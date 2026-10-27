// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';

import stack from '../objectstack.config.js';

/**
 * How Duly writes HISTORY — the sanctioned path for seeds, imports and fixtures.
 *
 * A `duly_task` cannot be created in `done` by an ordinary caller: `completed_at`
 * is `readonly`, `beforeInsert` stamps only `last_update_at`, so
 * `completed_at_required_when_done` refuses the row. That is right for the
 * DISPATCH path — tasks are dispatched `open` and completed later — and it stays.
 * It is fatal for the SEED path, which has to write six months of finished work.
 *
 * The answer, measured here rather than assumed, is
 * `{ context: { isSystem: true } }` — the same leg `src/jobs/dispatch.job.ts`
 * already uses, and the leg the platform's own seed loader uses
 * (`SeedLoaderService.SEED_OPTIONS = { isSystem: true, skipTriggers: true,
 * seedReplay: true }`). It takes TWO passes, and the second one is the half that
 * is easy to miss:
 *
 *   completed_at  → carried on the INSERT, from a system context.
 *   last_update_at → CANNOT be carried on an insert at all. `beforeInsert`
 *                    stamps it unconditionally, and lifecycle hooks still run
 *                    on the seed path, so a system insert's value is
 *                    overwritten with the boot clock. It takes a SECOND seed
 *                    pass in `mode: 'update'`.
 *
 * Without that second pass there are no STALLED rows — open tasks whose
 * `last_update_at` is 14+ days old — and the "Not moving" view, the one signal
 * the product claims is its most valuable, is empty on a freshly seeded demo.
 *
 * ── Both directions are pinned, deliberately ─────────────────────────────
 * A test that only proved "the seed may" would quietly turn `readonly: true`
 * into decoration. So each permissive assertion is paired with the refusal it
 * must not have widened: an ordinary caller's IDENTICAL write is still refused
 * by `completed_at_required_when_done`, and their `last_update_at` is still
 * dropped by the readonly strip.
 *
 * ── Which LAYER enforces ─────────────────────────────────────────────────
 * Both verbs, inside ObjectQL, exempted by `isSystem`. Through @objectstack
 * 17.3 the INSERT strip lived only at the API boundary
 * (`MetadataProtocolService.createData`), so `engine.insert` from in-process
 * code kept a caller's readonly value — filed as objectstack#14147 and pinned
 * here as a tripwire. 17.4 moved the create-side strip into the engine, the
 * tripwire went red with the 18 upgrade, and it was deleted as its own comment
 * asked. The refusals below go through `protocol.createData` because that is
 * the door a person's write arrives by; an engine-level test now reads the same.
 */

// ── The seed fixture: relative instants, so "stalled" stays true forever ────
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

/** Comfortably past the 14-day "Not moving" threshold, and still moving with the clock. */
const STALLED_SINCE = daysAgo(45);
/** A completion that happened months ago — the shape #7 backfills by the dozen. */
const COMPLETED_ON = daysAgo(120);

const SEEDED_DONE = 'seeded — filed the Q1 safety return';
const SEEDED_STALLED = 'seeded — chase the overdue calibration';

/**
 * The worked example, and the thing #7 should copy.
 *
 * Three datasets, in this order, all written by the platform's seed loader under
 * its own system context:
 *
 *  1. `sys_user` FIRST. `duly_task.owner` is a user lookup and the seed loader
 *     resolves it as a NATURAL KEY against `sys_user.name`, deferring it to a
 *     second pass. A bare id string that matches no `sys_user` row does not
 *     resolve, and because `owner` is `required: true` the whole task row is
 *     refused — "Owner is required", with the loader also reporting the
 *     unresolved reference. Measured: without this dataset the two task rows
 *     below both fail and nothing is seeded.
 *  2. The tasks, in `mode: 'insert'`, carrying `completed_at`.
 *  3. The SAME tasks again in `mode: 'update'`, matched on `subject`, carrying
 *     only `last_update_at`. This is the pass that creates stalled history.
 */
const userSeed = {
  object: 'sys_user',
  externalId: 'name',
  mode: 'insert',
  records: [
    { name: 'seed_user_alice', email: 'alice@example.invalid' },
  ],
};

