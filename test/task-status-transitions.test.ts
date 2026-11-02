// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpDispatcherResult, HttpProtocolContext } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';

import stack from '../objectstack.config.js';
import { Task } from '../src/objects/index.js';
import { demoSeeds } from '../src/data/index.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import {
  ACTIONABLE_STATUSES,
  TASK_COMPLETE_ACTION,
  TASK_OBJECT,
  TASK_SKIP_ACTION,
  TASK_UNDO_ACTION,
  UNDOABLE_STATUSES,
  UNDO_PATCH,
} from '../src/actions/task.handlers.js';
import { runDispatch, unbindDispatchEngine } from '../src/jobs/dispatch.job.js';
import { ensureUsers } from './support/users.js';

/**
 * `duly_task.status` — the declared transition rule (#162).
 *
 * An outcome (`done`, `skipped`, `cancelled`) is what happened to a task, and
 * every rate and lens in the product counts over it. The rule declares the
 * legal moves on the object, so it holds on every door rather than on the one
 * a handler guarded. This suite proves that claim door by door, against a real
 * booted engine on sqlite with the app's own `objectstack.config.ts`:
 *
 *  - **REST action** — `HttpDispatcher.handleActions`, the `/actions` handler
 *    the console's `POST /api/v1/actions/duly_task/<action>/<id>` lands on.
 *  - **Data PATCH** — `HttpDispatcher.handleData`, the `/data` handler behind
 *    `PATCH /api/v1/data/duly_task/<id>`.
 *  - **MCP** — `HttpDispatcher.buildMcpBridge`, the in-process bridge the MCP
 *    server's tools call. Its `update` is the data tool; `runAction` is the
 *    action tool, which does not reach the task actions at all (they are not
 *    `ai.exposed`), so the data tool is the MCP door that can move a status.
 *
 * And the reversals the product ships (toast Undo on complete and on skip, the
 * Undo row action) are driven through the same doors they really use, so a
 * table that forgot one goes red here before it strands a user's undo.
 */

let data: any;
let kernel: any;
let dispatcher: HttpDispatcher;

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // Never a build artifact: this suite reports on `src/`.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(createIdentityObjectsPlugin());
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  await ensureUsers(data, ['user_alice', 'user_owner']);
  registerDulyActionHandlers(data);
  dispatcher = new HttpDispatcher(kernel);
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const STATUSES = ['open', 'in_progress', 'done', 'skipped', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];

/** The table, as declared. Read off the object so the suite tests the real rule. */
const rule = (): any =>
  ((Task as any).validations ?? []).find((v: any) => v?.name === 'status_transitions');

const UPDATE_STATUS = 'duly.task.update_status';
const ALICE: HttpProtocolContext = {
  request: {},
  executionContext: { userId: 'user_alice', systemPermissions: [UPDATE_STATUS] },
};

/**
 * A task already in `status`, written the way history is written: a system
 * insert carrying `completed_at` for a done row (AGENTS.md "How to write
 * history"). The rule has no `initialStates`, so any status may be inserted;
 * what it governs is the move out.
 */
const taskIn = async (status: Status): Promise<string> => {
  const row = await data.insert(
    'duly_task',
    {
      subject: `A ${status} task`,
      owner: 'user_alice',
      source: 'catalog',
      status,
      ...(status === 'done' ? { completed_at: new Date().toISOString() } : {}),
      ...(status === 'skipped' ? { skip_reason: 'Plant down' } : {}),
    },
    { context: { isSystem: true } },
  );
  return String(row.id);
};

const read = async (id: string) => data.findOne('duly_task', { where: { id } });

/** The payload a caller sends to move a task to `to`. A skip carries its reason. */
const moveTo = (to: Status): Record<string, unknown> =>
  to === 'skipped' ? { status: to, skip_reason: 'Plant down' } : { status: to };

/** Is `from → to` legal by the declared table? `from === to` is not a transition. */
const legal = (from: Status, to: Status): boolean =>
  from === to || (rule().transitions[from] as string[]).includes(to);

type Response = NonNullable<HttpDispatcherResult['response']>;

const act = async (action: string, id: string, params: Record<string, unknown> = {}): Promise<Response> =>
  (await dispatcher.handleActions(`/${TASK_OBJECT}/${action}/${id}`, 'POST', { params }, ALICE)).response as Response;

/**
 * The data PATCH door. `handleData` answers a success as a response and lets a
 * write refusal THROW — the HTTP adapter maps the thrown `ValidationError` to
 * the 400 envelope (the top-level `dispatch` re-throws it unchanged). So a
 * refusal is returned here as the thrown error, and the assertion reads the
 * rule's own field error off it.
 */
