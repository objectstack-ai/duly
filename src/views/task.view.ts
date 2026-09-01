// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { P, defineView } from '@objectstack/spec';

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
 * Bulk complete and bulk skip — declarative, and the ONLY declarative field
 * write the platform offers.
 *
 * `operation: 'update'` with a static `patch` IS the platform's "set these
 * fields on every selected record": no action, no handler, no code. The write
 * runs on the data plane under the CALLER's own permissions — strictly safer
 * than N dispatches through an action handler's `ctx.engine`, which is
 * system-elevated and RLS-bypassing by design.
 *
 * A week's worth of ticks in one gesture is the difference between a Monday
 * habit and a chore, so this is not a convenience: it is the same interaction
 * budget as the row tick, applied to the week.
 *
 * ── `visible` here is the OUTER of two layers ─────────────────────────────
 * It is evaluated once PER SELECTED RECORD, and the run covers only the rows
 * that pass, which is what keeps an already-`done` row out of the batch. That
 * matters for a reason that is MEASURED rather than theoretical: a predicate
 * update carries ONE payload for all N rows (`driver.updateMany` takes one SET
 * clause), so `task.hook.ts` stamping `completed_at` for a row that is
 * genuinely transitioning would write that timestamp to the whole batch —
 * silently re-dating a task completed days ago.
 *
 * A view predicate is a client-side hide, though, and the write it guards is
 * server-side: an import, a backfill, the dispatcher or an MCP caller
 * reassembles the same batch without ever reading this file. So the authority
 * lives at the write. `task.hook.ts` REFUSES a predicate write that would
 * re-stamp an already-done row (`DULY_TASK_BULK_ALREADY_DONE`, 409) — the one
 * route ADR-0058 Addendum II D3 sanctions for a row-conditional decision on a
 * batch-scoped payload.
 *
 * This predicate is kept because it is still the right UX: it stops the
 * console from assembling a batch the server would refuse, so a user gets an
 * unavailable action rather than an error they did not cause.
 * `test/task-hook.test.ts` pins the refusal; `test/task-actions.test.ts` pins
 * both layers.
 *
 * Labels are plain strings: an authored def is not i18n-resolved. That is a
 * real cost, accepted here because the repo carries no translation bundle yet
 * (`dulyTranslations` is empty) and the alternative — promoting the row
 * actions via `bulkActions: ['duly_task_complete']` — is N action dispatches
 * through the elevated facade instead of one data-plane write.
 */
