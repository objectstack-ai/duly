// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { F, P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `duly_catalog_item` — a duty template attached to a ROLE, not a person.
 *
 * This is the thing customers already have, usually as a spreadsheet: "these
 * are the 26 things a plant compliance officer owes". Instantiating a role
 * catalog onto a new hire is the difference between a product someone adopts in
 * an afternoon and one that dies during onboarding because 400 people were each
 * asked to hand-type their own list.
 *
 * The catalog is org-readable on purpose: it describes roles, not individuals,
 * and people need to see what a role owes before they take it.
 */
export const CatalogItem = ObjectSchema.create({
  name: 'duly_catalog_item',
  label: 'Catalog item',
  pluralLabel: 'Role catalog',
  icon: 'list-checks',
  description: 'A duty template attached to a role. Instantiated onto a person to create their duties.',

  // [ADR-0090 D1] Role descriptions, not personal data. Everyone reads;
  // permission sets decide who writes.
  sharingModel: 'public_read',

  fields: {
    name: Field.text({ label: 'Duty', required: true, searchable: true, maxLength: 200 }),
    description: Field.markdown({ label: 'What "done" means' }),

    position_code: Field.text({
      label: 'Position',
      required: true,
      searchable: true,
      maxLength: 100,
      description: 'The position this duty belongs to. Free text so a customer can load their catalog before modelling positions in the platform.',
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

    // Every default below is CONDITIONAL on `form`, mirroring `duly_duty`
    // field-for-field (#61 — #5's instantiation copies these verbatim onto
    // every duty made from this item, so a wrong value here is replicated
    // onto every person who takes the role). See `duty.object.ts`'s cadence
    // block for the full reasoning on which forms lose which field.
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

    // `scale` and the bounds are `duly_duty`'s, to the digit — see the long
    // block on that object for what each one was measured to prevent (#82).
    // They belong HERE as well as there because this object is where the
    // values are AUTHORED: `applyCatalogHandler` copies all three onto every
    // duty it creates, through `engine.insert`, which validates. A catalog
    // item carrying `due_offset_days: 1.5` is therefore not a quiet
    // inconsistency — it is an apply that refuses partway through, having
    // already created duties for the first N people, and the refusal names
    // `duly_duty` rather than the catalog item the value actually lives on.
    // Stopping it at the source is the difference between one loud refusal on
    // the row being edited and a half-finished fan-out.
    due_offset_days: Field.number({
      label: 'Offset (days, 0 = anchor day)',
      defaultValue: F`record.form != "recurring" ? null : 0`,
      scale: 0,
      min: -366,
      max: 366,
      description: 'Days from the anchor day, which is offset 0. On "Start of period": 0 = the first day of the period, 4 = the fifth day. On "End of period": 0 = the last day of the period, -3 = three days before the last. Whole days, and within a year either side of the anchor. Only a recurring duty has a period to offset into; blank (and forbidden) for standing and one-off.',
    }),
    lead_days: Field.number({
      label: 'Lead time (days)',
      defaultValue: F`record.form != "recurring" ? null : 7`,
      scale: 0,
      min: 0,
      max: 366,
      description: 'Whole days, up to a year. Only a recurring duty is dispatched with a lead window; blank (and forbidden) for standing and one-off.',
    }),
    grace_days: Field.number({
      label: 'Grace (days)',
      defaultValue: F`record.form == "standing" ? null : 0`,
      scale: 0,
      min: 0,
      max: 14,
      description: 'Whole days, up to 14 — the overdue reminder sweeps 15 days back, so a longer grace would never fire. Meaningless for a standing duty, which never has a task; still applies to a one-off\'s.',
    }),

    regulation_ref: Field.text({
      label: 'Reference',
      maxLength: 200,
      description: 'The clause, standard or policy this duty discharges. What turns a checklist into an audit answer.',
    }),

    active: Field.boolean({ label: 'Active', defaultValue: true }),
  },

  enable: { trackHistory: true, searchable: true, apiEnabled: true },

  indexes: [{ fields: ['position_code', 'active'] }],

  nameField: 'name',
  highlightFields: ['name', 'position_code', 'form', 'frequency'],

  // Mirrors `duly_duty`'s cadence rules (#61, #65) — not its full validation
  // set. `effective_window_ordered` has no equivalent here and never will:
  // this object declares no `effective_from` / `effective_to` at all, so
  // there is no window to order. That is the one deliberate divergence.
  validations: [
    {
      // The gap #65 closes, and the LAST place a blank recurring frequency
      // can be caught. Measured on @objectstack/runtime 17.2.0, not assumed:
      //
      //  - On INSERT the conditional default masks it. `applyFieldDefaults`
      //    treats an explicit `frequency: null` as absent and re-stamps
      //    `"monthly"` from the CEL default two dozen lines up, so an insert
      //    could never have reached this rule blank in the first place.
      //  - On UPDATE nothing runs. `applyFieldDefaults` is INSERT-only, so
      //    `{ frequency: null }` on a still-recurring item landed with no
      //    refusal — the one write that produces the state, and the one this
      //    rule exists for.
      //  - Downstream does NOT catch it either. `applyCatalogHandler` copies
      //    `frequency` onto every new `duly_duty` verbatim, and that insert
      //    hits the SAME default-masking: the duty is stamped `"monthly"`
      //    and `duly_duty`'s own `recurring_needs_frequency` never fires. So
      //    a blank here does not fan out as N loud refusals — it fans out as
      //    N duties silently dispatching on a monthly cadence nobody chose.
      //    Pinned in `test/catalog-apply-cadence.test.ts`.
      //
      // Wording is `duly_duty`'s, verbatim, as the three rules below already
      // are: a catalog item IS a duty template ("Duty" is even this object's
      // `name` label), and one message per cadence rule is what lets the
      // suites assert both objects against one constant.
      name: 'recurring_needs_frequency',
      type: 'script',
      severity: 'error',
      message: 'A recurring duty needs a frequency — otherwise nothing can dispatch it.',
      condition: P`record.form == "recurring" && isBlank(record.frequency)`,
    },
    {
      name: 'standing_no_frequency',
      type: 'script',
      severity: 'error',
      message: 'A standing duty never dispatches — a frequency on it is meaningless. Remove it.',
      condition: P`record.form == "standing" && !isBlank(record.frequency)`,
    },
    {
      name: 'non_recurring_no_due_timing',
      type: 'script',
      severity: 'error',
      message: 'Due anchor, due offset and lead time compute a period due date — only a recurring duty has one. Clear them for standing and one-off.',
      condition: P`record.form != "recurring" && (!isBlank(record.due_anchor) || !isBlank(record.due_offset_days) || !isBlank(record.lead_days))`,
    },
    {
      name: 'standing_no_grace_days',
      type: 'script',
      severity: 'error',
      message: 'Grace days measures lateness against a task\'s due date — a standing duty never has a task, so it never has one.',
      condition: P`record.form == "standing" && !isBlank(record.grace_days)`,
    },
  ],
});
