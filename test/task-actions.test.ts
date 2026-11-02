// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpDispatcherResult, HttpProtocolContext } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';

import stack from '../objectstack.config.js';
import { Task } from '../src/objects/index.js';
import { dulyActions } from '../src/actions/index.js';
import { TaskViews } from '../src/views/task.view.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import { ensureUsers } from './support/users.js';
import {
  ACTIONABLE_STATUSES,
  COMPLETE_PATCH,
  SKIP_PATCH,
  TASK_COMPLETE_ACTION,
  TASK_OBJECT,
  TASK_SKIP_ACTION,
  TASK_UNDO_ACTION,
  UNDO_PATCH,
} from '../src/actions/task.handlers.js';

/**
 * One-click completion, undo, and skip-with-reason.
 *
 * Everything here runs against a REAL booted ObjectQL engine (in-memory
 * driver) with the app's own `objectstack.config.ts` as the bundle. That is
 * not ceremony — it is the only way these assertions mean anything:
 *
 *  - **The route.** Complete and skip are declarative (`operation: 'update'`,
 *    #146): no handler, so the only thing that can perform them is the
 *    platform's own action route. They are driven through
 *    `HttpDispatcher.handleActions` — the `/actions` domain handler the REST
 *    route delegates to — which resolves the declaration, enforces
 *    `requiredPermissions` and the declared params, and performs the write as
 *    the caller. Nothing here re-implements that dispatch.
 *  - **The registration.** Undo is still a handler-backed action, and an
 *    action whose handler is not registered RENDERS, IS CLICKABLE, and fails
 *    at call time; `pnpm validate` passes green. The suite dispatches it too,
 *    so a missing or mis-keyed registration surfaces as the console's 404.
 *  - **The payload.** "Completing writes `{ status: 'done' }` and nothing
 *    else, and the record comes back with `completed_at` set" is a claim
 *    about the hook, the readonly strip and the validation rules acting on the
 *    write in that order. Only the real pipeline can answer it.
 */

let data: any;
let kernel: any;
let dispatcher: HttpDispatcher;

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // Point the artifact lookup at a path that cannot exist. Left to its
    // default it resolves `<cwd>/dist/objectstack.json`, and a local
    // `pnpm build` leaving one there would make this suite report on the last
    // BUILD instead of on `src/` — passing with the barrel entry deleted, and
    // behaving differently in CI (where `pnpm test` runs before `pnpm build`).
    // Measured on the sibling hook suite, not hypothetical.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  // The reduced kernel's identity objects (`sys_user`, `sys_member`,
  // `sys_organization`) and, with them, the Default Organization a real
  // `single` install creates at boot: from @objectstack 18 every
  // tenant-scoped table carries `organization_id` NOT NULL, and a system
  // write is stamped with that organization (ADR-0131 D3/D9).
  await kernel.use(createIdentityObjectsPlugin());
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  await ensureUsers(data, ['user_alice']);

  // `onEnable` is invoked by the CLI boot path, not by `new AppPlugin(...)`,
  // so the handlers are wired here through the REAL registration function.
  // Registering them by hand instead would let this suite pass with
  // `registerTaskActionHandlers` missing from `registerDulyActionHandlers` —
  // which is the exact defect it exists to catch.
  registerDulyActionHandlers(data);

  dispatcher = new HttpDispatcher(kernel);
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const newTask = async (over: Record<string, unknown> = {}) =>
  data.insert('duly_task', {
    subject: 'Return the safety inspection',
    owner: 'user_alice',
    source: 'catalog',
    status: 'open',
    ...over,
  });

const read = async (id: string) => data.findOne('duly_task', { where: { id } });

/**
 * Dispatch an action the way the platform dispatcher does.
 *
 * Mirrors `handleActionsRequest` in @objectstack/runtime 17.2.0 — the same
 * shape the MCP path builds — deliberately including the two details this
 * suite depends on:
 *
 *  1. `record` is loaded under the CALLER's scope and a failed load is
 *     swallowed to `{}`;
 *  2. `record.id = recordId` is then stamped on UNCONDITIONALLY, so an id is
 *     present even when the row was never read. That is why the handlers key
 *     their availability check on a real field and not on `record.id`.
 *
 * `subject: 'unreadable'` reproduces (1)+(2) — the shape a caller who cannot
 * read the row actually produces — without needing a second identity.
 */
