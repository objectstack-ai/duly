// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ActionHandler, ActionHandlerContext } from '@objectstack/spec/ui';

import type { HandlerRegistrationContext } from './register-handlers.js';

/**
 * The task-lifecycle row actions' shared vocabulary, and the ONE handler left.
 *
 * ── Two of the three actions have no handler, and that is the point ───────
 * `duly_task_complete` and `duly_task_skip` are declarative: `operation:
 * 'update'` + a static `patch` (objectstack#14092), performed by the platform
 * on its own action route, as the caller. This file still owns their payloads
 * ({@link COMPLETE_PATCH}, {@link SKIP_PATCH}) so the row actions, the bulk
 * `patch`es in `src/views/task.view.ts` and the tests are one declaration. The
 * header of `task.actions.ts` carries what the declarative form guarantees and
 * what it changed.
 *
 * This header used to say no row-level declarative field write existed, and
 * argue from that. It was true through 17.x; it stopped being true when
 * objectstack#14092 closed and the runtime half landed. ⛔ Do not reintroduce a
 * handler for complete or skip: an action with `operation: 'update'` is routed
 * by `operation` BEFORE any handler lookup (`@objectstack/runtime` 18.2.0
 * `handleActionsRequest` / `invokeBusinessAction`), so a handler registered
 * beside it is dead code that type-checks and never runs.
 *
 * ── Why undo is still a handler ───────────────────────────────────────────
 * It could be declarative too (`patch: { status: 'in_progress' }`). It is left
 * as it was because #146 moved the two actions whose toast Undo was missing,
 * and the reversal is the one action whose behaviour nobody asked to change.
 * Moving it is a one-line follow-up with the same tests.
 *
 * ── The trap with no author-time gate ─────────────────────────────────────
 * A HANDLER-backed action whose handler is not registered RENDERS, IS
 * CLICKABLE, and fails at call time with `Action '<name>' on object
 * 'duly_task' not found` (404 from the dispatcher). `pnpm validate` cannot see
 * it. `test/task-actions.test.ts` asserts the wiring against a real booted
 * engine, because that assertion is the only gate that exists.
 *
 * ── Why the handler re-checks what the button already gated ──────────────
 * `ctx.engine` is TRUSTED — system-elevated and RLS/FLS-bypassing by design
 * (`buildActionExecutionContext` stamps `isSystem: true` onto the caller's
 * context, and both dispatch surfaces log the write as such). An action's
 * `visible` predicate is a UI hide, not authorization: "the button is gone,
 * the route is not". So a handler that took `ctx.params.recordId` on trust
 * would let any caller who can reach the action route reopen anybody's task,
 * on an object whose `sharingModel` is `private`.
 *
 * The subject is therefore read from {@link readSubject}, which refuses
 * unless `ctx.record` came back carrying a real field. That is sound because
 * of a measured dispatcher detail: the record is loaded under the CALLER's
 * execution context, a failed load is swallowed to `{}`, and only then is
 * `record.id = recordId` stamped on unconditionally. So `ctx.record.id` is
 * present even when the caller cannot read the row — `ctx.record.status`
 * (declared `required: true`, so every stored row has one) is what actually
 * distinguishes "loaded" from "refused or missing".
 *
 * That re-check is a READ check, and it is the cost of a handler: the
 * declarative actions get the caller's WRITE scope from the platform instead.
 */

/** The object these actions are registered and dispatched under. */
export const TASK_OBJECT = 'duly_task';

/** Action names. Exported so the metadata, the wiring and the tests agree by construction. */
export const TASK_COMPLETE_ACTION = 'duly_task_complete';
export const TASK_UNDO_ACTION = 'duly_task_undo';
export const TASK_SKIP_ACTION = 'duly_task_skip';

/**
 * The complete payload of a completion. ONE field.
 *
 * `completed_at` and `last_update_at` are stamped by `src/hooks/task.hook.ts`
 * on the transition, and both are `readonly: true` so a caller's value is
 * stripped at the API boundary. Sending either from here does not merely
 * duplicate the hook — the strip drops a key still holding exactly what the
 * caller supplied, so the outcome would depend on whether the hook's value
 * happened to equal ours. Exported so the row action, the bulk `patch` and
 * the tests are one declaration rather than three that agree today.
 */
export const COMPLETE_PATCH = { status: 'done' } as const;

/** Undo returns the task to the board, not to untouched. The hook clears `completed_at`. */
export const UNDO_PATCH = { status: 'in_progress' } as const;

/** Skip's fixed half. `skip_reason` is the caller's and is required — see the action metadata. */
export const SKIP_PATCH = { status: 'skipped' } as const;

