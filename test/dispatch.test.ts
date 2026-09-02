// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { Duty, Task } from '../src/objects/index.js';
import { dulyJobs } from '../src/jobs/index.js';
import { dulyFunctions } from '../src/functions/index.js';
import {
  DISPATCH_HANDLER_NAME,
  DISPATCH_JOB_NAME,
  DISPATCH_PAGE_SIZE,
  DispatchJob,
  bindDispatchEngine,
  dulyDispatch,
  parseBackfillWindow,
  runDispatch,
  unbindDispatchEngine,
  type DispatchEngine,
} from '../src/jobs/dispatch.job.js';
import {
  DEFAULT_GRACE_DAYS,
  DEFAULT_TIMEZONE,
  DISPATCH_DUTY_FIELDS,
  FAULT_SKIP_REASONS,
  nextDispatchedPeriod,
  planDispatch,
  type DispatchDuty,
} from '../src/jobs/dispatch.plan.js';
import { dueDateFor, periodKeyFor, periodsBetween, visibleFromFor } from '../src/functions/period.js';

/**
 * The dispatch spine.
 *
 * Three layers, tested three ways, because each has a different way of being
 * wrong invisibly:
 *
 *  1. **Wiring.** A job needs two registrations — the schedule in `dulyJobs`
 *     and the handler in `dulyFunctions` — and the second has no author-time
 *     gate at all. `pnpm validate` passes on a job whose handler name matches
 *     nothing; `AppPlugin` logs a warning at boot and skips it. So the lookup
 *     the runtime performs is performed here.
 *
 *  2. **The planner**, pure. Every scheduling decision, driven directly with
 *     fixed clocks and no engine. This is where the zone and lead-time
 *     behaviour is cornered, because a planner that is wrong about Los Angeles
 *     produces a task on the wrong day and nothing errors.
 *
 *  3. **Idempotency**, against a REAL booted engine on **sqlite**. Not the
 *     memory driver, and this is the load-bearing choice in the file: measured
 *     on 17.2.0, `InMemoryDriver.create` is a `table.push()` that stores no
 *     constraints of any kind, so two identical `duly_task` inserts BOTH
 *     SUCCEED and the table ends with two rows. A dispatcher suite on the
 *     memory driver would report idempotency passing while the index that
 *     provides it was never consulted. `test/task-hook.test.ts` uses memory
 *     legitimately — it tests hook ordering, which needs no constraint — but
 *     the whole point of this job is a constraint, so it has to run somewhere
 *     that has one.
 */

type AnyRow = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────
// 1. Wiring — the failure mode that reads as success
// ─────────────────────────────────────────────────────────────────────────

describe('wiring', () => {
  it('is exported from the jobs barrel', () => {
    expect(dulyJobs).toContain(DispatchJob);
    expect(DispatchJob.name).toBe(DISPATCH_JOB_NAME);
  });

  it('reaches defineStack({ jobs }) — the only place the runtime reads', () => {
    const names = ((stack as { jobs?: Array<{ name?: string }> }).jobs ?? []).map((j) => j.name);
    expect(names).toContain(DISPATCH_JOB_NAME);
  });

  it("resolves its handler the way AppPlugin does: bundle.functions[job.handler]", () => {
    // `collectBundleFunctions` reads `defineStack({ functions })` and takes
    // `.handler` off each entry. A name that misses is logged and skipped —
    // the job stays registered and never runs, with no author-time gate.
    const functions = (stack as { functions?: Record<string, unknown> }).functions ?? {};
    const entry = functions[DispatchJob.handler] as { handler?: unknown } | undefined;
    expect(entry, `no function named '${DispatchJob.handler}' — the job would never execute`).toBeDefined();
    expect(typeof entry?.handler).toBe('function');
    expect(DispatchJob.handler).toBe(DISPATCH_HANDLER_NAME);
  });

  it('declares the handler as a writer, because it writes', () => {
    // A `script`-node function is pure by contract; one that writes declares it
    // so a run reports `unmeasuredEffect` instead of claiming it wrote nothing.
    const entry = dulyFunctions[DISPATCH_HANDLER_NAME] as { effect?: string };
    expect(entry.effect).toBe('writes');
  });

  it('is a UTC cron, and enabled', () => {
    expect(DispatchJob.schedule.type).toBe('cron');
    const schedule = DispatchJob.schedule as { timezone?: string; expression?: unknown };
    expect(schedule.timezone).toBe('UTC');
    // A disabled job is registered and never scheduled, which reads identically
    // to a working one from every surface except the logs.
    expect(DispatchJob.enabled).not.toBe(false);
  });

  it('threads a retry policy and a timeout to the adapter', () => {
    expect(DispatchJob.retryPolicy?.maxRetries).toBeGreaterThan(0);
    expect(DispatchJob.timeout).toBeGreaterThan(0);
  });
});

