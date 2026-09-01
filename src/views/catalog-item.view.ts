// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'duly_catalog_item' };

export const CatalogItemViews = defineView({
  list: {
    label: 'Role catalog',
    type: 'grid',
    data,
    columns: [
      { field: 'position_code' },
      { field: 'name' },
      { field: 'form' },
      { field: 'frequency' },
      { field: 'regulation_ref' },
      { field: 'active' },
    ],
    sort: [{ field: 'position_code', order: 'asc' }],
  },
});