const patch = async (id: string, body: Record<string, unknown>): Promise<Response | { thrown: any }> => {
  try {
    return (await dispatcher.handleData(`/${TASK_OBJECT}/${id}`, 'PATCH', body, {}, ALICE)).response as Response;
  } catch (thrown) {
    return { thrown };
  }
};

const patchOk = async (id: string, body: Record<string, unknown>) => {
  const result = await patch(id, body);
  expect('thrown' in result ? String(result.thrown?.message) : '', 'the PATCH must not be refused').toBe('');
  expectOk(result as Response);
};

const patchRefused = async (id: string, body: Record<string, unknown>, from: string, to: string) => {
  const result = await patch(id, body);
  expect('thrown' in result, `the PATCH must be refused: ${JSON.stringify(result)}`).toBe(true);
  const thrown = (result as { thrown: any }).thrown;
  expect(thrown.name).toBe('ValidationError');
  expect(thrown.code ?? 'VALIDATION_FAILED').toBe('VALIDATION_FAILED');
  expectRefusedMove(thrown.fields, from, to);
};

const mcp = () => (dispatcher as any).buildMcpBridge(ALICE);

/** Assert the rule's own refusal — its code and its from/to — never just "it failed". */
const expectRefusedMove = (fields: any[] | undefined, from: string, to: string) => {
  const field = (fields ?? []).find((f: any) => f?.field === 'status');
  expect(field, JSON.stringify(fields)).toBeDefined();
  expect(field.code).toBe('invalid_transition');
  expect(field.constraint).toEqual({ from, to });
};

const expectRefusedResponse = (response: Response, from: string, to: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(400);
  expect(response.body?.error?.code).toBe('VALIDATION_FAILED');
  expectRefusedMove(response.body?.error?.details?.fields, from, to);
};

const expectOk = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
};

// ── The table ───────────────────────────────────────────────────────────────

describe('the declared rule', () => {
  it('is a state_machine rule on status, at error severity', () => {
    expect(rule(), 'status_transitions must be declared on duly_task').toBeDefined();
    expect(rule().type).toBe('state_machine');
    expect(rule().field).toBe('status');
    expect(rule().severity).toBe('error');
  });

  it('writes a row for EVERY status option — a missing row would accept any move out of it', () => {
    const options = ((Task as any).fields.status.options as Array<{ value: string }>).map((o) => o.value);
    expect([...options].sort()).toEqual([...STATUSES].sort());
    for (const status of options) {
      expect(Array.isArray(rule().transitions[status]), `transitions.${status} must be an array`).toBe(true);
    }
  });

  it('is exactly the table #162 measured', () => {
    expect(rule().transitions).toEqual({
      open: ['in_progress', 'done', 'skipped', 'cancelled'],
      in_progress: ['open', 'done', 'skipped', 'cancelled'],
      done: ['open', 'in_progress'],
      skipped: ['open', 'in_progress'],
      cancelled: [],
    });
  });

  it('the live states are the ones complete and skip are offered from, and they reach every outcome', () => {
    for (const live of ACTIONABLE_STATUSES) {
      expect(rule().transitions[live]).toEqual(expect.arrayContaining(['done', 'skipped', 'cancelled']));
    }
  });

  it('an outcome moves only back to a live state — never to another outcome', () => {
    for (const outcome of ['done', 'skipped', 'cancelled']) {
      for (const to of rule().transitions[outcome] as string[]) {
        expect(ACTIONABLE_STATUSES, `${outcome} → ${to}`).toContain(to);
      }
    }
  });

  it('cancelled is terminal: nothing in the product reverses a cancel', () => {
    expect(rule().transitions.cancelled).toEqual([]);
  });

  it('declares no initialStates — the insert door is out of scope, and the seed inserts every status', () => {
    expect(rule().initialStates).toBeUndefined();
  });
});

// ── Every pair, on the engine ───────────────────────────────────────────────

describe('every from → to pair, as the task owner', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const verdict = legal(from, to) ? 'accepted' : 'refused';
      it(`${from} → ${to} is ${verdict}`, async () => {
        const id = await taskIn(from);
        const write = data.update('duly_task', moveTo(to), { where: { id }, context: { userId: 'user_alice' } });
        if (legal(from, to)) {
          await write;
          expect((await read(id)).status).toBe(to);
        } else {
          const error: any = await write.then(
            () => null,
            (e: unknown) => e,
          );
          expect(error, `${from} → ${to} must be refused`).not.toBeNull();
          expectRefusedMove(error.fields, from, to);
          expect((await read(id)).status, 'nothing written').toBe(from);
        }
      });
    }
  }
});

