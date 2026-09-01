// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Frequency } from '../functions/period.js';

import { ADMIN, POSITIONS } from './demo-org.js';

/**
 * The role catalog, and the duties instantiated from it.
 *
 * ── Cadence is authored ONCE, on the catalog item ─────────────────────────
 * A duty copies its item's cadence verbatim — that is what
 * `duly_catalog_apply` does at run time, so the fixture does the same rather
 * than restating five numbers per duty. {@link DemoDuty} therefore carries no
 * cadence of its own: `duty.seed.ts` reads it off {@link CATALOG_ITEMS}.
 *
 * ── Which cadence fields a form may carry is now ENFORCED (#61) ───────────
 * `standing_no_frequency`, `non_recurring_no_due_timing` and
 * `standing_no_grace_days` refuse the meaningless combinations at insert, on
 * both `duly_catalog_item` and `duly_duty`. A standing row carrying a
 * frequency does not read oddly — it is **rejected**, and with it every duty
 * and task downstream. So:
 *
 *   standing   →  no frequency, no dueAnchor, no dueOffsetDays, no leadDays,
 *                 no graceDays. All five omitted; the conditional defaults
 *                 resolve them to null.
 *   one_off    →  no dueAnchor, no dueOffsetDays, no leadDays. Keeps
 *                 graceDays — its task has a real due date to be late against.
 *   recurring  →  all five.
 *
 * {@link cadenceOf} is the single place that decides this, so a new item
 * cannot get it wrong by omission.
 */

export type Form = 'recurring' | 'one_off' | 'standing';

export interface DemoCatalogItem {
  name: string;
  position: string;
  form: Form;
  description: string;
  /** The clause this duty discharges. Invented internal policy — never a real regulation. */
  reference?: string;
  active?: boolean;
  // Cadence — present only on the forms allowed to carry each field.
  frequency?: Frequency;
  dueAnchor?: 'period_start' | 'period_end';
  dueOffsetDays?: number;
  leadDays?: number;
  graceDays?: number;
}

const { compliance, supervisor, technician } = POSITIONS;

/**
 * Twenty items across three position codes.
 *
 * Frequency mix: eight monthly, three weekly, one fortnightly, two quarterly,
 * one semi-annual, two annual, two **standing** and one one-off. `regulation_ref`
 * is filled on all but one — it is what makes the catalog read as an audit
 * answer rather than a to-do list.
 */
