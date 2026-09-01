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
 * ── The shared-payload path, and why this hook REFUSES it ────────────────
 * A predicate (`multi: true`) write carries ONE payload for all N matched rows
 * — `driver.updateMany` takes a single SET clause — and ADR-0058 Addendum II
 * governs what a hook may do with it. D1: a `before*` event dispatches once per
 * matched row. D3: every per-row context carries THAT one payload, so "a
 * rewrite takes effect on the WHOLE batch, whichever row's dispatch made it",
 * and therefore "a rewrite CONDITIONED on the row (`ctx.previous`,
 * `ctx.input.id`) is outside this contract". D3 names the sanctioned route in
 * as many words: per-row `previous` is supplied "so a guard can REFUSE the
 * write, not so a rewrite can be aimed at one row".
 *
 * `completed_at` is precisely such a rewrite: it is read off THIS row's
 * pre-image. Measured against a booted engine — a batch of one `open` row and
 * one already-`done` row, both written `status: 'done'` — the open row's
 * dispatch stamps `completed_at = now` and the done row's completion instant,
 * days old, is silently overwritten. Nothing errors; the history just moves.
 *
 * So on this path the hook throws. The guard is decided from the ROW ALONE —
 * its own pre-image plus the payload — never from what an earlier dispatch left
 * in the shared payload, because dispatch order is not the caller's to control
 * and an accumulator would only catch the orders in which the done row happens
 * to come second.
 *
 * Three boundaries this guard deliberately holds:
 *
 *  - It turns on `status` being IN THE PAYLOAD. A predicate write that does not
 *    write `status` computes no stamp, so there is nothing to leak — an
 *    administrative bulk backfill over done rows, and the seed's `mode:
 *    'update'` backdating pass, are untouched.
 *  - Only the stamping direction is guarded. A batch moving rows OUT of done
 *    writes `completed_at = null`, and null is the correct value for every row
 *    being moved out of done, including one that was never completed. That
 *    rewrite is genuinely row-invariant, so it is allowed.
 *  - A batch in which EVERY row is already done is refused too, even though
 *    nothing would leak. The hook cannot see the batch — `dispatch.index` is a
 *    position, not a total — and a rule stated on the row is one a caller can
 *    predict and a test can pin. Re-completing a done task in bulk is a caller
 *    mistake either way, and the answer is now loud instead of silent.
 *
 * The single-record path (`dispatch.mode === 'record'`) has a payload of its
 * own, so the row-conditional stamp is sound there and is unchanged.
 *
 * ── The same path and `last_update_at`: write nothing, do not refuse ─────
 * The stagnation stamp is row-conditional too, in the other direction: it
 * fires when THIS row's `status`, `note` or `skip_reason` differs from THIS
 * row's pre-image. D3 applies unchanged — that value goes into the one shared
 * payload and is written to every matched row, so a single genuine edit inside
 * a 200-row bulk write refreshes all 200 clocks and the stalled list quietly
 * empties. Measured: two open tasks, a `multi: true` write setting the same
 * `note` both already needed, one of which already held it — the unchanged
 * row's clock moved 6ms anyway, stamped by the other row's dispatch.
 *
 * The response here is the opposite of the guard above, and the difference is
 * what is at stake. A wrong `completed_at` corrupts a historical fact, so that
 * write must be refused. A `last_update_at` that was not refreshed corrupts
 * nothing — the clock only moves forward — so refusing would cost a working
 * feature to protect a value that, on this path, nothing reads. The honest
 * answer is to write nothing.
 *
 * WHY nothing reads it, stated plainly because it is only safe while it stays
 * true: stagnation is defined over OPEN work. `duly_stagnation` filters
 * `status IN ('open','in_progress')` on every measure, and the "Not moving"
 * lens does the same. The two bulk actions this product ships — `complete`
 * (`status: 'done'`) and `skip` (`status: 'skipped'`) — move every row they
 * touch OUT of that set, so a row leaving a bulk write with a stale clock is
 * one no stagnation query will ever evaluate again. "Bulk completion would
 * look like stagnation" describes a state that cannot occur.
 *
 * That premise is a fact about `bulkActionDefs`, not about this hook, and it
 * is exactly what a bulk "set note" or a bulk reassign would break — silently,
 * because the symptom is a frozen clock rather than an error. So it is pinned
 * where it can go stale: `test/bulk-stagnation-premise.test.ts` reads the real
 * defs out of `src/views/task.view.ts` and the real status set out of
 * `duly_stagnation` and the `stalled` view, and fails if any bulk action's
 * patch leaves rows inside the stagnation set. If that test ever goes red, the
 * decision below is what has to change — not the test.
 *
 * The single-record path keeps the row-conditional stamp for this column too:
 * `mode: 'record'` has a payload of its own, so there is no batch to leak
 * onto.
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

  // ── The shared-payload guard — refuse, never aim a rewrite at one row ──
  // `ctx.dispatch` is the engine's own dispatch marker: `'record'` for a
  // single-record write, `'per-row'` for one dispatch of a predicate write.
  // Conditioned on `status` being in the payload because that is the only
  // shape that computes a stamp at all — see the module header.
  if (ctx.dispatch?.mode === 'per-row' && 'status' in input && wasDone && isDone) {
    throw Object.assign(
      new Error(
        `Task ${String(input.id ?? previous.id ?? '')} is already done. A bulk status write carries one `
        + 'payload for every matched row, so completing this batch would overwrite that task\'s original '
        + 'completion timestamp. Leave the done rows out of the selection, or write them one at a time.',
      ),
      { code: 'DULY_TASK_BULK_ALREADY_DONE', status: 409 },
    );
  }

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
  // ── …and nothing at all on the shared-payload path ─────────────────────
  // The loop below is row-conditional in the other direction from
  // `completed_at`: it fires on a difference against THIS row's pre-image. So
  // under D3 the value it writes lands in the one shared payload and is
  // applied to every matched row — one genuine note edit inside a 200-row
  // batch used to refresh all 200 clocks, measured.
  //
  // Unlike `completed_at` there is nothing here to corrupt — the clock only
  // moves forward and no historical fact is overwritten — so the sanctioned
  // refusal would cost a working feature to protect a value that, on this
  // path, nothing reads. Same detection as the guard above, opposite response:
  // write NOTHING rather than write one row's truth onto all of them. The
  // module header carries why that is safe; the premise it rests on is guarded
  // in `test/bulk-stagnation-premise.test.ts`.
  if (ctx.dispatch?.mode === 'per-row') return;

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
    + 'never on an administrative write, which would reset the stagnation signal. On a '
    + 'predicate (bulk) write both row-conditional stamps are handled by ADR-0058 '
    + 'Addendum II D3: one payload for the whole batch, so a re-stamp of an already-done '
    + 'row is refused outright and last_update_at is not stamped at all.',
  // Explicit because it is load-bearing rather than a default worth inheriting:
  // if this handler throws, the write MUST be refused. Committing a task whose
  // stamps were not applied is the exact silent corruption the
  // `completed_at_required_when_done` rule exists to make impossible.
  onError: 'abort',
  handler: stampTaskLifecycle,
};
