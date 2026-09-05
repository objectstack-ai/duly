// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Hook, HookContext } from '@objectstack/spec/data';

/**
 * `duly_task` lifecycle stamps — the server-owned columns.
 *
 * `completed_at`, `last_update_at`, `late_after` and `completed_late` are all
 * `readonly: true`, so a caller's value is stripped at the API boundary and
 * this hook is their ONE writer. A value a `before*` hook derives is not a
 * caller write and survives that strip.
 *
 * ── The two lateness stamps, and why they are stored at all ──────────────
 * "Late" is `due_date + duty.grace_days` against a moment, and no filter or
 * dataset grammar can say it: no date arithmetic, no column-to-column
 * comparison on the SQL path, and here the offset is itself a column on a
 * joined object (objectstack#14104). Both halves become knowable at a definite
 * instant, so each is resolved at that instant and stored:
 *
 *   `late_after`     = `due_date + grace_days`   · at DISPATCH, by the planner
 *   `completed_late` = `completed_at > late_after` · at COMPLETION, here
 *
 * Neither is a MAINTAINED flag — the shape `AGENTS.md` rule 5 forbids, which
 * needs a writer running every midnight and lies on the day it does not run.
 * Each is written once, at the moment it becomes true, and is never recomputed:
 * the same category as `completed_at` beside them. The boundary is written out
 * under rule 5 itself.
 *
 * **Write-once is the whole design.** Change a duty's `grace_days` and tasks
 * already completed keep their verdict, and already-dispatched open tasks keep
 * the `late_after` they were born with. A compliance record that rewrites
 * itself when configuration changes is worth nothing in front of an auditor.
 * If a replay is ever wanted, `duly_catalog_sync` is where it belongs — it
 * already exists to push duty edits onto instantiated records — and it
 * deliberately does not do this today.
 *
 * Two consequences of THIS hook holding the pen, both deliberate:
 *
 *  - `late_after` is never touched on an update except to fill a blank. There
 *    is no leg that recomputes it, so no duty edit and no re-date can move it.
 *  - The verdict compares CIVIL DAYS in UTC, not instants in the duty's zone.
 *    Grace is granted in whole days, and the overdue escalation already judges
 *    lateness on `daysBetween(due_date, today())` — the same UTC day boundary.
 *    Agreeing with it is the point of this card: one system, one answer. A
 *    per-zone boundary would need the duty read this handler deliberately does
 *    not do (see "one self-contained function" below), and it would put the two
 *    surfaces back into disagreement by up to a day.
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
 *    rewrite is genuinely row-invariant, so it is allowed — and it is written
 *    for EVERY matched row, not only the rows whose pre-image was done. That
 *    detail is load-bearing rather than tidy: keying it on the pre-image makes
 *    the hook emit a different key set per row, which 17.3.0 refuses outright
 *    with `MultiUpdateHookKeyDivergenceError`. The branch is therefore gated on
 *    the PAYLOAD's status, the one value every matched row shares.
 *  - A batch in which EVERY row is already done is refused too, even though
 *    nothing would leak. The hook cannot see the batch — `dispatch.index` is a
 *    position, not a total — and a rule stated on the row is one a caller can
 *    predict and a test can pin. Re-completing a done task in bulk is a caller
 *    mistake either way, and the answer is now loud instead of silent.
 *
 * The single-record path (`dispatch.mode === 'record'`) has a payload of its
 * own, so the row-conditional stamp is sound there and is unchanged.
 *
 * ── `completed_late` on that path: refuse the LATE direction only ────────
 * The verdict is read off THIS row's `late_after`, so it is the same
 * out-of-contract rewrite `completed_at` is — worse, in fact, because two rows
 * in one batch can legitimately disagree: tick five tasks together and one of
 * them is past its grace, and whichever dispatch runs last decides the
 * compliance record for all five.
 *
 * Refusing every bulk completion would answer that, and it would delete a
 * feature this product is built around — a week of ticks in one gesture is the
 * difference between a Monday habit and a chore. Writing NOTHING, the answer
 * `last_update_at` gets below, is not available either: that one is safe only
 * because nothing reads it on this path, and here the on-time rate reads
 * exactly these rows. A silent null verdict on the most common completion
 * gesture in the product is the defect this card exists to remove.
 *
 * So the guard is asymmetric, and the asymmetry is what makes the write sound:
 *
 *  - A row that would be stamped LATE refuses the write
 *    (`DULY_TASK_BULK_LATE_COMPLETION`, 409), naming the task and the day its
 *    grace ran out.
 *  - Every row that survives its own guard computes `false`, so the value that
 *    reaches the shared payload is the one every matched row would have
 *    written. It is row-INVARIANT by construction, not by luck.
 *
 * A batch is therefore either wholly on time and stamped correctly, or refused
 * — decided from each row alone, in any dispatch order, with no accumulator.
 * Bulk SKIP is untouched (`skipped` is not a completion), and so is the
 * clearing direction: `completed_late = null` alongside `completed_at = null`
 * is correct for every row leaving `done`.
 *
 * ── What this costs the console: nothing. Measured, not assumed ──────────
 * The obvious fear is that ticking a week of work in one gesture now fails
 * whenever one row is late. It does not, because the console's bulk action is
 * NOT a predicate write. Measured against a live `pnpm demo` on
 * `@objectstack/rest` 17.2.0 by recording the requests the toolbar issues:
 *
 *     POST /api/v1/data/duly_task/updateMany
 *     { "records": [ { "id": …, "data": { "status": "done" } },
 *                    { "id": …, "data": { "status": "done" } } ], … }
 *
 * One payload PER RECORD, so each row is dispatched with its own — and a
 * two-row selection of one late and one on-time task was completed in a single
 * gesture with `completed_late: true` and `false` landing correctly on the two
 * rows. The row-conditional stamp is sound there for the same reason it is
 * sound on `mode: 'record'`.
 *
 * The shared payload this guard is about is the OTHER shape — `multi: true`
 * with a `where`, which is what an import, a backfill, an MCP caller or a
 * filtered REST update assembles. That is precisely where no view predicate can
 * reach and why the authority has to live at the write.
 *
 * Not extended to the view's `visible` predicate the way the already-done
 * guard is. That predicate is a client-side hide, and this condition depends on
 * the completion instant against a stored date — a boundary that moves at
 * midnight, between the render and the write. A predicate that evaluated it
 * differently from the server would hide a working action instead of
 * preventing a refused one, and a silently missing bulk action is worse than an
 * error that names its cause.
 *
 * ── The same path and `last_update_at`: write nothing, do not refuse ─────
 * The stagnation stamp is row-conditional too, in the other direction: it
 * fires when THIS row's `status`, `progress`, `note` or `skip_reason` differs from THIS
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

  // The CIVIL DAY an instant falls on. `late_after` is a calendar date and
  // `completed_at` is an instant, so the verdict has to be day-against-day:
  // grace is granted in whole days, and a task completed at 14:00 on the last
  // day of its grace is inside it. Both spellings are ISO, so a lexical `>` is
  // chronological. Accepts a `Date` because a caller's payload may carry one.
  const dayOf = (value: unknown): string => {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return typeof value === 'string' ? value.slice(0, 10) : '';
  };

  // The verdict. `false` when there is no deadline to miss — see the header:
  // a definite "not late" rather than a missing answer, so `done` always
  // splits into on-time + late.
  const completedLate = (completedAt: unknown, lateAfter: unknown): boolean => {
    const completedDay = dayOf(completedAt);
    const deadline = dayOf(lateAfter);
    if (completedDay === '' || deadline === '') return false;
    return completedDay > deadline;
  };

  if (ctx.event === 'beforeInsert') {
    // A brand-new task has just been touched, by definition.
    input.last_update_at = now;

    // ── late_after — the zero-grace fallback, for the paths with no duty ──
    // The dispatcher stamps this itself, with the duty's own grace
    // (`dispatch.plan.ts`). Every other producer has no duty to read: the
    // assignment fan-out creates tasks with `duty` unset, and a member
    // hand-creating their own task has none either. Zero grace is what "no
    // duty governs this row" already means to the overdue escalation, so the
    // two surfaces agree rather than one of them silently never firing.
    //
    // ⚠ The one row this is WRONG for is a task created by hand ON A DUTY
    // that grants grace — today, any `one_off` duty (#61 keeps `grace_days`
    // on that form deliberately). The escalation reads the duty and waits;
    // this fallback does not and stamps the due date. Filed as #100 with the
    // options, because the fix is a producer this handler cannot be: a
    // lowered `body` ships without its module scope and has no engine to read
    // `duly_duty` with. It is not a regression — before the stamps existed the
    // `late` view was grace-free for every task alike.
    //
    // A task with no `due_date` keeps a blank stamp: there is no deadline to
    // derive, and a task with no due date genuinely cannot be late.
    const dueDay = dayOf(input.due_date);
    if (dueDay !== '' && dayOf(input.late_after) === '') input.late_after = dueDay;

    // A row inserted ALREADY done — a seeded history, an import — carries its
    // verdict from the same beat, because both halves are on the payload. The
    // dispatch contract has no predicate INSERT (it covers update and delete
    // only), so this is a payload of one row and there is no batch to leak on.
    if (input.status === 'done') {
      input.completed_late = completedLate(input.completed_at, input.late_after);
    }
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

  // ── late_after — FILLED once if it is blank, never rewritten ───────────
  // Write-once is the design (see the header), so this leg only ever turns a
  // blank into a value: a task that acquires a due date after it was created
  // would otherwise be one that can never be late anywhere. A row that already
  // carries a stamp keeps it, whatever happens to its due date afterwards.
  //
  // Not on the shared-payload path. The CONDITION here is row-conditional —
  // "this row has no stamp" — so on a batch the fill computed for a blank row
  // would land on every matched row and overwrite a stamp another row was born
  // with. Nothing is written instead: an unstamped row stays unstamped, which
  // is where it already was, rather than a stamped row being corrupted. An
  // administrative bulk re-date is left alone, as it is for `last_update_at`.
  if (ctx.dispatch?.mode !== 'per-row' && dayOf(previous.late_after) === '') {
    const dueDay = dayOf('due_date' in input ? input.due_date : previous.due_date);
    if (dueDay !== '') input.late_after = dueDay;
  }

  const lateAfter = 'late_after' in input ? input.late_after : previous.late_after;

  if (!wasDone && isDone) {
    // ── The on-time verdict, and the second shared-payload guard ─────────
    // The verdict is read off THIS row's own stamp, so it is exactly the
    // rewrite D3 puts outside the contract: one row's answer would be written
    // to every matched row. The sanctioned route is to REFUSE — and refusing
    // only the LATE direction is what keeps bulk complete working: every row
    // that survives its own guard computes `false`, so the value that reaches
    // the shared payload is the same one every row in the batch would have
    // written. A batch is either all on time, or it is refused.
    const late = completedLate(now, lateAfter);
    if (ctx.dispatch?.mode === 'per-row' && late) {
      throw Object.assign(
        new Error(
          `Task ${String(input.id ?? previous.id ?? '')} is being completed after ${String(lateAfter ?? '')}, `
          + 'the day its grace ran out. A bulk status write carries one payload for every matched row, so '
          + 'this task\'s on-time verdict would be recorded against the whole batch. Complete a late task '
          + 'on its own row.',
        ),
        { code: 'DULY_TASK_BULK_LATE_COMPLETION', status: 409 },
      );
    }
    input.completed_at = now;
    input.completed_late = late;
  } else if ('status' in input && !isDone) {
    // Reopened, skipped or cancelled — the completion is undone, so the
    // timestamp goes with it, or the record keeps a completion that no longer
    // happened. The verdict goes with it for the same reason: a completion
    // that did not happen has nothing to be late about. Both values are
    // row-invariant — `null` is correct for every row being moved out of done,
    // including one that was never completed — so this direction stays
    // allowed on the shared-payload path.
    //
    // ── Why the test is on the PAYLOAD's status, not on `wasDone` ─────────
    // The obvious spelling of this branch is `wasDone && !isDone`, and it is
    // the one that breaks. `wasDone` reads THIS row's pre-image, so on a
    // predicate write reopening a mixed batch the nulls are written for the
    // rows that were done and not for the rows that were not — the hook
    // produces a DIFFERENT KEY SET per row, which is precisely what a shared
    // payload cannot express. The platform refuses the whole update:
    //
    //   MultiUpdateHookKeyDivergenceError: Refusing a multi-record update on
    //   'duly_task': its 'beforeUpdate' handlers wrote 'completed_at',
    //   'completed_late' for some of the 2 matched records and not for others
    //
    // Measured on `@objectstack/objectql` 17.3.0, which added that guard;
    // on 17.2.0 the same divergence went through unremarked. Writing the
    // nulls for EVERY matched row fixes it at the cause rather than working
    // around the guard: the row that was never done already holds null, so
    // the write is a no-op on it, and the key set stops depending on the row.
    //
    // `'status' in input` is what makes that true. `isDone` falls back to the
    // stored status when the payload carries none, so testing `!isDone` alone
    // would re-open the same divergence one shape over — an administrative
    // bulk write with no `status` (a re-owner, a business-unit backfill) would
    // write the nulls on the not-done rows and skip the done ones. Gated on
    // the payload, `isDone` is read off the ONE shared payload and is therefore
    // identical for every matched row, which is the property the guard wants.
    // A write that does not carry `status` is not a completion transition and
    // still touches neither column, exactly as before.
    input.completed_at = null;
    input.completed_late = null;
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
  // `progress` (#108) is on the list for exactly that reason, and it is the
  // clearest case of it: the column exists so that reporting progress is ONE
  // TAP instead of a typed sentence, and the phrase a person picks is a person
  // saying "I am on this". Leaving it off would have made the product's own
  // headline gesture the one interaction that does not count as movement — a
  // task nudged every week would keep drifting into "Not moving", which is the
  // list a manager is supposed to trust. It is the same category as `note`
  // beside it (a human sentence about the work) and NOT the category of
  // `owner` or `due_date` (somebody administering the row).
  //
  // ⛔ `attachments` is deliberately NOT here, and the asymmetry is the point.
  // A file arriving is real, but the column is optional by product invariant
  // and nothing may make it feel otherwise; an upload that silently reset the
  // stagnation clock would turn "attach something" into the cheapest way to
  // look busy, which is one step from the evidence gate the invariant forbids.
  // A person who attaches a file and means it has a phrase to pick beside it.
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

  for (const field of ['status', 'progress', 'note', 'skip_reason']) {
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
    'Server-owned columns on duly_task: completed_at and the completed_late verdict on the '
    + 'transition into and out of done, late_after filled at insert for the paths the '
    + 'dispatcher does not stamp, and last_update_at only when status, progress, note or '
    + 'skip_reason '
    + 'actually changed — never on an administrative write, which would reset the stagnation '
    + 'signal. Both lateness stamps are write-once: a later change to the duty\'s grace never '
    + 'moves them. On a predicate (bulk) write the row-conditional stamps are handled by '
    + 'ADR-0058 Addendum II D3: one payload for the whole batch, so a re-stamp of an '
    + 'already-done row and a completion that would be stamped late are both refused, and '
    + 'last_update_at is not stamped at all.',
  // Explicit because it is load-bearing rather than a default worth inheriting:
  // if this handler throws, the write MUST be refused. Committing a task whose
  // stamps were not applied is the exact silent corruption the
  // `completed_at_required_when_done` rule exists to make impossible.
  onError: 'abort',
  handler: stampTaskLifecycle,
};