export const CATALOG_ITEMS: readonly DemoCatalogItem[] = [
  // ── Plant compliance officer ──────────────────────────────────────────
  {
    name: 'Emissions return',
    position: compliance,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_end',
    dueOffsetDays: -5,
    leadDays: 10,
    graceDays: 3,
    description: 'Submit the site emissions figures for the month, with the meter readings they were derived from.',
    reference: 'Group Environment Standard GE-02 §5',
  },
  {
    name: 'Waste transfer log review',
    position: compliance,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_start',
    dueOffsetDays: 4,
    leadDays: 7,
    graceDays: 2,
    description: 'Check every transfer note raised last month against the carrier register; flag anything unmatched.',
    reference: 'Group Environment Standard GE-04 §2',
  },
  {
    name: 'Effluent sampling record',
    position: compliance,
    form: 'recurring',
    frequency: 'weekly',
    dueAnchor: 'period_start',
    dueOffsetDays: 1,
    leadDays: 3,
    graceDays: 1,
    description: 'Draw and log the weekly outfall sample. Record the result even when it is within limits.',
    reference: 'Site Discharge Consent DC-11 cl.4',
  },
  {
    name: 'Permit condition review',
    position: compliance,
    form: 'recurring',
    frequency: 'quarterly',
    dueAnchor: 'period_end',
    dueOffsetDays: -10,
    leadDays: 21,
    graceDays: 5,
    description: 'Walk the permit conditions one by one and record, for each, the evidence that it was met this quarter.',
    reference: 'Group Environment Standard GE-09 §1',
  },
  {
    name: 'Site environmental audit',
    position: compliance,
    form: 'recurring',
    frequency: 'semiannual',
    dueAnchor: 'period_end',
    dueOffsetDays: 0,
    // A long lead on purpose: half a year of work needs half a year of notice,
    // and it is what makes a task visible — and therefore capable of going
    // STALE — months before it is late. See `demo-history.ts`.
    leadDays: 150,
    graceDays: 10,
    description: 'Full walk-round audit against the group environmental standard, with findings and owners.',
    reference: 'Group Assurance Plan AP-3 §6',
  },
  {
    name: 'Annual environmental statement',
    position: compliance,
    form: 'recurring',
    frequency: 'annual',
    dueAnchor: 'period_end',
    dueOffsetDays: -30,
    leadDays: 60,
    graceDays: 14,
    description: 'Compile the year\'s environmental performance into the statement the group publishes.',
    reference: 'Group Environment Standard GE-01 §8',
  },
  {
    name: 'Keep the permit register current',
    position: compliance,
    form: 'standing',
    description: 'The register reflects the permits actually in force — no expiry passes without the entry being updated. Never "done"; attested, not ticked.',
    reference: 'Group Environment Standard GE-09 §4',
  },

  // ── Shift supervisor ──────────────────────────────────────────────────
  {
    name: 'Shift handover record',
    position: supervisor,
    form: 'recurring',
    frequency: 'weekly',
    dueAnchor: 'period_start',
    dueOffsetDays: 0,
    leadDays: 2,
    graceDays: 0,
    description: 'Written handover for every shift change in the week: state of the line, anything left open.',
    reference: 'Works Instruction WI-120 §3',
  },
  {
    name: 'Line safety walk',
    position: supervisor,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_start',
    dueOffsetDays: 2,
    leadDays: 7,
    graceDays: 2,
    description: 'Walk the line against the safety checklist with an operator present. Log what you fixed on the spot.',
    reference: 'Site Safety Standard SS-07 §2',
  },
  {
    name: 'Toolbox talk record',
    position: supervisor,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_start',
    dueOffsetDays: 9,
    leadDays: 7,
    graceDays: 3,
    description: 'Run one toolbox talk with the shift and record who attended.',
    reference: 'Site Safety Standard SS-07 §5',
  },
  {
    name: 'Lifting equipment check',
    position: supervisor,
    form: 'recurring',
    frequency: 'quarterly',
    dueAnchor: 'period_start',
    dueOffsetDays: 5,
    leadDays: 14,
    graceDays: 5,
    description: 'Visual check and tag review of every sling, hoist and eyebolt on the line.',
    reference: 'Works Instruction WI-204 §1',
  },
  {
    name: 'Contractor induction refresh',
    position: supervisor,
    form: 'recurring',
    frequency: 'annual',
    dueAnchor: 'period_end',
    dueOffsetDays: -60,
    // Same reasoning as the semi-annual audit above — a year's notice for a
    // year's obligation, which is what lets it stagnate long before it is late.
    leadDays: 120,
    // 21 is what this item's author wrote, and it is now a value the product
    // can actually honour. It could not be, once: the overdue escalation fires
    // on `due_date + grace_days + 1` and the sweep looked back only 15 days,
    // so day one for this item fell outside the window and it was never
    // escalated — a live instance, in our own demo data, of the silent
    // late-failure #82 is about. #82 cut it to 14 to fit that lookback; #89
    // raised the pair instead (`OVERDUE_LOOKBACK_DAYS` 31, `grace_days` max
    // 30), which is where the 21 comes back from. It earns its place in the
    // demo precisely because it is the one row exercising a grace longer than
    // a fortnight.
    graceDays: 21,
    description: 'Re-run the site induction for every contractor still holding a pass, and retire the passes nobody claimed.',
    reference: 'Site Safety Standard SS-15 §3',
  },
  {
    name: 'Answer the duty phone',
    position: supervisor,
    form: 'standing',
    description: 'The out-of-hours phone is carried and answered. There is no version of this that is ever finished.',
    reference: 'Works Instruction WI-002 §1',
  },
  {
    name: 'Overtime justification summary',
    position: supervisor,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_end',
    dueOffsetDays: -2,
    leadDays: 7,
    graceDays: 3,
    description: 'One line per overtime shift worked: why it was needed and what it covered.',
    reference: 'People Policy PP-22 cl.6',
  },

  // ── Quality technician ────────────────────────────────────────────────
  {
    name: 'Calibration verification',
    position: technician,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_start',
    dueOffsetDays: 6,
    leadDays: 7,
    graceDays: 2,
    description: 'Verify each instrument against its reference standard and record the deviation, in range or not.',
    reference: 'Quality Manual QM-31 §4',
  },
  {
    name: 'Retained sample review',
    position: technician,
    form: 'recurring',
    frequency: 'fortnightly',
    dueAnchor: 'period_start',
    dueOffsetDays: 2,
    leadDays: 5,
    graceDays: 1,
    description: 'Inspect the retained samples due for review and dispose of anything past its retention window.',
    reference: 'Quality Manual QM-18 §2',
  },
  {
    name: 'Nonconformance log review',
    position: technician,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_start',
    dueOffsetDays: 1,
    leadDays: 7,
    graceDays: 2,
    description: 'Review every nonconformance raised last month and confirm each one has an owner and a closing date.',
    reference: 'Quality Manual QM-05 §3',
  },
  {
    name: 'Cleaning verification swabs',
    position: technician,
    form: 'recurring',
    frequency: 'weekly',
    dueAnchor: 'period_start',
    dueOffsetDays: 3,
    leadDays: 3,
    graceDays: 1,
    description: 'Swab the changeover points after the weekly clean and log the plate counts.',
    reference: 'Quality Manual QM-22 §7',
  },
  {
    name: 'Instrument drift check',
    position: technician,
    form: 'recurring',
    frequency: 'monthly',
    dueAnchor: 'period_start',
    dueOffsetDays: 8,
    leadDays: 7,
    graceDays: 2,
    // The one item with no reference: not every duty discharges a written
    // clause, and a catalog where the column is 100% full stops reading as
    // real. Nothing downstream depends on it being set.
    description: 'Compare this month\'s calibration deviations against the last three and note any instrument trending out.',
  },
  {
    name: 'Commissioning file handover',
    position: technician,
    form: 'one_off',
    graceDays: 7,
    description: 'Hand the commissioning file to operations: as-built drawings, test records, spares list, signed off.',
    reference: 'Project Standard PS-06 §5',
    // Retired from the catalog once the programme it belonged to closed — the
    // duty already instantiated from it lives on. `active: false` is what a
    // real catalog looks like after a year.
    active: false,
  },
];