async function dispatch(
  action: string,
  opts: { recordId?: string; params?: Record<string, unknown>; subject?: 'load' | 'unreadable' } = {},
): Promise<unknown> {
  const { recordId, params = {}, subject = 'load' } = opts;

  let record: Record<string, unknown> = {};
  if (recordId && subject === 'load') {
    const got = await read(recordId);
    if (got) record = { ...got };
  }
  if (record.id == null && recordId) record.id = recordId;

  return data.executeAction(TASK_OBJECT, action, {
    record,
    user: { id: 'user_alice' },
    session: { userId: 'user_alice' },
    // The slim facade the dispatcher hands a handler. TRUSTED — system
    // elevated, RLS/FLS-bypassing by design; reproduced exactly so the suite
    // exercises the same write the console does.
    engine: {
      insert: async (object: string, values: Record<string, unknown>) => data.insert(object, values),
      update: async (object: string, id: string, values: Record<string, unknown>) =>
        data.update(object, values, { where: { id }, context: { isSystem: true } }),
      delete: async (object: string, id: string) => data.delete(object, { where: { id } }),
      find: async (object: string, query: Record<string, unknown>) => data.find(object, { where: query }),
    },
    params: { ...params, recordId, objectName: TASK_OBJECT },
  });
}

/** Assert a refusal by its ENVELOPE (ADR-0112), never by the bare fact that it threw. */
async function refusal(promise: Promise<unknown>): Promise<{ code: unknown; status: unknown; message: string }> {
  try {
    await promise;
  } catch (error: any) {
    return { code: error?.code, status: error?.status, message: String(error?.message ?? '') };
  }
  throw new Error('expected the dispatch to be refused, but it resolved');
}

/** The capability every task action requires (`requiredPermissions`). */
const UPDATE_STATUS = 'duly.task.update_status';

/** The task owner, holding the capability the `duly_member` set grants. */
const ALICE: HttpProtocolContext = {
  request: {},
  executionContext: { userId: 'user_alice', systemPermissions: [UPDATE_STATUS] },
};

/** An authenticated caller holding no Duly capability at all. */
const NO_CAPABILITY: HttpProtocolContext = {
  request: {},
  executionContext: { userId: 'user_alice', systemPermissions: [] },
};

/**
 * Call an action through the platform's own route — the path the console's
 * `POST /api/v1/actions/duly_task/<action>/<id>` lands on, with the API prefix
 * stripped. The response is returned as-is, refusals included.
 */
async function act(
  action: string,
  recordId?: string,
  params: Record<string, unknown> = {},
  as: HttpProtocolContext = ALICE,
): Promise<NonNullable<HttpDispatcherResult['response']>> {
  const path = recordId ? `/${TASK_OBJECT}/${action}/${recordId}` : `/${TASK_OBJECT}/${action}`;
  const result = await dispatcher.handleActions(path, 'POST', { params }, as);
  return result.response as NonNullable<HttpDispatcherResult['response']>;
}

/** An action call that must succeed; its `data` is returned. */
async function ok(action: string, recordId: string, params: Record<string, unknown> = {}): Promise<any> {
  const response = await act(action, recordId, params);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body?.success).toBe(true);
  return response.body?.data;
}

/**
 * What the console's toast Undo does with the envelope it built: a data-plane
 * update of `undoData` onto the record, as the caller. Reproduced from
 * `@objectstack/console` 18.2.0 (`UndoManager` → `dataSource.update(objectName,
 * recordId, undoData)`), so the suite exercises the write the click makes.
 */
async function applyUndo(undo: { objectName: string; recordId: string; undoData: Record<string, unknown> }) {
  await data.update(undo.objectName, { ...undo.undoData }, {
    where: { id: undo.recordId },
    context: { userId: 'user_alice' },
  });
}

const declared = (name: string) => dulyActions.find((a: any) => a?.name === name) as any;

// ── Two declared forms, and the failure mode that reads as success ─────────
const DECLARATIVE = [TASK_COMPLETE_ACTION, TASK_SKIP_ACTION] as const;
const ALL_ACTIONS = [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION] as const;

