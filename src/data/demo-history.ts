// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { periodBounds, periodKeyFor, visibleFromFor } from '../functions/period.js';
import { planDispatch, type DispatchDuty, type DutySkip, type TaskDraft } from '../jobs/dispatch.plan.js';

import { timezoneOf, unitOf } from './demo-org.js';
import { DUTIES, cadenceOf, catalogItem, type DemoCatalogItem } from './demo-catalog.js';

/**
 * Six months of history, produced by the DISPATCHER'S OWN PLANNER.
 *
 * ── Why `planDispatch` and not a second period walk ──────────────────────
 * The card's hardest rule is that period keys come from `src/functions/period.ts`
 * and are never typed by hand: `duly_task` is unique on
 * `(duty, owner, period_key)`, so `2026-W4` where the engine says `2026-W04`
 * is a second task for one obligation that nothing downstream can tell was
 * meant to be the same. Calling the engine directly would satisfy that rule.
 * Calling `planDispatch` satisfies something stronger — the seeded rows are
 * *literally what the dispatcher would have produced*: same keys, same due
 * dates, same lead windows. There is no second opinion about periods anywhere
 * in this fixture because there is no second walk.
 *
 * Two invariants then fall out of the structure rather than being asserted on
 * top of it:
 *
 *  - **Standing duties hold zero tasks.** `planForDuty` returns
 *    `{ reason: 'standing' }` before it reads anything else, so a standing
 *    duty cannot produce a draft here. Impossible in this fixture, not merely
 *    absent from it. {@link SKIPS} carries the reasons so `test/seed.test.ts`
 *    can assert the mechanism and not just the outcome.
 *  - **Paused duties hold zero tasks**, by the same route (`not_active`).
 *
 * ── Two plans, unioned ───────────────────────────────────────────────────
 * A real system on any given morning holds both: everything the backfill ever
 * created, AND whatever today's scheduled run would create for the periods now
 * in flight or already inside their lead window. So this asks for both and
 * unions them on the dispatch identity — which is exactly the state
 * `pnpm dev` should open on.
 *
 * ── Relative, so the demo does not rot ───────────────────────────────────
 * Every instant below is derived from {@link NOW}, read once when this module
 * loads. A literal `2026-07-18` stops being "stalled" as soon as the repo ages
 * past it, and a demo that quietly decays into an empty "Not moving" view is
 * the failure this card exists to prevent. The window is walked in CIVIL days
 * through `visibleFromFor` — the period engine's own date shift — rather than
 * by subtracting milliseconds, which is wrong twice a year in every zone that
 * observes a summer-time change.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** The fixture's clock. One read, at module load, so every derived instant agrees. */
export const NOW = new Date();

/**
 * Today as a civil date. The daily period key IS the local calendar day by the
 * period engine's own spelling, so this is that module answering rather than a
 * second copy of the zone arithmetic (the same idiom `dispatch.plan.ts` uses).
 */
export const TODAY = periodKeyFor('daily', NOW, 'UTC');

/** Roughly six months of backfill, as an inclusive civil-date window. */
export const HISTORY_FROM = visibleFromFor(TODAY, 183);

// ─────────────────────────────────────────────────────────────────────────
// The duties, in the shape the planner reads
// ─────────────────────────────────────────────────────────────────────────

/** A self-declared duty has no catalog row behind it, so it carries its own cadence. */
const itemFor = (item: string | null, own: Partial<DemoCatalogItem> | undefined, name: string): DemoCatalogItem =>
  item !== null
    ? catalogItem(item)
    : ({ name, position: '', description: '', form: 'recurring', ...own } as DemoCatalogItem);

