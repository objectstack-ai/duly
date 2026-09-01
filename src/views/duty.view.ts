// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'duly_duty' };

export const DutyViews = defineView({
  list: {
    label: 'All duties',
    type: 'grid',
    data,
    columns: [
      { field: 'name' },
      { field: 'form' },
      { field: 'frequency' },
      { field: 'owner' },
      { field: 'source' },
      { field: 'status' },
    ],
  },

  listViews: {
    mine: {
      label: 'My duties',
      type: 'grid',
      data,
      columns: [
        { field: 'name' },
        { field: 'form' },
        { field: 'frequency' },
        { field: 'due_anchor' },
        { field: 'status' },
      ],
      filter: [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }],
    },

    // Standing duties never produce a task, so they would otherwise be
    // invisible. They get their own view rather than an infinite backlog.
    standing: {
      label: 'Standing duties',
      type: 'grid',
      data,
      columns: [{ field: 'name' }, { field: 'owner' }, { field: 'business_unit' }, { field: 'status' }],
      filter: [{ field: 'form', operator: 'equals', value: 'standing' }],
    },
  },
});