describe('registration', () => {
  it('every task action is declared in the actions barrel, bound to duly_task', () => {
    for (const name of ALL_ACTIONS) {
      const action = declared(name);
      expect(action, `${name} must be in dulyActions or it is dead metadata`).toBeDefined();
      expect(action.objectName).toBe(TASK_OBJECT);
    }
  });

  it('complete and skip are the declarative field write, with the same patch as the bulk forms', () => {
    expect(declared(TASK_COMPLETE_ACTION).operation).toBe('update');
    expect(declared(TASK_COMPLETE_ACTION).patch).toEqual(COMPLETE_PATCH);
    expect(declared(TASK_SKIP_ACTION).operation).toBe('update');
    expect(declared(TASK_SKIP_ACTION).patch).toEqual(SKIP_PATCH);
    for (const name of DECLARATIVE) {
      const action = declared(name);
      // `type` stays at its default — the platform action route the write is
      // performed on — and nothing binds a handler: `target` is refused beside
      // `operation: 'update'`, because there is no handler for it to name.
      expect(action.type).toBe('script');
      expect(action.target, `${name} must not name a handler`).toBeUndefined();
      expect(action.body).toBeUndefined();
    }
  });

  it('undo is still a handler-backed script action', () => {
    const undo = declared(TASK_UNDO_ACTION);
    expect(undo.type).toBe('script');
    expect(undo.operation).toBeUndefined();
    // A `script` action with neither `body` nor `target` is refused at
    // author time. `target` is what the dispatcher resolves the handler by.
    expect(undo.target).toBe(TASK_UNDO_ACTION);
  });

  it('reaches duly_task.actions — defineStack merged it onto the object', () => {
    const merged = (data.getSchema(TASK_OBJECT)?.actions ?? []).map((a: any) => a?.name);
    for (const name of ALL_ACTIONS) {
      expect(merged, `${name} must reach the object the row renders`).toContain(name);
    }
  });

  it('undo has its handler registered under duly_task, and the declarative two have none', () => {
    const registered = data
      .listRegisteredActions()
      .map((r: { objectName: string; actionName: string }) => `${r.objectName}:${r.actionName}`);

    // `executeAction` is an exact-string map lookup on `<object>:<name>`, so
    // a handler filed under `global` is unreachable from a task row even
    // though it registered without error.
    expect(registered, `${TASK_UNDO_ACTION} renders and 404s without this`).toContain(`${TASK_OBJECT}:${TASK_UNDO_ACTION}`);
    // The route dispatches on `operation` BEFORE any handler lookup, so a
    // handler registered beside a declarative action is dead code that
    // type-checks and never runs.
    for (const name of DECLARATIVE) {
      expect(registered, `${name} is declarative; a handler for it would never run`).not.toContain(`${TASK_OBJECT}:${name}`);
    }
  });

  it('dispatches for real — every action, end to end through the route', async () => {
    const task = await newTask();
    const completed = await ok(TASK_COMPLETE_ACTION, task.id);
    expect(completed.operation).toBe('update');
    expect(completed.id).toBe(task.id);

    const undone = await ok(TASK_UNDO_ACTION, task.id);
    expect(undone.action).toBe(TASK_UNDO_ACTION);
    expect(undone.task).toBe(task.id);

    const skipped = await ok(TASK_SKIP_ACTION, task.id, { skip_reason: 'Plant down' });
    expect(skipped.operation).toBe('update');
  });

  it('an unregistered action name is refused the way a missing handler would be', async () => {
    // Pins the failure shape the registration assertions above protect
    // against, so "not found" stays recognisable if the engine reworks it.
    await expect(dispatch('duly_task_not_registered', { recordId: 'x' })).rejects.toThrow(/not found/i);
  });
});

