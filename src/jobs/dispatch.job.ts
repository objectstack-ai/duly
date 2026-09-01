// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineJob } from '@objectstack/spec';

import {
  DISPATCH_DUTY_FIELDS,
  DISPATCHABLE_FORM,
  DISPATCHABLE_STATUS,
  FAULT_SKIP_REASONS,
  nextDispatchedPeriod,
  planDispatch,
  type BackfillWindow,
  type DispatchDuty,
  type DutySkip,
  type TaskDraft,
} from './dispatch.plan.js';

/**
 * `duly_dispatch` — the spine. Active recurring duties become tasks, once per
 * period, forever, without a lock.
 *
 * This file is the SMALL half. Every decision the dispatcher makes lives in
 * `dispatch.plan.ts` as a pure function; what is left here is the schedule
 * declaration and the code that talks to the engine. That boundary is the point
 * — the imperative surface of the spine is about forty lines, and they are all
 * on this page.
 *
 * ── What is declarative, and what could not be ───────────────────────────
 * Declarative: the schedule, the timezone, the retry policy, the timeout, the
 * duty selection filter, and the identity constraint that makes the whole thing
 * idempotent (`duly_task_dispatch_identity`, declared on the object). Imperative:
 * the period arithmetic — calendar maths in a per-row IANA zone, which no
 * filter language expresses — and the insert loop.
 *
 * The insert loop is imperative for a reason worth writing down, because the
 * declarative alternative exists and was measured. A scheduled FLOW could do
 * this shape (`get_record` → `script` → `loop` → `create_record`), and its
 * error handling — a `try_catch` region or a `fault` edge — would swallow the
 * duplicate insert. But it swallows every OTHER failure identically: the
 * `create_record` executor collapses the engine's error to a string
 * (`create_record(duly_task) failed: <message>`) with no code, so a missing
 * required field, a permission refusal and a store outage all arrive as the
 * same anonymous failure the catch region cannot tell from a duplicate. For the
 * one job the product cannot afford to fail quietly, "the run succeeded and
 * created nothing" is the wrong failure to make easy. Two further measured
 * facts settled it: the schedule trigger hands a flow
 * `{ event, params: { jobId, flowName, schedule } }` and no input channel, so
 * backfill's `{ from, to }` cannot reach a scheduled flow at all, while
 * `IJobService.trigger(name, data)` forwards `data` to a job handler; and
 * `ScheduleTrigger` calls `jobService.schedule(name, schedule, handler)` with no
 * options, so a scheduled flow gets neither `retryPolicy` nor `timeout`.
 *
 * ── The one thing the platform could not give this job: data reach ───────
 * Measured against @objectstack/runtime 17.2.0 and @objectstack/service-job
 * 17.2.0, a declarative job handler is invoked with exactly
 * `{ jobId: string, data: unknown, bundle: object }`. There is no engine, no
 * service registry and no logger on it, and `bundle` is the metadata bundle.
 * So the one metadata shape the platform offers for scheduled work cannot, by
 * itself, read or write a record.
 *
 * That is filed as a platform defect, not worked around silently. What this
 * file does instead is make the seam explicit and singular: {@link runDispatch}
 * takes its engine as an ARGUMENT — no module-scope client reached for at a
 * distance, no `ctx.ql ?? ctx.engine ?? …` chain probing for a key the contract
 * does not declare — and {@link bindDispatchEngine} is the one place a host
 * supplies it. Until a host calls it, {@link dulyDispatch} REFUSES loudly with
 * a message naming the wiring. A dispatcher that silently does nothing is the
 * single worst failure this product can have; a job run that fails with "the
 * dispatcher has no engine" is a bad night, not a silent quarter.
 */

/** The job's metadata name. Exported so the metadata and the tests agree. */
export const DISPATCH_JOB_NAME = 'duly_dispatch';

/**
 * The `defineStack({ functions })` key the job's `handler` resolves against.
 *
 * `AppPlugin` looks the handler up as `collectBundleFunctions(bundle)[job.handler]`
 * and, on a miss, logs `job handler not found in bundle.functions — skipping`
 * and moves on. The job then reads as wired everywhere: registered in the
 * metadata registry, listed in the admin UI, and never once executed. There is
 * no author-time gate for it, which is why the name is a constant and
 * `test/dispatch.test.ts` performs the same lookup the runtime performs.
 */
export const DISPATCH_HANDLER_NAME = 'dulyDispatch';

/**
 * Duties read per round trip.
 *
 * The sweep pages rather than taking one large `limit`: an unbounded read is
 * the thing that works on every test fixture and falls over on the first real
 * tenant, and it fails by silently dispatching a PREFIX of the duties — the
 * people whose ids sort late simply stop getting tasks, with no error anywhere.
 */