const ITEM_BY_NAME = new Map(CATALOG_ITEMS.map((i) => [i.name, i]));

export const catalogItem = (name: string): DemoCatalogItem => {
  const item = ITEM_BY_NAME.get(name);
  /* c8 ignore next 3 -- a typo here would silently seed a cadence-less duty */
  if (!item) throw new Error(`demo fixture: no catalog item named ${JSON.stringify(name)}`);
  return item;
};

/**
 * The cadence fields a row of `form` may carry, and only those.
 *
 * One function for both objects: a value stripped here for `duly_catalog_item`
 * is stripped identically for the `duly_duty` instantiated from it, so the two
 * cannot disagree and neither can trip #61's validation rules.
 */
export interface Cadence {
  frequency?: Frequency;
  due_anchor?: 'period_start' | 'period_end';
  due_offset_days?: number;
  lead_days?: number;
  grace_days?: number;
}

/**
 * Keys are OMITTED rather than set to `undefined`. An explicit `undefined` is
 * still an own property: it would be compared by the loader's no-op-replay
 * check (churning the row on every boot) and it is not what the conditional
 * `defaultValue` expressions expect to be handed.
 */
export const cadenceOf = (item: DemoCatalogItem): Cadence => {
  const out: Cadence = {};
  if (item.form === 'standing') return out;
  if (item.frequency !== undefined) out.frequency = item.frequency;
  if (item.graceDays !== undefined) out.grace_days = item.graceDays;
  if (item.form === 'one_off') return out;
  if (item.dueAnchor !== undefined) out.due_anchor = item.dueAnchor;
  if (item.dueOffsetDays !== undefined) out.due_offset_days = item.dueOffsetDays;
  if (item.leadDays !== undefined) out.lead_days = item.leadDays;
  return out;
};