// ── Predicates ─────────────────────────────────────────────────────────────
describe('predicates', () => {
  const taskFields = Object.keys((Task as any).fields ?? {});

  const scan = (source: string, where: string) => {
    expect(source.length, `${where} must carry a predicate`).toBeGreaterThan(0);
    for (const field of taskFields) {
      // Every mention of a duly_task field must be `record.`-qualified. A bare
      // `status` evaluates to null and hides the action on EVERY record — a
      // button that silently never appears, with nothing red anywhere.
      const bare = new RegExp(`(^|[^.\\w])${field}\\b`);
      expect(bare.test(source), `${where}: "${field}" is not record.-qualified — ${source}`).toBe(false);
    }
  };

  it('every action predicate is CEL and record.-qualified', () => {
    for (const name of ALL_ACTIONS) {
      const visible = declared(name)?.visible;
      expect(visible?.dialect, `${name}.visible must be CEL`).toBe('cel');
      scan(String(visible?.source ?? ''), `${name}.visible`);
    }
  });

  it('every bulk predicate is CEL and record.-qualified', () => {
    for (const def of allBulkDefs()) {
      expect(def.visible?.dialect, `${def.name}.visible must be CEL`).toBe('cel');
      scan(String(def.visible?.source ?? ''), `${def.name}.visible`);
    }
  });

  it('complete and skip are offered on exactly the actionable statuses', () => {
    // Not a re-spelling of the source: this drives the vocabulary
    // `ACTIONABLE_STATUSES` names, so a status added to one and not the other
    // is caught.
    for (const name of [TASK_COMPLETE_ACTION, TASK_SKIP_ACTION]) {
      const source = String(declared(name)?.visible?.source ?? '');
      for (const status of ACTIONABLE_STATUSES) expect(source).toContain(`"${status}"`);
      expect(source).not.toContain('"done"');
      expect(source).not.toContain('"cancelled"');
    }
    expect(String(declared(TASK_UNDO_ACTION)?.visible?.source ?? '')).toContain('"done"');
  });
});

// ── The payload, and what must never be in it ──────────────────────────────
describe('payload', () => {
  const SERVER_OWNED = ['completed_at', 'last_update_at'];

  it('completing sends { status: done } and nothing else', () => {
    expect(COMPLETE_PATCH).toEqual({ status: 'done' });
    expect(Object.keys(COMPLETE_PATCH)).toHaveLength(1);
  });

  it('undo returns the task to in_progress', () => {
    expect(UNDO_PATCH).toEqual({ status: 'in_progress' });
  });

  it('no payload anywhere writes a server-owned timestamp', () => {
    // The hook is their one writer, and both are `readonly: true`: a caller's
    // value is stripped only while the key still holds exactly what the caller
    // supplied, so sending one makes the outcome depend on value equality.
    const payloads: Array<[string, Record<string, unknown>]> = [
      ['COMPLETE_PATCH', COMPLETE_PATCH],
      ['UNDO_PATCH', UNDO_PATCH],
      ['SKIP_PATCH', SKIP_PATCH],
      ...allBulkDefs().map((d): [string, Record<string, unknown>] => [`${d.name}.patch`, d.patch ?? {}]),
    ];
    for (const [where, payload] of payloads) {
      for (const key of SERVER_OWNED) {
        expect(Object.keys(payload), `${where} must not write ${key}`).not.toContain(key);
      }
    }
    for (const name of ALL_ACTIONS) {
      const params = (declared(name)?.params ?? []) as Array<{ name?: string; field?: string }>;
      for (const p of params) {
        expect(SERVER_OWNED, `${name} must not collect a server-owned field`).not.toContain(p.name ?? p.field ?? '');
      }
    }
  });

  it('no action asks for a percentage, an evidence upload or a confirmation', () => {
    // The product invariant, asserted rather than remembered: completion never
    // requires evidence, a note, or a percentage, and undo replaces the
    // "are you sure?" step on the two actions that write without a dialog.
    for (const name of [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION]) {
      const action = declared(name);
      expect(action.confirmText, `${name} must not confirm — undo is the confirmation`).toBeUndefined();
      expect(action.params ?? [], `${name} must not collect anything`).toHaveLength(0);
    }
    const everyParam = ALL_ACTIONS
      .flatMap((n) => (declared(n)?.params ?? []) as Array<{ name?: string; type?: string }>);
    for (const p of everyParam) {
      expect(p.type, 'no action may demand an attachment to close a task').not.toBe('file');
      expect(p.name).not.toMatch(/percent|progress|evidence|attachment/i);
    }
  });

  it('complete and skip offer the toast Undo; the undo row action stays one click away', () => {
    // `undoable` is fulfilled on two shapes only, `operation: 'update'` and
    // `type: 'api'` — so it became possible on these two when they became
    // declarative (#146), and it is what puts Undo on the success toast.
    for (const name of DECLARATIVE) {
      expect(declared(name).undoable, `${name} must offer Undo on its toast`).toBe(true);
    }
    // The toast lasts as long as the toast. The reversal that makes a
    // no-confirmation tick defensible tomorrow, and on the record page, is
    // still the row action, shown on every row a tick leaves behind.
    const undo = declared(TASK_UNDO_ACTION);
    expect(undo.locations).toEqual(declared(TASK_COMPLETE_ACTION).locations);
    expect(undo.confirmText).toBeUndefined();
    expect((undo.visible as { source?: string } | undefined)?.source).toBe('record.status == "done"');
  });
});