/**
 * The statuses a task can be completed or skipped FROM — the vocabulary of the
 * two actions' `visible` predicates, pinned against them by the tests.
 *
 * `cancelled` is absent deliberately: a cancelled task is one the org stopped
 * asking for, and re-completing it would put it back into on-time rates that
 * had correctly forgotten it.
 *
 * This list is what the buttons OFFER. What the server ENFORCES is the
 * `status_transitions` rule on `duly_task` (#162): only these two states may
 * move to `done` or `skipped`, on the action route, the data PATCH and MCP
 * alike. `test/task-status-transitions.test.ts` pins the two together, so a
 * status added here and not to the rule (or the reverse) goes red.
 */
export const ACTIONABLE_STATUSES: readonly string[] = ['open', 'in_progress'];

/** Undo applies to exactly one prior state. */
export const UNDOABLE_STATUSES: readonly string[] = ['done'];

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface TaskActionParams extends Record<string, unknown> {
  recordId?: unknown;
}

export interface TaskActionResult {
  action: string;
  task: string;
  /** The status this write set. */
  status: string;
  /** The status the record held before it. Makes a run legible in the audit log. */
  from: string;
}

/** The subject of a row action: its id, and the status the caller was actually allowed to read. */
interface TaskSubject {
  id: string;
  status: string;
}

// ── Refusals ────────────────────────────────────────────────────────────────
//
// Thrown with `code` and `status` (ADR-0112 envelope) rather than as bare
// `Error`s. The dispatcher reads `err.status` / `err.code` and maps them onto
// the response, so a refusal reaches the caller as its own answer instead of a
// 500. A bare `throw new Error(...)` would also make the rejection tests
// untrustworthy: `expect(...).toThrow()` alone passes for any throw, including
// the wrong one.

function refuse(message: string, code: string, status: number): Error {
  return Object.assign(new Error(message), { code, status });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolve the record this action is acting on, or refuse.
 *
 * Both refusals are fail-closed and deliberately indistinguishable to the
 * caller: "you may not read it" and "it is not there" are the same answer on a
 * `private` object, and telling them apart would confirm the existence of rows
 * the caller cannot see.
 */
function readSubject(ctx: ActionHandlerContext<TaskActionParams>, action: string): TaskSubject {
  const record = (ctx.record ?? {}) as Record<string, unknown>;
  const id = text(ctx.params?.recordId) || text(record.id);
  if (!id) {
    throw refuse(
      `${action} acts on one task and was dispatched without one. Invoke it from a task row, or pass a recordId.`,
      'DULY_TASK_NO_SUBJECT',
      400,
    );
  }

  // `status` is `required: true` on duly_task, so every stored row carries
  // one. Its absence means the subject read returned nothing under the
  // caller's own scope — see the module header.
  const status = text(record.status);
  if (!status) {
    throw refuse(
      `Task ${id} is not available to you.`,
      'DULY_TASK_NOT_AVAILABLE',
      404,
    );
  }

  return { id, status };
}

function requireStatusIn(
  subject: TaskSubject,
  allowed: readonly string[],
  action: string,
): void {
  if (allowed.includes(subject.status)) return;
  throw refuse(
    `${action} applies to a task that is ${allowed.join(' or ')}; this one is ${subject.status}.`,
    'DULY_TASK_WRONG_STATUS',
    409,
  );
}

// ── duly_task_undo ──────────────────────────────────────────────────────────

/**
 * Reverse a completion.
 *
 * Returns the task to `in_progress` rather than to whatever it was: the work
 * was demonstrably touched, and sending it back to `open` would erase that.
 * The hook clears `completed_at` on the transition out of `done`.
 */
export const undoTaskHandler: ActionHandler<TaskActionParams> = async (ctx) => {
  const subject = readSubject(ctx, TASK_UNDO_ACTION);
  requireStatusIn(subject, UNDOABLE_STATUSES, TASK_UNDO_ACTION);

  await ctx.engine.update(TASK_OBJECT, subject.id, { ...UNDO_PATCH });

  const result: TaskActionResult = {
    action: TASK_UNDO_ACTION,
    task: subject.id,
    status: UNDO_PATCH.status,
    from: subject.status,
  };
  return result;
};

// ── Wiring ──────────────────────────────────────────────────────────────────

/**
 * Register the task handler on the engine — undo, the one with a handler.
 *
 * Called from `registerDulyActionHandlers` in `register-handlers.ts`, which
 * `objectstack.config.ts` invokes from `onEnable`. It registers under
 * {@link TASK_OBJECT} — the action declares `objectName: 'duly_task'`, and
 * `executeAction` is an exact-string map lookup on `<object>:<name>`, so a
 * handler filed under `global` would be unreachable from a task row.
 */
export function registerTaskActionHandlers(ql: HandlerRegistrationContext): void {
  ql.registerAction(TASK_OBJECT, TASK_UNDO_ACTION, undoTaskHandler);
}
