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
 * ── `visible` here is load-bearing, not decoration ────────────────────────
 * It is evaluated once PER SELECTED RECORD, and the run covers only the rows
 * that pass. That is what keeps an already-`done` row out of the batch — and
 * it has to, for a reason that is MEASURED rather than theoretical: a
 * predicate update carries ONE payload for all N rows (`driver.updateMany`
 * takes one SET clause), so `task.hook.ts` stamping `completed_at` for a row
 * that is genuinely transitioning writes that timestamp to the whole batch.
 * Verified against a booted engine: bulk-completing a selection that already
 * contains a done row moves that row's `completed_at` to now. The predicate
 * is what makes such a selection unreachable from the UI;
 * `test/task-actions.test.ts` pins both halves.
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
  },
});
