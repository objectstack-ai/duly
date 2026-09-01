// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppPlugin, ObjectKernel, SeedLoaderService, createStandaloneStack } from '@objectstack/runtime';
import { SeedLoaderRequestSchema } from '@objectstack/spec/data';

import { FREQUENCIES, periodBounds, periodKeyFor, type Frequency } from '../src/functions/period.js';
import { ADMIN, PEOPLE, UNITS } from '../src/data/demo-org.js';
import { CATALOG_ITEMS, DUTIES } from '../src/data/demo-catalog.js';
import { AD_HOC_TASKS, ASSIGNMENTS } from '../src/data/demo-assignments.js';
import { SEEDED_TASKS, SKIPS, TODAY } from '../src/data/demo-history.js';

/**
 * The demo seed, asserted against a REAL BOOTED KERNEL with the declarative
 * seeder actually running — not against the fixture arrays.
 *
 * That distinction is the whole point of this suite. Everything in
 * `src/data/demo-*.ts` is plain TypeScript and would pass any assertion made
 * about it whether or not a single row ever reached the database. The failures
 * this card exists to prevent all live on the other side of the loader:
 *
 *  - a task refused because its `owner` natural key resolved to nothing
 *    (`Owner is required`, 0 inserted — measured on #32);
 *  - a `done` task refused because `completed_at` never made it past the
 *    readonly strip;
 *  - a `last_update_at` overwritten with the boot clock because the second
 *    seed pass was missing or its external id did not match — which empties
 *    the "Not moving" view while the seed reports complete success;
 *  - a standing or one-off row refused by #61's cadence rules, taking every
 *    duty and task under it with it.
 *
 * Every one of those reports success somewhere. So this suite reads the rows
 * back.
 *
 * ── The acceptance criteria this pins, in the card's own words ────────────
 *   "every view in the app renders non-trivial content"          → `view populations`
 *   "My week, Late, Not moving and Calendar are each non-empty"  → `view populations`
 *   "no duly_task exists whose duty is form: 'standing'"         → `the standing invariant`
 *   "re-running the seed on a populated DB does not duplicate"   → `idempotence`
 */

/**
 * The demo seed is OPT-IN and off by default — see the gate in
 * `src/data/index.ts` for why the product wants it that way. This suite is the
 * one that asks for it, so it sets the variable in `beforeAll` and imports the
 * config dynamically afterwards.
 *
 * Spelled out here rather than imported from `src/data/index.js` deliberately:
 * that module reads the variable ONCE, when it is first evaluated, and a static
 * import would evaluate it before `beforeAll` could set anything — after which
 * the dynamic import below would hand back the cached, EMPTY barrel and every
 * count in this file would be zero. A rename that desyncs this string fails on
 * the assertion right after the import, naming the variable;
 * `test/demo-seed-opt-in.test.ts` imports the real constant.
 */
const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';

type SeedDataset = { object: string; records: Record<string, unknown>[] };

/** Both assigned in `beforeAll`, after the opt-in is set. */
let stack: Record<string, unknown>;
let dulySeeds: SeedDataset[];

const SYSTEM = { isSystem: true } as const;
const DAY = 24 * 60 * 60 * 1000;

let kernel: any;
let data: any;
let ql: any;
let metadata: any;

/** Every row of an object, read past RLS. */
const all = async (object: string): Promise<any[]> =>
  (await data.find(object, {}, { context: SYSTEM })) ?? [];

const count = async (object: string): Promise<number> => (await all(object)).length;

/** The `sys_user.id` behind a seeded display name. */
const userId = async (name: string): Promise<string> => {
  const rows = await data.find('sys_user', { where: { name } }, { context: SYSTEM });
  expect(rows?.length, `exactly one sys_user named ${name}`).toBe(1);
  return String(rows[0].id);
};

