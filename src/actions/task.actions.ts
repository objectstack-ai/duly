// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { P, defineAction } from '@objectstack/spec';

import {
  TASK_COMPLETE_ACTION,
  TASK_OBJECT,
  TASK_SKIP_ACTION,
  TASK_UNDO_ACTION,
} from './task.handlers.js';

/**
 * The interaction the whole product rests on.
 *
 * If ticking a task costs more than a second the list stops being maintained,
 * and every metric downstream becomes a report on a dataset nobody keeps. So:
 * one click to complete, one click to reverse, and a modal in exactly one
 * place — skip, where the object's own validation will refuse the write
 * without a reason.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * No `confirmText` on complete or undo. No completion percentage, no required
 * note, no evidence gate. `duly_task.enable.files` is on so people CAN attach
 * something, never so they must. Undo replaces confirmation: that trade is
 * what buys the tick itself having no ceremony, and it only holds while undo
 * stays one click away.
 *
 * ── Predicates are CEL and `record.`-qualified ────────────────────────────
 * A bare `status` evaluates to `null` and hides the action on EVERY record —
 * a button that silently never appears, with nothing red anywhere. Action
 * predicates are checked by `pnpm validate`; flow predicates are not
 * (objectstack#14089). Written correctly here because it is correct, not
 * because a gate is watching.
 *
 * ⚠️ `visible` is a UI hide, not authorization — the button is gone, the
 * route is not. Each handler re-checks the same condition server-side; see
 * `task.handlers.ts`.
 *
 * ── Why `type: 'script'` and not a declarative field write ────────────────
 * Because no declarative row-action field write exists. The BULK forms of
 * complete and skip ARE declarative — `bulkActionDefs` with
 * `operation: 'update'` and a static `patch`, in `src/views/task.view.ts` —
 * and this asymmetry is the platform gap filed upstream this round. The full
 * argument, including why `type: 'api'` with a hand-written data-API path is
 * not the declarative form, is in the `task.handlers.ts` header.
 */

/**
 * `duly_task_complete` — the tick.
 *
 * Sends `{ status: 'done' }` and nothing else. `completed_at` is stamped by
 * the lifecycle hook on the transition; sending it from here would fight the
 * readonly strip, whose outcome then depends on value equality.
 */
export const TaskCompleteAction = defineAction({
  name: TASK_COMPLETE_ACTION,
  objectName: TASK_OBJECT,
  label: 'Complete',
  description: 'Mark this task done. One click, no questions — and one click to undo.',
  icon: 'check',
  type: 'script',
  target: TASK_COMPLETE_ACTION,
  locations: ['list_item', 'record_header'],
  variant: 'primary',
  // Lowest order in the group, so the tick is the primary button in the
  // record header rather than whatever registered first.
  order: 10,
  visible: P`record.status == "open" || record.status == "in_progress"`,
  // The platform's own one-click reversal: the runtime snapshots the record's
  // prior field values and offers Undo on the success toast. It covers the
  // mistake noticed IMMEDIATELY; `duly_task_undo` below covers the one noticed
  // after the toast is gone. Both exist because the toast is transient and the
  // promise this action makes ("an accidental tick costs one click") is not.
  undoable: true,
  refreshAfter: true,
  successMessage: 'Done.',
});

/**
 * `duly_task_undo` — the reversal, on a just-completed row.
 *
 * This is the action that makes ticking cheap. It is not a nicety: without it
 * the correct design would be a confirm dialog on every completion, which is
 * the ceremony this product cannot afford.
 */
export const TaskUndoAction = defineAction({
  name: TASK_UNDO_ACTION,
  objectName: TASK_OBJECT,
  label: 'Undo',
  description: 'Reopen this task. The completion timestamp is cleared with it.',
  icon: 'undo-2',
  type: 'script',
  target: TASK_UNDO_ACTION,
  locations: ['list_item', 'record_header'],
  variant: 'secondary',
  order: 20,
  visible: P`record.status == "done"`,
  refreshAfter: true,
  successMessage: 'Reopened.',
});

/**
 * `duly_task_skip` — a legitimate outcome, recorded as one.
 *
 * The reason is collected by the param dialog, which is correct HERE and only
 * here: `skip_needs_reason` refuses the write without it, so the alternative
 * to the dialog is a button that always fails.
 *
 * The question rides on `description`, not `confirmText`: an action that
 * declares `confirmText` beside non-empty `params` shows two dialogs for one
 * decision, and the schema refuses the pair.
 */
export const TaskSkipAction = defineAction({
  name: TASK_SKIP_ACTION,
  objectName: TASK_OBJECT,
  label: 'Skip',
  description:
    'Skipping is a legitimate outcome — the plant was down, there was nothing to return. Recording why is what keeps skip from becoming a synonym for done.',
  icon: 'skip-forward',
  type: 'script',
  target: TASK_SKIP_ACTION,
  locations: ['list_item', 'record_more'],
  variant: 'secondary',
  order: 30,
  visible: P`record.status == "open" || record.status == "in_progress"`,
  params: [
    {
      name: 'skip_reason',
      // `field: 'skip_reason'` is deliberately NOT used in place of this pair:
      // the param must be required even though the FIELD is optional (a task
      // may be imported with no reason; one skipped by hand may not).
      label: 'Why skipped',
      type: 'text',
      required: true,
      placeholder: 'The plant was down — there was nothing to return',
      helpText: 'Stored on the task. Short is fine; blank is not.',
    },
  ],
  undoable: true,
  refreshAfter: true,
  successMessage: 'Skipped.',
});
