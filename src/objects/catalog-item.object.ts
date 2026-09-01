// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
    }),

    due_anchor: Field.select({
      label: 'Due date anchored to',
      options: [
        { label: 'Start of period', value: 'period_start', default: true },
        { label: 'End of period', value: 'period_end' },
      ],
    }),

    due_offset_days: Field.number({
      label: 'Offset (days, 0 = anchor day)',
      defaultValue: 0,
      description: 'Days from the anchor day, which is offset 0. On "Start of period": 0 = the first day of the period, 4 = the fifth day. On "End of period": 0 = the last day of the period, -3 = three days before the last.',
    }),
    lead_days: Field.number({ label: 'Lead time (days)', defaultValue: 7, min: 0 }),
    grace_days: Field.number({ label: 'Grace (days)', defaultValue: 0, min: 0 }),

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
});
