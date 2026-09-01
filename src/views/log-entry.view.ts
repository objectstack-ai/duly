// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'duly_log_entry' };

export const LogEntryViews = defineView({
  list: {
    label: 'Work log',
    type: 'grid',
    data,
    columns: [
      { field: 'logged_on' },
      { field: 'subject' },
      { field: 'category' },
      { field: 'visibility' },
    ],
    sort: [{ field: 'logged_on', order: 'desc' }],
  },
});