const bulkActions = [
  {
    name: 'duly_task_bulk_complete',
    label: 'Complete',
    icon: 'check',
    variant: 'primary' as const,
    operation: 'update' as const,
    // The complete payload, same one field as the row action. No
    // `completed_at`: the hook owns it, and it is readonly to callers.
    patch: { status: 'done' },
    confirmText: 'Mark the selected tasks done.',
    confirmLabel: 'Complete',
    visible: P`record.status == "open" || record.status == "in_progress"`,
  },
  {
    name: 'duly_task_bulk_skip',
    label: 'Skip',
    icon: 'skip-forward',
    variant: 'secondary' as const,
    operation: 'update' as const,
    patch: { status: 'skipped' },
    // One reason for the whole selection. That is honest for the case this
    // exists to serve — a plant shutdown skips the week together — and the
    // per-task wording stays available on the row action.
    params: [
      {
        name: 'skip_reason',
        label: 'Why skipped',
        type: 'text' as const,
        required: true,
        placeholder: 'The plant was down — there was nothing to return',
        help: 'Recorded on every task in the selection.',
      },
    ],
    visible: P`record.status == "open" || record.status == "in_progress"`,
  },
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
    bulkActionDefs: bulkActions,
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
      bulkActionDefs: bulkActions,
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
      bulkActionDefs: bulkActions,
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
      bulkActionDefs: bulkActions,
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

    /**
     * Kanban. Columns come from `duly_task.status` — the renderer reads the
     * field's own `options` for the column set, their order and their labels
     * (measured in the console's `plugin-kanban`), so the board cannot drift
     * from the object.
     *
     * Dragging a card writes ONE field. Measured against the renderer's move
     * handler: `dataSource.update(object, id, { [groupBy]: toColumnId })` —
     * `status` and nothing else, which is the same write the row action does.
     * It is NOT gated on `inlineEdit`; it is gated on update permission, so a
     * user who may not write `status` gets the platform's rejection rather
     * than a silent no-op.
     *
     * `inlineEdit` is still declared, and it is not decoration: the toolbar
     * lets a viewer switch this view to its grid visualisation, and the
     * adapter honours `inlineEdit` on that branch (`editable:` is set in the
     * grid case only). On the kanban branch itself it is inert.
     *
     * No `summarizeField`: it renders a per-column SUM, and there is no number
     * on a task worth totalling. The nearest candidate would be a count, and
     * counts are never ranked or compared here.
     */
    board: {
      label: 'Board',
      type: 'kanban',
      data,
      columns: [{ field: 'subject' }, { field: 'due_date' }, { field: 'owner' }, { field: 'source' }],
      kanban: {
        groupByField: 'status',
        // The card face, in reading order: what it is, when it is owed, whose
        // it is, and where it came from.
        columns: ['subject', 'due_date', 'owner', 'source'],
      },
      inlineEdit: true,
      sort: [{ field: 'due_date', order: 'asc' }],
    },

    /**
     * Gantt. The bar runs `visible_from` → `due_date`, and that span IS the
     * lead time: a bar that starts on its own due date is a task that first
     * appeared the day it was already owed, which is a report on a failure
     * rather than a reminder. `lead_days` on the duty is what produces the
     * length, and this is the only screen where you can see it.
     *
     * Grouped by owner so an overloaded fortnight is visible as one person's
     * row going solid, before the period arrives.
     *
     * The filter is not a scope narrowing, it is a correctness one: the
     * renderer maps a missing date to `new Date()`, so an undated one-off
     * would draw a zero-width bar on TODAY and read as load that does not
     * exist. Both columns are stored and indexed; the unary operators carry
     * their direction in the name and take no value.
     *
     * No `colorField`, deliberately, and this is measured rather than an
     * oversight: the gantt renderer passes `record[colorField]` straight into
     * `backgroundColor`, so `colorField: 'status'` sets `background: "open"` —
     * not a colour, silently dropped, every bar identical. With the key
     * ABSENT the same renderer falls through to its status-derived palette and
     * the bars separate by state. Filed upstream; see the PR body.
     */
    schedule: {
      label: 'Schedule',
      type: 'gantt',
      data,
      columns: [
        { field: 'subject' },
        { field: 'status' },
        { field: 'owner' },
        { field: 'visible_from' },
        { field: 'due_date' },
      ],
      gantt: {
        startDateField: 'visible_from',
        endDateField: 'due_date',
        titleField: 'subject',
        groupByField: 'owner',
        viewMode: 'week',
        tooltipFields: [{ field: 'status' }, { field: 'period_key' }, { field: 'source' }],
      },
      filter: [
        { field: 'visible_from', operator: 'is_not_null' },
        { field: 'due_date', operator: 'is_not_null' },
      ],
      sort: [{ field: 'visible_from', order: 'asc' }],
    },

    /**
     * Timeline — the visual companion to `stalled`. Ordered by
     * `last_update_at`, which `task.hook.ts` stamps on a status change or a
     * note edit and deliberately does NOT advance on an administrative write,
     * so this really is "what has been happening" and not "what has been
     * touched".
     *
     * `colorField` earns its place here: the timeline renderer resolves it
     * against the object's own `status` options and uses the AUTHORED colours
     * (`#35674D` for done, and so on), so this lens and the status badge in
     * every grid read the same.
     */
    recent: {
      label: 'Recent activity',
      type: 'timeline',
      data,
      columns: [{ field: 'subject' }, { field: 'status' }, { field: 'owner' }, { field: 'last_update_at' }],
      timeline: {
        startDateField: 'last_update_at',
        titleField: 'subject',
        colorField: 'status',
        scale: 'day',
      },
      sort: [{ field: 'last_update_at', order: 'desc' }],
    },

    /**
     * Outstanding work, bucketed by team. `business_unit` is denormalised onto
     * the task at dispatch precisely so a rollup like this survives a later
     * transfer.
     *
     * Groups sort by LABEL — measured in the grid's grouping hook, which sorts
     * group keys with a locale compare on the label and never on the bucket
     * size. Nothing here ranks a unit, or a person, by a count.
     */
    by_unit: {
      label: 'By business unit',
      type: 'grid',
      data,
      /**
       * The residual, stated for the reader of the SCREEN and not only for the
       * reader of this file, because the filter below does NOT make the
       * mechanism correct — it makes this deployment fit inside it. The
       * grouping and its per-group counts are computed over the FETCHED PAGE,
       * so the numbers in the group headers are true only while the filtered
       * set fits in one. The dashboard's by-unit figures come from the
       * `duly_stagnation` dataset and are aggregated server-side over the
       * whole store; those are the authoritative ones, and this lens is for
       * browsing.
       *
       * ⚠ It does NOT reach the screen today, and that is measured rather
       * than assumed. The value survives every layer — it is in
       * `dist/objectstack.json` and in `GET /api/v1/meta/view/duly_task` —
       * but the console's `ObjectView` relay builds its ListView schema by
       * spreading the OBJECT's list view and relaying `label`, `sort`,
       * `filter` and friends off the active view, and `description` is not
       * one of the keys it relays. `ListView` has the branch that would
       * render it (`data-testid="view-description"`); the value never
       * arrives, so nothing is displayed and nothing errors. Filed as
       * objectstack-ai/objectui#7199.
       *
       * It stays authored anyway, and that is deliberate: this is the key the
       * spec defines for exactly this sentence, it IS served to API and MCP
       * callers reading the view today, and it starts rendering the moment
       * the relay is fixed. What must not happen is someone reading this file
       * and believing the caveat is currently in front of users. Written as a
       * PLAIN STRING on purpose: the renderer takes
       * `typeof description === 'string' ? description : ''`, so an inline
       * `{ en, 'zh-CN' }` locale map would render empty even after the relay
       * is fixed (second half of #7199).
       */
      description:
        'Open and in-progress work only. Group counts are computed over the loaded page — the '
        + 'dashboard is the authoritative by-unit surface; this lens is for browsing.',
      /**
       * `business_unit` is in the columns because the grid's query
       * projection is built from `columns` ALONE — `grouping` contributes
       * nothing to it. Measured on the seeded app: without this the request
       * was `select=id,subject,status,due_date,period_key,owner,source`, the
       * field arrived `undefined` on all 186 rows, and the renderer bucketed
       * every one of them into a single `(empty)` group. Nothing errored and
       * every gate stayed green.
       *
       * Filed upstream as objectstack-ai/objectui#7179 — the projection
       * should union the grouping fields rather than making authors mirror
       * them here. This is not a workaround waiting on it: on a by-unit view
       * the unit column is worth showing anyway, and it is the shared six
       * plus one rather than a column every other lens has to carry.
       * `test/metadata-bindings.test.ts` fails if a grouped grid ever drops
       * it again.
       */
      columns: [...columns, { field: 'business_unit' }],
      grouping: { fields: [{ field: 'business_unit' }] },
      /**
       * ⚠ LOAD-BEARING FOR THE GROUPING — not a scope preference, and not a
       * default worth inheriting. Widen it and the lens silently goes wrong
       * again, in the way described below. `test/metadata-bindings.test.ts`
       * fails if it is dropped or widened.
       *
       * ── What it is holding up, measured on the #75 seed ──────────────────
       * The grid groups CLIENT-SIDE over the rows already fetched, and its
       * per-group counts are `computeAggregations` over that same array
       * (objectui's `useGroupedData`). There is no server-side grouping path
       * for a grid at all, so a grouped grid can only be a complete roll-up
       * while its whole result set fits in one page.
       *
       * Unfiltered, this lens did not. The store holds 186 tasks — 151 of them
       * `done`, most from months ago — across FIVE business units, and the
       * request is `top=100`:
       *
       *   Northgate Operations  33     store: 61
       *   Northgate Plant        3     store:  7
       *   Northgate Quality     46     store: 86
       *   Riverside Plant       18     store: 31
       *   (Central Office)       —     store:  1   ← no group at all
       *                        ───
       *                        100     "Showing first 100 records."
       *
       * Two failures, and the second is the sharper one. Every count in the
       * header was a page slice reading as a total. And one unit had NO GROUP
       * ON THE SCREEN, with nothing saying a unit was missing — a wrong number
       * invites a second look, an absent row does not.
       *
       * Scoped to open work the lens fits: 27 `open` + 6 `in_progress` = 33
       * rows, one page, all five units present, every count true. That is also
       * the better lens on its own merits — "what is outstanding, by unit" is
       * the question a manager opens this for, and nobody wants a by-unit
       * breakdown of work that finished six months ago. It survives the
       * platform being fixed: even with server-side grouping we would not want
       * this lens spending its first page on completed tasks.
       *
       * ── Why not simply raise the page size ──────────────────────────────
       * It moves the cliff instead of removing it, and hides the next
       * occurrence. With a filter that fits, the page size is not what is
       * holding the lens together.
       *
       * ── What stays broken ───────────────────────────────────────────────
       * This remains STRUCTURALLY page-scoped. A deployment with more open
       * tasks than a page hits exactly this again, with the same silent
       * missing group. The filter buys a correct lens at this product's
       * realistic scale, not a correct mechanism. The durable fix is upstream:
       * objectstack-ai/objectui#7189 asks for server-side grouping and true
       * per-group counts on a grid — the platform already does this for the
       * dashboard through a dataset, just not on this surface. The `description`
       * above is where that is said to users — subject to objectui#7199,
       * which currently keeps a per-view description off the screen entirely,
       * so today this comment and the counts' own arithmetic are the whole
       * disclosure.
       */
      filter: [{ field: 'status', operator: 'in', value: ['open', 'in_progress'] }],
      bulkActionDefs: bulkActions,
      sort: [{ field: 'due_date', order: 'asc' }],
    },
  },
});
