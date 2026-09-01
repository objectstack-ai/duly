// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ActionHandler, ActionHandlerContext } from '@objectstack/spec/ui';

import type { HandlerRegistrationContext } from './register-handlers.js';

/**
 * Runtime handlers for the three task-lifecycle row actions.
 *
 * ── Why these are hand-written and the BULK forms are not ─────────────────
 * The bulk forms of complete and skip are pure metadata: the list views
 * declare them as `bulkActionDefs` with `operation: 'update'` and a static
 * `patch`, which is the platform's DECLARATIVE "set these fields on every
 * selected record" — no handler, no code, and the write runs under the
 * caller's own permissions. See `src/views/task.view.ts`.
 *
 * There is no row-level equivalent. `ActionType` is
 * `url | form | flow | script | api | modal` — no `update_record`, no action
 * `effect`. The two near-misses and why neither is the declarative form:
 *
 *  - `type: 'api'` + `method: 'PATCH'` + `bodyExtra: { status: 'done' }` is a
 *    declarative HTTP CALL, not a declarative field write. The author
 *    hand-writes the platform's own data-API path into application metadata
 *    (`/api/v1/data/<object>/<id>` — `basePath` `/api` + version `v1` +
 *    `crud.dataPrefix` `/data`, measured in @objectstack/rest 17.2.0). Nothing
 *    binds that string to `objectName`, nothing checks it at author time, and
 *    it is wrong in the spec's own worked example, which omits the `/data`
 *    segment the shipped router requires. A metadata app pinning the
 *    platform's transport route is precisely the contract-first violation the
 *    repo forbids, and for AI-authored metadata it is the worst available
 *    shape: it parses green and 404s at the click.
 *  - `type: 'flow'` + a flow carrying an `update_record` node is declarative,
 *    but it is three flows to assign one string, on the one surface this repo
 *    already knows `pnpm validate` does not fully check (objectstack#14089).
 *
 * Filed upstream as the fourth platform gap of this round; named in the PR.
 *
 * ── The trap with no author-time gate ─────────────────────────────────────
 * An action whose handler is not registered RENDERS, IS CLICKABLE, and fails
 * at call time with `Action '<name>' on object 'duly_task' not found` (404
 * from the dispatcher). `pnpm validate` cannot see it. `test/task-actions.test.ts`
 * asserts the wiring against a real booted engine, because that assertion is
 * the only gate that exists.
 *
 * ── Why each handler re-checks what the button already gated ──────────────
 * `ctx.engine` is TRUSTED — system-elevated and RLS/FLS-bypassing by design
 * (`buildActionExecutionContext` stamps `isSystem: true` onto the caller's
 * context, and both dispatch surfaces log the write as such). An action's
 * `visible` predicate is a UI hide, not authorization: "the button is gone,
 * the route is not". So a handler that took `ctx.params.recordId` on trust
 * would let any caller who can reach the action route complete anybody's
 * task, on an object whose `sharingModel` is `private`.
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
 * This authorization re-check, not the one-line write, is the real cost of
 * having no declarative row-action field set — and it is the part of the
 * upstream report that matters.
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
 * The statuses a task can be completed or skipped FROM.
 *
 * `cancelled` is absent deliberately: a cancelled task is one the org stopped
 * asking for, and re-completing it would put it back into on-time rates that
 * had correctly forgotten it.
 */
export const ACTIONABLE_STATUSES: readonly string[] = ['open', 'in_progress'];

/** Undo applies to exactly one prior state. */
export const UNDOABLE_STATUSES: readonly string[] = ['done'];

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface TaskActionParams extends Record<string, unknown> {
  recordId?: unknown;
  skip_reason?: unknown;
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

// ── duly_task_complete ──────────────────────────────────────────────────────

/**
 * Tick the task. No modal, no confirmation, no note, no percentage.
 *
 * The ceremony budget for this interaction is one click, and undo is what buys
 * it: an accidental tick costs one click to reverse. A five-second tick that
 * becomes a five-minute chore is how the list stops being maintained, and
 * every metric downstream then reports on a dataset nobody keeps.
 */
export const completeTaskHandler: ActionHandler<TaskActionParams> = async (ctx) => {
  const subject = readSubject(ctx, TASK_COMPLETE_ACTION);
  requireStatusIn(subject, ACTIONABLE_STATUSES, TASK_COMPLETE_ACTION);

  await ctx.engine.update(TASK_OBJECT, subject.id, { ...COMPLETE_PATCH });

  const result: TaskActionResult = {
    action: TASK_COMPLETE_ACTION,
    task: subject.id,
    status: COMPLETE_PATCH.status,
    from: subject.status,
  };
  return result;
};

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

// ── duly_task_skip ──────────────────────────────────────────────────────────

/**
 * Record that the task legitimately did not happen — "the plant was down,
 * there was nothing to return".
 *
 * This is the ONE place a modal is correct, because `skip_needs_reason` will
 * reject the write without a reason. Forcing that answer to be recorded as
 * `done` or left `open` corrupts the data either way.
 *
 * The reason is NOT re-validated here beyond emptiness. The object's rule is
 * the authority and it runs on the write; a second, subtly different check in
 * this handler would be a rule that can drift from the one that actually
 * decides. What this does is refuse a BLANK reason early, with the same
 * outcome the rule would produce, so a programmatic caller that bypassed the
 * param dialog gets the same answer as the button.
 */
export const skipTaskHandler: ActionHandler<TaskActionParams> = async (ctx) => {
  const subject = readSubject(ctx, TASK_SKIP_ACTION);
  requireStatusIn(subject, ACTIONABLE_STATUSES, TASK_SKIP_ACTION);

  const reason = text(ctx.params?.skip_reason).trim();
  if (!reason) {
    throw refuse('Say why the task was skipped.', 'DULY_TASK_SKIP_NEEDS_REASON', 400);
  }

  await ctx.engine.update(TASK_OBJECT, subject.id, { ...SKIP_PATCH, skip_reason: reason });

  const result: TaskActionResult = {
    action: TASK_SKIP_ACTION,
    task: subject.id,
    status: SKIP_PATCH.status,
    from: subject.status,
  };
  return result;
};

// ── Wiring ──────────────────────────────────────────────────────────────────

/**
 * Register the three task handlers on the engine.
 *
 * Called from `registerDulyActionHandlers` in `register-handlers.ts`, which
 * `objectstack.config.ts` invokes from `onEnable`. All three register under
 * {@link TASK_OBJECT} — the actions declare `objectName: 'duly_task'`, and
 * `executeAction` is an exact-string map lookup on `<object>:<name>`, so a
 * handler filed under `global` would be unreachable from a task row.
 */
export function registerTaskActionHandlers(ql: HandlerRegistrationContext): void {
  ql.registerAction(TASK_OBJECT, TASK_COMPLETE_ACTION, completeTaskHandler);
  ql.registerAction(TASK_OBJECT, TASK_UNDO_ACTION, undoTaskHandler);
  ql.registerAction(TASK_OBJECT, TASK_SKIP_ACTION, skipTaskHandler);
}
