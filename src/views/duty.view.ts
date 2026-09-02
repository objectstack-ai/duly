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
      { field: 'review_status' },
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
        // Where each of my duties stands in the pipeline — including the ones
        // that are approved and therefore NOT in "To confirm". A duty list
        // that showed only `status` would say "Active" about a duty producing
        // no tasks at all.
        { field: 'review_status' },
        { field: 'status' },
      ],
      filter: [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }],
    },

    /**
     * "What is waiting on ME" — the owner's half of the review pipeline.
     *
     * Two states in one list, deliberately. `to_confirm` (the organisation
     * put this on you; is it yours?) and `returned` (a reviewer sent it back)
     * are different sentences, but they are the same ACTION — read it, fix it
     * if it needs fixing, send it up — and splitting them would make the
     * second one a list most people never open. `review_note` is a column
     * rather than a detail-page trip: a returned duty whose reason you have
     * to click into is a reason you read once.
     */
    to_confirm: {
      label: 'To confirm',
      type: 'grid',
      data,
      columns: [
        { field: 'name' },
        { field: 'review_status' },
        { field: 'review_note' },
        { field: 'form' },
        { field: 'frequency' },
        { field: 'source' },
      ],
      filter: [
        { field: 'owner', operator: 'equals', value: '{current_user_id}' },
        { field: 'review_status', operator: 'in', value: ['to_confirm', 'returned'] },
      ],
      sort: [{ field: 'name', order: 'asc' }],
    },

    /**
     * "What is waiting on a reviewer" — the other half.
     *
     * No owner filter, and that is the point: this list is somebody ELSE's
     * duties. How far it reaches is not this view's decision — it is
     * `duly_manager`'s `readScope: 'unit_and_below'` on `duly_duty`
     * (`src/security/permission-sets.ts`), which resolves to owner-only on an
     * open-edition boot and to the unit tree with `@objectstack/security-
     * enterprise` installed. A view that tried to express reach in its own
     * filter would be a second, weaker copy of the security model.
     *
     * `owner` is a column here for the same reason it is not a filter: the
     * first question a reviewer asks of this list is whose duty each row is.
     */
    to_review: {
      label: 'To review',
      type: 'grid',
      data,
      columns: [
        { field: 'name' },
        { field: 'owner' },
        { field: 'business_unit' },
        { field: 'form' },
        { field: 'frequency' },
        { field: 'source' },
      ],
      filter: [{ field: 'review_status', operator: 'equals', value: 'to_review' }],
      sort: [{ field: 'business_unit', order: 'asc' }, { field: 'name', order: 'asc' }],
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
      /**
       * Both grouping fields are columns here because the grid's query
       * projection is built from `columns` ALONE — `grouping` contributes
       * nothing to it. Measured on the seeded app: without them the request
       * was `select=id,name,form,frequency,source,status`, both fields
       * arrived `undefined`, and this two-level lens collapsed into a single
       * `(empty)` group nested inside another `(empty)` group. Nothing
       * errored and every gate stayed green.
       *
       * Filed upstream as objectstack-ai/objectui#7179 — the projection
       * should union the grouping fields rather than making authors mirror
       * them here. They are listed in the grouping's own order, so the row
       * reads the way the hierarchy nests, and they earn their place on a
       * "what does this team owe" screen regardless.
       * `test/metadata-bindings.test.ts` fails if either is dropped again.
       */
      columns: [
        { field: 'name' },
        { field: 'form' },
        { field: 'frequency' },
        { field: 'business_unit' },
        { field: 'owner' },
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
