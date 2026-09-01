// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  FREQUENCIES,
  dueDateFor,
  periodBounds,
  periodKeyFor,
  periodsBetween,
  visibleFromFor,
  type DueAnchor,
  type Frequency,
} from '../functions/period.js';

/**
 * The dispatcher's BRAIN — pure, clockless, engineless.
 *
 * Everything the dispatcher decides lives here: which duties are in scope,
 * which periods they owe a task for, and what each task row should say. It
 * takes rows in and returns rows out. No I/O, no `Date.now()`, no platform
 * import. `dispatch.job.ts` next door is the other half: the schedule
 * declaration and the twenty lines that actually talk to the engine.
 *
 * The split is a file boundary on purpose. This module is the part that can be
 * wrong in ways nothing would notice — a period key off by one zone, a lead
 * window that never opens — and a pure function is the only shape that can be
 * cornered by a test without booting anything.
 *
 * ── Every period spelling comes from `../functions/period.ts` ────────────
 * Not one key, boundary or due date is derived here. `duly_task` is unique on
 * `(duty, owner, period_key)`, so two spellings of one period are two tasks for
 * one obligation and nothing downstream can tell they were meant to be the
 * same. Two consequences worth stating, because they read as coincidences:
 *
 *  - **"today, in the duty's zone" is `periodKeyFor('daily', now, tz)`.** The
 *    daily period key IS the local calendar day, by that module's own spelling
 *    (`YYYY-MM-DD`). Asking it is how this file gets a local date without
 *    owning a second copy of the zone arithmetic.
 *  - **"the instant local day D begins in zone Z" is
 *    `periodBounds('daily', D, tz).start`.** Same reason. `periodsBetween`
 *    wants instants and a backfill window is authored as calendar dates; this
 *    is the conversion, performed by the module that owns it.
 */

// ─────────────────────────────────────────────────────────────────────────
// Cadence defaults
// ─────────────────────────────────────────────────────────────────────────

/**
 * The cadence values used when a duty row carries `null`.
 *
 * These are NOT this module's opinion — each one is `duly_duty`'s own declared
 * default, restated here so the planner stays a pure function with no metadata
 * import, and pinned against the object schema in `test/dispatch.test.ts` so
 * the two cannot drift into two answers. (Same pattern, and the same reason, as
 * `DEFAULT_DUTY_TIMEZONE` in `src/actions/catalog.handlers.ts`.)
 *
 * The engine applies these on write, so a row read back normally carries them.
 * The fallback covers the rows that predate a default or arrived through a path
 * that skipped it — and it is a fallback to the DECLARED value, never an
 * invented one.
 */
export const DEFAULT_TIMEZONE = 'UTC';
export const DEFAULT_DUE_ANCHOR: DueAnchor = 'period_start';
export const DEFAULT_DUE_OFFSET_DAYS = 0;
export const DEFAULT_LEAD_DAYS = 7;

/** The status a duty must hold to dispatch. */
export const DISPATCHABLE_STATUS = 'active';
/** The form a duty must hold to dispatch. `standing` and `one_off` never do. */
export const DISPATCHABLE_FORM = 'recurring';

/**
 * The `duly_duty` projection the planner reads.
 *
 * Exported so the read in `dispatch.job.ts` and the fields consumed here are
 * one list rather than two. A field the planner reads but the projection omits
 * comes back `undefined`, which reads exactly like "the duty does not set it" —
 * a silent wrong answer, not an error. `test/dispatch.test.ts` pins the two
 * together.
 */