export const DISPATCH_PAGE_SIZE = 200;

// ─────────────────────────────────────────────────────────────────────────
// The engine seam
// ─────────────────────────────────────────────────────────────────────────

/**
 * The slice of `IDataEngine` the dispatcher uses — structural, so the real
 * engine satisfies it without an import and a test fake satisfies it without a
 * kernel.
 */
export interface DispatchEngine {
  find(objectName: string, query?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown[]>;
  insert(objectName: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(objectName: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

let boundEngine: DispatchEngine | null = null;

/**
 * Give the dispatch job its data engine.
 *
 * A host calls this once, from `defineStack({ onEnable })`, which is the only
 * place in an ObjectStack application that is handed `ctx.ql`. It exists
 * because the job handler context does not carry an engine (see the file
 * header); when the platform grows one, this function and its caller are what
 * gets deleted, and nothing else in the dispatcher changes.
 */
export function bindDispatchEngine(engine: DispatchEngine): void {
  boundEngine = engine;
}

/** Drop the binding. For tests, so one suite cannot leak an engine into the next. */
export function unbindDispatchEngine(): void {
  boundEngine = null;
}

function requireDispatchEngine(): DispatchEngine {
  if (boundEngine === null) {
    throw new Error(
      `Job '${DISPATCH_JOB_NAME}' has no data engine. The platform invokes a job handler with ` +
        `{ jobId, data, bundle } and no engine handle, so the host must call ` +
        `bindDispatchEngine(ctx.ql) from defineStack({ onEnable }). No tasks were dispatched.`,
    );
  }
  return boundEngine;
}

// ─────────────────────────────────────────────────────────────────────────
// Backfill input
// ─────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read the optional `{ from?, to? }` job input into a backfill window.
 *
 * `IJobService.trigger(name, data)` forwards `data` to the handler unchanged,
 * so this is the operator's channel — and the only one that is not a schedule.
 *
 * Three readings, all decided rather than inferred:
 *
 *  - **Neither** → `null`, the scheduled run. This is what the cron produces.
 *  - **`from` alone** → `from` … the run's clock. "Catch this duty up."
 *  - **`to` alone** → REFUSED. It could only mean "from the beginning of the
 *    duty", and `effective_from` is nullable, so the honest reading of the
 *    unbounded case is "generate tasks back to 1583". A job that quietly
 *    generates ten thousand rows because an operator left a field blank is not
 *    a job anyone runs twice; a refusal costs one retyped command.
 *
 * Malformed input throws. A backfill is typed by a human at the moment they run
 * it, so a rejected run they can see beats a window silently reinterpreted.
 */
export function parseBackfillWindow(data: unknown, now: Date): BackfillWindow | null {
  if (data == null) return null;
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError(`${DISPATCH_JOB_NAME}: job input must be an object of the shape { from?, to? }`);
  }

  const raw = data as { from?: unknown; to?: unknown };
  if (raw.from === undefined && raw.to === undefined) return null;

  if (raw.from === undefined) {
    throw new RangeError(
      `${DISPATCH_JOB_NAME}: a backfill needs 'from'. A 'to' on its own would mean "every period since the ` +
        `duty began", and effective_from is nullable, so that window has no floor.`,
    );
  }

  const from = raw.from;
  if (typeof from !== 'string' || !ISO_DATE.test(from)) {
    throw new RangeError(`${DISPATCH_JOB_NAME}: 'from' must be a YYYY-MM-DD date, received ${JSON.stringify(from)}`);
  }

  let to: string;
  if (raw.to === undefined) {
    to = now.toISOString().slice(0, 10);
  } else if (typeof raw.to === 'string' && ISO_DATE.test(raw.to)) {
    to = raw.to;
  } else {
    throw new RangeError(`${DISPATCH_JOB_NAME}: 'to' must be a YYYY-MM-DD date, received ${JSON.stringify(raw.to)}`);
  }

  if (to < from) {
    throw new RangeError(`${DISPATCH_JOB_NAME}: backfill window ends before it starts (${from} … ${to})`);
  }
  return { from, to };
}

// ─────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────

export interface DispatchOptions {
  /** The run's clock. Defaults to now; supplied by tests and by a replay. */
  now?: Date;
  /** A backfill window, or `null`/absent for the scheduled sweep. */
  window?: BackfillWindow | null;
}

export interface DispatchResult {
  duties: number;
  /** Task rows this run inserted. */
  created: number;
  /** Task rows that already existed — the normal steady state, not a problem. */
  existing: number;
  /** Duties whose `last_dispatched_period` this run moved forward. */
  advanced: number;
  skipped: DutySkip[];
  /** Set when the run finished without doing all of its work. */
  degradedReason?: string;
}

/**
 * The execution context for every read and write the job makes.
 *
 * `isSystem` because the dispatcher acts for the organisation, not for a
 * person: `duly_duty` is `sharingModel: 'private'`, so a user-scoped sweep
 * would see only the duties of whoever happened to trigger it and would
 * silently dispatch a fraction of the tenant.
 */
const SYSTEM_CONTEXT = { isSystem: true } as const;

/**
 * Run one dispatch pass.
 *
 * The engine is a parameter and not a module-scope client, so this function is
 * exactly as testable as the planner and there is no hidden global to leak
 * between runs.
 */
export async function runDispatch(engine: DispatchEngine, options: DispatchOptions = {}): Promise<DispatchResult> {
  const now = options.now ?? new Date();
  const window = options.window ?? null;

  const duties = await readDispatchableDuties(engine);
  const plan = planDispatch({ duties, now, window });

  const createdByDuty = new Map<string, string[]>();
  let created = 0;
  let existing = 0;

  for (const draft of plan.drafts) {
    const outcome = await insertOnce(engine, draft);
    if (outcome === 'created') {
      created += 1;
      const keys = createdByDuty.get(draft.duty);
      if (keys) keys.push(draft.period_key);
      else createdByDuty.set(draft.duty, [draft.period_key]);
    } else {
      existing += 1;
    }
  }

  const byId = new Map(duties.map((duty) => [duty.id, duty] as const));
  let advanced = 0;
  for (const [dutyId, keys] of createdByDuty) {
    const next = nextDispatchedPeriod(byId.get(dutyId)?.last_dispatched_period, keys);
    if (next === null) continue;
    // Writes `duly_duty`, never `duly_task`. `last_update_at` is the task's
    // stagnation signal and this job must never touch it — a dispatcher that
    // reset it would make every stalled task look freshly worked, and the
    // signal going quiet raises no error anywhere.
    await engine.update(
      'duly_duty',
      { last_dispatched_period: next },
      { where: { id: dutyId }, multi: false, context: SYSTEM_CONTEXT },
    );
    advanced += 1;
  }

  const faults = plan.skipped.filter((skip) => FAULT_SKIP_REASONS.includes(skip.reason));
  return {
    duties: duties.length,
    created,
    existing,
    advanced,
    skipped: plan.skipped,
    ...(faults.length > 0
      ? {
          degradedReason: `${faults.length} duty/duties could not be dispatched: ${faults
            .map((f) => `${f.duty} (${f.reason}${f.detail ? `: ${f.detail}` : ''})`)
            .join('; ')}`,
        }
      : {}),
  };
}

/**
 * Every active recurring duty, paged.
 *
 * The filter is deliberately only the two zone-independent facts. The
 * effective-window test is NOT pushed into the query: `effective_from` and
 * `effective_to` are calendar days in the DUTY's own zone, and "today" is a
 * different day in Auckland and in Los Angeles at the same instant, so a single
 * SQL predicate cannot be right for every row it matches. The window test
 * belongs where the zone is known, which is the planner.
 */
async function readDispatchableDuties(engine: DispatchEngine): Promise<DispatchDuty[]> {
  const duties: DispatchDuty[] = [];
  for (let offset = 0; ; offset += DISPATCH_PAGE_SIZE) {
    const page = (await engine.find(
      'duly_duty',
      {
        where: { status: DISPATCHABLE_STATUS, form: DISPATCHABLE_FORM },
        fields: [...DISPATCH_DUTY_FIELDS],
        // A stable total order, or paging re-reads and skips rows.
        orderBy: [{ field: 'id', order: 'asc' }],
        limit: DISPATCH_PAGE_SIZE,
        offset,
      },
      { context: SYSTEM_CONTEXT },
    )) as DispatchDuty[];
    duties.push(...page);
    if (page.length < DISPATCH_PAGE_SIZE) return duties;
  }
}

/**
 * Insert one task, or establish that it is already there.
 *
 * ── Attempt the insert; do not read first ────────────────────────────────
 * The happy path is a bare `insert`. A read-then-write guard would be a race
 * two overlapping runs lose — both read nothing, both write, and the loser
 * either duplicates the obligation or fails anyway — and it would cost a query
 * on every task on every night for a collision that is rare.
 *
 * `duly_task_dispatch_identity`, unique on `(duty, owner, period_key)` and
 * scoped to the organization, is what makes the bare insert safe. It is the
 * constraint that lets this job be ordinary: re-runnable, killable mid-run,
 * safe to invoke twice concurrently.
 *
 * ── Why the FAILURE path reads instead of classifying the error ──────────
 * The obvious shape — catch, ask "was that a uniqueness violation?", swallow if
 * so — is not available honestly. Measured on 17.2.0, ObjectQL does not wrap a
 * constraint violation in a platform error: the raw driver error propagates, so
 * on SQLite the app sees `code: 'SQLITE_CONSTRAINT_UNIQUE'`, on Postgres it
 * would see `23505`, on MySQL `ER_DUP_ENTRY`. The platform's own
 * dialect-independent predicate for this, `isUniqueViolationError`, lives in
 * `@objectstack/types`, which neither `@objectstack/spec` nor
 * `@objectstack/runtime` re-exports and which an application therefore cannot
 * reach. The remaining options were to hard-code one driver's spelling or to
 * pattern-match an error message — a consumer growing tolerance for a producer
 * that does not answer, which is how the wrong driver ships silently.
 *
 * So the failure path asks the DATA, which every driver answers the same way:
 * *is the row there now?* If it is, the obligation exists exactly once and this
 * run's job on it is done, whoever won the race. If it is not, the insert failed
 * for a reason that is not "already dispatched" — a missing required field, a
 * refused write, a store that is down — and the error is re-thrown so the run
 * FAILS. That is the half a blanket swallow gets wrong.
 *
 * This is not read-then-write: nothing is read before the insert, so the happy
 * path is one round trip and there is no window between a check and a write for
 * a second run to slip through.
 */
async function insertOnce(engine: DispatchEngine, draft: TaskDraft): Promise<'created' | 'existing'> {
  try {
    await engine.insert('duly_task', { ...draft }, { context: SYSTEM_CONTEXT });
    return 'created';
  } catch (error) {
    const rows = await engine.find(
      'duly_task',
      {
        where: { duty: draft.duty, owner: draft.owner, period_key: draft.period_key },
        fields: ['id'],
        limit: 1,
      },
      { context: SYSTEM_CONTEXT },
    );
    if (rows.length > 0) return 'existing';
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The handler
// ─────────────────────────────────────────────────────────────────────────

/** What the platform hands a job handler. Measured, not assumed — see the header. */
export interface DispatchJobContext {
  jobId?: string;
  data?: unknown;
}

/**
 * What the run reports.
 *
 * A run that inserted nothing because everything already existed resolves
 * `completed`: that is a SUCCESSFUL run, and the whole design rests on it being
 * unremarkable. `degraded` is reserved for a run that finished without doing all
 * of its work — a duty the period engine refused. It is not a failure and never
 * retries; only a thrown error does that, which is what an unreachable store or
 * an unbound engine produces.
 */
export const dulyDispatch = async (
  context: DispatchJobContext = {},
): Promise<{ outcome: 'completed' | 'degraded'; reason?: string }> => {
  const engine = requireDispatchEngine();
  const now = new Date();
  const window = parseBackfillWindow(context.data, now);
  const result = await runDispatch(engine, { now, window });
  return result.degradedReason ? { outcome: 'degraded', reason: result.degradedReason } : { outcome: 'completed' };
};

// ─────────────────────────────────────────────────────────────────────────
// The metadata
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runs at 01:00 UTC daily, and resolves each duty in ITS OWN `timezone`.
 *
 * One UTC pass covers every zone because the question asked per duty is "is
 * this period's task due to exist yet", never "is it midnight here". A job that
 * chased local midnights would need one schedule per zone and would still get
 * the answer wrong twice a year.
 *
 * 01:00 rather than 00:00 so a run is never racing a zone's own DST transition,
 * and so the hour every other nightly job in every other system picks is left
 * alone.
 */
export const DispatchJob = defineJob({
  name: DISPATCH_JOB_NAME,
  label: 'Dispatch due tasks',
  description:
    'Turns active recurring duties into tasks, one per period, in each duty\'s own timezone. Idempotent on (duty, owner, period_key); safe to re-run, backfill or interrupt.',
  schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
  handler: DISPATCH_HANDLER_NAME,

  // A failed run is worth retrying: the usual cause is a store that was briefly
  // unreachable, and the identity index makes a retry after a partial run cost
  // nothing — the tasks already written are found, not duplicated. Three
  // attempts over a few minutes, then leave it for the next night rather than
  // hammering a store that is genuinely down.
  retryPolicy: { maxRetries: 3, backoffMs: 30_000, backoffMultiplier: 2, maxRetryDelayMs: 300_000, jitter: true },

  // Fifteen minutes. A dispatch pass is a paged read plus one insert per owed
  // task; an attempt still running after fifteen minutes has stopped making
  // progress, and abandoning it is safe for the same reason a retry is.
  timeout: 900_000,
});