export const DISPATCH_DUTIES: readonly DispatchDuty[] = DUTIES.map((duty) => {
  const item = itemFor(duty.item, duty.own, duty.name);
  const cadence = cadenceOf(item);
  const unit = unitOf(duty.owner);
  return {
    // The planner treats `id` as opaque and copies it onto every draft's
    // `duty`. Handing it the duty's NATURAL KEY is what makes the drafts
    // seedable as they come out: the loader resolves `duly_task.duty` against
    // `duly_duty.name`, which is precisely this string.
    id: duty.name,
    name: duty.name,
    form: item.form,
    status: duty.status ?? 'active',
    owner: duty.owner,
    business_unit: unit,
    source: duty.source,
    frequency: cadence.frequency ?? null,
    due_anchor: cadence.due_anchor ?? null,
    due_offset_days: cadence.due_offset_days ?? null,
    lead_days: cadence.lead_days ?? null,
    timezone: timezoneOf(unit),
    // The same window `duty.seed.ts` writes onto `duly_duty.effective_from`.
    // Stated HERE too, not only there: the planner clips every period whose
    // due date falls outside a duty's effective window, so leaving it out
    // would seed tasks the duty itself says predate it — a history that a
    // re-run of the real dispatcher would refuse to reproduce.
    effective_from: HISTORY_FROM,
  };
});

const TZ_BY_DUTY = new Map(DISPATCH_DUTIES.map((duty) => [duty.id, duty.timezone ?? 'UTC']));

// ─────────────────────────────────────────────────────────────────────────
// The plan
// ─────────────────────────────────────────────────────────────────────────

const backfill = planDispatch({
  duties: DISPATCH_DUTIES,
  now: NOW,
  window: { from: HISTORY_FROM, to: TODAY },
});

const live = planDispatch({ duties: DISPATCH_DUTIES, now: NOW, window: null });

/** The dispatch identity, spelled so no field value can be mistaken for a separator. */
const identityOf = (draft: TaskDraft) => JSON.stringify([draft.duty, draft.owner, draft.period_key]);

/** Backfill union today's scheduled run, deduplicated on `(duty, owner, period_key)`. */
export const DRAFTS: readonly TaskDraft[] = (() => {
  const seen = new Map<string, TaskDraft>();
  for (const draft of [...backfill.drafts, ...live.drafts]) {
    if (!seen.has(identityOf(draft))) seen.set(identityOf(draft), draft);
  }
  return [...seen.values()];
})();

/**
 * Why each duty produced nothing, straight from the planner.
 *
 * Exported so `test/seed.test.ts` can assert the MECHANISM behind "standing
 * duties have zero tasks" — that the planner refused them by form — rather
 * than only observing that no such row happens to exist.
 */
export const SKIPS: readonly DutySkip[] = [...backfill.skipped];

// ─────────────────────────────────────────────────────────────────────────
// Turning drafts into history
// ─────────────────────────────────────────────────────────────────────────

/** The instant a civil day begins in a zone — the period engine again, not a conversion invented here. */
const startOfDay = (day: string, timezone: string): Date => periodBounds('daily', day, timezone).start;

/** ISO instant, never later than the fixture's clock. Nothing in a demo happened tomorrow. */
const iso = (instant: Date): string => new Date(Math.min(instant.getTime(), NOW.getTime())).toISOString();

/**
 * The occurrences this fixture places by hand are addressed by DUTY and by
 * position in that duty's series ("the newest one already past due", "the
 * oldest one"), never by date, so they survive the calendar moving under them.
 */

/**
 * Still open, and past due. The **Late** view.
 *
 * Three of the four are being actively chased (touched inside the fortnight);
 * one is not. Late and stalled are different populations, and showing them as
 * overlapping-but-distinct is the whole argument for having both views:
 * lateness reports a failure that has already happened, stagnation catches one
 * that has not.
 */
const LATE_MOST_RECENT: Readonly<Record<string, 'open' | 'in_progress'>> = {
  'Emissions return — Northgate': 'open',
  'Toolbox talk record — Line B': 'in_progress',
  'Line safety walk — Riverside': 'open',
  // The overlap: late AND untouched since the day it was dispatched.
  'Calibration verification — Lab 1': 'open',
};

/** How long ago each actively-chased late row was last touched. */
const CHASED_DAYS_AGO = [2, 6, 10] as const;

/** Untouched since dispatch as well as late — the fourth Late row above. */
const STALLED_LATE = 'Calibration verification — Lab 1';

