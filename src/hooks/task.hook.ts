// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Hook, HookContext } from '@objectstack/spec/data';

/**
 * `duly_task` lifecycle stamps — the two server-owned timestamps.
 *
 * Both `completed_at` and `last_update_at` are `readonly: true`, so a caller's
 * value is stripped at the API boundary and this hook is their ONE writer. A
 * value a `beforeUpdate` hook derives is not a caller write and survives that
 * strip.
 *
 * ── Why this hook must stay in the barrel ────────────────────────────────
 * Hooks are read from `defineStack({ hooks })` only. A `*.hook.ts` that is not
 * exported from `src/hooks/index.ts` type-checks, reads as wired, and never
 * runs. `duly_task` carries a `completed_at_required_when_done` validation rule
 * precisely so that an unregistered hook is a LOUD refusal — "a completed task
 * must carry a completion timestamp" — instead of a done task committing with
 * no timestamp. The rule is the assertion; this hook is what satisfies it.
 * `test/task-hook.test.ts` pins the registration for the same reason.
 *
 * ── Pipeline facts this hook is built on (measured, not assumed) ─────────
 * All three are asserted against a real booted engine in
 * `test/task-hook.test.ts` rather than taken on trust:
 *
 *   1. `ctx.previous` is the pre-image, bound BEFORE the `beforeUpdate` chain
 *      runs. It is what makes a TRANSITION detectable rather than a state.
 *   2. `beforeUpdate` runs ahead of the validation rules, so a write carrying
 *      only `{ status: 'done' }` has `completed_at` stamped by the time the
 *      completion rule is evaluated — that is why the bare write commits.
 *   3. The readonly strip runs AFTER this hook and drops only a key still
 *      holding exactly what the caller supplied, so a value derived here
 *      replaces a caller-supplied one instead of being dropped with it.
 *
 * ── Why the handler is one self-contained function ───────────────────────
 * `objectstack build` lowers an inline handler into a metadata `body`, and a
 * body ships without its module scope. A handler that referenced a
 * module-level constant or helper still BUILDS — it silently falls back to the
 * legacy bundled runtime module with a warning — so the pressure to keep this
 * self-contained is a build warning, not an error. Keep the field list and the
 * comparisons inside the function.
 */
const stampTaskLifecycle = (ctx: HookContext): void => {
  // `input.<field>` IS the record field on a declarative hook — reads resolve
  // against the payload, writes land in it. The envelope spelling
  // `input.data.<field>` is deliberately NOT used: it works only off the raw
  // `engine.registerHook` envelope and is a TypeError in the sandboxed body
  // form this handler is lowered into — which, with `onError: 'abort'`, would
  // refuse every task write rather than fail quietly.
  const input = ctx.input as Record<string, unknown>;
  const now = new Date().toISOString();

  if (ctx.event === 'beforeInsert') {
    // A brand-new task has just been touched, by definition.
    input.last_update_at = now;
    return;
  }

  const previous = ctx.previous as Record<string, unknown> | undefined;

  // No pre-image means no transition can be READ, and the dispatch that arrives
  // without one is the whole-operation context of an UNSCOPED predicate write —
  // precisely the bulk write this hook must never let reset the clock. Stamping
  // nothing is fail-safe in both directions: the stagnation signal is left
  // alone, and a bulk write that tried to set `status = 'done'` is refused
  // loudly by `completed_at_required_when_done` rather than committing a
  // completed task with no completion timestamp.
  if (!previous) return;

  // ── completed_at — stamped on the TRANSITION, not on the state ──────────
  // Reading the next status from the payload but falling back to the stored one
  // is what keeps a save that merely re-sends `status: 'done'` (every
  // whole-record form submit on an already-done task) from overwriting the
  // original completion instant.
  const nextStatus = 'status' in input ? input.status : previous.status;
  const wasDone = previous.status === 'done';
  const isDone = nextStatus === 'done';

  if (!wasDone && isDone) {
    input.completed_at = now;
  } else if (wasDone && !isDone) {
    // Reopened, skipped or cancelled — the completion is undone, so the
    // timestamp goes with it, or the record keeps a completion that no longer
    // happened.
    input.completed_at = null;
  }

  // ── last_update_at — only when a human moved the work ───────────────────
  //
  // This list is the whole stagnation signal. The "Not moving" view is
  // `status in (open, in_progress) AND last_update_at < {14_days_ago}`, so the
  // clock may only advance when a person actually moved the work. Stamping on
  // EVERY update would let one bulk re-owner, a business-unit backfill or an
  // import silently reset it across the whole table — with no error anywhere,
  // the numbers just quietly get better and the signal goes quiet exactly when
  // it matters.
  //
  // Administrative and system-owned columns are therefore deliberately absent:
  // `owner`, `business_unit`, `assignment`, `duty`, `due_date`, `visible_from`,
  // `period_key`, `source`, `subject`. Re-owning, re-parenting or re-dating a
  // task is not progress on it. Adding a field here widens the signal's blast
  // radius; do it only for something a person changes BECAUSE they worked the
  // task.
  //
  // Compared against the pre-image rather than merely tested for presence: a
  // re-save carrying an unchanged `status` is not progress.
  for (const field of ['status', 'note', 'skip_reason']) {
    if (!(field in input)) continue;
    const next = input[field];
    const prior = previous[field];
    const bothBlank =
      (next === null || next === undefined) && (prior === null || prior === undefined);
    if (!bothBlank && next !== prior) {
      input.last_update_at = now;
      return;
    }
  }
};

export const TaskLifecycleHook: Hook = {
  name: 'duly_task_lifecycle_stamps',
  label: 'Task lifecycle stamps',
  object: 'duly_task',
  events: ['beforeInsert', 'beforeUpdate'],
  description:
    'Server-owned timestamps on duly_task: completed_at on the transition into and out of '
    + 'done, and last_update_at only when status, note or skip_reason actually changed — '
    + 'never on an administrative or bulk write, which would reset the stagnation signal.',
  // Explicit because it is load-bearing rather than a default worth inheriting:
  // if this handler throws, the write MUST be refused. Committing a task whose
  // stamps were not applied is the exact silent corruption the
  // `completed_at_required_when_done` rule exists to make impossible.
  onError: 'abort',
  handler: stampTaskLifecycle,
};
