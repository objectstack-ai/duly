// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'duly_assignment' };

export const AssignmentViews = defineView({
  list: {
    label: 'Assignments',
    type: 'grid',
    data,
    columns: [
      { field: 'subject' },
      { field: 'assigner' },
      { field: 'due_date' },
      { field: 'task_count' },
      { field: 'status' },
    ],
    sort: [{ field: 'due_date', order: 'asc' }],
  },

  listViews: {
    sent_by_me: {
      label: 'Sent by me',
      type: 'grid',
      data,
      columns: [
        { field: 'subject' },
        { field: 'due_date' },
        { field: 'task_count' },
        { field: 'status' },
      ],
      filter: [{ field: 'assigner', operator: 'equals', value: '{current_user_id}' }],
    },
  },
});