// ── Behaviour against the real write pipeline ──────────────────────────────
describe('complete', () => {
  it('sets status done and the record comes back with completed_at', async () => {
    const task = await newTask();
    await ok(TASK_COMPLETE_ACTION, task.id);

    const row = await read(task.id);
    expect(row.status).toBe('done');
    expect(row.completed_at, 'the hook stamps it; the validation rule refuses the write without it').toBeTruthy();
    expect(row.completed_late, 'no due date, so nothing to be late against').toBe(false);
    expect(row.last_update_at).toBeTruthy();
  });

  it('stamps the late verdict on a task completed after its grace ran out', async () => {
    // `completed_late` is read off the row's own `late_after`, so this is the
    // hook running on THIS write, not a default.
    const task = await newTask({ due_date: '2020-01-01' });
    await ok(TASK_COMPLETE_ACTION, task.id);

    const row = await read(task.id);
    expect(row.late_after).toBe('2020-01-01');
    expect(row.completed_late).toBe(true);
  });

  it('is written as the caller, not as the system', async () => {
    // The declarative write is a data-plane update under the caller's own
    // execution context. A handler's `ctx.engine` would have written it
    // system-elevated; the audit column says which one ran.
    const task = await newTask();
    await ok(TASK_COMPLETE_ACTION, task.id);
    expect((await read(task.id)).updated_by).toBe('user_alice');
  });

  it('works from in_progress as well as open', async () => {
    const task = await newTask({ status: 'in_progress' });
    await ok(TASK_COMPLETE_ACTION, task.id);
    expect((await read(task.id)).status).toBe('done');
  });

  it('never re-stamps a task that is already done', async () => {
    // The handler used to refuse this with a 409. The declarative write has no
    // status precondition, and the history survives anyway: done → done is
    // not a transition, and the hook stamps only transitions.
    const task = await newTask();
    await ok(TASK_COMPLETE_ACTION, task.id);
    const before = await read(task.id);
    await tick();

    await ok(TASK_COMPLETE_ACTION, task.id);
    const after = await read(task.id);
    expect(after.completed_at, 'the original completion instant').toBe(before.completed_at);
    expect(after.completed_late).toBe(before.completed_late);
  });
});

describe('the status precondition the handler had, and the route does not (#162)', () => {
  it('completing a CANCELLED task through the API is accepted today', async () => {
    // ⚠️ Pins today's behaviour so #162 flips it red on purpose. The handler
    // answered 409 DULY_TASK_WRONG_STATUS here; the declarative write has no
    // status precondition, and neither does the data plane the same caller
    // could already PATCH (member `allowEdit`, `writeScope: 'own'`, no field
    // block), so the 409 guarded one door of several. The button stays hidden
    // by `visible`. The declared rule belongs on the object, where every door
    // passes — a `state_machine` validation on `duly_task.status`, card #162.
    const task = await newTask({ status: 'cancelled' });
    await ok(TASK_COMPLETE_ACTION, task.id);
    expect((await read(task.id)).status).toBe('done');
  });
});

describe('toast undo', () => {
  it('the route answers with the undo envelope for exactly the field complete wrote', async () => {
    const task = await newTask();
    const result = await ok(TASK_COMPLETE_ACTION, task.id);
    expect(result.undo).toMatchObject({
      type: 'update',
      objectName: TASK_OBJECT,
      recordId: task.id,
      undoData: { status: 'open' },
      redoData: { status: 'done' },
    });
  });

  it('applying it reopens the task, and the hook clears completed_at with it', async () => {
    const task = await newTask();
    const { undo } = await ok(TASK_COMPLETE_ACTION, task.id);
    expect((await read(task.id)).completed_at).toBeTruthy();

    await applyUndo(undo);

    const row = await read(task.id);
    expect(row.status, 'back to where it was, not to in_progress').toBe('open');
    expect(row.completed_at ?? null).toBeNull();
    expect(row.completed_late ?? null).toBeNull();
  });

  it('a skip is undone with its reason, so a reopened task carries no stray reason', async () => {
    const task = await newTask({ status: 'in_progress' });
    const { undo } = await ok(TASK_SKIP_ACTION, task.id, { skip_reason: 'Plant down' });
    // `patch` merges UNDER the params, and the capture covers the whole bag.
    expect(undo.undoData).toEqual({ status: 'in_progress', skip_reason: null });

    await applyUndo(undo);

    const row = await read(task.id);
    expect(row.status).toBe('in_progress');
    expect(row.skip_reason ?? null).toBeNull();
  });
});