// ─────────────────────────────────────────────────────────────────────────
// Duties — the catalog instantiated onto people
// ─────────────────────────────────────────────────────────────────────────

export interface DemoDuty {
  /**
   * `duly_duty.name`, and the seed's natural key for it.
   *
   * **Unique across the fixture, and it has to be.** The seed loader resolves
   * `duly_task.duty` as a natural key against `duly_duty.name` (`duly_duty`'s
   * dataset declares `externalId: 'name'`), matching with `limit: 1`. Two
   * duties sharing a name would not error — the second person's tasks would
   * simply attach to the first person's duty, silently and permanently.
   *
   * So where one catalog item is held by several people, the duty is named for
   * the SCOPE that person actually covers ("Line A", "Riverside", "Lab 2").
   * That is how the same obligation reads on a real site anyway, and it is
   * what makes "What each team owes" legible.
   */
  name: string;
  /** The `duly_catalog_item.name` this was instantiated from; `null` for self-declared. */
  item: string | null;
  owner: string;
  source: 'catalog' | 'assigned' | 'self';
  status?: 'active' | 'paused' | 'retired';
  /** Self-declared duties carry their own cadence — there is no catalog row behind them. */
  own?: Partial<DemoCatalogItem> & { form: Form };
}

/**
 * ⚠️ `source` is stated on EVERY row, never left to the default.
 *
 * Since #54 both `duly_duty.source` and `duly_task.source` default to `self`,
 * and every dataset measure is filtered to `catalog` + `assigned`
 * (`src/datasets/governed.ts`). A governed duty that relied on the default
 * would land unscored, and every dashboard measure would read zero — with no
 * error anywhere, because an unscored duty is a perfectly legal thing to be.
 */
