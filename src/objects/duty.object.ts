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
    // bounds read the same way — "Grace (days) must be ≤ 30".
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
    // `grace_days` stops at 30, and that number is NOT a taste call. The
    // overdue escalation fires on `due_date + grace_days + 1` and its sweep
    // looks back `OVERDUE_LOOKBACK_DAYS` (31) days
    // (`src/flows/reminders.flow.ts`), so a grace of 31 or more puts day one
    // outside the swept window and the escalation NEVER FIRES — the same
    // silent inertness this card is about, one flow over.
    //
    // ── THE OTHER HALF OF THIS NUMBER LIVES IN ANOTHER FILE ───────────────
    // The invariant is `lookback >= max_grace + 1`, and it spans three files
    // that cannot see each other:
    //
    //   src/flows/reminders.flow.ts    OVERDUE_LOOKBACK_DAYS = 31
    //   src/objects/duty.object.ts     grace_days max: 30   ← you are here
    //   src/objects/catalog-item.object.ts  grace_days max: 30 (mirrored,
    //                                  because catalog apply copies it onto
    //                                  every duty it creates)
    //
    // Nothing in the toolchain couples them; `test/reminders.test.ts` ("the
    // lookback still covers the largest grace a duty can declare") reads all
    // three and fails if any moves alone. Raise this ceiling and you MUST
    // raise the lookback in the same commit — the failure mode of getting it
    // wrong is not an error, it is an escalation that never fires and never
    // says so. That is exactly how a 21-day grace sat in the demo catalog
    // against a 15-day lookback, never escalating, until #82 went looking.
    //
    // ── Why 30 and not 14 (#89) ───────────────────────────────────────────
    // 14 was the largest grace a 15-day lookback could honour, and it was
    // measurably too low: the demo catalog's annual "Contractor induction
    // refresh" was authored with 21 days of grace — an ordinary configuration
    // for an annual duty — and had to be cut to fit. A limit that a plausible
    // first configuration trips is a limit in the wrong place, so the lookback
    // moved instead. It stops at 30 rather than going further because a grace
    // longer than a month stops being grace and becomes a different due date,
    // and the lookback is the half that is not free (see the flow).
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
      max: 30,
      description: 'Days after the due date before an open task counts as late. Whole days, up to 30 — the overdue reminder sweeps 31 days back, so a longer grace would put day one outside the window and never fire at all. Meaningless for a standing duty, which never has a task; still applies to a one-off\'s.',
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


    // ── Review — confirmed by the owner, approved by somebody else ────────
    //
    // A duty that nobody has approved does not dispatch (`dispatch.plan.ts`
    // refuses it with `not_approved`). That is the whole point of the column:
    // an imported or self-created list is VISIBLE immediately and PRODUCTIVE
    // only once a second person has said so.
    //
    // `trackHistory: true` is already set on this object, and that is what
    // renders the clickable status pipeline on the record page — measured:
    // app-declared actions render nowhere in the Console today
    // (objectui#7234), while a tracked `select` gets the platform's own
    // pipeline for free. So the whole workflow rides this field rather than a
    // pair of custom buttons that would not appear.
    review_status: Field.select({
      label: 'Review status',
      required: true,
      options: [
        { label: 'To confirm', value: 'to_confirm', color: '#8C6512' },
        { label: 'To review', value: 'to_review', color: '#2E7C8E' },
        // ── The two verdicts, and why they carry a predicate ──────────────
        // `visibleWhen` is the ONE authoring surface on this platform whose
        // predicate scope binds the caller (`current_user`) as well as the
        // record — measured on `@objectstack/formula` 17.2.0, and enforced
        // server-side, not just in the picker: ObjectQL's rule validator
        // evaluates the PICKED option's `visibleWhen` on every insert and
        // update and rejects the write with `invalid_option` when it is
        // false. `SelectOptionSchema` says so in as many words ("Client-side
        // hiding is UX, not authorization … the server MUST also reject
        // writes of its value"), which is why authorization lives here and
        // NOT in a hand-written hook.
        //
        // The predicate is the RECORD RELATIONSHIP, not a position, and that
        // is a decision worth stating because the card asked for a position:
        //
        //  - `'duly_manager' in current_user.positions` evaluates and
        //    enforces correctly (measured both ways). But `current_user
        //    .positions` is populated from `sys_user_position` rows, which a
        //    PACKAGE may not declare (`src/security/positions.ts`) — they are
        //    a manual rollout step. In every deployment that has not done it
        //    yet, including `pnpm demo`, the list is empty, so a position
        //    predicate fails CLOSED and nobody can approve anything. A gate
        //    that is inert-or-fatal depending on a manual step is not a gate.
        //  - `record.owner != current_user.id` needs nothing installed and
        //    says the thing the product actually means: a review you issue on
        //    your own list is not a review. WHO ELSE may write the record at
        //    all is already decided one layer up, by the permission set's
        //    write scope — the platform's own axis for that question.
        //
        // Fail-open case, stated because it is real: a write with no acting
        // user (the declarative seed, an in-process job) cannot bind
        // `current_user`, the predicate fails to evaluate, and the platform
        // logs `option visibleWhen … failed to evaluate — allowed through`
        // and admits the write. That is what lets the demo seed carry
        // `approved` rows, and it means this predicate is a rule about
        // PEOPLE, not a containment boundary for server code.
        { label: 'Approved', value: 'approved', color: '#35674D', visibleWhen: P`record.owner != current_user.id` },
        { label: 'Returned', value: 'returned', color: '#A33A2B', visibleWhen: P`record.owner != current_user.id` },
      ],
      // Where a new duty enters the pipeline, decided by WHO PUT IT THERE.
      // The organisation's lists (`catalog`, `assigned`) need the owner to
      // confirm they are theirs before anyone approves them; a self-declared
      // duty is already confirmed by the act of writing it down, so it goes
      // straight to review. Same conditional-default idiom as the cadence
      // fields above, and it works for the same reason: `source` is declared
      // higher up this map, so `record.source` is already resolved — from the
      // payload, or from `source`'s own option default — by the time this
      // runs.
      defaultValue: F`record.source == "self" ? "to_review" : "to_confirm"`,
      description: 'Where this duty stands in confirmation and approval. Only an approved duty dispatches tasks — a returned one stops the same day, which is the point of returning it.',
    }),

    review_note: Field.textarea({
      label: 'Return reason',
      description: 'Why the duty was sent back, in words the owner can act on. Required to return one (`returned_needs_note`), and deliberately not cleared afterwards — the last return is worth reading while the correction is being made.',
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
    // The dispatcher's selection filter is `status + form + review_status`
    // (`dispatch.job.ts#readDispatchableDuties`), and it is the one query in
    // this app that runs over every duty in the tenant, every night.
    { fields: ['review_status'] },
  ],

  nameField: 'name',

  /**
   * ── The record page's clickable pipeline renders THIS field ─────────────
   * [ADR-0085] `stageField` names the record's LINEAR lifecycle, and the
   * record-detail stepper is its consumer. Measured on the running console
   * (`@objectstack/console` 17.2.0): with the key absent the renderer falls
   * back to a heuristic that takes the first field named `status` / `stage` /
   * `state` / `phase` — so this object's stepper was `status`
   * (Active · Paused · Retired), which is not a progression at all. ADR-0085
   * calls that exact shape "an unordered state set" and says a consumer's
   * stage heuristics should be suppressed for it.
   *
   * `review_status` IS linear — to confirm → to review → approved — so it is
   * the honest answer to the question the key asks, and naming it is what
   * makes the confirmation workflow clickable on the record page. That
   * matters more than it sounds: an app-declared action renders NOWHERE in
   * the Console today (objectui#7234), so this stepper is the only surface
   * this workflow has.
   *
   * `status` loses its stepper and stays an ordinary select on the form,
   * which is what it always should have been.
   */
  stageField: 'review_status',

  highlightFields: ['name', 'form', 'frequency', 'owner', 'status', 'review_status'],

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
      // ── The pipeline, as a table the engine enforces ────────────────────
      // `to_confirm → to_review → approved | returned → to_review`, and
      // nothing else. Declared as the platform's `state_machine` rule rather
      // than as three script predicates over `previous.review_status`,
      // because this is the shape the platform reads: ADR-0020 retired the
      // standalone `workflow` type and made a record's legal transitions a
      // validation rule with a flat `{ from: [to] }` table, and the rule
      // validator enforces it on the UPDATE path with the prior row in hand.
      //
      // Two details in here are load-bearing, both measured on
      // `@objectstack/objectql` 17.2.0:
      //
      //  - An empty array is how a state is made TERMINAL, and omitting a
      //    key is the opposite: the validator does `const allowed =
      //    transitions[from]; if (!Array.isArray(allowed)) return null;`, so a
      //    state with no row accepts ANY transition out of it. Every state
      //    this pipeline has is therefore written down, including the ones
      //    with one way out.
      //  - `initialStates` closes the INSERT door, which `transitions` does
      //    not cover at all: a `select` accepts any declared option on
      //    create, so without this a duty could be born `approved` and
      //    dispatch immediately — which is the defect this whole card exists
      //    to close, arriving through the other door.
      //
      // The seed and the historical-import path are exempt by design, not by
      // accident: the platform skips `state_machine` rules whenever the write
      // context carries `seedReplay` (the seed loader always does) or
      // `skipStateMachine` (what the REST import endpoint sets for
      // `treatAsHistorical`). So a customer importing an existing list that is
      // already approved lands it mid-pipeline through the platform's own
      // door, and nobody needs a back door here.
      name: 'review_status_transitions',
      type: 'state_machine',
      field: 'review_status',
      severity: 'error',
      message: 'That is not a step this review can take. A duty goes to confirm → to review → approved or returned, and a returned one goes back to review once it has been corrected.',
      transitions: {
        to_confirm: ['to_review'],
        to_review: ['approved', 'returned'],
        returned: ['to_review'],
        // ── `approved → returned`, which the card's table does not draw ───
        // Deliberate, and worth the deviation. Measured: with `approved: []`
        // an approved duty can never be corrected by anyone — no owner, no
        // manager, no administrator; the only doors left are a historical
        // import and a re-seed. A cadence that turns out wrong, a duty
        // approved on the wrong person, a catalog sync that replays a change
        // nobody re-read — each is a live duty dispatching work every night
        // with no way back into the pipeline that governs it.
        //
        // Returning is the one way out, and it is the auditable one:
        // `returned_needs_note` makes the reason mandatory, and the tasks
        // already dispatched are untouched — returning stops the NEXT run,
        // it does not retract work already owed. Approval is still not
        // self-issuable (see the option predicates above), so this is not a
        // loophole around review; it is the correction path review needs.
        approved: ['returned'],
      },
      initialStates: ['to_confirm', 'to_review'],
    },
    {
      // Returning a duty without saying why makes the return unactionable:
      // the owner sees `returned` and has nothing to correct. Same shape and
      // the same reasoning as `duly_task`'s `skip_needs_reason`.
      name: 'returned_needs_note',
      type: 'script',
      severity: 'error',
      message: 'Say why the duty is being returned — the owner needs something to act on.',
      condition: P`record.review_status == "returned" && isBlank(record.review_note)`,
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