describe('undo (the row action)', () => {
  it('returns the record to in_progress with completed_at null', async () => {
    const task = await newTask();
    await ok(TASK_COMPLETE_ACTION, task.id);
    expect((await read(task.id)).completed_at).toBeTruthy();

    await ok(TASK_UNDO_ACTION, task.id);

    const row = await read(task.id);
    expect(row.status).toBe('in_progress');
    expect(row.completed_at ?? null).toBeNull();
  });

  it('is refused on a task that was never completed', async () => {
    const task = await newTask();
    const { code, status } = await refusal(dispatch(TASK_UNDO_ACTION, { recordId: task.id }));
    expect(code).toBe('DULY_TASK_WRONG_STATUS');
    expect(status).toBe(409);
  });

  it('a completion can be taken back and retaken', async () => {
    const task = await newTask();
    await ok(TASK_COMPLETE_ACTION, task.id);
    const first = (await read(task.id)).completed_at;
    await ok(TASK_UNDO_ACTION, task.id);
    await tick();
    await ok(TASK_COMPLETE_ACTION, task.id);

    const row = await read(task.id);
    expect(row.status).toBe('done');
    expect(row.completed_at > first, 'the second completion is its own instant').toBe(true);
  });
});

describe('skip', () => {
  it('records the reason and leaves completed_at unset', async () => {
    const task = await newTask();
    await ok(TASK_SKIP_ACTION, task.id, { skip_reason: 'The plant was down — there was nothing to return' });

    const row = await read(task.id);
    expect(row.status).toBe('skipped');
    expect(row.skip_reason).toBe('The plant was down — there was nothing to return');
    expect(row.completed_at ?? null, 'a skip is not a completion').toBeNull();
    expect(row.last_update_at, 'recording a skip is progress on the task').toBeTruthy();
  });

  it('without a reason is refused by the route, and nothing is written', async () => {
    // The param is `required: true`, and the route enforces the declared
    // params before the write — the same answer the dialog gives.
    const task = await newTask();
    const response = await act(TASK_SKIP_ACTION, task.id);
    expect(response.status).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect((await read(task.id)).status, 'the refusal must not be a partial write').toBe('open');
  });

  it('with a blank reason is refused too', async () => {
    const task = await newTask();
    const response = await act(TASK_SKIP_ACTION, task.id, { skip_reason: '   ' });
    expect(response.status).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect((await read(task.id)).status).toBe('open');
  });

  it("the OBJECT's rule is the authority — a direct write with no reason is refused by it", async () => {
    // The route's param check is a courtesy for the caller. This asserts the
    // rule that actually decides, with its own message, so the two cannot
    // drift into one guard doing all the work.
    const task = await newTask();
    let caught: any;
    try {
      await data.update('duly_task', { id: task.id, status: 'skipped' });
    } catch (error) {
      caught = error;
    }
    expect(caught, 'skip_needs_reason must refuse this').toBeDefined();
    expect(caught.code).toBe('VALIDATION_FAILED');
    expect(caught.message).toBe('Say why the task was skipped.');
  });

  it('declares the reason as a required param — the one modal that is correct', () => {
    const params = (declared(TASK_SKIP_ACTION)?.params ?? []) as Array<any>;
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('skip_reason');
    expect(params[0].required).toBe(true);
    // Pairing `confirmText` with params shows two dialogs for one decision,
    // and the schema refuses the pair; the question rides on `description`.
    expect(declared(TASK_SKIP_ACTION)?.confirmText).toBeUndefined();
    expect(String(declared(TASK_SKIP_ACTION)?.description ?? '').length).toBeGreaterThan(0);
  });
});