export const DUTIES: readonly DemoDuty[] = [
  // ── The account `objectstack dev` logs you in as ──────────────────────
  // Deliberately given a real week: a monthly pair that keeps My week
  // populated, a quarter that has already run three times, the semi-annual
  // audit that goes stale, one standing duty, and one self-declared duty so
  // the caliber split is visible on the evaluator's OWN screen.
  { name: 'Emissions return — Northgate', item: 'Emissions return', owner: ADMIN, source: 'catalog' },
  { name: 'Waste transfer log review — Northgate', item: 'Waste transfer log review', owner: ADMIN, source: 'catalog' },
  { name: 'Permit condition review — Northgate', item: 'Permit condition review', owner: ADMIN, source: 'catalog' },
  { name: 'Site environmental audit — Northgate', item: 'Site environmental audit', owner: ADMIN, source: 'catalog' },
  { name: 'Keep the permit register current — Northgate', item: 'Keep the permit register current', owner: ADMIN, source: 'catalog' },
  {
    name: 'Keep up with regulator bulletins',
    item: null,
    owner: ADMIN,
    source: 'self',
    own: { form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 7, leadDays: 7, graceDays: 0, description: 'Read the month\'s bulletins and note anything that changes what the site owes.' },
  },

  // ── Northgate Quality ─────────────────────────────────────────────────
  { name: 'Annual environmental statement — Ardenline', item: 'Annual environmental statement', owner: 'Priya Raman', source: 'catalog' },
  { name: 'Answer the duty phone — Northgate Quality', item: 'Answer the duty phone', owner: 'Priya Raman', source: 'catalog' },
  {
    name: 'Monthly quality trend read',
    item: null,
    owner: 'Priya Raman',
    source: 'self',
    own: { form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 5, leadDays: 7, graceDays: 0, description: 'Half an hour with the month\'s nonconformances and calibration deviations, looking for the shape rather than the individual events.' },
  },
  { name: 'Calibration verification — Lab 1', item: 'Calibration verification', owner: 'Rosa Delgado', source: 'catalog' },
  { name: 'Retained sample review — Lab 1', item: 'Retained sample review', owner: 'Rosa Delgado', source: 'catalog' },
  { name: 'Nonconformance log review — Northgate Quality', item: 'Nonconformance log review', owner: 'Rosa Delgado', source: 'catalog' },
  { name: 'Calibration verification — Lab 2', item: 'Calibration verification', owner: 'Ibrahim Chaudhry', source: 'catalog' },
  { name: 'Instrument drift check — Lab 2', item: 'Instrument drift check', owner: 'Ibrahim Chaudhry', source: 'catalog' },
  {
    name: 'Track my own training hours',
    item: null,
    owner: 'Ibrahim Chaudhry',
    source: 'self',
    own: { form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 3, leadDays: 5, graceDays: 0, description: 'Log the hours and what they were spent on, so the year-end return is not reconstructed from memory.' },
  },

  // ── Northgate Operations ──────────────────────────────────────────────
  { name: 'Shift handover record — Line A', item: 'Shift handover record', owner: 'Marek Dvorak', source: 'catalog' },
  { name: 'Line safety walk — Line A', item: 'Line safety walk', owner: 'Marek Dvorak', source: 'catalog' },
  { name: 'Line safety walk — Line B', item: 'Line safety walk', owner: 'Sami Okonkwo', source: 'catalog' },
  { name: 'Toolbox talk record — Line B', item: 'Toolbox talk record', owner: 'Sami Okonkwo', source: 'catalog' },
  { name: 'Contractor induction refresh — Northgate', item: 'Contractor induction refresh', owner: 'Sami Okonkwo', source: 'catalog' },
  { name: 'Lifting equipment check — Line C', item: 'Lifting equipment check', owner: 'Yuki Tanabe', source: 'catalog' },
  { name: 'Overtime justification summary — Northgate Operations', item: 'Overtime justification summary', owner: 'Yuki Tanabe', source: 'catalog' },

  // ── Riverside Plant ───────────────────────────────────────────────────
  { name: 'Emissions return — Riverside', item: 'Emissions return', owner: 'Ana Ferreira', source: 'catalog' },
  { name: 'Permit condition review — Riverside', item: 'Permit condition review', owner: 'Ana Ferreira', source: 'catalog' },
  // The paused duty. `planForDuty` skips it with `not_active`, so it holds no
  // tasks at all — which is the point: pausing stops the dispatcher, it does
  // not hide the obligation.
  { name: 'Waste transfer log review — Riverside', item: 'Waste transfer log review', owner: 'Ana Ferreira', source: 'catalog', status: 'paused' },
  { name: 'Line safety walk — Riverside', item: 'Line safety walk', owner: 'Greta Lindqvist', source: 'catalog' },
  { name: 'Toolbox talk record — Riverside', item: 'Toolbox talk record', owner: 'Greta Lindqvist', source: 'catalog' },
  { name: 'Nonconformance log review — Riverside', item: 'Nonconformance log review', owner: 'Elin Halvorsen', source: 'catalog' },

  // ── Managers hold duties of their own ─────────────────────────────────
  // A second standing duty instantiated from the same catalog item, at group
  // level. Standing duties hold no tasks, so this costs the fixture nothing
  // and keeps the top of the org chart from being a person with no duties.
  { name: 'Keep the permit register current — Ardenline', item: 'Keep the permit register current', owner: 'Nadia Ilves', source: 'catalog' },
  {
    name: 'Monthly site performance note',
    item: null,
    owner: 'Tomas Bergh',
    source: 'self',
    own: { form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -1, leadDays: 5, graceDays: 0, description: 'A page on how the site actually ran this month — written for myself, not for a report.' },
  },

  // ── Central Office ────────────────────────────────────────────────────
  // A one-off: dispatched by hand, never by the scheduler. `planForDuty`
  // returns `one_off` for it, so its single task is seeded directly in
  // `task.seed.ts` alongside the assignment fan-out.
  { name: 'Commissioning file handover — Riverside upgrade', item: 'Commissioning file handover', owner: 'Owen Pryce', source: 'catalog' },
];
