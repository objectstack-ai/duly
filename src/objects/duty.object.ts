// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { P } from '@objectstack/spec';
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
        { label: 'Role catalog', value: 'catalog', color: '#16515F', default: true },
        { label: 'Assigned by manager', value: 'assigned', color: '#8C6512' },
        { label: 'Self-declared', value: 'self', color: '#576B73' },
      ],
    }),

    catalog_item: Field.lookup('duly_catalog_item', {
      label: 'Catalog item',
      description: 'Set when this duty was instantiated from a role catalog, so catalog edits can be replayed.',
    }),

    // ── Cadence ───────────────────────────────────────────────────────────
    frequency: Field.select({
      label: 'Frequency',
      options: [
        { label: 'Daily', value: 'daily' },
        { label: 'Weekly', value: 'weekly' },
        { label: 'Fortnightly', value: 'fortnightly' },
        { label: 'Monthly', value: 'monthly', default: true },
        { label: 'Quarterly', value: 'quarterly' },
        { label: 'Semi-annual', value: 'semiannual' },
        { label: 'Annual', value: 'annual' },
      ],
      description: 'Required for recurring duties. Ignored for one-off and standing.',
    }),

    due_anchor: Field.select({
      label: 'Due date anchored to',
      options: [
        { label: 'Start of period', value: 'period_start', default: true },
        { label: 'End of period', value: 'period_end' },
      ],
    }),

    due_offset_days: Field.number({
      label: 'Offset (days)',
      defaultValue: 0,
      description: 'Days from the anchor. "5" with a monthly period anchored to period start = due on the 5th. Negative offsets count back from period end.',
    }),

    lead_days: Field.number({
      label: 'Lead time (days)',
      defaultValue: 7,
      min: 0,
      description: 'How far ahead of the due date the task appears in the owner\'s list. A task that shows up on its due date is a task that is already late.',
    }),

    grace_days: Field.number({
      label: 'Grace (days)',
      defaultValue: 0,
      min: 0,
      description: 'Days after the due date before an open task counts as late.',
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
      name: 'effective_window_ordered',
      type: 'script',
      severity: 'error',
      message: 'Effective from must not be after effective to.',
      condition: P`!isBlank(record.effective_from) && !isBlank(record.effective_to) && record.effective_from > record.effective_to`,
    },
  ],
});
