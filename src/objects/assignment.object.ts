// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `duly_assignment` — a manager hands one piece of work to N people.
 *
 * The fan-out is the whole point. An assignment to five people becomes five
 * independent `duly_task` rows, each with one owner who updates only their own.
 * Nobody maintains "3 of 5 done" — it is a rollup over the children, computed
 * on read. The alternative (one shared task with five names on it) produces a
 * record that everybody can see and nobody owns.
 *
 * Assigning is also the ONLY write a manager makes in this product. There is no
 * manager-side status entry, no weekly consolidation form, no sign-off queue.
 */
export const Assignment = ObjectSchema.create({
  name: 'duly_assignment',
  label: 'Assignment',
  pluralLabel: 'Assignments',
  icon: 'send',
  description: 'One piece of work handed to several people, fanned out into independent tasks.',

  sharingModel: 'private',

  fields: {
    subject: Field.text({ label: 'Assignment', required: true, searchable: true, maxLength: 255 }),
    description: Field.markdown({ label: 'Details' }),

    assigner: Field.user({
      label: 'Assigned by',
      required: true,
      defaultValue: 'current_user',
    }),

    assignees: Field.user({
      label: 'Assign to',
      multiple: true,
      required: true,
      description: 'Each name becomes one independent task.',
    }),

    due_date: Field.date({ label: 'Due' }),

    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Draft', value: 'draft', color: '#8598A0', default: true },
        { label: 'Dispatched', value: 'dispatched', color: '#2E7C8E' },
        { label: 'Closed', value: 'closed', color: '#35674D' },
      ],
    }),

    needs_collection: Field.boolean({
      label: 'I have a follow-up once everyone is in',
      defaultValue: false,
      description: 'Only when this is ticked does the assigner get a task of their own. Otherwise a manager who assigns work does not inherit a to-do list from it.',
    }),

    // Server-owned rollups (ADR-0021). Nobody types these.
    task_count: Field.summary({
      label: 'Tasks',
      summaryOperations: {
        object: 'duly_task',
        field: 'id',
        function: 'count',
        relationshipField: 'assignment',
      },
    }),
  },

  enable: { trackHistory: true, searchable: true, apiEnabled: true, files: true },

  indexes: [{ fields: ['assigner', 'status'] }, { fields: ['due_date'] }],

  nameField: 'subject',
  highlightFields: ['subject', 'assigner', 'due_date', 'status'],
});
