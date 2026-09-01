// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { Task } from '../src/objects/index.js';
import { dulyActions } from '../src/actions/index.js';
import { TaskViews } from '../src/views/task.view.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
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
 * not ceremony — it is the only way two of these assertions mean anything:
 *
 *  - **The registration.** An action whose handler is not registered RENDERS,
 *    IS CLICKABLE, and fails at call time; `pnpm validate` passes green. The
 *    suite dispatches through the engine's own `executeAction`, so a missing
 *    or mis-keyed registration surfaces as the same 404 the console would get.
 *  - **The payload.** "Completing sends `{ status: 'done' }` and nothing else,
 *    and the record comes back with `completed_at` set" is a claim about the
 *    hook, the readonly strip and the validation rules acting on the write in
 *    that order. Only the real pipeline can answer it.
 */

let data: any;
let kernel: any;

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
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
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');

  // `onEnable` is invoked by the CLI boot path, not by `new AppPlugin(...)`,
  // so the handlers are wired here through the REAL registration function.
  // Registering them by hand instead would let this suite pass with
  // `registerTaskActionHandlers` missing from `registerDulyActionHandlers` —
  // which is the exact defect it exists to catch.
  registerDulyActionHandlers(data);
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

const declared = (name: string) => dulyActions.find((a: any) => a?.name === name) as any;