const taskSeed = {
  object: 'duly_task',
  externalId: 'subject',
  mode: 'insert',
  records: [
    {
      subject: SEEDED_DONE,
      owner: 'seed_user_alice',
      source: 'catalog',
      status: 'done',
      period_key: '2026-Q1',
      // The whole point: a completion instant, supplied by the seed.
      completed_at: COMPLETED_ON,
    },
    {
      subject: SEEDED_STALLED,
      owner: 'seed_user_alice',
      source: 'catalog',
      status: 'open',
      period_key: '2026-Q2',
      // Supplied here too — and DELIBERATELY expected not to survive. The
      // assertion below proves it does not, which is why pass 3 exists.
      last_update_at: STALLED_SINCE,
    },
  ],
};

const backdateSeed = {
  object: 'duly_task',
  externalId: 'subject',
  mode: 'update',
  records: [
    { subject: SEEDED_DONE, last_update_at: COMPLETED_ON },
    { subject: SEEDED_STALLED, last_update_at: STALLED_SINCE },
  ],
};

const SYSTEM_CONTEXT = { isSystem: true } as const;

let data: any;
let protocol: any;
let kernel: any;

/** A non-seed task payload, used for the boundary assertions. */
const adhoc = (over: Record<string, unknown> = {}) => ({
  subject: 'ad-hoc probe task',
  owner: 'seed_user_alice',
  source: 'catalog',
  ...over,
});

const read = async (id: string) =>
  data.findOne('duly_task', { where: { id } }, { context: SYSTEM_CONTEXT });

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // Same guard as test/task-hook.test.ts: point the artifact lookup at a path
    // that cannot exist, or a local `pnpm build` leaves `dist/objectstack.json`
    // where the kernel will load metadata — objects AND hooks — from the last
    // BUILD instead of from the config imported above.
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
  // skipSeedData FALSE — the real declarative seeder runs, which is the whole
  // path under test. The datasets are supplied here rather than through
  // `src/data/` so that this suite owns its own fixture and does not collide
  // with the app's real seed (#7).
  await kernel.use(
    new AppPlugin(
      { ...(stack as any), data: [userSeed, taskSeed, backdateSeed] } as any,
      undefined,
      { skipSeedData: false },
    ),
  );
  await kernel.bootstrap();
  data = kernel.getService('data');
  protocol = kernel.getService('protocol');
  // The inline seed is kicked off against a budget rather than awaited by
  // bootstrap, so give it a moment to settle before reading its rows.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}, 120_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

const seeded = async (subject: string) =>
  data.findOne('duly_task', { where: { subject } }, { context: SYSTEM_CONTEXT });