// ── Authorization: the button is a hide, the route is the gate ──────────────
describe('authorization', () => {
  it('all three actions refuse a caller without the capability, and write nothing', async () => {
    // [ADR-0066 D4] `requiredPermissions` is checked by the route ahead of
    // BOTH forms — before the declarative branch and before a handler — so
    // moving complete and skip changed nothing here.
    for (const name of ALL_ACTIONS) {
      const task = await newTask();
      const params = name === TASK_SKIP_ACTION ? { skip_reason: 'x' } : {};
      const response = await act(name, task.id, params, NO_CAPABILITY);
      expect(response.status, `${name} must refuse`).toBe(403);
      expect(response.body?.error?.code).toBe('PERMISSION_DENIED');
      expect(response.body?.error?.message).toContain(UPDATE_STATUS);
      expect((await read(task.id)).status, `${name} wrote on a refusal`).toBe('open');
    }
  });

  it('the declarative two refuse an unknown record, and a call with no record', async () => {
    for (const name of DECLARATIVE) {
      // Each with the params it declares: the route refuses an undeclared
      // param before it ever looks for the record.
      const params = name === TASK_SKIP_ACTION ? { skip_reason: 'x' } : {};
      const unknown = await act(name, 'duly_task-nope', params);
      expect(unknown.status, `${name} on a missing row`).toBe(404);
      expect(unknown.body?.error?.code).toBe('RECORD_NOT_FOUND');

      const none = await act(name, undefined, params);
      expect(none.status, `${name} with no subject`).toBe(400);
      expect(none.body?.error?.message).toContain('recordId');
    }
  });

  // The handler's own re-check — undo writes through the elevated facade, so
  // it reads its subject under the caller's scope first. See task.handlers.ts.
  it('undo refuses when the subject did not load under the caller scope', async () => {
    const task = await newTask();
    await ok(TASK_COMPLETE_ACTION, task.id);
    // The dispatcher stamps `record.id` on even when the read returned
    // nothing, so an id alone proves nothing about read access.
    const { code, status } = await refusal(
      dispatch(TASK_UNDO_ACTION, { recordId: task.id, subject: 'unreadable' }),
    );
    expect(code).toBe('DULY_TASK_NOT_AVAILABLE');
    expect(status).toBe(404);
    expect((await read(task.id)).status, 'nothing may be written on a refusal').toBe('done');
  });

  it('undo refuses a dispatch with no subject at all', async () => {
    const { code, status } = await refusal(dispatch(TASK_UNDO_ACTION, {}));
    expect(code).toBe('DULY_TASK_NO_SUBJECT');
    expect(status).toBe(400);
  });

  it('undo refuses an unknown record id', async () => {
    const { code, status } = await refusal(dispatch(TASK_UNDO_ACTION, { recordId: 'duly_task-nope' }));
    expect(code).toBe('DULY_TASK_NOT_AVAILABLE');
    expect(status).toBe(404);
  });
});

// ── Bulk ───────────────────────────────────────────────────────────────────

/** Every bulk def declared on any task list view. */
function allBulkDefs(): Array<any> {
  const views = TaskViews as any;
  const entries = [views.list, ...Object.values(views.listViews ?? {})];
  return entries.flatMap((v: any) => (v?.bulkActionDefs ?? []) as Array<any>);
}