/**
 * Open, NOT yet due, and untouched since dispatch. The **Not moving** view
 * doing the job it exists for.
 *
 * Both are long-lead obligations — a half-year audit noticed five months out,
 * a yearly induction refresh noticed four months out — which is the only shape
 * in which stagnation can fire before lateness can. A short-lead monthly task
 * cannot be three weeks stale and still in date.
 */
const STALLED_IN_FLIGHT: readonly string[] = [
  'Site environmental audit — Northgate',
  'Contractor induction refresh — Northgate',
];

/** One skipped occurrence, with a reason that is an answer rather than "n/a". */
const SKIPPED_MOST_RECENT = 'Line safety walk — Line A';
const SKIP_REASON = 'Line A was down for the rebuild for the whole period — there was no line to walk.';

/** One withdrawn occurrence. Cancelled work was never owed, so no measure counts it. */
const CANCELLED_OLDEST = 'Retained sample review — Lab 1';

/** A few in-flight tasks somebody has actually started. */
const IN_PROGRESS_IN_FLIGHT: readonly string[] = [
  'Permit condition review — Northgate',
  'Nonconformance log review — Northgate Quality',
  'Shift handover record — Line A',
];

/** Notes, so a record detail view is not a wall of empty fields. */
const NOTES: Readonly<Record<string, string>> = {
  'Emissions return — Northgate': 'Meter 3 was swapped mid-period — figures split across the two serials, both attached.',
  'Calibration verification — Lab 1': 'Waiting on the reference standard to come back from the calibration house.',
  'Site environmental audit — Northgate': 'Booked for the week of the shutdown so the lines are cold.',
  'Toolbox talk record — Line B': 'Two of the night shift still to attend; running a repeat session.',
  'Contractor induction refresh — Northgate': 'Pass list pulled from the gatehouse; fourteen to chase.',
};

export interface SeededTask extends Omit<TaskDraft, 'status'> {
  status: 'open' | 'in_progress' | 'done' | 'skipped' | 'cancelled';
  completed_at?: string;
  skip_reason?: string;
  note?: string;
  /** Written by a SECOND seed pass — an insert can never carry it. See `task.seed.ts`. */
  last_update_at: string;
}

const byDuty = new Map<string, TaskDraft[]>();
for (const draft of DRAFTS) {
  const series = byDuty.get(draft.duty);
  if (series) series.push(draft);
  else byDuty.set(draft.duty, [draft]);
}
for (const series of byDuty.values()) {
  series.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
}

const isPast = (draft: TaskDraft) => draft.due_date < TODAY;

const mostRecentPast = new Map<string, string>();
const oldest = new Map<string, string>();
for (const [duty, series] of byDuty) {
  const past = series.filter(isPast);
  if (past.length > 0) mostRecentPast.set(duty, past[past.length - 1]!.period_key);
  if (series.length > 0) oldest.set(duty, series[0]!.period_key);
}

/** The earliest occurrence of a duty that is still in flight — the one its owner is looking at now. */
const inFlightKey = (duty: string): string | undefined =>
  byDuty.get(duty)?.find((draft) => !isPast(draft))?.period_key;

/**
 * How long ago a task that is still moving was last touched.
 *
 * Two constraints, and the interesting one is the second:
 *
 *  1. **Never before the task was dispatched.** A row cannot have been worked
 *     on before it existed. This clamps the whole band for a freshly
 *     dispatched monthly.
 *  2. **Never 14 days or more.** Anything that old lands in "Not moving", and
 *     which rows stagnate is a decision this fixture makes deliberately —
 *     see {@link STALLED_IN_FLIGHT} — not a side effect of a spread.
 *
 * Between those, the age is spread by how long the task has BEEN open rather
 * than uniformly. A task dispatched five months ago and still being worked was
 * realistically last touched a week or two back; one dispatched on Monday was
 * touched this week. A uniform spread collapses to "everything was touched in
 * the last few days" once constraint 1 clamps it, which makes the dashboard's
 * nested >7d / >14d / >30d buckets read identically and look broken.
 */