// ───────────────────────────────────────────────────────────────────────────
// The sanctioned path
// ───────────────────────────────────────────────────────────────────────────
describe('a declarative seed can write history', () => {
  it('seeds a DONE task carrying its own completion instant', async () => {
    const row = await seeded(SEEDED_DONE);
    expect(row, 'the seeded done task must exist — if it is missing, check that sys_user seeded first').toBeTruthy();
    expect(row.status).toBe('done');
    expect(row.completed_at).toBe(COMPLETED_ON);
  });

  it('seeds a STALLED task — open, and last touched 14+ days ago', async () => {
    const row = await seeded(SEEDED_STALLED);
    expect(row).toBeTruthy();
    expect(row.status).toBe('open');
    expect(row.last_update_at).toBe(STALLED_SINCE);

    // The property the "Not moving" view actually asks for, stated as the view
    // states it rather than as a restatement of the line above.
    const ageDays = (Date.now() - new Date(row.last_update_at as string).getTime()) / DAY;
    expect(ageDays, 'a stalled row must be older than the 14-day threshold').toBeGreaterThan(14);
  });

  it('needed the second pass: an INSERT cannot carry last_update_at, whatever the context', async () => {
    // The reason `backdateSeed` exists. `beforeInsert` stamps `last_update_at`
    // unconditionally, and lifecycle hooks DO run on the seed path —
    // `skipTriggers` suppresses record-change AUTOMATION, not hooks. So the
    // value `taskSeed` supplied for SEEDED_STALLED was overwritten with the
    // boot clock, and only the `mode: 'update'` pass put history back.
    //
    // If this ever fails, `beforeInsert` has become context-aware and the
    // two-pass shape in AGENTS.md should be revisited — it is no longer needed.
    const fresh = await protocol.createData({
      object: 'duly_task',
      data: adhoc({ subject: 'insert cannot backdate', status: 'open', last_update_at: STALLED_SINCE }),
      context: SYSTEM_CONTEXT,
    });
    expect(fresh.record.last_update_at).not.toBe(STALLED_SINCE);
    const age = Date.now() - new Date(fresh.record.last_update_at as string).getTime();
    expect(age, 'beforeInsert overwrote it with now').toBeLessThan(60_000);
  });

  it('a system-context INSERT does carry completed_at', async () => {
    // The other half, on the write face rather than through the seed loader —
    // this is what an import (#19) or a fixture author calls directly.
    const created = await protocol.createData({
      object: 'duly_task',
      data: adhoc({ subject: 'system insert done', status: 'done', completed_at: COMPLETED_ON }),
      context: SYSTEM_CONTEXT,
    });
    expect(created.droppedFields ?? null, 'nothing may be stripped from a system write').toBeNull();
    expect(created.record.status).toBe('done');
    expect((await read(created.id)).completed_at).toBe(COMPLETED_ON);
  });

  it('a system-context UPDATE carries last_update_at — the second pass, unwrapped', async () => {
    const created = await protocol.createData({
      object: 'duly_task',
      data: adhoc({ subject: 'system update backdate', status: 'open' }),
      context: SYSTEM_CONTEXT,
    });
    const updated = await protocol.updateData({
      object: 'duly_task',
      id: created.id,
      data: { last_update_at: STALLED_SINCE },
      context: SYSTEM_CONTEXT,
    });
    expect(updated.droppedFields ?? null).toBeNull();
    expect((await read(created.id)).last_update_at).toBe(STALLED_SINCE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The refusal that must survive it
// ───────────────────────────────────────────────────────────────────────────
describe('an ordinary caller still may not', () => {
  it('create a done task — the IDENTICAL payload a system caller just committed', async () => {
    // This is the assertion that keeps "seeds may" from becoming "readonly
    // means nothing". Same object, same fields, same completion instant; the
    // ONLY difference from the passing case above is the missing context.
    const payload = adhoc({ subject: 'caller insert done', status: 'done', completed_at: COMPLETED_ON });

    let error: any;
    try {
      await protocol.createData({ object: 'duly_task', data: payload });
    } catch (e) {
      error = e;
    }

    expect(error, 'a non-system caller must NOT be able to create history').toBeDefined();
    // Assert the envelope, not merely that something threw: an unrelated fault
    // (a missing required field, a store outage) would also throw here and
    // would read as this rule holding.
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.name).toBe('ValidationError');
    // The wording is the contract on this one — it is what a user would see.
    expect(error.message).toMatch(/completion timestamp/i);

    // And nothing was written.
    const rows = await data.find(
      'duly_task',
      { where: { subject: 'caller insert done' } },
      { context: SYSTEM_CONTEXT },
    );
    expect(rows.length).toBe(0);
  });

  it('is refused just the same with an explicit non-system context', async () => {
    // `isSystem: false` spelled out, not merely absent — so the exemption is
    // pinned to the flag's VALUE and not to the key being missing.
    let error: any;
    try {
      await protocol.createData({
        object: 'duly_task',
        data: adhoc({ subject: 'explicit non-system done', status: 'done', completed_at: COMPLETED_ON }),
        context: { userId: 'seed_user_alice', isSystem: false },
      });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe('VALIDATION_FAILED');
    expect(error?.message).toMatch(/completion timestamp/i);
  });

  it('backdate last_update_at — the strip drops it and says so', async () => {
    const created = await protocol.createData({
      object: 'duly_task',
      data: adhoc({ subject: 'caller backdate attempt', status: 'open' }),
      context: SYSTEM_CONTEXT,
    });
    const before = (await read(created.id)).last_update_at;

    const updated = await protocol.updateData({
      object: 'duly_task',
      id: created.id,
      data: { last_update_at: STALLED_SINCE },
    });

    // The boundary reports the drop rather than failing — so the caller's write
    // "succeeds" and the column does not move. Pinning the report as well as
    // the stored value is what makes this legible when it fires.
    expect(updated.droppedFields).toEqual([
      { object: 'duly_task', fields: ['last_update_at'], reason: 'readonly' },
    ]);
    expect((await read(created.id)).last_update_at).toBe(before);
  });
});
