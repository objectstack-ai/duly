// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'duly_task' };

const columns = [
  { field: 'subject' },
  { field: 'status' },
  { field: 'due_date' },
  { field: 'period_key' },
  { field: 'owner' },
  { field: 'source' },
];

/**
 * Task views.
 *
 * `my_week` is the screen the product lives or dies on. It asks the stored,
 * indexed columns — `owner`, `status`, `visible_from` — and nothing derived, so
 * it stays correct without a maintenance writer behind it.
 */
export const TaskViews = defineView({
  list: {
    label: 'All tasks',
    type: 'grid',
    data,
    columns,
    sort: [{ field: 'due_date', order: 'asc' }],
  },

  listViews: {
    my_week: {
      label: 'My week',
      type: 'grid',
      data,
      columns: [{ field: 'subject' }, { field: 'status' }, { field: 'due_date' }, { field: 'source' }],
      filter: [
        { field: 'owner', operator: 'equals', value: '{current_user_id}' },
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
        { field: 'visible_from', operator: 'less_than_or_equal', value: '{today}' },
      ],
      sort: [{ field: 'due_date', order: 'asc' }],
    },

    // Late = past due and still open. Read from stored columns, never from a
    // flag: a stored `is_late` needs a writer that runs every midnight, and the
    // day it does not run the view lies without erroring.
    late: {
      label: 'Late',
      type: 'grid',
      data,
      columns,
      filter: [
        { field: 'due_date', operator: 'less_than', value: '{today}' },
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
      ],
      sort: [{ field: 'due_date', order: 'asc' }],
    },

    // Stagnation: open, and untouched for a fortnight. This is the earliest
    // honest warning a manager gets — earlier than any completion percentage,
    // because it fires long before the due date does.
    stalled: {
      label: 'Not moving',
      type: 'grid',
      data,
      columns: [...columns, { field: 'last_update_at' }],
      filter: [
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
        { field: 'last_update_at', operator: 'less_than', value: '{14_days_ago}' },
      ],
      sort: [{ field: 'last_update_at', order: 'asc' }],
    },

    calendar: {
      label: 'Calendar',
      type: 'calendar',
      data,
      columns: [{ field: 'subject' }, { field: 'status' }, { field: 'owner' }],
      // A calendar view with no `calendar` block binds to literal default field
      // names and renders empty while authoring reports success. Bind it.
      calendar: {
        startDateField: 'due_date',
        titleField: 'subject',
        colorField: 'status',
      },
      sort: [{ field: 'due_date', order: 'asc' }],
    },
  },
});