// ── The failure mode that reads as success ─────────────────────────────────
//
// There is no author-time gate for an unregistered handler. This block IS the
// gate.
describe('registration', () => {
  it('every task action is declared in the actions barrel, bound to duly_task', () => {
    for (const name of [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION]) {
      const action = declared(name);
      expect(action, `${name} must be in dulyActions or it is dead metadata`).toBeDefined();
      expect(action.objectName).toBe(TASK_OBJECT);
      expect(action.type).toBe('script');
      // A `script` action with neither `body` nor `target` is refused at
      // author time. `target` is what the dispatcher resolves the handler by.
      expect(action.target).toBe(name);
    }
  });

  it('reaches duly_task.actions — defineStack merged it onto the object', () => {
    const merged = (data.getSchema(TASK_OBJECT)?.actions ?? []).map((a: any) => a?.name);
    for (const name of [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION]) {
      expect(merged, `${name} must reach the object the row renders`).toContain(name);
    }
  });

  it('every declared handler-backed action has a handler registered under duly_task', () => {
    const registered = data
      .listRegisteredActions()
      .map((r: { objectName: string; actionName: string }) => `${r.objectName}:${r.actionName}`);

    for (const name of [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION]) {
      // `executeAction` is an exact-string map lookup on `<object>:<name>`, so
      // a handler filed under `global` is unreachable from a task row even
      // though it registered without error.
      expect(registered, `${name} renders and 404s without this`).toContain(`${TASK_OBJECT}:${name}`);
    }
  });

  it('dispatches for real — the wiring end to end, not just the registry', async () => {
    const task = await newTask();
    const result: any = await dispatch(TASK_COMPLETE_ACTION, { recordId: task.id });
    expect(result?.action).toBe(TASK_COMPLETE_ACTION);
    expect(result?.task).toBe(task.id);
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
    for (const name of [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION]) {
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
    // Not a re-spelling of the source: this drives the same vocabulary the
    // handlers enforce, so a status added to one and not the other is caught.
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
    for (const name of [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION]) {
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
    const everyParam = [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION]
      .flatMap((n) => (declared(n)?.params ?? []) as Array<{ name?: string; type?: string }>);
    for (const p of everyParam) {
      expect(p.type, 'no action may demand an attachment to close a task').not.toBe('file');
      expect(p.name).not.toMatch(/percent|progress|evidence|attachment/i);
    }
  });

  it('complete offers the platform Undo affordance', () => {
    // `undoable` is the runtime's own one-click reversal: it snapshots the
    // record's prior field values and offers Undo on the success toast. It is
    // what makes a no-confirmation tick defensible at the moment of the
    // mistake; `duly_task_undo` covers the mistake noticed after the toast.
    expect(declared(TASK_COMPLETE_ACTION)?.undoable).toBe(true);
  });
});

// ── Behaviour against the real write pipeline ──────────────────────────────
describe('complete', () => {
  it('sets status done and the record comes back with completed_at', async () => {
    const task = await newTask();
    await dispatch(TASK_COMPLETE_ACTION, { recordId: task.id });

    const row = await read(task.id);
    expect(row.status).toBe('done');
    expect(row.completed_at, 'the hook stamps it; the validation rule refuses the write without it').toBeTruthy();
    expect(row.last_update_at).toBeTruthy();
  });

  it('works from in_progress as well as open', async () => {
    const task = await newTask({ status: 'in_progress' });
    await dispatch(TASK_COMPLETE_ACTION, { recordId: task.id });
    expect((await read(task.id)).status).toBe('done');
  });

  it('is refused on a task that is already done', async () => {
    const task = await newTask();
    await dispatch(TASK_COMPLETE_ACTION, { recordId: task.id });
    const before = await read(task.id);
    await tick();

    const { code, status } = await refusal(dispatch(TASK_COMPLETE_ACTION, { recordId: task.id }));
    expect(code).toBe('DULY_TASK_WRONG_STATUS');
    expect(status).toBe(409);

    // And the refusal is not merely a message: the original completion instant
    // survives it. Re-stamping would silently move the record's history.
    expect((await read(task.id)).completed_at).toBe(before.completed_at);
  });

  it('is refused on a cancelled task', async () => {
    const task = await newTask({ status: 'cancelled' });
    const { code, status } = await refusal(dispatch(TASK_COMPLETE_ACTION, { recordId: task.id }));
    expect(code).toBe('DULY_TASK_WRONG_STATUS');
    expect(status).toBe(409);
  });
});

describe('undo', () => {
  it('returns the record to in_progress with completed_at null', async () => {
    const task = await newTask();
    await dispatch(TASK_COMPLETE_ACTION, { recordId: task.id });
    expect((await read(task.id)).completed_at).toBeTruthy();

    await dispatch(TASK_UNDO_ACTION, { recordId: task.id });

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
    await dispatch(TASK_COMPLETE_ACTION, { recordId: task.id });
    const first = (await read(task.id)).completed_at;
    await dispatch(TASK_UNDO_ACTION, { recordId: task.id });
    await tick();
    await dispatch(TASK_COMPLETE_ACTION, { recordId: task.id });

    const row = await read(task.id);
    expect(row.status).toBe('done');
    expect(row.completed_at > first, 'the second completion is its own instant').toBe(true);
  });
});

describe('skip', () => {
  it('records the reason and leaves completed_at unset', async () => {
    const task = await newTask();
    await dispatch(TASK_SKIP_ACTION, {
      recordId: task.id,
      params: { skip_reason: 'The plant was down — there was nothing to return' },
    });

    const row = await read(task.id);
    expect(row.status).toBe('skipped');
    expect(row.skip_reason).toBe('The plant was down — there was nothing to return');
    expect(row.completed_at ?? null, 'a skip is not a completion').toBeNull();
    expect(row.last_update_at, 'recording a skip is progress on the task').toBeTruthy();
  });

  it('without a reason is refused, and nothing is written', async () => {
    const task = await newTask();
    const { code, status } = await refusal(dispatch(TASK_SKIP_ACTION, { recordId: task.id }));
    expect(code).toBe('DULY_TASK_SKIP_NEEDS_REASON');
    expect(status).toBe(400);
    expect((await read(task.id)).status, 'the refusal must not be a partial write').toBe('open');
  });

  it('with a blank reason is refused too', async () => {
    const task = await newTask();
    const { code } = await refusal(dispatch(TASK_SKIP_ACTION, { recordId: task.id, params: { skip_reason: '   ' } }));
    expect(code).toBe('DULY_TASK_SKIP_NEEDS_REASON');
  });

  it("the OBJECT's rule is the authority — a direct write with no reason is refused by it", async () => {
    // The handler's early refusal is a courtesy for the programmatic caller.
    // This asserts the rule that actually decides, with its own message, so
    // the two cannot drift into one guard doing all the work.
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

// ── Availability: the button is a hide, the handler is the gate ────────────
describe('authorization', () => {
  it('refuses when the subject did not load under the caller scope', async () => {
    const task = await newTask();
    // The dispatcher stamps `record.id` on even when the read returned
    // nothing, so an id alone proves nothing about read access.
    const { code, status } = await refusal(
      dispatch(TASK_COMPLETE_ACTION, { recordId: task.id, subject: 'unreadable' }),
    );
    expect(code).toBe('DULY_TASK_NOT_AVAILABLE');
    expect(status).toBe(404);
    expect((await read(task.id)).status, 'nothing may be written on a refusal').toBe('open');
  });

  it('refuses a dispatch with no subject at all', async () => {
    const { code, status } = await refusal(dispatch(TASK_COMPLETE_ACTION, {}));
    expect(code).toBe('DULY_TASK_NO_SUBJECT');
    expect(status).toBe(400);
  });

  it('refuses an unknown record id', async () => {
    const { code, status } = await refusal(dispatch(TASK_COMPLETE_ACTION, { recordId: 'duly_task-nope' }));
    expect(code).toBe('DULY_TASK_NOT_AVAILABLE');
    expect(status).toBe(404);
  });

  it('all three actions are gated, not just complete', async () => {
    for (const name of [TASK_COMPLETE_ACTION, TASK_UNDO_ACTION, TASK_SKIP_ACTION]) {
      const { code } = await refusal(dispatch(name, { recordId: 'duly_task-nope' }));
      expect(code, `${name} must refuse an unreadable subject`).toBe('DULY_TASK_NOT_AVAILABLE');
    }
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

  it('the visible predicate is what keeps an already-done row out of the batch', async () => {
    // MEASURED, and the reason the predicate is load-bearing rather than
    // decoration: a predicate update carries ONE payload for all N rows
    // (`driver.updateMany` takes one SET clause), so the `completed_at` the
    // hook stamps for a row that IS transitioning is written to every row in
    // the batch — including one that was completed days ago.
    const open = (await newTask({ subject: 'still open' })).id;
    const alreadyDone = (await newTask({ subject: 'done last week' })).id;
    await dispatch(TASK_COMPLETE_ACTION, { recordId: alreadyDone });
    const original = (await read(alreadyDone)).completed_at;
    await tick();

    await data.update('duly_task', { ...COMPLETE_PATCH }, { multi: true, where: { id: { $in: [open, alreadyDone] } } });

    expect(
      (await read(alreadyDone)).completed_at,
      'a done row inside the batch has its completion instant overwritten — which is why the def excludes it',
    ).not.toBe(original);

    // So the declaration has to exclude it, and does.
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