describe('bulk', () => {
  const BULK_COMPLETE = 'duly_task_bulk_complete';
  const BULK_SKIP = 'duly_task_bulk_skip';

  it('is offered on every multi-select grid, and not on the calendar', () => {
    const views = TaskViews as any;
    const grids: Array<[string, any]> = [
      ['list', views.list],
      ['my_week', views.listViews.my_week],
      ['late', views.listViews.late],
      ['stalled', views.listViews.stalled],
    ];
    for (const [label, view] of grids) {
      const names = (view?.bulkActionDefs ?? []).map((d: any) => d?.name);
      expect(names, `${label} must offer bulk complete`).toContain(BULK_COMPLETE);
      expect(names, `${label} must offer bulk skip`).toContain(BULK_SKIP);
    }
    // A calendar has no multi-select gesture to hang a selection bar on.
    expect(views.listViews.calendar?.bulkActionDefs).toBeUndefined();
  });

  it('is declarative — a data-plane update carrying the same patch as the row action', () => {
    const complete = allBulkDefs().find((d) => d.name === BULK_COMPLETE);
    expect(complete.operation).toBe('update');
    expect(complete.patch).toEqual(COMPLETE_PATCH);
    // `execution` only applies to `operation: 'custom'`; the schema refuses it
    // here, and its absence is what keeps this a data-plane write rather than
    // N dispatches through the elevated action facade.
    expect(complete.execution).toBeUndefined();

    const skip = allBulkDefs().find((d) => d.name === BULK_SKIP);
    expect(skip.operation).toBe('update');
    expect(skip.patch).toEqual(SKIP_PATCH);
    // `patch` merges UNDER the collected params, so the reason lands beside
    // the fixed status without being exposed as an editable status field.
    expect(skip.params).toHaveLength(1);
    expect(skip.params[0].name).toBe('skip_reason');
    expect(skip.params[0].required).toBe(true);
  });

  it('completes a week of tasks in one write path, all stamped', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) ids.push((await newTask({ subject: `bulk ${i}` })).id);

    // The data-plane form a `bulkActionDefs` update lowers to: ONE predicate
    // write scoped to the selection, not 20 dispatches.
    const affected = await data.update('duly_task', { ...COMPLETE_PATCH }, {
      multi: true,
      where: { id: { $in: ids } },
    });
    expect(affected).toBe(20);

    for (const id of ids) {
      const row = await read(id);
      expect(row.status).toBe('done');
      expect(row.completed_at, `${id} must be stamped by the hook like any other write`).toBeTruthy();
    }
  });

  it('an already-done row in the batch is refused by the SERVER, not merely hidden', async () => {
    // The layer that actually decides. A predicate update carries ONE payload
    // for all N rows (`driver.updateMany` takes one SET clause), so the
    // `completed_at` the hook stamps for a row that IS transitioning would be
    // written to every row in the batch — including one completed days ago.
    // ADR-0058 Addendum II D3 hands a `before*` hook exactly one way out of
    // that, and `task.hook.ts` takes it: refuse the write.
    //
    // This is the assertion that makes the `visible` predicate below a
    // convenience rather than the only thing between a caller and moved
    // history — an import, a backfill, the dispatcher or an MCP caller never
    // goes near a view predicate.
    const open = (await newTask({ subject: 'still open' })).id;
    const alreadyDone = (await newTask({ subject: 'done last week' })).id;
    await ok(TASK_COMPLETE_ACTION, alreadyDone);
    const original = (await read(alreadyDone)).completed_at;
    await tick();

    const { code, status } = await refusal(
      data.update('duly_task', { ...COMPLETE_PATCH }, { multi: true, where: { id: { $in: [open, alreadyDone] } } }),
    );
    expect(code).toBe('DULY_TASK_BULK_ALREADY_DONE');
    expect(status).toBe(409);

    expect(
      (await read(alreadyDone)).completed_at,
      'the original completion instant must survive a batch that tried to re-stamp it',
    ).toBe(original);
    expect((await read(open)).status, 'and the refusal writes nothing at all').toBe('open');
  });

  it('and the visible predicate still keeps such a batch from being assembled', async () => {
    // The outer layer, kept. `visible` is evaluated once per selected record
    // and the run covers only the passing rows, so the console cannot build
    // the batch the server now refuses. Defence in depth: the user gets a
    // greyed-out row instead of an error they did not cause.
    const complete = allBulkDefs().find((d) => d.name === BULK_COMPLETE);
    const source = String(complete.visible?.source ?? '');
    expect(source).not.toContain('"done"');
    for (const status of ACTIONABLE_STATUSES) expect(source).toContain(`"${status}"`);
  });

  it('bulk skip writes the reason alongside the status', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await newTask({ subject: `skip ${i}` })).id);

    await data.update('duly_task', { ...SKIP_PATCH, skip_reason: 'Plant shutdown, week 34' }, {
      multi: true,
      where: { id: { $in: ids } },
    });

    for (const id of ids) {
      const row = await read(id);
      expect(row.status).toBe('skipped');
      expect(row.skip_reason).toBe('Plant shutdown, week 34');
    }
  });

  it('a bulk skip with no reason is refused by the object rule, not silently dropped', async () => {
    const id = (await newTask()).id;
    let caught: any;
    try {
      await data.update('duly_task', { ...SKIP_PATCH }, { multi: true, where: { id: { $in: [id] } } });
    } catch (error) {
      caught = error;
    }
    expect(caught, 'skip_needs_reason applies to the bulk path too').toBeDefined();
    expect(caught.code).toBe('VALIDATION_FAILED');
    expect((await read(id)).status).toBe('open');
  });
});