beforeAll(async () => {
  // Ask for the demo BEFORE anything evaluates the config: the gate in
  // src/data/index.ts reads the environment at module-evaluation time, because
  // the seed is baked into the compiled artifact rather than chosen at boot.
  vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
  stack = (await import('../objectstack.config.js')).default as unknown as Record<string, unknown>;
  ({ dulySeeds } = (await import('../src/data/index.js')) as unknown as { dulySeeds: SeedDataset[] });
  expect(
    (stack.data as unknown[] | undefined)?.length ?? 0,
    `this suite boots the demo, so ${DEMO_SEED_ENV_VAR} must be set before the config is imported`,
  ).toBeGreaterThan(0);

  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Same guard as `test/task-hook.test.ts` and `test/seed-history.test.ts`:
    // point the artifact lookup at a path that cannot exist, or a local
    // `pnpm build` leaves `dist/objectstack.json` where the kernel loads
    // metadata — objects, hooks AND the compiled seed — from the last BUILD
    // rather than from the config imported above.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  // skipSeedData FALSE, and `stack` unmodified — the app's own `dulySeeds`,
  // resolved by the opt-in gate above, going through the platform's own loader
  // is exactly what is under test. Nothing here substitutes the demo array in
  // by hand: that would leave the config's own wiring unexercised, and wiring
  // it to the ungated `demoSeeds` is precisely how 459 rows would find their
  // way back into the default `pnpm dev` path.
  await kernel.use(new AppPlugin(stack as any, undefined, { skipSeedData: false }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  ql = kernel.getService('objectql');
  metadata = kernel.getService('metadata');

  // The inline seed is raced against a budget (8s by default) rather than
  // awaited by bootstrap, and continues in the background when it loses. So
  // wait for the LAST dataset in the barrel to have landed rather than for a
  // fixed delay — `duly_log_entry` sorts last both in the barrel and in the
  // loader's topological order, and the two `mode: 'update'` backdate passes
  // run before it.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const logs = await count('duly_log_entry');
    if (logs >= 15) break;
    if (Date.now() > deadline) throw new Error(`seed did not settle: ${logs} log entries after 120s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
  vi.unstubAllEnvs();
});

// ───────────────────────────────────────────────────────────────────────────
describe('the seed lands', () => {
  it('writes every object the demo needs', async () => {
    expect(await count('sys_business_unit'), 'three-level unit tree').toBe(UNITS.length);
    // Twelve people plus the account `objectstack dev` logs you in as.
    expect(await count('sys_user')).toBe(PEOPLE.length + 1);
    expect(await count('duly_catalog_item')).toBe(CATALOG_ITEMS.length);
    expect(await count('duly_duty')).toBe(DUTIES.length);
    expect(await count('duly_assignment')).toBe(ASSIGNMENTS.length);
    expect(await count('duly_log_entry')).toBe(15);
  });

  it('seeds every task, none refused', async () => {
    // The specific failure this guards: `duly_task.owner` is resolved as a
    // natural key against `sys_user.name`, and a miss is not a dropped field —
    // `owner` is required, so the WHOLE row is refused. #32 measured that as
    // `inserted: 0, errored: 4`. A silently short count is what it looks like.
    const tasks = await all('duly_task');
    expect(tasks.length).toBe(SEEDED_TASKS.length + AD_HOC_TASKS.length);
    expect(tasks.every((task) => Boolean(task.owner)), 'every task resolved an owner').toBe(true);
  });

  it('every task states its caliber explicitly, and both calibers are present', async () => {
    // Since #54 `source` defaults to `self`, and every dataset measure filters
    // to catalog+assigned. A seed that leaned on the default would land wholly
    // unscored — every dashboard measure zero, nothing erroring.
    const tasks = await all('duly_task');
    const bySource = new Map<string, number>();
    for (const task of tasks) bySource.set(task.source, (bySource.get(task.source) ?? 0) + 1);
    expect([...bySource.keys()].sort()).toEqual(['assigned', 'catalog', 'self']);
    const governed = (bySource.get('catalog') ?? 0) + (bySource.get('assigned') ?? 0);
    expect(governed, 'the governed population every dataset measure reads').toBeGreaterThan(100);
    // And self-declared work exists too, or the caliber split is invisible.
    expect(bySource.get('self')).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('view populations — what an evaluator actually opens', () => {
  /**
   * These mirror the filters in `src/views/task.view.ts` field for field. They
   * are not a restatement of the fixture: each one asks the database the same
   * question the rendered view asks it, so an empty answer here is an empty
   * screen there.
   */

  it('My week is not empty for the account you log in as', async () => {
    // `my_week`: owner = {current_user_id}, status in (open, in_progress),
    // visible_from <= {today}. `objectstack dev` logs you in as `Dev Admin`,
    // so a demo whose data belongs to twelve other people renders this blank.
    const me = await userId(ADMIN);
    const mine = (await all('duly_task')).filter(
      (task) =>
        String(task.owner) === me &&
        ['open', 'in_progress'].includes(task.status) &&
        String(task.visible_from) <= TODAY,
    );
    expect(mine.length, 'My week must have content for the seeded admin').toBeGreaterThanOrEqual(3);
  });

  it('Late has 3-4 rows, as the card asks', async () => {
    // `late`: late_after < {today} AND status in (open, in_progress). Since #52
    // the lens reads the stamped deadline, not the raw due date — a task inside
    // the grace its own duty granted is not late yet.
    const late = (await all('duly_task')).filter(
      (task) => task.late_after && String(task.late_after) < TODAY && ['open', 'in_progress'].includes(task.status),
    );
    expect(late.length).toBeGreaterThanOrEqual(3);
    expect(late.length).toBeLessThanOrEqual(4);
  });

  it('every seeded task carries the deadline it was dispatched with, and grace is really in it', async () => {
    // Item 6 of #52: the demo has to carry the stamps, and they have to come
    // from the DUTY's grace rather than from the due date. Drop `grace_days`
    // out of `DISPATCH_DUTIES` and every value here collapses onto `due_date`
    // — the whole fixture silently reverts to the grace-free reading, with
    // nothing erroring and the counts above unchanged.
    const tasks = (await all('duly_task')).filter((task) => task.due_date);
    expect(tasks.length).toBeGreaterThan(100);
    for (const task of tasks) {
      expect(task.late_after, `${task.subject} has a due date and no deadline`).toBeTruthy();
      expect(
        String(task.late_after) >= String(task.due_date),
        `${task.subject}: a deadline before its own due date`,
      ).toBe(true);
    }
    const withGrace = tasks.filter((task) => String(task.late_after) > String(task.due_date));
    expect(
      withGrace.length,
      'no seeded task has any grace at all — the duty projection is not reading grace_days',
    ).toBeGreaterThan(20);
  });

  it('the on-time rate the dashboard reads is a real number, not 100%', async () => {
    // `duly_duty_health` counts `completed_late` on the governed population.
    // Every done row must carry a definite verdict or the two counts stop
    // adding up to `tasks_done`, and the split has to be non-trivial or the
    // tile reads as fabricated.
    const done = (await all('duly_task')).filter((task) => task.status === 'done');
    expect(done.length).toBeGreaterThan(50);
    for (const task of done) {
      expect(typeof task.completed_late, `${task.subject} completed with no verdict`).toBe('boolean');
    }
    const late = done.filter((task) => task.completed_late === true);
    expect(late.length, 'a history with no late completion makes the measure decorative')
      .toBeGreaterThan(0);
    expect(late.length / done.length, 'and a mostly-late history is not a plausible demo either')
      .toBeLessThan(0.5);
  });

  it('Not moving has 2-3 rows — and the second seed pass is what puts them there', async () => {
    // `stalled`: status in (open, in_progress) AND last_update_at < {14_days_ago}.
    //
    // This is the assertion that catches a missing or mis-keyed backdate pass.
    // `beforeInsert` stamps `last_update_at` unconditionally and hooks run on
    // the seed path, so WITHOUT the `mode: 'update'` datasets every row here
    // reads as touched at boot, this count is 0, and nothing anywhere errors.
    const threshold = Date.now() - 14 * DAY;
    const stalled = (await all('duly_task')).filter(
      (task) =>
        ['open', 'in_progress'].includes(task.status) &&
        task.last_update_at &&
        new Date(task.last_update_at as string).getTime() < threshold,
    );
    expect(stalled.length, 'an empty "Not moving" view reads as a healthy team').toBeGreaterThanOrEqual(2);
    expect(stalled.length).toBeLessThanOrEqual(3);
  });

  it('stagnation is NOT lateness — at least one stalled row is not yet late', async () => {
    // The product's central claim: stagnation fires while intervening is still
    // cheap, weeks before a due date makes the failure obvious. If every
    // stalled row were also late, the two views would be one view with a
    // different sort and the claim would be decoration.
    const threshold = Date.now() - 14 * DAY;
    const stalledNotLate = (await all('duly_task')).filter(
      (task) =>
        ['open', 'in_progress'].includes(task.status) &&
        task.last_update_at &&
        new Date(task.last_update_at as string).getTime() < threshold &&
        // Against the stamped deadline, which is what the Late lens reads.
        String(task.late_after) >= TODAY,
    );
    expect(stalledNotLate.length).toBeGreaterThanOrEqual(1);
  });

  it('Calendar, Schedule and Board all have something to draw', async () => {
    const tasks = await all('duly_task');
    // `calendar` binds startDateField: 'due_date'.
    expect(tasks.filter((task) => task.due_date).length).toBeGreaterThan(100);
    // `schedule` (gantt) filters visible_from IS NOT NULL AND due_date IS NOT
    // NULL — a row missing either draws nothing, so it must be a real
    // population and not an accident of the filter.
    expect(tasks.filter((task) => task.visible_from && task.due_date).length).toBeGreaterThan(100);
    // `board` (kanban) groups by status. A board with one column is not a
    // board; the seed has to populate several.
    const statuses = new Set(tasks.map((task) => task.status));
    expect([...statuses].sort()).toEqual(['cancelled', 'done', 'in_progress', 'open', 'skipped']);
  });

  it('the majority of history is done, so the picture is plausible', async () => {
    const tasks = await all('duly_task');
    const done = tasks.filter((task) => task.status === 'done');
    expect(done.length / tasks.length).toBeGreaterThan(0.5);
    // Not 100% either — a perfect record reads as fabricated, and the Late and
    // Not-moving views would have nothing in them.
    expect(done.length / tasks.length).toBeLessThan(0.95);
  });

  it('one task is skipped, and it says why', async () => {
    const skipped = (await all('duly_task')).filter((task) => task.status === 'skipped');
    expect(skipped.length).toBe(1);
    // `skip_needs_reason` still runs on the seed path (`seedReplay` skips only
    // state_machine rules), so a reasonless skip would have been refused — but
    // assert the reason is a real answer rather than a placeholder.
    expect(String(skipped[0].skip_reason).length).toBeGreaterThan(20);
  });

  it('every done task carries the completion instant the seed supplied', async () => {
    // `completed_at` is readonly and there is no writer for it on the insert
    // path. It lands only because the seed loader writes under
    // `{ isSystem: true }`. If that ever stops being true this goes red here
    // rather than as a wall of validation errors at boot.
    const done = (await all('duly_task')).filter((task) => task.status === 'done');
    expect(done.length).toBeGreaterThan(100);
    expect(done.every((task) => Boolean(task.completed_at))).toBe(true);
    // And they are historical, not stamped at boot.
    const oldest = Math.min(...done.map((task) => new Date(task.completed_at as string).getTime()));
    expect(Date.now() - oldest, 'history should reach back months').toBeGreaterThan(120 * DAY);
  });

  it('unit rollups differ from each other', async () => {
    const byUnit = new Map<string, number>();
    for (const task of await all('duly_task')) {
      const unit = String(task.business_unit ?? '');
      byUnit.set(unit, (byUnit.get(unit) ?? 0) + 1);
    }
    expect(byUnit.size, 'several units must carry work').toBeGreaterThanOrEqual(3);
    // Distinct totals, or "By business unit" is a grid of identical numbers.
    expect(new Set(byUnit.values()).size).toBeGreaterThan(1);
  });

  it('the Role catalog reads as an audit answer, not a to-do list', async () => {
    const items = await all('duly_catalog_item');
    expect(items.length).toBe(20);
    expect(new Set(items.map((item) => item.position_code)).size).toBe(3);
    const withReference = items.filter((item) => item.regulation_ref);
    expect(withReference.length / items.length, 'most items cite the clause they discharge').toBeGreaterThan(0.9);
  });

  it('the work log is present, mostly private, and attached to no metric', async () => {
    const entries = await all('duly_log_entry');
    expect(entries.length).toBe(15);
    expect(new Set(entries.map((entry) => String(entry.owner))).size).toBe(2);
    const priv = entries.filter((entry) => entry.visibility === 'private');
    expect(priv.length / entries.length).toBeGreaterThan(0.5);
    // Every dataset in `src/datasets/` is `object: 'duly_task'`, so nothing
    // here can enter a measure. Assert the rows carry nothing scoreable
    // either — no link into the governed population at all.
    expect(entries.every((entry) => !entry.related_task)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the standing invariant', () => {
  it('no task exists whose duty is standing', async () => {
    const standing = (await all('duly_duty')).filter((duty) => duty.form === 'standing');
    expect(standing.length, 'the fixture must actually contain standing duties').toBeGreaterThanOrEqual(2);
    const ids = new Set(standing.map((duty) => String(duty.id)));
    const offenders = (await all('duly_task')).filter((task) => ids.has(String(task.duty)));
    expect(offenders.map((task) => task.subject)).toEqual([]);
  });

  it('and the planner is WHY, not luck', async () => {
    // The rows above being absent could equally mean the fixture happens not
    // to mention them. It cannot: every task comes out of `planDispatch`, and
    // `planForDuty` refuses a standing duty by form before reading anything
    // else. The planner's own skip reasons are the proof.
    const standingNames = DUTIES.filter((duty) => {
      const seeded = SKIPS.find((skip) => skip.duty === duty.name);
      return seeded?.reason === 'standing';
    }).map((duty) => duty.name);
    expect(standingNames.length).toBeGreaterThanOrEqual(2);
    for (const name of standingNames) {
      expect(SEEDED_TASKS.some((task) => task.duty === name), `${name} produced a draft`).toBe(false);
    }
    // The paused duty holds none either, for its own reason.
    expect(SKIPS.some((skip) => skip.reason === 'not_active')).toBe(true);
  });

  it('standing rows carry no cadence at all, and one-off carries no due timing (#61)', async () => {
    const blank = (value: unknown) => value === null || value === undefined || value === '';
    for (const object of ['duly_catalog_item', 'duly_duty']) {
      for (const row of await all(object)) {
        if (row.form === 'standing') {
          for (const field of ['frequency', 'due_anchor', 'due_offset_days', 'lead_days', 'grace_days']) {
            expect(blank(row[field]), `${object} ${row.name}.${field} on a standing row`).toBe(true);
          }
        }
        if (row.form === 'one_off') {
          for (const field of ['due_anchor', 'due_offset_days', 'lead_days']) {
            expect(blank(row[field]), `${object} ${row.name}.${field} on a one-off row`).toBe(true);
          }
        }
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('period keys come from the engine', () => {
  it('every seeded key round-trips through periodKeyFor', async () => {
    // The card's hardest rule, checked the only way that actually proves it:
    // take each key back to the period it names, and ask the engine to spell
    // that period. A hand-typed `2026-W4` does not survive this — the engine
    // says `2026-W04`, and `duly_task` being unique on
    // `(duty, owner, period_key)` makes those two different obligations.
    const duties = new Map((await all('duly_duty')).map((duty) => [String(duty.id), duty]));
    const keyed = (await all('duly_task')).filter((task) => task.period_key);
    expect(keyed.length).toBeGreaterThan(100);

    for (const task of keyed) {
      const duty = duties.get(String(task.duty));
      expect(duty, `task ${task.subject} resolved its duty`).toBeTruthy();
      const frequency = duty.frequency as Frequency;
      expect(FREQUENCIES).toContain(frequency);
      const timezone = String(duty.timezone ?? 'UTC');
      const key = String(task.period_key);
      const bounds = periodBounds(frequency, key, timezone);
      expect(periodKeyFor(frequency, bounds.start, timezone), `${task.subject} / ${key}`).toBe(key);
    }
  });

  it('an assignment task has no period, because an assignment has none', async () => {
    const assignments = new Set((await all('duly_assignment')).map((row) => String(row.id)));
    const fanOut = (await all('duly_task')).filter((task) => assignments.has(String(task.assignment)));
    expect(fanOut.length).toBe(AD_HOC_TASKS.filter((task) => task.assignment).length);
    expect(fanOut.every((task) => !task.period_key)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('assignments', () => {
  it('one fans out to four people with mixed completion', async () => {
    const rows = await all('duly_assignment');
    const readiness = rows.find((row) => row.subject === ASSIGNMENTS[0]!.subject);
    expect(readiness).toBeTruthy();
    const children = (await all('duly_task')).filter((task) => String(task.assignment) === String(readiness.id));
    expect(children.length).toBe(4);
    // Four independent rows, four owners — never one shared row with four
    // names on it.
    expect(new Set(children.map((task) => String(task.owner))).size).toBe(4);
    expect(new Set(children.map((task) => task.status)).size).toBeGreaterThanOrEqual(3);
  });

  it('needs_collection is what gives the assigner a task, and only that', async () => {
    const rows = await all('duly_assignment');
    const sweep = rows.find((row) => row.subject === ASSIGNMENTS[1]!.subject);
    const readiness = rows.find((row) => row.subject === ASSIGNMENTS[0]!.subject);
    expect(Boolean(sweep.needs_collection)).toBe(true);
    expect(Boolean(readiness.needs_collection)).toBe(false);

    const tasks = await all('duly_task');
    const sweepChildren = tasks.filter((task) => String(task.assignment) === String(sweep.id));
    // Two assignees plus the assigner's own follow-up.
    expect(sweepChildren.length).toBe(3);
    expect(sweepChildren.some((task) => String(task.owner) === String(sweep.assigner))).toBe(true);

    // And the assignment that did NOT tick it gives its assigner nothing —
    // a manager who hands out work does not inherit a to-do list from it.
    const readinessChildren = tasks.filter((task) => String(task.assignment) === String(readiness.id));
    expect(readinessChildren.some((task) => String(task.owner) === String(readiness.assigner))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('idempotence', () => {
  it('re-running the whole seed over a populated database duplicates nothing', async () => {
    // The card's fourth acceptance criterion, exercised through the platform's
    // own loader with the same config the boot uses — not a proxy for it.
    const objects = [
      'sys_business_unit',
      'sys_user',
      // The junction (#74). It is the one dataset here with no single-column
      // natural key, so its replay safety rests entirely on the composite
      // `externalId: ['user_id', 'business_unit_id']` — and a dataset that
      // cannot match its own rows re-inserts every one of them on every boot,
      // reporting success each time. Counted here so that is a red test rather
      // than a table that grows twelve rows per restart.
      'sys_business_unit_member',
      'duly_catalog_item',
      'duly_duty',
      'duly_assignment',
      'duly_task',
      'duly_log_entry',
    ];
    const before = new Map<string, number>();
    for (const object of objects) before.set(object, await count(object));

    const loader = new SeedLoaderService(ql, metadata, kernel.logger ?? console);
    const request = SeedLoaderRequestSchema.parse({
      seeds: dulySeeds as any,
      config: { defaultMode: 'upsert', multiPass: true },
    });
    const result = await loader.load(request);
    expect(result.summary.totalInserted, 'a replay must insert nothing').toBe(0);
    // "Inserted nothing" is only meaningful alongside "and it really ran".
    // An env filter that dropped every dataset, or a request the loader
    // refused, would also report zero inserts — and would prove nothing.
    const declared = dulySeeds.reduce((total, dataset) => total + dataset.records.length, 0);
    expect(result.summary.totalRecords, 'the replay must have walked every row').toBe(declared);
    expect(result.summary.totalErrored).toBe(0);

    for (const object of objects) {
      expect(await count(object), `${object} after replay`).toBe(before.get(object));
    }
  }, 180_000);

  it('and the replay leaves the stalled rows stalled', async () => {
    // The subtler half. A replay that re-INSERTED nothing but re-STAMPED
    // `last_update_at` would leave the counts identical and the "Not moving"
    // view empty — the same silent failure as omitting the backdate pass,
    // arriving one boot later.
    const threshold = Date.now() - 14 * DAY;
    const stalled = (await all('duly_task')).filter(
      (task) =>
        ['open', 'in_progress'].includes(task.status) &&
        task.last_update_at &&
        new Date(task.last_update_at as string).getTime() < threshold,
    );
    expect(stalled.length).toBeGreaterThanOrEqual(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('nothing real is named', () => {
  it('every seeded address is on a domain that cannot exist', async () => {
    // RFC 2606 reserves `.example`. A demo seed is screenshotted and pasted
    // into decks; a plausible-looking real domain in one eventually becomes a
    // claim about a real organisation.
    const addressed = (await all('sys_user')).filter((user) => user.email);
    expect(addressed.length).toBe(PEOPLE.length);
    expect(addressed.every((user) => String(user.email).endsWith('.example'))).toBe(true);
  });

  it('the account you log in as is left alone apart from its name', () => {
    // The `Dev Admin` row exists so `owner: 'Dev Admin'` resolves in a kernel
    // with no auth plugin. On a real `objectstack dev` boot that account is
    // already there with credentials attached, and the loader's no-op-replay
    // check must SKIP it rather than update it — which it only does while the
    // seed record declares nothing but the field it is matched on.
    const seed = dulySeeds.find((dataset) => dataset.object === 'sys_user');
    const admin = seed!.records.find((record: any) => record.name === ADMIN);
    expect(Object.keys(admin as object)).toEqual(['name']);
  });
});
