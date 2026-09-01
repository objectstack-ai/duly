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

    /**
     * "What does this team owe" — every duty bucketed by business unit, then
     * by the one accountable person inside it, both levels collapsible.
     *
     * ⚠️ DELIBERATELY `type: 'grid'` + `grouping`, NOT `type: 'tree'`, and the
     * difference is not cosmetic. The platform's `tree` view is a
     * SELF-REFERENCING hierarchy: `TreeConfigSchema` takes a `parentField`
     * single-parent pointer, and the renderer nests a record under another
     * record of the SAME object by matching `record[parentField]` against the
     * sibling ids. `duly_duty` has no self-reference — its lookups point at
     * `sys_business_unit`, `duly_catalog_item` and a user — so a `type: 'tree'`
     * view here resolves no parent for any row, puts every duty at depth 0 and
     * renders a FLAT list. The renderer never reads `grouping`, so declaring
     * the two levels alongside it would change nothing, and nothing in
     * `pnpm validate` says so: the `view/layout-without-binding` gate does not
     * cover `tree` at all. That is the exact "renders wrong while authoring
     * reports success" shape this app's views exist to avoid, so it is not
     * shipped and the gap is filed upstream instead (see the PR body).
     *
     * The grid's grouping hook is the honest expression of the same idea and
     * it is measured, not assumed: it recurses through `grouping.fields`,
     * building nested `subgroups` with per-level collapse — a real two-level
     * hierarchy. Group keys sort by LABEL, never by bucket size, so no team
     * and no person is ever ordered by how much they owe.
     */
    catalog_tree: {
      label: 'What each team owes',
      type: 'grid',
      data,
      columns: [
        { field: 'name' },
        { field: 'form' },
        { field: 'frequency' },
        { field: 'source' },
        { field: 'status' },
      ],
      grouping: {
        fields: [{ field: 'business_unit' }, { field: 'owner' }],
      },
      sort: [{ field: 'name', order: 'asc' }],
    },
  },
});