describe('the cadence fallbacks are the object schema, not a second opinion', () => {
  // The planner is pure and imports no metadata, so it restates `duly_duty`'s
  // declared defaults. This assertion is what stops the two from drifting
  // into two answers — the same pin as DEFAULT_DUTY_TIMEZONE in the catalog
  // handlers.
  it('timezone', () => expect(Duty.fields.timezone.defaultValue).toBe(DEFAULT_TIMEZONE));

  // `lead_days` / `due_offset_days` / `due_anchor` no longer carry a plain
  // literal default (#61): the value must be BLANK, not the cadence default,
  // on a duty the planner never reads them for (standing, one-off) — see
  // `duty.object.ts`'s cadence block. Each is now a CEL `defaultValue` (the
  // blessed null-guard idiom, objectstack#3306), which `pnpm validate`
  // accepts structurally and never evaluates (`field.zod.ts`'s authoring
  // gate returns unconditionally on `shape === 'expression'`), so a
  // STRUCTURAL pin here — reading `.defaultValue` off the schema — would
  // prove nothing about whether the expression actually behaves. The real
  // pin — that a RECURRING duty still gets exactly `DEFAULT_DUE_ANCHOR` /
  // `DEFAULT_DUE_OFFSET_DAYS` / `DEFAULT_LEAD_DAYS`, against a booted engine
  // that actually evaluates the CEL — lives in
  // `test/cadence-conditional-defaults.test.ts`, alongside the standing/
  // one-off assertions that these come back blank.
});

