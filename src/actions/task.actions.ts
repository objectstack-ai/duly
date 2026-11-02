// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { P, defineAction } from '@objectstack/spec';

import {
  COMPLETE_PATCH,
  SKIP_PATCH,
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
 * route is not. What stands behind it differs by form; see below.
 *
 * ── Complete and skip are declarative; undo is not ────────────────────────
 * Complete and skip are `operation: 'update'` + a static `patch`: the
 * platform's declarative single-record field write (objectstack#14092; graded
 * `live` in `@objectstack/spec` 18.2.0 `liveness/action.json`, key `operation`).
 * The same words as the BULK forms in `src/views/task.view.ts`, and no
 * handler. `@objectstack/runtime` 18.2.0 `executeDeclarativeUpdateAction`
 * performs it on the platform action route, and three things follow from
 * that, each measured in `test/task-actions.test.ts`:
 *
 *  1. **Toast Undo.** `undoable: true` is fulfillable on this shape and on
 *     `type: 'api'` only. The console's `ActionRunner.executeUpdateOperation`
 *     posts the write, then builds the undo envelope from the row it ran on —
 *     the prior value of every field in `{ ...patch, ...params }` — and the
 *     success toast offers Undo. Undo is a data-plane update of those fields,
 *     as the caller; the hook clears `completed_at` on the way out of done.
 *  2. **The hook still holds the pen.** The write is a data-plane update
 *     executed AS THE CALLER, never system-elevated, so `task.hook.ts` and
 *     the validation rules fire exactly as for a user edit: `completed_at` /
 *     `completed_late` are stamped, `skip_needs_reason` decides a skip.
 *  3. **The capability gate is the same gate.** `requiredPermissions` is
 *     checked by `actionPermissionError` on the REST `/actions` door and the
 *     MCP door BEFORE the declarative branch, exactly as for a handler.
 *
 * What changed underneath, deliberately: the row gate. A handler's
 * `ctx.engine` is system-elevated, so the old handlers had to re-read the row
 * under the caller's scope and then write past it. A READ scope wider than
 * the write scope (a manager's `unit_and_below`) would therefore have let a
 * manager complete a report's task. The declarative write is checked against
 * the caller's WRITE scope (`own`), which is the "managers do not enter
 * status" invariant held by the platform instead of by a re-check. (Read off
 * the code, not measured: hierarchy scopes need the enterprise runtime, and
 * this open-edition checkout resolves both to owner-only — AGENTS.md rule 7.)
 *
 * Where the old status check went: the handlers' 409 on a wrong status
 * (completing a cancelled task, skipping a done one) guarded one door of
 * several — the same caller could send the same `{ status }` through the
 * data plane. It is now the `status_transitions` rule on `duly_task` (#162),
 * which the route, the data PATCH and MCP all write through: completing a
 * cancelled task answers 400 `VALIDATION_FAILED` / `invalid_transition` on
 * every door (`test/task-status-transitions.test.ts`).
 * The completion instant is still never re-stamped: a done → done write is
 * not a transition, and the hook stamps only transitions.
 *
 * `duly_task_undo` stays a `script` action with a handler. The toast Undo is
 * transient; the row action is the reversal that is still there tomorrow, and
 * on the record page. `task.handlers.ts` carries why it re-checks the row.
 */

/**
 * `duly_task_complete` — the tick.
 *
 * Writes `{ status: 'done' }` and nothing else. `completed_at` is stamped by
 * the lifecycle hook on the transition; sending it from here would fight the
 * readonly strip, whose outcome then depends on value equality.
 */
export const TaskCompleteAction = defineAction({
  name: TASK_COMPLETE_ACTION,
  objectName: TASK_OBJECT,
  label: 'Complete',
  description: 'Mark this task done. One click, no questions — and one click to undo.',
  icon: 'check',
  // The declarative field write. `type` stays at its default `script` (the
  // platform action route the write is performed on); `target` is refused
  // beside it, because there is no handler for one to name.
  operation: 'update',
  patch: { ...COMPLETE_PATCH },
  locations: ['list_item', 'record_header'],
  variant: 'primary',
  // Lowest order in the group, so the tick is the primary button in the
  // record header rather than whatever registered first.
  order: 10,
  visible: P`record.status == "open" || record.status == "in_progress"`,
  // [ADR-0066 D4] `visible` above is a UI hide and the caller-scoped write is
  // a ROW check ("is this row yours to write"). Neither answers the other
  // question — "is completing a task a thing you may do at all" — which is
  // what this declares: 403 on the platform action route and the MCP bridge.
  // A read-only auditor with unit-wide visibility must fail this one.
  // Granted by the `duly_member` set, and so by every set that inherits it.
  requiredPermissions: ['duly.task.update_status'],
  // The success toast's Undo. Fulfilled on this shape: the console snapshots
  // the prior `status` off the row before the write and offers it back.
  undoable: true,
  refreshAfter: true,
  successMessage: 'Done.',
});

/**
 * `duly_task_undo` — the reversal, on a completed row.
 *
 * This is the action that makes ticking cheap. It is not a nicety: without it
 * the correct design would be a confirm dialog on every completion, which is
 * the ceremony this product cannot afford. The toast Undo on complete is the
 * fast path and lasts as long as the toast; this row action is the one that
 * is still there after a reload, on the record page, and for a task ticked
 * yesterday.
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
  // [ADR-0066 D4] Same capability as complete: undo is the other half of the
  // same one-click promise, and splitting them would produce a deployment
  // where a tick cannot be taken back.
  requiredPermissions: ['duly.task.update_status'],
  refreshAfter: true,
  successMessage: 'Reopened.',
});

/**
 * `duly_task_skip` — a legitimate outcome, recorded as one.
 *
 * The reason is collected by the param dialog, which is correct HERE and only
 * here: `skip_needs_reason` refuses the write without it, so the alternative
 * to the dialog is a button that always fails. `required: true` on the param
 * is enforced server-side too (`enforceActionParams`, ahead of the write), and
 * the object rule is the authority behind both.
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
  // Declarative, like complete. The static half is the status; the reason is
  // the param below, and `patch` merges UNDER the collected params, so the
  // write is `{ status: 'skipped', skip_reason }`.
  operation: 'update',
  patch: { ...SKIP_PATCH },
  locations: ['list_item', 'record_more'],
  variant: 'secondary',
  order: 30,
  visible: P`record.status == "open" || record.status == "in_progress"`,
  // [ADR-0066 D4] Skipping is a status entry like the other two, so it takes
  // the same capability.
  requiredPermissions: ['duly.task.update_status'],
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
  // The toast Undo restores the prior value of BOTH fields written — the
  // status and the (blank) reason — so an accidental skip leaves no stray
  // reason behind on a task that is open again.
  undoable: true,
  refreshAfter: true,
  successMessage: 'Skipped.',
});