// ── The three doors ─────────────────────────────────────────────────────────

describe('door 1 — the REST action route', () => {
  it('refuses completing a cancelled task', async () => {
    const id = await taskIn('cancelled');
    expectRefusedResponse(await act(TASK_COMPLETE_ACTION, id), 'cancelled', 'done');
    const row = await read(id);
    expect(row.status).toBe('cancelled');
    expect(row.completed_at ?? null).toBeNull();
  });

  it('refuses skipping a done task', async () => {
    const id = await taskIn('done');
    expectRefusedResponse(await act(TASK_SKIP_ACTION, id, { skip_reason: 'Changed my mind' }), 'done', 'skipped');
    expect((await read(id)).status).toBe('done');
  });

  it('allows open → done', async () => {
    const id = await taskIn('open');
    expectOk(await act(TASK_COMPLETE_ACTION, id));
    const row = await read(id);
    expect(row.status).toBe('done');
    expect(row.completed_at).toBeTruthy();
  });
});

describe('door 2 — the data PATCH', () => {
  it('refuses cancelled → done', async () => {
    const id = await taskIn('cancelled');
    await patchRefused(id, { status: 'done' }, 'cancelled', 'done');
    expect((await read(id)).status).toBe('cancelled');
  });

  it('refuses skipped → done', async () => {
    const id = await taskIn('skipped');
    await patchRefused(id, { status: 'done' }, 'skipped', 'done');
    expect((await read(id)).status).toBe('skipped');
  });

  it('allows open → done', async () => {
    const id = await taskIn('open');
    await patchOk(id, { status: 'done' });
    expect((await read(id)).status).toBe('done');
  });

  it('a save that re-sends the same outcome is not a transition and is accepted', async () => {
    // Every whole-record form submit on a done task carries `status: 'done'`.
    const id = await taskIn('done');
    await patchOk(id, { status: 'done', note: 'Filed with the regulator' });
    expect((await read(id)).note).toBe('Filed with the regulator');
  });
});

describe('door 3 — MCP', () => {
  it('the data tool refuses cancelled → done', async () => {
    const id = await taskIn('cancelled');
    const error: any = await mcp()
      .update(TASK_OBJECT, id, { status: 'done' })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error, 'the MCP data tool must refuse').not.toBeNull();
    expectRefusedMove(error.fields ?? error.details?.fields, 'cancelled', 'done');
    expect((await read(id)).status).toBe('cancelled');
  });

  it('the data tool allows open → done', async () => {
    const id = await taskIn('open');
    await mcp().update(TASK_OBJECT, id, { status: 'done' });
    expect((await read(id)).status).toBe('done');
  });

  it('the action tool does not reach the task actions at all — they are not ai.exposed', async () => {
    // So the data tool above is the one MCP door that can move a status.
    const id = await taskIn('cancelled');
    const error: any = await mcp()
      .runAction(TASK_COMPLETE_ACTION, { objectName: TASK_OBJECT, recordId: id })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).not.toBeNull();
    expect(String(error.message)).toMatch(/not exposed to AI/);
    expect((await read(id)).status).toBe('cancelled');
  });
});

// ── The reversals the product ships ─────────────────────────────────────────