const touchedDaysAgo = (draft: TaskDraft, dispatched: Date, index: number): number => {
  const openFor = Math.floor((NOW.getTime() - dispatched.getTime()) / DAY);
  if (openFor >= 14) return 8 + (index % 5);
  return Math.max(0, Math.min(index % 6, openFor));
};

/**
 * Decide what actually happened to one dispatched task.
 *
 * Deterministic: every variation is a function of the draft's position in the
 * fixture, never of a random number. Two boots of the same tree produce the
 * same history, which is what lets `test/seed.test.ts` assert counts at all.
 */
const resolveDraft = (draft: TaskDraft, index: number): SeededTask => {
  const timezone = TZ_BY_DUTY.get(draft.duty) ?? 'UTC';
  const dispatched = new Date(startOfDay(draft.visible_from, timezone).getTime() + 9 * HOUR);
  const dueInstant = startOfDay(draft.due_date, timezone);
  const note = NOTES[draft.duty];
  const withNote = (row: SeededTask): SeededTask => (note ? { ...row, note } : row);

  const isMostRecentPast = mostRecentPast.get(draft.duty) === draft.period_key;
  const isOldest = oldest.get(draft.duty) === draft.period_key;
  const isInFlightHead = inFlightKey(draft.duty) === draft.period_key;
  const untouchedSinceDispatch = iso(dispatched);

  // ── The occurrences placed by hand ───────────────────────────────────
  if (isMostRecentPast && draft.duty in LATE_MOST_RECENT) {
    return withNote({
      ...draft,
      status: LATE_MOST_RECENT[draft.duty]!,
      // Chased, but at different tempos — 2, 6 and 10 days. A month-overdue
      // task that was last touched yesterday, every time, is not what being
      // chased looks like; and spreading these across the fortnight is what
      // puts anything at all in the dashboard's 7-to-14-day band, which would
      // otherwise be empty and make its >7d and >14d tiles read identically.
      last_update_at:
        draft.duty === STALLED_LATE
          ? untouchedSinceDispatch
          : iso(new Date(NOW.getTime() - CHASED_DAYS_AGO[index % CHASED_DAYS_AGO.length]! * DAY)),
    });
  }
  if (isMostRecentPast && draft.duty === SKIPPED_MOST_RECENT) {
    return {
      ...draft,
      status: 'skipped',
      skip_reason: SKIP_REASON,
      last_update_at: iso(new Date(dueInstant.getTime() - DAY + 15 * HOUR)),
    };
  }
  if (isOldest && draft.duty === CANCELLED_OLDEST) {
    return {
      ...draft,
      status: 'cancelled',
      last_update_at: iso(new Date(dueInstant.getTime() - 3 * DAY + 11 * HOUR)),
    };
  }

  // ── Everything else already due is done ──────────────────────────────
  if (isPast(draft)) {
    // Some early, some on the day, some just over. A history that is uniformly
    // on time reads as fabricated — and the grace days each duty grants exist
    // precisely because real completion scatters around the due date.
    const drift = [-3, -1, 0, 1][index % 4]!;
    const completed = iso(
      new Date(Math.max(dueInstant.getTime() + drift * DAY + 14 * HOUR, dispatched.getTime())),
    );
    return withNote({ ...draft, status: 'done', completed_at: completed, last_update_at: completed });
  }

  // ── In flight ────────────────────────────────────────────────────────
  const stalled = isInFlightHead && STALLED_IN_FLIGHT.includes(draft.duty);
  return withNote({
    ...draft,
    status: isInFlightHead && IN_PROGRESS_IN_FLIGHT.includes(draft.duty) ? 'in_progress' : 'open',
    last_update_at: stalled ? untouchedSinceDispatch : iso(new Date(NOW.getTime() - touchedDaysAgo(draft, dispatched, index) * DAY)),
  });
};

/** Every dispatched task the demo opens with, history and in-flight alike. */
export const SEEDED_TASKS: readonly SeededTask[] = DRAFTS.map(resolveDraft);