describe('the duty projection covers every field the planner reads', () => {
  it('names only real duly_duty fields', () => {
    const declared = new Set([...Object.keys(Duty.fields), 'id']);
    for (const field of DISPATCH_DUTY_FIELDS) {
      expect(declared.has(field), `'${field}' is not a duly_duty field`).toBe(true);
    }
  });

  it('includes every field a draft is built from', () => {
    // A field the planner reads but the projection omits comes back undefined,
    // which reads exactly like "the duty does not set it".
    for (const field of [
      'name',
      'form',
      'status',
      'owner',
      'business_unit',
      'source',
      // The dispatch gate. Omitted from the projection it comes back
      // `undefined`, which the planner reads as "not approved" — every duty
      // in the tenant would stop dispatching, quietly, on the next deploy.
      'review_status',
      'frequency',
      'due_anchor',
      'due_offset_days',
      'lead_days',
      // Read for `late_after`. Omitted, it comes back undefined — which reads
      // as "this duty grants no grace", so every task would be dispatched with
      // its deadline on the due date and the Late list would be the grace-free
      // one #48 was filed against, with nothing erroring.
      'grace_days',
      'timezone',
      'effective_from',
      'effective_to',
      'last_dispatched_period',
    ]) {
      expect(DISPATCH_DUTY_FIELDS as readonly string[]).toContain(field);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. The planner — pure, fixed clocks
// ─────────────────────────────────────────────────────────────────────────

const duty = (over: Partial<DispatchDuty> = {}): DispatchDuty => ({
  id: 'duty_1',
  name: 'File the emissions return',
  form: 'recurring',
  status: 'active',
  owner: 'user_alice',
  business_unit: 'bu_plant',
  source: 'catalog',
  // The steady state of a duty that is actually being worked. Stated on the
  // fixture rather than defaulted inside the planner, so the gate below has
  // something to turn OFF — a planner that silently treated a missing review
  // state as approved would pass every test in this file.
  review_status: 'approved',
  frequency: 'monthly',
  due_anchor: 'period_start',
  due_offset_days: 4,
  lead_days: 0,
  timezone: 'UTC',
  effective_from: null,
  effective_to: null,
  last_dispatched_period: null,
  ...over,
});

const keysOf = (duties: DispatchDuty[], now: Date, window?: { from: string; to: string } | null) =>
  planDispatch({ duties, now, window: window ?? null }).drafts.map((d) => d.period_key);

describe('what is never dispatched', () => {
  const now = new Date('2026-08-15T09:00:00Z');

  it('a standing duty produces nothing, in any run', () => {
    // Not created and immediately closed — skipped entirely. A standing duty
    // never completes, so a task for one is a row nobody can ever tick.
    expect(keysOf([duty({ form: 'standing' })], now)).toEqual([]);
    expect(keysOf([duty({ form: 'standing' })], now, { from: '2025-01-01', to: '2026-12-31' })).toEqual([]);
    expect(planDispatch({ duties: [duty({ form: 'standing' })], now }).skipped[0]?.reason).toBe('standing');
  });

  it('a one-off duty produces nothing — that is the fan-out\'s job', () => {
    expect(keysOf([duty({ form: 'one_off' })], now)).toEqual([]);
    expect(planDispatch({ duties: [duty({ form: 'one_off' })], now }).skipped[0]?.reason).toBe('one_off');
  });

  it('a paused duty produces nothing, and a retired one produces nothing', () => {
    for (const status of ['paused', 'retired']) {
      expect(keysOf([duty({ status })], now), status).toEqual([]);
      expect(planDispatch({ duties: [duty({ status })], now }).skipped[0]?.reason).toBe('not_active');
    }
  });

  it('an unapproved duty produces nothing, whatever the review state is', () => {
    // The four states the pipeline can be in, and the one that dispatches.
    // Written as a sweep rather than one case, because the failure this
    // guards against is a gate written as "not returned" — which would let
    // `to_confirm` and `to_review` through and make the confirmation step
    // decorative.
    for (const review_status of ['to_confirm', 'to_review', 'returned']) {
      expect(keysOf([duty({ review_status })], now), review_status).toEqual([]);
      expect(
        planDispatch({ duties: [duty({ review_status })], now }).skipped[0]?.reason,
        review_status,
      ).toBe('not_approved');
    }
    expect(keysOf([duty({ review_status: 'approved' })], now)).toEqual(['2026-08']);
  });

  it('a duty carrying NO review state produces nothing either', () => {
    // Fail-closed, and this is the case that decides the direction. A row
    // that predates the column, or arrived through a path that skipped the
    // default, is not "grandfathered in" — it stops until somebody approves
    // it. The recoverable failure is the one that is visible.
    expect(keysOf([duty({ review_status: null })], now)).toEqual([]);
    expect(keysOf([duty({ review_status: undefined })], now)).toEqual([]);
    expect(planDispatch({ duties: [duty({ review_status: null })], now }).skipped[0]?.reason)
      .toBe('not_approved');
  });

  it('an unapproved duty is an ordinary skip, not a degraded run', () => {
    // `not_approved` must stay OUT of `FAULT_SKIP_REASONS`. A tenant part-way
    // through a rollout has hundreds of them, and a nightly job that reports
    // `degraded` every night is a job whose alerts get muted — after which the
    // one real fault it exists to report goes unread too.
    expect(FAULT_SKIP_REASONS as readonly string[]).not.toContain('not_approved');
  });

  it('backfilling does not smuggle an unapproved duty past the gate', () => {
    // A backfill skips the duty-level effective window on purpose, so it is
    // worth pinning that it does NOT skip this. Returning a duty and then
    // asking for last month must not re-create the work it stopped.
    expect(keysOf([duty({ review_status: 'returned' })], now, { from: '2026-01-01', to: '2026-08-31' }))
      .toEqual([]);
  });

  it('un-pausing produces only the current period, never the gap', () => {
    // The duty was last dispatched in February and has been paused since. The
    // rule is "the current period", not "everything you missed" — a person
    // coming back from three months' leave gets this month's work, not ninety
    // days of backlog they cannot do anything about.
    const resumed = duty({ status: 'active', last_dispatched_period: '2026-02' });
    expect(keysOf([resumed], now)).toEqual(['2026-08']);
  });

  it('a duty outside its effective window produces nothing', () => {
    expect(keysOf([duty({ effective_from: '2026-09-01' })], now)).toEqual([]);
    expect(keysOf([duty({ effective_to: '2026-07-31' })], now)).toEqual([]);
    expect(planDispatch({ duties: [duty({ effective_to: '2026-07-31' })], now }).skipped[0]?.reason).toBe(
      'outside_effective_window',
    );
  });

  it('a recurring duty with no frequency is a FAULT, not a quiet skip', () => {
    // `recurring_needs_frequency` should make this unreachable. If it is ever
    // reached, the run must say so rather than silently dispatching nobody.
    const plan = planDispatch({ duties: [duty({ frequency: null })], now });
    expect(plan.drafts).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('no_frequency');
  });

  it('a bad timezone stops that duty and nothing else', () => {
    const plan = planDispatch({ duties: [duty({ id: 'bad', timezone: 'Mars/Olympus' }), duty({ id: 'good' })], now });
    expect(plan.skipped.map((s) => s.reason)).toEqual(['invalid_cadence']);
    expect(plan.skipped[0]?.detail).toBeTruthy();
    expect(plan.drafts.map((d) => d.duty)).toEqual(['good']);
  });
});

describe('one UTC pass, every zone right', () => {
  it('Asia/Shanghai and America/Los_Angeles get different local periods from one instant', () => {
    // 2026-08-31T20:00Z is 2026-09-01 04:00 in Shanghai and 2026-08-31 13:00 in
    // Los Angeles. Both duties are monthly; both answers are correct, and they
    // are different months.
    const now = new Date('2026-08-31T20:00:00Z');
    const plan = planDispatch({
      duties: [
        duty({ id: 'cn', timezone: 'Asia/Shanghai' }),
        duty({ id: 'us', timezone: 'America/Los_Angeles' }),
      ],
      now,
    });
    const byDuty = Object.fromEntries(plan.drafts.map((d) => [d.duty, d.period_key]));
    expect(byDuty).toEqual({ cn: '2026-09', us: '2026-08' });
  });

  it('the due date is resolved in the duty\'s zone too', () => {
    const now = new Date('2026-08-31T20:00:00Z');
    const plan = planDispatch({ duties: [duty({ id: 'cn', timezone: 'Asia/Shanghai' })], now });
    // due_anchor period_start + 4 → the 5th of the duty's own September.
    expect(plan.drafts[0]?.due_date).toBe('2026-09-05');
  });

  it('every spelling in a draft is the period engine\'s, not this planner\'s', () => {
    // The one assertion that makes the "sole authority" rule mean something: a
    // draft is recomputed here straight from period.ts and must match byte for
    // byte. A second derivation anywhere would show up as a mismatch.
    const now = new Date('2026-08-15T09:00:00Z');
    for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Auckland']) {
      for (const frequency of ['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'semiannual', 'annual'] as const) {
        const d = duty({ frequency, timezone, lead_days: 3, due_anchor: 'period_end', due_offset_days: 0 });
        const [draft] = planDispatch({ duties: [d], now }).drafts;
        const expectedKey = periodKeyFor(frequency, now, timezone);
        const expectedDue = dueDateFor({
          frequency,
          periodKey: expectedKey,
          timezone,
          dueAnchor: 'period_end',
          dueOffsetDays: 0,
        });
        const label = `${frequency} @ ${timezone}`;
        expect(draft?.period_key, label).toBe(expectedKey);
        expect(draft?.due_date, label).toBe(expectedDue);
        expect(draft?.visible_from, label).toBe(visibleFromFor(expectedDue, 3));
      }
    }
  });
});

describe('lead time decides how far ahead a task exists', () => {
  it('with no lead time, only the current period', () => {
    const now = new Date('2026-08-27T09:00:00Z');
    expect(keysOf([duty({ lead_days: 0 })], now)).toEqual(['2026-08']);
  });

  it('with lead time, next period\'s task exists once its window opens', () => {
    // Monthly, due on the 3rd (period_start + 2), 7 days of lead → September's
    // task becomes visible on 2026-08-27 and must therefore exist by then.
    const d = duty({ due_offset_days: 2, lead_days: 7 });
    expect(keysOf([d], new Date('2026-08-26T09:00:00Z'))).toEqual(['2026-08']);
    expect(keysOf([d], new Date('2026-08-27T09:00:00Z'))).toEqual(['2026-08', '2026-09']);
  });

  it('the current period exists even when its own lead window has not opened', () => {
    // Due at period end with no lead: `visible_from` is 31 August, in the
    // future on 1 August. `visible_from` governs when a task SHOWS UP, not
    // whether it EXISTS, so the row is owed today.
    const now = new Date('2026-08-01T09:00:00Z');
    const [draft] = planDispatch({
      duties: [duty({ due_anchor: 'period_end', due_offset_days: 0, lead_days: 0 })],
      now,
    }).drafts;
    expect(draft?.period_key).toBe('2026-08');
    expect(draft?.due_date).toBe('2026-08-31');
    expect(draft?.visible_from).toBe('2026-08-31');
  });

  it('the look-ahead is bounded by lead_days, so a long lead does not run away', () => {
    // 400 days of lead on an annual duty reaches next year and stops there —
    // not the year after, whose visible_from is still in the future.
    const now = new Date('2026-08-15T09:00:00Z');
    const d = duty({ frequency: 'annual', due_anchor: 'period_start', due_offset_days: 0, lead_days: 400 });
    expect(keysOf([d], now)).toEqual(['2026', '2027']);
  });
});

describe('the copied fields', () => {
  it('copies the subject and denormalises the business unit from the DUTY', () => {
    const now = new Date('2026-08-15T09:00:00Z');
    const [draft] = planDispatch({ duties: [duty()], now }).drafts;
    expect(draft).toMatchObject({
      subject: 'File the emissions return',
      duty: 'duty_1',
      owner: 'user_alice',
      // From the duty, not the owner's current unit: a later transfer must not
      // move historical rollups.
      business_unit: 'bu_plant',
      source: 'catalog',
      status: 'open',
    });
  });

  it('never writes a status other than open, and never writes the server-owned stamps', () => {
    const now = new Date('2026-08-15T09:00:00Z');
    const [draft] = planDispatch({ duties: [duty()], now }).drafts;
    expect(draft?.status).toBe('open');
    // `completed_at` / `last_update_at` belong to task.hook.ts. A dispatcher
    // that wrote either would be a second writer on the stagnation clock.
    expect(Object.keys(draft ?? {})).not.toContain('completed_at');
    expect(Object.keys(draft ?? {})).not.toContain('last_update_at');
    // `late_after` is the exception, and it is not a second writer: it is
    // knowable ONLY here, from a duty field the task does not carry, and it is
    // never written again (#52).
    expect(Object.keys(draft ?? {})).toContain('late_after');
  });
});

/**
 * `late_after` — the lateness deadline, resolved once, at dispatch (#52).
 *
 * The planner is where the duty's `grace_days` is in hand, and it is the only
 * place it is in hand: `duly_task` carries no duty grace of its own, and the
 * task's own filter grammar cannot add an interval held in a joined column
 * (objectstack#14104). So the stamp is what turns "late" into a plain date
 * comparison everywhere downstream.
 */
describe('late_after — due date plus the grace the duty granted', () => {
  const now = new Date('2026-08-15T09:00:00Z');
  const only = (over: Partial<DispatchDuty>) => planDispatch({ duties: [duty(over)], now }).drafts[0];

  it('adds the duty grace to the due date', () => {
    const draft = only({ grace_days: 7 });
    expect(draft?.due_date).toBe('2026-08-05');
    expect(draft?.late_after).toBe('2026-08-12');
  });

  it('a duty granting no grace is late the day after the due date, not on it', () => {
    // `late_after` IS the last day still inside the window, so a zero-grace
    // duty stamps the due date itself — the `late` view then asks
    // `late_after < today`, which fires the following morning. That is the same
    // day-one the overdue escalation fires on (`due_date + grace + 1`), which
    // is the disagreement #52 existed to end.
    expect(only({ grace_days: 0 })?.late_after).toBe('2026-08-05');
  });

  it('an ABSENT grace reads as zero, never as "no deadline"', () => {
    // The trap: a null grace producing a null `late_after` would produce a task
    // that can never be late on any surface — silently, and only for the duties
    // whose grace nobody filled in. Zero is also how the overdue escalation
    // already reads an absent grace.
    expect(only({ grace_days: null })?.late_after).toBe('2026-08-05');
    expect(only({ grace_days: undefined })?.late_after).toBe('2026-08-05');
    expect(DEFAULT_GRACE_DAYS).toBe(0);
  });

  it('crosses a month end by the calendar, not by 24-hour arithmetic', () => {
    // Through the period engine's own civil-date shift, like `visible_from`.
    const draft = planDispatch({
      duties: [duty({ due_anchor: 'period_end', due_offset_days: 0, grace_days: 5 })],
      now: new Date('2026-08-15T09:00:00Z'),
    }).drafts[0];
    expect(draft?.due_date).toBe('2026-08-31');
    expect(draft?.late_after).toBe('2026-09-05');
  });

  it('the grace the DUTY held is the one stamped — nothing reads it again later', () => {
    // Two duties, two graces, one run: the deadline travels on the row from
    // here, so a later edit to either duty cannot reach the tasks it produced.
    const drafts = planDispatch({
      duties: [duty({ id: 'strict', grace_days: 0 }), duty({ id: 'lenient', grace_days: 14 })],
      now,
    }).drafts;
    expect(drafts.map((d) => `${d.duty}:${d.late_after}`)).toEqual([
      'strict:2026-08-05',
      'lenient:2026-08-19',
    ]);
  });
});

describe('backfill', () => {
  const now = new Date('2026-08-15T09:00:00Z');

  it('a 13-month window produces exactly the expected key set', () => {
    const window = { from: '2025-08-01', to: '2026-08-31' };
    const keys = keysOf([duty()], now, window);
    expect(keys).toEqual([
      '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
      '2026-06', '2026-07', '2026-08',
    ]);
    // And that set is `periodsBetween`'s, not a second walk written here.
    expect(keys).toEqual(
      periodsBetween('monthly', new Date('2025-08-01T12:00:00Z'), new Date('2026-08-31T12:00:00Z'), 'UTC'),
    );
  });

  it('clips to the duty\'s effective window, per period', () => {
    const d = duty({ effective_from: '2026-03-10', effective_to: '2026-06-30' });
    // Due on the 5th, so March's due date (2026-03-05) predates the window.
    expect(keysOf([d], now, { from: '2025-08-01', to: '2026-08-31' })).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('backfills a duty whose window has already closed', () => {
    // The duty-level "today is inside the window" gate is the SCHEDULED run's
    // selection rule. Applying it to a backfill would make backfill useless for
    // the case it exists for.
    const d = duty({ effective_to: '2026-06-30' });
    expect(keysOf([d], now)).toEqual([]);
    expect(keysOf([d], now, { from: '2026-04-01', to: '2026-08-31' })).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('ignores the visibility gate — a past period is not "not visible yet"', () => {
    const d = duty({ lead_days: 0, due_anchor: 'period_end' });
    expect(keysOf([d], now, { from: '2026-06-01', to: '2026-08-31' })).toEqual(['2026-06', '2026-07', '2026-08']);
  });
});

describe('parseBackfillWindow', () => {
  const now = new Date('2026-08-15T09:00:00Z');

  it('no input is the scheduled run', () => {
    expect(parseBackfillWindow(undefined, now)).toBeNull();
    expect(parseBackfillWindow(null, now)).toBeNull();
    expect(parseBackfillWindow({}, now)).toBeNull();
  });

  it('from alone runs up to the clock', () => {
    expect(parseBackfillWindow({ from: '2026-01-01' }, now)).toEqual({ from: '2026-01-01', to: '2026-08-15' });
  });

  it('both ends are honoured', () => {
    expect(parseBackfillWindow({ from: '2026-01-01', to: '2026-03-31' }, now)).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('refuses a "to" with no floor rather than guessing one', () => {
    expect(() => parseBackfillWindow({ to: '2026-03-31' }, now)).toThrow(/needs 'from'/);
  });

  it('refuses a malformed date and a reversed window', () => {
    expect(() => parseBackfillWindow({ from: '01/01/2026' }, now)).toThrow(/YYYY-MM-DD/);
    expect(() => parseBackfillWindow({ from: '2026-01-01', to: 7 }, now)).toThrow(/YYYY-MM-DD/);
    expect(() => parseBackfillWindow({ from: '2026-05-01', to: '2026-01-01' }, now)).toThrow(/ends before it starts/);
    expect(() => parseBackfillWindow('2026-01-01', now)).toThrow(/must be an object/);
  });
});

describe('nextDispatchedPeriod — advances, never regresses', () => {
  it('takes the latest key created', () => {
    expect(nextDispatchedPeriod(null, ['2026-08', '2026-09'])).toBe('2026-09');
    expect(nextDispatchedPeriod('2026-02', ['2026-08'])).toBe('2026-08');
  });

  it('writes nothing when the run created nothing', () => {
    expect(nextDispatchedPeriod('2026-08', [])).toBeNull();
    expect(nextDispatchedPeriod(null, [])).toBeNull();
  });

  it('writes nothing rather than moving backwards', () => {
    expect(nextDispatchedPeriod('2026-09', ['2026-08'])).toBeNull();
    expect(nextDispatchedPeriod('2026-08', ['2026-08'])).toBeNull();
  });

  it('is chronological for every frequency spelling', () => {
    expect(nextDispatchedPeriod('2026-W09', ['2026-W10'])).toBe('2026-W10');
    expect(nextDispatchedPeriod('2026-Q1', ['2026-Q3'])).toBe('2026-Q3');
    expect(nextDispatchedPeriod('2026-H1', ['2026-H2'])).toBe('2026-H2');
    expect(nextDispatchedPeriod('2025', ['2026'])).toBe('2026');
    expect(nextDispatchedPeriod('2026-08-09', ['2026-08-10'])).toBe('2026-08-10');
    // The zero padding is what makes a lexical compare chronological.
    expect(nextDispatchedPeriod('2026-W09', ['2026-W08'])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Idempotency, against a real engine that actually has the index
// ─────────────────────────────────────────────────────────────────────────

let kernel: { getService(name: string): unknown; shutdown?(): Promise<void> } | undefined;
/**
 * The booted engine, typed as the rows it actually returns.
 *
 * Not `DispatchEngine`: that contract returns `unknown[]` so a caller cannot
 * read a field it did not ask for, which is right for the dispatcher and
 * useless for a test that has to inspect the rows. The real engine satisfies
 * both, and the tests pass it straight to `runDispatch` structurally.
 */
let data: {
  find(o: string, q?: AnyRow, x?: AnyRow): Promise<AnyRow[]>;
  insert(o: string, d: AnyRow, x?: AnyRow): Promise<AnyRow>;
  update(o: string, d: AnyRow, x?: AnyRow): Promise<unknown>;
};

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    // sqlite, NOT memory: the memory driver stores no constraints, so the
    // unique index this whole job rests on would not exist and every
    // idempotency assertion below would pass without testing anything.
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // Left to its default this resolves `<cwd>/dist/objectstack.json`, and a
    // local `pnpm build` would make the suite report on the last BUILD rather
    // than on `src/` — passing with the barrel entry deleted, and behaving
    // differently in CI (where `pnpm test` runs before `pnpm build`).
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  const k = new ObjectKernel();
  for (const plugin of plugins) await k.use(plugin);
  await k.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await k.bootstrap();
  kernel = k as unknown as typeof kernel;
  data = k.getService('data') as typeof data;
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

/**
 * Every duty a test seeds, retired again when it ends.
 *
 * The suite shares one database, and `runDispatch` sweeps EVERY active
 * recurring duty — so without this, a later test's run keeps creating tasks for
 * an earlier test's duties and any assertion on a run-level count
 * (`created === 0`) measures the whole file's history instead of this test.
 * Retiring is enough: a retired duty leaves the sweep, and leaving the rows in
 * place keeps each test's evidence readable if it fails.
 */
const seeded: string[] = [];

afterEach(async () => {
  unbindDispatchEngine();
  while (seeded.length > 0) {
    const id = seeded.pop() as string;
    await data.update('duly_duty', { status: 'retired' }, { where: { id }, multi: false });
  }
});

let seq = 0;
const seedDuty = async (over: AnyRow = {}, options?: AnyRow): Promise<string> => {
  const created = await data.insert('duly_duty', {
    name: `Duty ${++seq}`,
    form: 'recurring',
    owner: `user_${seq}`,
    source: 'catalog',
    status: 'active',
    frequency: 'monthly',
    due_anchor: 'period_start',
    due_offset_days: 4,
    lead_days: 0,
    timezone: 'UTC',
    review_status: 'approved',
    ...over,
  }, {
    ...options,
    context: {
      // A duty may not be CREATED `approved` — `review_status_transitions`
      // declares `initialStates: ['to_confirm', 'to_review']`, and that is the
      // rule, not an obstacle to route around. This fixture is writing
      // established history (a duty that was approved some time ago), so it
      // takes the platform's own door for exactly that: `skipStateMachine` is
      // the context key the REST import endpoint sets for a `treatAsHistorical`
      // import, and the seed loader's `seedReplay` reaches the same branch.
      // The pipeline itself is exercised through ordinary writes in
      // `test/duty-review.test.ts`, which is where it must not be bypassed.
      skipStateMachine: true,
      ...((options?.context as AnyRow | undefined) ?? {}),
    },
  });
  const row = (Array.isArray(created) ? created[0] : created) as AnyRow;
  seeded.push(String(row.id));
  return String(row.id);
};

const tasksFor = async (dutyId: string): Promise<AnyRow[]> =>
  data.find('duly_task', { where: { duty: dutyId }, orderBy: [{ field: 'period_key', order: 'asc' }] });

const readDuty = async (dutyId: string): Promise<AnyRow> =>
  (await data.find('duly_duty', { where: { id: dutyId }, limit: 1 }))[0] as AnyRow;

const NOW = new Date('2026-08-15T09:00:00Z');

describe('the index is real on this engine', () => {
  it('refuses a second (duty, owner, period_key) — which is what makes the job ordinary', async () => {
    // Asserted rather than assumed. If this ever goes green-by-absence — a
    // driver swap, an index rename — every idempotency test below becomes a
    // test of nothing, and this is the one that says so.
    const dutyId = await seedDuty();
    const row = { subject: 'x', duty: dutyId, owner: 'user_dup', period_key: '2099-01', source: 'catalog', status: 'open' };
    await data.insert('duly_task', row);
    await expect(data.insert('duly_task', { ...row })).rejects.toThrow();
    expect(await data.find('duly_task', { where: { period_key: '2099-01' } })).toHaveLength(1);
  });
});

describe('the review gate, against the real engine', () => {
  it('a returned duty generates nothing; walking it back to approved generates its tasks', async () => {
    // The demo beat, end to end: change one field, tomorrow's work changes.
    const dutyId = await seedDuty({
      lead_days: 0,
      review_status: 'returned',
      review_note: 'Monthly is wrong for this — the permit says quarterly.',
    });

    const blocked = await runDispatch(data, { now: NOW });
    expect(await tasksFor(dutyId), 'a returned duty owes nobody anything').toHaveLength(0);
    // It is not even READ: the sweep's own query filters on `review_status`,
    // so an unapproved duty costs the nightly run nothing at all.
    expect(blocked.skipped.some((skip) => skip.duty === dutyId)).toBe(false);

    // The owner corrects it and sends it back up; the manager approves. Two
    // writes, because `returned → approved` is not a step the machine has.
    await data.update('duly_duty', { id: dutyId, review_status: 'to_review' });
    await data.update('duly_duty', { id: dutyId, review_status: 'approved' });

    await runDispatch(data, { now: NOW });
    expect((await tasksFor(dutyId)).map((task) => task.period_key)).toEqual(['2026-08']);
  });

  it('returning an approved duty stops the NEXT run, and leaves the tasks already dispatched alone', async () => {
    // The other half, and the one a "just filter the view" implementation
    // would get wrong: returning a duty is not a retraction of work already
    // owed. August's task stays; September's is never created.
    const dutyId = await seedDuty({ lead_days: 0, frequency: 'monthly' });
    await runDispatch(data, { now: NOW });
    expect((await tasksFor(dutyId)).map((task) => task.period_key)).toEqual(['2026-08']);

    await data.update('duly_duty', {
      id: dutyId,
      review_status: 'returned',
      review_note: 'Superseded by the group standard — rewrite the acceptance bar.',
    });

    const september = new Date('2026-09-15T09:00:00Z');
    const after = await runDispatch(data, { now: september });
    expect(after.created, 'a returned duty creates nothing on the next night').toBe(0);
    expect((await tasksFor(dutyId)).map((task) => task.period_key)).toEqual(['2026-08']);
  });
});

describe('running twice over the same clock', () => {
  it('the second pass inserts nothing, and that is a successful run', async () => {
    const dutyId = await seedDuty({ lead_days: 0 });

    const first = await runDispatch(data, { now: NOW });
    expect(first.created).toBeGreaterThan(0);
    const afterFirst = await tasksFor(dutyId);
    expect(afterFirst.map((t) => t.period_key)).toEqual(['2026-08']);

    const second = await runDispatch(data, { now: NOW });
    expect(second.created).toBe(0);
    expect(second.existing).toBeGreaterThan(0);
    expect(second.degradedReason).toBeUndefined();
    expect(await tasksFor(dutyId)).toHaveLength(1);
  });

  it('two overlapping runs produce one task, not two', async () => {
    // The race the unique index exists for. Both runs plan the same draft; one
    // insert wins, the other fails, reads, finds the row and reports it as
    // already existing. Neither run fails.
    const dutyId = await seedDuty({ lead_days: 0 });
    const [a, b] = await Promise.all([runDispatch(data, { now: NOW }), runDispatch(data, { now: NOW })]);
    expect(await tasksFor(dutyId)).toHaveLength(1);
    const forThisDuty = (r: { created: number }) => r.created;
    expect(forThisDuty(a) + forThisDuty(b)).toBeGreaterThan(0);
  });

  it('never touches an existing task row — the stagnation clock stays put', async () => {
    // `last_update_at` is hook-stamped on every task write and deliberately
    // does not advance on administrative ones. If the dispatcher ever updated
    // a task, every stalled item would look freshly worked and the signal would
    // go quiet with no error anywhere.
    const dutyId = await seedDuty({ lead_days: 0 });
    await runDispatch(data, { now: NOW });
    const before = (await tasksFor(dutyId))[0];

    const writes: string[] = [];
    const spy: DispatchEngine = {
      find: (o, q, x) => data.find(o, q as AnyRow, x as AnyRow),
      insert: (o, d, x) => data.insert(o, d, x as AnyRow),
      update: (o, d, x) => {
        writes.push(o);
        return data.update(o, d, x as AnyRow);
      },
    };
    await runDispatch(spy, { now: NOW });
    await runDispatch(spy, { now: new Date('2026-09-15T09:00:00Z') });

    expect(writes, 'the dispatcher must never update duly_task').not.toContain('duly_task');
    const after = (await tasksFor(dutyId))[0];
    expect(after.last_update_at).toBe(before.last_update_at);
    expect(after.status).toBe('open');
  });
});

describe('last_dispatched_period', () => {
  it('advances to the latest key created, and stays put on a no-op run', async () => {
    const dutyId = await seedDuty({ lead_days: 0 });
    await runDispatch(data, { now: NOW });
    expect((await readDuty(dutyId)).last_dispatched_period).toBe('2026-08');

    const again = await runDispatch(data, { now: NOW });
    expect(again.advanced).toBe(0);
    expect((await readDuty(dutyId)).last_dispatched_period).toBe('2026-08');

    await runDispatch(data, { now: new Date('2026-09-15T09:00:00Z') });
    expect((await readDuty(dutyId)).last_dispatched_period).toBe('2026-09');
  });

  it('never regresses when an older period is backfilled afterwards', async () => {
    const dutyId = await seedDuty({ lead_days: 0 });
    await runDispatch(data, { now: NOW });
    expect((await readDuty(dutyId)).last_dispatched_period).toBe('2026-08');

    await runDispatch(data, { now: NOW, window: { from: '2026-01-01', to: '2026-05-31' } });
    expect((await readDuty(dutyId)).last_dispatched_period).toBe('2026-08');
    expect((await tasksFor(dutyId)).map((t) => t.period_key)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-08',
    ]);
  });
});

describe('backfill against the engine', () => {
  it('a second backfill over the same window inserts nothing', async () => {
    const dutyId = await seedDuty({ lead_days: 0, effective_from: '2025-01-01' });
    const window = { from: '2025-08-01', to: '2026-08-31' };

    const first = await runDispatch(data, { now: NOW, window });
    expect(first.created).toBe(13);
    expect((await tasksFor(dutyId))).toHaveLength(13);

    const second = await runDispatch(data, { now: NOW, window });
    expect(second.created).toBe(0);
    expect(second.existing).toBe(13);
    expect((await tasksFor(dutyId))).toHaveLength(13);
  });
});

describe('a real failure is re-raised, not swallowed as a duplicate', () => {
  it('rethrows when the row is genuinely absent after a failed insert', async () => {
    // The half a blanket try/catch gets wrong. A create that fails for a reason
    // other than "already there" must fail the RUN — otherwise the dispatcher
    // reports a clean night on which nothing was created.
    await seedDuty({ lead_days: 0 });
    const boom = new Error('the store is on fire');
    const broken: DispatchEngine = {
      find: (o, q, x) => data.find(o, q as AnyRow, x as AnyRow),
      insert: (o) => (o === 'duly_task' ? Promise.reject(boom) : Promise.reject(boom)),
      update: (o, d, x) => data.update(o, d, x as AnyRow),
    };
    await expect(runDispatch(broken, { now: new Date('2027-03-15T09:00:00Z') })).rejects.toThrow('the store is on fire');
  });
});

describe('paging', () => {
  it('keeps reading while a page comes back full', async () => {
    // The sweep must not stop at the first page. Driven with a fake rather than
    // 201 real duties: the assertion is about the loop, not the store.
    const pages: number[] = [];
    const makeDuty = (i: number): DispatchDuty => ({
      id: `d${i}`, name: 'n', form: 'standing', status: 'active', owner: 'u', source: 'self',
    });
    const paging: DispatchEngine = {
      find: async (object, query): Promise<unknown[]> => {
        if (object !== 'duly_duty') return [];
        const offset = Number((query as { offset?: number })?.offset ?? 0);
        pages.push(offset);
        if (offset === 0) return Array.from({ length: DISPATCH_PAGE_SIZE }, (_, i) => makeDuty(i));
        if (offset === DISPATCH_PAGE_SIZE) return [makeDuty(999)];
        return [];
      },
      insert: async () => ({}),
      update: async () => undefined,
    };
    const result = await runDispatch(paging, { now: NOW });
    expect(pages).toEqual([0, DISPATCH_PAGE_SIZE]);
    expect(result.duties).toBe(DISPATCH_PAGE_SIZE + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. The handler, and the seam it needs
// ─────────────────────────────────────────────────────────────────────────

describe('the job handler', () => {
  it('refuses loudly when no host has bound an engine', async () => {
    // The platform hands a job handler { jobId, data, bundle } and no engine.
    // Until a host wires one, this must FAIL — a dispatcher that quietly does
    // nothing is the worst failure this product can have.
    unbindDispatchEngine();
    await expect(dulyDispatch({ jobId: DISPATCH_JOB_NAME })).rejects.toThrow(/no data engine/);
  });

  it('dispatches through the bound engine and reports completed', async () => {
    const dutyId = await seedDuty({ lead_days: 0 });
    bindDispatchEngine(data);
    const outcome = await dulyDispatch({ jobId: DISPATCH_JOB_NAME });
    expect(outcome).toEqual({ outcome: 'completed' });
    expect((await tasksFor(dutyId)).length).toBeGreaterThan(0);
  });

  it('takes a backfill window off the job input channel', async () => {
    // `IJobService.trigger(name, data)` forwards `data` to the handler; this is
    // the only non-schedule way into the job, and the reason the dispatcher is
    // a job rather than a scheduled flow.
    const dutyId = await seedDuty({ lead_days: 0, effective_from: '2026-01-01' });
    bindDispatchEngine(data);
    await dulyDispatch({ jobId: DISPATCH_JOB_NAME, data: { from: '2026-03-01', to: '2026-05-31' } });
    expect((await tasksFor(dutyId)).map((t) => t.period_key)).toEqual(['2026-03', '2026-04', '2026-05']);
  });

  it('reports degraded — not failed — when a duty could not be dispatched', async () => {
    // `degraded` is "ran to completion, work did not happen". It never retries,
    // which is right: retrying a typo'd timezone at 01:05 will not fix it.
    //
    // ── Why this row needs `skipAutomations` to exist at all (#24) ────────
    // `duly_duty_timezone_guard` now refuses an unresolvable zone on the way
    // in, so an ordinary write can no longer produce this row — which is the
    // point of that guard, and this assertion would otherwise have to be
    // deleted along with the defect it describes. It must NOT be deleted: the
    // rows it models still exist. `skipAutomations` is the platform's own
    // "import with run automations unchecked" opt-out (`triggerHooks` skips
    // metadata-bound hooks on it), and it is exactly how such a duty is born
    // in the wild — an import that bypassed the guard, a row that predates it,
    // or a zone the host's tzdata stopped recognising after the duty was
    // saved. Dispatch must still degrade rather than fail on those, and must
    // still not retry them.
    await seedDuty({ timezone: 'Mars/Olympus' }, { context: { skipAutomations: true } });
    bindDispatchEngine(data);
    const outcome = await dulyDispatch({ jobId: DISPATCH_JOB_NAME });
    expect(outcome.outcome).toBe('degraded');
    expect(outcome.reason).toMatch(/invalid_cadence/);
  });
});

describe('the product invariants this job must not undo', () => {
  it('the identity index is still what dispatch relies on', () => {
    const identity = Task.indexes?.find((i) => i.name === 'duly_task_dispatch_identity');
    expect(identity?.fields).toEqual(['duty', 'owner', 'period_key']);
    expect(identity?.unique).toBe('organization');
  });
});