export const DISPATCH_DUTY_FIELDS = [
  'id',
  'name',
  'form',
  'status',
  'owner',
  'business_unit',
  'source',
  'frequency',
  'due_anchor',
  'due_offset_days',
  'lead_days',
  'timezone',
  'effective_from',
  'effective_to',
  'last_dispatched_period',
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────────

/** A `duly_duty` row, as the projection above returns it. */
export interface DispatchDuty {
  id: string;
  name?: string | null;
  form?: string | null;
  status?: string | null;
  owner?: string | null;
  business_unit?: string | null;
  source?: string | null;
  frequency?: string | null;
  due_anchor?: string | null;
  due_offset_days?: number | null;
  lead_days?: number | null;
  timezone?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  last_dispatched_period?: string | null;
}

/** One `duly_task` row the dispatcher intends to insert. */
export interface TaskDraft {
  /** Copied at dispatch, so renaming the duty never rewrites history. */
  subject: string;
  duty: string;
  owner: string;
  /** Denormalised from the DUTY, so a later transfer does not move rollups. */
  business_unit: string | null;
  source: string;
  period_key: string;
  due_date: string;
  visible_from: string;
  status: 'open';
}

/** Why a duty produced no drafts on this run. */
export type DispatchSkipReason =
  /** `form: 'standing'` — a standing duty is attestable, never tickable. */
  | 'standing'
  /** `form: 'one_off'` — dispatched by hand or by the assignment fan-out. */
  | 'one_off'
  /** A form this dispatcher does not know. */
  | 'unknown_form'
  /** `paused` or `retired`. */
  | 'not_active'
  /** Recurring with no cadence. `recurring_needs_frequency` should prevent it. */
  | 'no_frequency'
  /** A `frequency` value outside `FREQUENCIES`. */
  | 'unknown_frequency'
  /** Today, in the duty's own zone, is outside `[effective_from, effective_to]`. */
  | 'outside_effective_window'
  /** In scope, but no period is due to exist yet. */
  | 'nothing_due'
  /** The period engine refused this duty's cadence — a bad zone, a bad offset. */
  | 'invalid_cadence';

/**
 * The skip reasons that mean something is WRONG with the data, as opposed to
 * the duty simply having nothing to do. A run that hits one of these finished,
 * but did not do all of its work — which is what `JobRunOutcome.degraded` is
 * for. The others are ordinary, expected, and silent.
 */
export const FAULT_SKIP_REASONS: readonly DispatchSkipReason[] = [
  'unknown_form',
  'no_frequency',
  'unknown_frequency',
  'invalid_cadence',
];

export interface DutySkip {
  duty: string;
  reason: DispatchSkipReason;
  /** The period engine's own message, for `invalid_cadence` only. */
  detail?: string;
}

export interface DispatchPlan {
  drafts: TaskDraft[];
  skipped: DutySkip[];
}

/** An inclusive backfill window, as authored calendar dates. */
export interface BackfillWindow {
  from: string;
  to: string;
}

export interface DispatchPlanInput {
  duties: readonly DispatchDuty[];
  /** The run's clock. Supplied, never read from the environment. */
  now: Date;
  /** Present for a backfill run; `null` for the scheduled run. */
  window?: BackfillWindow | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers over the period engine
// ─────────────────────────────────────────────────────────────────────────

/**
 * The local calendar day containing `instant`, in `timezone`, as `YYYY-MM-DD`.
 *
 * This is the daily period key, which the period engine defines to be exactly
 * the local calendar day. Asking for it that way is what keeps this file from
 * owning a second copy of the zone arithmetic.
 */
function localDayOf(instant: Date, timezone: string): string {
  return periodKeyFor('daily', instant, timezone);
}

/**
 * The first instant of local day `isoDate` in `timezone`.
 *
 * A daily period's bounds ARE the local day's bounds, so this is the period
 * engine answering, not a conversion invented here. On a local day a zone
 * erased at the date line the period holds no instants and `start === end`;
 * `periodsBetween` walks past such a day, so feeding it one is safe.
 */
function startOfLocalDay(isoDate: string, timezone: string): Date {
  return periodBounds('daily', isoDate, timezone).start;
}

/**
 * `isoDate` shifted forward by `days` calendar days.
 *
 * `visibleFromFor` is the period engine's civil-date shift — it subtracts its
 * second argument — so a negative lead is a forward shift. Spelled through it
 * rather than reimplemented because a second `addDays` is a second thing that
 * can be wrong about February.
 */
function addCalendarDays(isoDate: string, days: number): string {
  return visibleFromFor(isoDate, -days);
}

function isFrequency(value: unknown): value is Frequency {
  return typeof value === 'string' && (FREQUENCIES as readonly string[]).includes(value);
}

/** `YYYY-MM-DD` values compare lexicographically, so a plain `<=` is a date test. */
function withinDateWindow(day: string, from?: string | null, to?: string | null): boolean {
  if (typeof from === 'string' && from !== '' && day < from) return false;
  if (typeof to === 'string' && to !== '' && day > to) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// The plan
// ─────────────────────────────────────────────────────────────────────────

/**
 * Turn a page of duties into the task rows they owe.
 *
 * ── Which periods a SCHEDULED run considers ──────────────────────────────
 * The current period, plus any later period whose lead window has already
 * opened (`visible_from <= today`). Both halves are needed:
 *
 *  - The current period unconditionally. `visible_from` governs when a task
 *    SHOWS UP, not whether it EXISTS — a monthly duty due on the 30th with no
 *    lead time still owes a row on the 1st, or nothing can be worked early.
 *  - Later periods, gated on visibility. A duty due on the 3rd with 7 days of
 *    lead is meant to appear in the previous month; if the dispatcher only ever
 *    emitted the current period, that row would not exist until the month it is
 *    due and the lead time would be decorative.
 *
 * The look-ahead is bounded at `today + lead_days`, which is exact rather than
 * generous: `visible_from` is `due_date - lead_days` and `due_date` is clamped
 * inside its own period, so a period starting after `today + lead_days` cannot
 * have `visible_from <= today`. Nothing is missed and nothing extra is walked.
 *
 * ── Which periods a BACKFILL run considers ───────────────────────────────
 * Exactly the window, via `periodsBetween` — both ends inclusive of the period
 * containing them. Visibility does not gate a backfill: an operator asking for
 * March is asking for March, and every one of those periods is in the past, so
 * its lead window opened long ago.
 *
 * ── The two effective-window tests, and why there are two ────────────────
 *  1. **Duty-level, on `today`** — the scheduled run's selection rule: a duty
 *     whose window has not opened or has closed is not dispatched at all. This
 *     is the rule as specified, and it is deliberately NOT applied to a
 *     backfill: backfilling a duty whose window closed last month is the whole
 *     point of backfill.
 *  2. **Period-level, on `due_date`** — always. A period whose due date falls
 *     outside the duty's effective window is not owed, in either mode. This is
 *     what keeps a backfill from inventing obligations that predate the duty.
 *
 * ── One bad duty does not stop the run ───────────────────────────────────
 * A typo'd IANA zone or a non-integer offset makes the period engine throw. It
 * throws per duty, so it is caught per duty and recorded as `invalid_cadence`
 * with the engine's own message. The alternative — one malformed row stopping
 * every other person's tasks from being created — is the worse failure by a
 * wide margin. It is not swallowed: `FAULT_SKIP_REASONS` carries it into the
 * job's `degraded` outcome, so the run is recorded as one that did not do all
 * of its work.
 */
export function planDispatch(input: DispatchPlanInput): DispatchPlan {
  const { duties, now, window = null } = input;
  const drafts: TaskDraft[] = [];
  const skipped: DutySkip[] = [];

  for (const duty of duties) {
    const outcome = planForDuty(duty, now, window);
    if ('reason' in outcome) {
      skipped.push({ duty: duty.id, reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) });
      continue;
    }
    drafts.push(...outcome.drafts);
  }

  return { drafts, skipped };
}

type DutyOutcome = { drafts: TaskDraft[] } | { reason: DispatchSkipReason; detail?: string };

function planForDuty(duty: DispatchDuty, now: Date, window: BackfillWindow | null): DutyOutcome {
  // ── Form and status: the two invariants, stated first ──────────────────
  // A standing duty NEVER generates a task. Skipped entirely — never created
  // and immediately closed, which would put an unclosable row in every list.
  if (duty.form === 'standing') return { reason: 'standing' };
  if (duty.form === 'one_off') return { reason: 'one_off' };
  if (duty.form !== DISPATCHABLE_FORM) return { reason: 'unknown_form' };
  if (duty.status !== DISPATCHABLE_STATUS) return { reason: 'not_active' };

  if (duty.frequency == null || duty.frequency === '') return { reason: 'no_frequency' };
  if (!isFrequency(duty.frequency)) return { reason: 'unknown_frequency' };
  const frequency: Frequency = duty.frequency;

  const timezone = duty.timezone ?? DEFAULT_TIMEZONE;
  const dueAnchor = (duty.due_anchor ?? DEFAULT_DUE_ANCHOR) as DueAnchor;
  const dueOffsetDays = duty.due_offset_days ?? DEFAULT_DUE_OFFSET_DAYS;
  const leadDays = duty.lead_days ?? DEFAULT_LEAD_DAYS;

  try {
    // "Today" is resolved in the DUTY's zone, not the server's. A single UTC
    // pass covers every zone because the question asked per duty is "is this
    // period's task due to exist yet", never "is it midnight here".
    const today = localDayOf(now, timezone);

    if (window === null && !withinDateWindow(today, duty.effective_from, duty.effective_to)) {
      return { reason: 'outside_effective_window' };
    }

    const currentKey = periodKeyFor(frequency, now, timezone);
    // Both ends are the START of a local day, never `now`. `periodsBetween`
    // returns `[]` when `to` is before `from`, and with `lead_days: 0` the
    // horizon IS today — so passing the run's instant as `from` would put a
    // mid-morning `now` after midnight-of-today and silently dispatch NOTHING,
    // for every duty with no lead time, on every run. (Measured: it did.)
    const candidates =
      window === null
        ? periodsBetween(
            frequency,
            startOfLocalDay(today, timezone),
            startOfLocalDay(addCalendarDays(today, leadDays), timezone),
            timezone,
          )
        : periodsBetween(
            frequency,
            startOfLocalDay(window.from, timezone),
            startOfLocalDay(window.to, timezone),
            timezone,
          );

    const drafts: TaskDraft[] = [];
    for (const periodKey of candidates) {
      const dueDate = dueDateFor({ frequency, periodKey, timezone, dueAnchor, dueOffsetDays });
      const visibleFrom = visibleFromFor(dueDate, leadDays);

      // Period-level effective clip — both modes. A period whose due date sits
      // outside the duty's window is not owed by anyone.
      if (!withinDateWindow(dueDate, duty.effective_from, duty.effective_to)) continue;

      // Visibility gate — scheduled runs only. The current period is exempt:
      // it must exist whether or not it is meant to be on screen yet.
      if (window === null && periodKey !== currentKey && visibleFrom > today) continue;

      drafts.push({
        subject: duty.name ?? '',
        duty: duty.id,
        owner: duty.owner ?? '',
        business_unit: duty.business_unit ?? null,
        source: duty.source ?? '',
        period_key: periodKey,
        due_date: dueDate,
        visible_from: visibleFrom,
        status: 'open',
      });
    }

    if (drafts.length === 0) return { reason: 'nothing_due' };
    return { drafts };
  } catch (error) {
    return { reason: 'invalid_cadence', detail: error instanceof Error ? error.message : String(error) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// last_dispatched_period
// ─────────────────────────────────────────────────────────────────────────

/**
 * Where `duly_duty.last_dispatched_period` should stand after a run, or `null`
 * when it should not be written at all.
 *
 * **Advances, never regresses.** The keys of one frequency are fixed-width and
 * zero-padded (`2026-08` · `2026-W34` · `2026-Q3` · `2026-H2` · `2026` ·
 * `2026-08-21`), so a lexical `>` is chronological and no parsing is needed.
 * A duty holds one frequency at a time, which is what makes that sound.
 *
 * Two consequences of the never-regress rule, stated so they are decisions:
 *
 *  - A run that created nothing — every task already existed — writes nothing.
 *    That is the correct reading of "the latest key it created", and it is also
 *    what keeps a second identical run from issuing a single write.
 *  - If a duty's `frequency` is CHANGED, the stored key is in the old spelling
 *    and the comparison against the new one is meaningless. The rule then fails
 *    in the safe direction: the field either advances or is left alone, and it
 *    never jumps backwards. It is a bookkeeping breadcrumb, not the idempotency
 *    mechanism — that is the unique index — so a stale one costs nothing.
 */
export function nextDispatchedPeriod(current: string | null | undefined, createdKeys: readonly string[]): string | null {
  let best: string | null = null;
  for (const key of createdKeys) {
    if (best === null || key > best) best = key;
  }
  if (best === null) return null;
  if (typeof current === 'string' && current !== '' && current >= best) return null;
  return best;
}
