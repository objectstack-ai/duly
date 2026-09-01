// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { F, P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `duly_duty` — the STANDING DEFINITION of a piece of work someone owes.
 *
 * A duty is not a task. It is the rule that produces tasks: "the plant manager
 * files the emissions return, monthly, by the 5th, with 7 days of lead time".
 * The dispatcher (`src/jobs/dispatch.job.ts`) turns an active recurring duty
 * into exactly one `duly_task` per period.
 *
 * ── Why three forms and not one ──────────────────────────────────────────
 * `recurring`  auto-dispatches. The spine of the product.
 * `one_off`    is dispatched once, by hand or by an assignment fan-out.
 * `standing`   NEVER completes and therefore NEVER generates a task ("keep the
 *              register current", "answer the duty phone"). Products that model
 *              these as tasks generate an infinite backlog of items nobody can
 *              close, and users learn to ignore the list. A standing duty is
 *              visible and attestable, not tickable.
 *
 * ── Why `due_anchor` + `due_offset_days` and not just a period ───────────
 * A quarterly duty due "in Q3" is due on 30 September to everyone who is behind
 * on it. Anchoring the due date INSIDE the period is what keeps annual and
 * semi-annual work from collapsing onto the last week of December.
 */
export const Duty = ObjectSchema.create({
  name: 'duly_duty',
  label: 'Duty',
  pluralLabel: 'Duties',
  icon: 'clipboard-list',
  description: 'A standing obligation attached to a person: what is owed, how often, and by when within each period.',

  // [ADR-0090 D1] A duty carries the org chart's expectations of a named
  // person. Default-deny; managers reach their reports through the permission
  // sets in `src/security/`, never through an org-wide default.
  sharingModel: 'private',

  fields: {
    name: Field.text({
      label: 'Duty',
      required: true,
      searchable: true,
      maxLength: 200,
    }),

    description: Field.markdown({
      label: 'What "done" means',
      description: 'The acceptance bar, in the owner\'s own words. Optional — an unfilled one is not a blocker.',
    }),

    form: Field.select({
      label: 'Form',
      required: true,
      options: [
        { label: 'Recurring', value: 'recurring', color: '#2E7C8E', default: true },
        { label: 'One-off', value: 'one_off', color: '#8C6512' },
        { label: 'Standing', value: 'standing', color: '#576B73' },
      ],
    }),

    owner: Field.user({
      label: 'Owner',
      required: true,
      defaultValue: 'current_user',
      description: 'Exactly one accountable person. Work owed by "the team" is owed by nobody.',
    }),

    business_unit: Field.lookup('sys_business_unit', {
      label: 'Business unit',
      description: 'Rollup anchor. Set from the owner\'s position on create.',
    }),

    // ── Where the duty came from ──────────────────────────────────────────
    // This is the CALIBER field, and the only one metrics are allowed to read.
    // `catalog` and `assigned` duties are governed: the organisation put them
    // there, so on-time rates over them mean something. `self` duties are the
    // owner's own record-keeping — surfaced, never scored, never ranked. Keep
    // metric filters on this stored column rather than deriving a boolean:
    // a derived flag is one more thing that can drift out of step with it.
    source: Field.select({
      label: 'Source',
      required: true,
      options: [
        { label: 'Role catalog', value: 'catalog', color: '#16515F' },
        { label: 'Assigned by manager', value: 'assigned', color: '#8C6512' },
        // The default. Every path that legitimately produces a governed duty
        // stamps `source` explicitly — `duly_catalog_apply` writes 'catalog'
        // (#34), the assignment fan-out writes 'assigned' (#33) — so the
        // default is only ever reached by a hand-created duty, which is by
        // definition self-declared. Fail-safe direction: a producer that
        // forgets to stamp caliber produces an unscored duty, not a scored
        // one (#50).
        { label: 'Self-declared', value: 'self', color: '#576B73', default: true },
      ],
    }),

    catalog_item: Field.lookup('duly_catalog_item', {
      label: 'Catalog item',
      description: 'Set when this duty was instantiated from a role catalog, so catalog edits can be replayed.',
    }),

    // ── Cadence ───────────────────────────────────────────────────────────
    // Every default below is CONDITIONAL on `form` (#61): a duty that never
    // dispatches (`standing`) or dispatches once by hand (`one_off`) has no
    // period, so a cadence field auto-filled anyway does not merely go
    // unread — it reads back as though the duty runs on that schedule. The
    // option-level `default: true` idiom (still used on `form` itself, three
    // fields up) is UNCONDITIONAL, so the conditional half needs the CEL
    // `defaultValue` slot instead: the blessed null-guard idiom
    // (`cond ? value : null`, objectstack#3306) that `applyFieldDefaults` and
    // `Field.formula` share one evaluator for. `form` is declared above every
    // field below, so by the time each of these runs `record.form` is already
    // resolved — from the payload, or from `form`'s own option default.
    //
    // Which forms lose which field is NOT uniform, and is decided by what
    // `dispatch.plan.ts#planForDuty` actually reads, not by a blanket
    // "non-recurring" rule:
    //  - `frequency` is scoped to `standing` ONLY, mirroring exactly the
    //    converse of `recurring_needs_frequency` below (the pair this issue
    //    completes). One-off's equally-meaningless frequency is a separate,
    //    narrower case this issue does not adjudicate.
    //  - `due_anchor` / `due_offset_days` / `lead_days` compute a PERIOD due
    //    date, which only a recurring duty has — `planForDuty` returns before
    //    reading any of the three for `standing` or `one_off`. Scoped to
    //    `form != "recurring"`.
    //  - `grace_days` measures lateness against a TASK's due date, and a
    //    one-off duty's task has a real one (set directly, not computed from
    //    an anchor) — see `duly_duty_health`'s intended `completed_at <=
    //    due_date + duty.grace_days` (objectstack#14104), which is not
    //    form-gated. Only `standing`, which never has a task, loses it.
    frequency: Field.select({
      label: 'Frequency',
      options: [
        { label: 'Daily', value: 'daily' },
        { label: 'Weekly', value: 'weekly' },
        { label: 'Fortnightly', value: 'fortnightly' },
        { label: 'Monthly', value: 'monthly' },
        { label: 'Quarterly', value: 'quarterly' },
        { label: 'Semi-annual', value: 'semiannual' },
        { label: 'Annual', value: 'annual' },
      ],
      defaultValue: F`record.form == "standing" ? null : "monthly"`,
      description: 'Required for a recurring duty. Forbidden for a standing duty — it never dispatches, so a frequency on it is meaningless (`standing_no_frequency`). Ignored for one-off, which is dispatched once, by hand.',
    }),

    due_anchor: Field.select({
      label: 'Due date anchored to',
      options: [
        { label: 'Start of period', value: 'period_start' },
        { label: 'End of period', value: 'period_end' },
      ],
      defaultValue: F`record.form != "recurring" ? null : "period_start"`,
      description: 'Anchors the due date inside a period. Only a recurring duty has one; blank (and forbidden) for standing and one-off.',
    }),

    // ── Why these three carry `scale` and bounds (#82) ────────────────────
    // All three are WHOLE DAYS, and the engine's number validator enforces
    // `min` / `max` / `scale` only when they are DECLARED. Undeclared, a
    // fractional or absurd value saves clean, passes `pnpm validate` and
    // renders fine — then fails days later inside the nightly batch, recorded
    // against the JOB rather than against the duty that holds the bad value.
    //
    // `scale: 0` rather than a sixth hand-written validation: it is the
    // platform's own declarative answer to exactly this (AGENTS.md rule 9),
    // and it does something no rule can — the form renders a whole-number
    // input, so the value is harder to type wrong in the first place. The
    // platform's refusal was measured before this was decided rather than
    // assumed insufficient (the card left "or a script validation with a
    // product-voice message" open), and it turns out to name the field by its
    // LABEL, the limit, and what arrived:
    //
    //   ValidationError: Offset (days, 0 = anchor day) must have at most 0
    //   decimal places (got 1)                          code VALIDATION_FAILED
    //   fields[0]: { field: 'due_offset_days', code: 'max_scale',
    //                constraint: { scale: 0, actual: 1 } }
    //
    // That is already product voice, so nothing is layered on top of it. The
    // bounds read the same way — "Grace (days) must be ≤ 14".
    //
    // ── The three do NOT share a failure mode ─────────────────────────────
    // Same declaration, three different routes to the period engine — measured
    // one duty at a time on 17.2.0, against the real engine and the real CEL
    // evaluator, because "same declaration" is not "same behaviour":
    //
    //   due_offset_days: 1.5  `dueDateFor` throws, `planForDuty` catches it as
    //                         `invalid_cadence`, the run reports `degraded`
    //                         and the duty produces no tasks —
    //                         "dueOffsetDays must be a whole number of days,
    //                          received 1.5".
    //   lead_days: 2.5        Throws too, but one function over:
    //                         `visibleFromFor`, reached through
    //                         `addCalendarDays`, which NEGATES its argument.
    //                         So the message names a number nobody typed —
    //                         "leadDays must be a whole number of days,
    //                          received -2.5".
    //   grace_days: 2.5       Throws NOWHERE. It never reaches the period
    //                         engine at all; its only evaluating reader is the
    //                         overdue escalation's CEL gate, which wraps it in
    //                         `int()`. Measured: `int(2.5) == 2`,
    //                         `int(2.9) == 2`. A duty declaring 2.5 days of
    //                         grace escalates on precisely the day one
    //                         declaring 2 does — silently, forever.
    //
    // ── The bounds ────────────────────────────────────────────────────────
    // `9e9` was accepted here too, and failed later still: measured as
    // "dueDate must be a YYYY-MM-DD calendar date, received 0NaN-NaN-NaN",
    // which names neither the field nor anything the author typed. An anchor
    // or a lead window reaching more than a year outside its own period is a
    // typo, not a schedule, so ±366 / 0..366 is where they stop.
    //
    // `grace_days` stops at 14, and that number is NOT a taste call. The
    // overdue escalation fires on `due_date + grace_days + 1` and its sweep
    // looks back `OVERDUE_LOOKBACK_DAYS` (15) days
    // (`src/flows/reminders.flow.ts`), so a grace of 15 or more puts day one
    // outside the swept window and the escalation NEVER FIRES — the same
    // silent inertness this card is about, one flow over. 14 is the largest
    // grace the product can currently honour; raising it means raising the
    // lookback, and `test/reminders.test.ts` holds the two numbers together so
    // neither can move alone.
    due_offset_days: Field.number({
      label: 'Offset (days, 0 = anchor day)',
      defaultValue: F`record.form != "recurring" ? null : 0`,
      scale: 0,
      min: -366,
      max: 366,
      description: 'Days from the anchor day, which is offset 0. On "Start of period": 0 = the first day of the period, 4 = the fifth day. On "End of period": 0 = the last day of the period, -3 = three days before the last. Whole days, and within a year either side of the anchor — anything larger is a typo, not a schedule. Only a recurring duty has a period to offset into; blank (and forbidden) for standing and one-off.',
    }),

    lead_days: Field.number({
      label: 'Lead time (days)',
      defaultValue: F`record.form != "recurring" ? null : 7`,
      scale: 0,
      min: 0,
      max: 366,
      description: 'How far ahead of the due date the task appears in the owner\'s list. A task that shows up on its due date is a task that is already late. Whole days, up to a year. Only a recurring duty is dispatched with a lead window; blank (and forbidden) for standing and one-off.',
    }),

    grace_days: Field.number({
      label: 'Grace (days)',
      defaultValue: F`record.form == "standing" ? null : 0`,
      scale: 0,
      min: 0,
      max: 14,
      description: 'Days after the due date before an open task counts as late. Whole days, up to 14 — the overdue reminder sweeps 15 days back, so a longer grace would put day one outside the window and never fire at all. Meaningless for a standing duty, which never has a task; still applies to a one-off\'s.',
    }),

    // A global product cannot compute "the 5th of the month" without knowing
    // whose month. Periods are resolved in the duty's own timezone, not the
    // server's.
    timezone: Field.text({
      label: 'Timezone',
      defaultValue: 'UTC',
      maxLength: 64,
      description: 'IANA name (e.g. Europe/Berlin). Period boundaries and due dates are computed here.',
    }),

    // ── Lifecycle ─────────────────────────────────────────────────────────
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Active', value: 'active', color: '#35674D', default: true },
        { label: 'Paused', value: 'paused', color: '#8C6512' },
        { label: 'Retired', value: 'retired', color: '#8598A0' },
      ],
    }),

    effective_from: Field.date({ label: 'Effective from' }),
    effective_to: Field.date({ label: 'Effective to' }),

    // Written by the dispatcher, by nobody else. This is what makes dispatch
    // idempotent when the unique index alone is not enough to reason about
    // (e.g. a backfill run): the dispatcher reads it to know where it got to.
    last_dispatched_period: Field.text({
      label: 'Last dispatched period',
      readonly: true,
      maxLength: 16,
      description: 'Server-owned. Set by the dispatch job to the last period key it created a task for.',
    }),
  },

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    files: false,
  },

  indexes: [
    { fields: ['owner'] },
    { fields: ['business_unit'] },
    { fields: ['status'] },
    { fields: ['form'] },
    { fields: ['source'] },
  ],

  nameField: 'name',
  highlightFields: ['name', 'form', 'frequency', 'owner', 'status'],

  validations: [
    {
      name: 'recurring_needs_frequency',
      type: 'script',
      severity: 'error',
      message: 'A recurring duty needs a frequency — otherwise nothing can dispatch it.',
      condition: P`record.form == "recurring" && isBlank(record.frequency)`,
    },
    {
      // The converse of `recurring_needs_frequency` (#61). A standing duty
      // NEVER dispatches — that is the whole point of the form — so a
      // frequency on one is not just unused, it reads to a configurer as
      // though the duty runs on that schedule.
      name: 'standing_no_frequency',
      type: 'script',
      severity: 'error',
      message: 'A standing duty never dispatches — a frequency on it is meaningless. Remove it.',
      condition: P`record.form == "standing" && !isBlank(record.frequency)`,
    },
    {
      // `due_anchor` / `due_offset_days` / `lead_days` exist to compute a
      // PERIOD due date (`dispatch.plan.ts#planForDuty`), and only a
      // recurring duty has a period. Standing never dispatches; one-off's
      // due date is set directly on the task, never derived from an anchor.
      name: 'non_recurring_no_due_timing',
      type: 'script',
      severity: 'error',
      message: 'Due anchor, due offset and lead time compute a period due date — only a recurring duty has one. Clear them for standing and one-off.',
      condition: P`record.form != "recurring" && (!isBlank(record.due_anchor) || !isBlank(record.due_offset_days) || !isBlank(record.lead_days))`,
    },
    {
      // `grace_days` measures lateness against a TASK's due date. A one-off
      // duty's task has a real one (set by hand, not computed), so grace
      // still applies there — only `standing`, which never has a task at
      // all, loses it.
      name: 'standing_no_grace_days',
      type: 'script',
      severity: 'error',
      message: 'Grace days measures lateness against a task\'s due date — a standing duty never has a task, so it never has one.',
      condition: P`record.form == "standing" && !isBlank(record.grace_days)`,
    },
    {
      name: 'effective_window_ordered',
      type: 'script',
      severity: 'error',
      message: 'Effective from must not be after effective to.',
      condition: P`!isBlank(record.effective_from) && !isBlank(record.effective_to) && record.effective_from > record.effective_to`,
    },
  ],
});