describe('every shipped reversal is still allowed', () => {
  /**
   * The toast Undo, the way the console performs it: the route returns an
   * envelope built from the row it ran on, and Undo is a data-plane update of
   * `undoData` as the caller (`@objectstack/console` 18.2.0 `UndoManager` →
   * `dataSource.update`). Driven here through the data PATCH door, which is
   * the request the click makes.
   */
  const toastUndo = async (action: string, from: Status, params: Record<string, unknown> = {}) => {
    const id = await taskIn(from);
    const response = await act(action, id, params);
    expectOk(response);
    const undo = response.body?.data?.undo;
    expect(undo?.undoData?.status, 'the envelope restores the prior status').toBe(from);
    await patchOk(id, undo.undoData);
    return read(id);
  };

  it('complete from open, then toast Undo: done → open', async () => {
    const row = await toastUndo(TASK_COMPLETE_ACTION, 'open');
    expect(row.status).toBe('open');
    expect(row.completed_at ?? null).toBeNull();
  });

  it('complete from in_progress, then toast Undo: done → in_progress', async () => {
    const row = await toastUndo(TASK_COMPLETE_ACTION, 'in_progress');
    expect(row.status).toBe('in_progress');
    expect(row.completed_at ?? null).toBeNull();
  });

  it('skip from open, then toast Undo: skipped → open, reason cleared', async () => {
    const row = await toastUndo(TASK_SKIP_ACTION, 'open', { skip_reason: 'Plant down' });
    expect(row.status).toBe('open');
    expect(row.skip_reason ?? null).toBeNull();
  });

  it('skip from in_progress, then toast Undo: skipped → in_progress, reason cleared', async () => {
    const row = await toastUndo(TASK_SKIP_ACTION, 'in_progress', { skip_reason: 'Plant down' });
    expect(row.status).toBe('in_progress');
    expect(row.skip_reason ?? null).toBeNull();
  });

  it('the Undo row action: done → in_progress', async () => {
    expect(UNDOABLE_STATUSES).toEqual(['done']);
    expect(rule().transitions.done).toContain(UNDO_PATCH.status);
    const id = await taskIn('done');
    expectOk(await act(TASK_UNDO_ACTION, id));
    const row = await read(id);
    expect(row.status).toBe(UNDO_PATCH.status);
    expect(row.completed_at ?? null).toBeNull();
  });
});

// ── The system writers ──────────────────────────────────────────────────────

describe('the system writers, checked against the rule', () => {
  it('an isSystem write is NOT exempt — the rule binds trusted code too', async () => {
    // The Undo handler's `ctx.engine` and the dispatcher both write with
    // `isSystem`. Neither needs an exemption (below), and none is granted.
    const id = await taskIn('cancelled');
    const error: any = await data
      .update('duly_task', { status: 'done' }, { where: { id }, context: { isSystem: true } })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).not.toBeNull();
    expectRefusedMove(error.fields, 'cancelled', 'done');
  });

  it('the platform\'s historical doors are exempt: seedReplay (the seed loader) and skipStateMachine (import)', async () => {
    for (const context of [{ isSystem: true, seedReplay: true }, { isSystem: true, skipStateMachine: true }]) {
      const id = await taskIn('cancelled');
      await data.update('duly_task', { status: 'open' }, { where: { id }, context });
      expect((await read(id)).status, JSON.stringify(context)).toBe('open');
    }
  });

  it('the demo seed\'s update passes never write status — they only backdate the clock', () => {
    // The insert passes are untouched by the rule (no `initialStates`), and
    // they run under `seedReplay` regardless. An update pass that carried
    // `status` would be the one seed write the table could see.
    const taskPasses = demoSeeds.filter((seed: any) => seed.object === TASK_OBJECT);
    expect(taskPasses.length).toBeGreaterThan(0);
    for (const seed of taskPasses as any[]) {
      if (seed.mode !== 'update') continue;
      for (const record of seed.records) expect(Object.keys(record)).not.toContain('status');
    }
  });

  describe('the dispatcher', () => {
    const duties: string[] = [];
    afterEach(async () => {
      unbindDispatchEngine();
      while (duties.length > 0) {
        await data.update('duly_duty', { status: 'retired' }, { where: { id: duties.pop() }, multi: false });
      }
    });

    it('re-running over a period whose task was cancelled leaves it cancelled and the run clean', async () => {
      const duty = await data.insert(
        'duly_duty',
        {
          name: 'Monthly safety return',
          form: 'recurring',
          owner: 'user_owner',
          source: 'catalog',
          status: 'active',
          frequency: 'monthly',
          due_anchor: 'period_start',
          due_offset_days: 4,
          lead_days: 0,
          timezone: 'UTC',
          review_status: 'approved',
        },
        // An approved duty is established history; `skipStateMachine` is the
        // import's door past the duty's own `initialStates` (see dispatch.test.ts).
        { context: { skipStateMachine: true } },
      );
      duties.push(String(duty.id));
      const now = new Date('2026-08-15T09:00:00Z');

      const first = await runDispatch(data, { now });
      expect(first.created).toBeGreaterThan(0);
      const [task] = await data.find('duly_task', { where: { duty: duty.id } });
      expect(task.status, 'the dispatcher creates open tasks only').toBe('open');

      await data.update('duly_task', { status: 'cancelled' }, { where: { id: task.id }, context: { userId: 'user_owner' } });

      const second = await runDispatch(data, { now });
      expect(second.degradedReason).toBeUndefined();
      expect(second.created).toBe(0);
      const after = await data.find('duly_task', { where: { duty: duty.id } });
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe('cancelled');
    });
  });
});
