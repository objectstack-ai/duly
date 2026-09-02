// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stackConfig, { onEnable } from '../objectstack.config.js';
import { DISPATCH_JOB_NAME, dulyDispatch, unbindDispatchEngine } from '../src/jobs/dispatch.job.js';

/**
 * Issue #42 — the dispatch engine is actually wired, not just wireable.
 *
 * Every other dispatch assertion in this repo (`test/dispatch.test.ts`) calls
 * `bindDispatchEngine(data)` itself, by hand, before touching `dulyDispatch`.
 * That is deliberately right for testing the PLANNER and the idempotency
 * index — but it means that suite would keep passing GREEN even if
 * `registerDulyActionHandlers` never called `bindDispatchEngine` at all, i.e.
 * even if this issue's fix were reverted. A test-side bind papers over
 * exactly the gap #42 exists to close.
 *
 * So this file boots the app the way a real host does — through
 * `defineStack({ onEnable })` — and never calls `bindDispatchEngine` itself.
 * If the wiring in `src/actions/register-handlers.ts` is missing, this file
 * fails with "Job 'duly_dispatch' has no data engine", not with a false
 * green.
 *
 * ── Reproducing the real onEnable-merge, not `new AppPlugin(stack)` ────────
 * `objectstack.config.ts` exports `defineStack(...)` as `default` and
 * `onEnable` as a SEPARATE named export sitting beside it — `defineStack`
 * itself is never handed `onEnable`. Measured on `@objectstack/runtime`
 * 17.2.0, `AppPlugin` only invokes `onEnable` when it is a property of the
 * bundle object it was constructed with (`this.bundle`), and measured on
 * `@objectstack/cli` 17.2.0 `serve.ts`, the CLI gets there by merging the
 * module's named exports onto its default export before constructing
 * `AppPlugin` — a comment there spells out why: "Without this AppPlugin can
 * never invoke runtime hooks declared as `export const onEnable = ...`
 * alongside the default `defineStack(...)` export." `test/task-actions.test.ts`
 * hits the same fact from the other side, passing only the default export and
 * noting `onEnable` is therefore never invoked, and registering handlers by
 * hand instead.
 *
 * This test does what the CLI does — `{ ...stackConfig, onEnable }` — so
 * `AppPlugin` finds `onEnable` on the bundle exactly as `objectstack dev`
 * would, and this is the one file in the repo that boots the config the way
 * a real host does.
 */

let kernel: { getService(name: string): unknown; shutdown?(): Promise<void> } | undefined;
let data: {
  find(o: string, q?: Record<string, unknown>, x?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  insert(o: string, d: Record<string, unknown>, x?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

beforeAll(async () => {
  // Defensive only: vitest gives each test FILE its own module registry, so
  // this module-scope binding cannot see another file's leftover state. This
  // just guards against booting on top of a bind this file did not make.
  unbindDispatchEngine();

  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Left to its default this resolves `<cwd>/dist/objectstack.json`; a local
    // `pnpm build` would then make this suite report on the last BUILD rather
    // than on `src/`, passing with the wiring reverted. Same guard as the
    // sibling suites, for the same reason.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  const k = new ObjectKernel();
  for (const plugin of plugins) await k.use(plugin);

  // The merge under test: the config's `default` export plus its `onEnable`
  // named export, exactly as `objectstack serve`/`objectstack dev` load it —
  // NOT `new AppPlugin(stackConfig)` alone, which is the shape
  // `test/task-actions.test.ts` uses precisely because it does NOT want
  // `onEnable` invoked.
  const bundle = { ...stackConfig, onEnable };
  await k.use(new AppPlugin(bundle, undefined, { skipSeedData: true }));
  await k.bootstrap();

  kernel = k as unknown as typeof kernel;
  data = k.getService('data') as typeof data;
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
  unbindDispatchEngine();
});

describe('the dispatch engine is bound at boot, through the real onEnable path', () => {
  it('dulyDispatch runs against the real engine with no test-side bindDispatchEngine call', async () => {
    const created = await data.insert('duly_duty', {
      name: 'File the emissions return',
      form: 'recurring',
      owner: 'user_alice',
      source: 'catalog',
      status: 'active',
      frequency: 'monthly',
      due_anchor: 'period_start',
      due_offset_days: 4,
      lead_days: 0,
      timezone: 'UTC',
      // Only an APPROVED duty dispatches (#107). Written straight, through
      // the platform's own historical-write door — `skipStateMachine` is what
      // the REST import endpoint sets for `treatAsHistorical`, and what the
      // seed loader reaches via `seedReplay`; the pipeline itself is exercised
      // by ordinary writes in `test/duty-review.test.ts`. Without this the
      // duty is born `to_confirm` and this suite would report the wiring
      // broken when what is actually true is that nobody approved anything.
      review_status: 'approved',
    }, { context: { skipStateMachine: true } });
    const dutyId = String((Array.isArray(created) ? created[0] : created).id);

    // If `registerDulyActionHandlers` never called `bindDispatchEngine`, this
    // throws "Job 'duly_dispatch' has no data engine …" — see
    // `requireDispatchEngine` in dispatch.job.ts. It does not, because
    // `onEnable` ran during `bootstrap()` above and bound the real `ql`.
    const outcome = await dulyDispatch({ jobId: DISPATCH_JOB_NAME });
    expect(outcome.outcome).toBe('completed');

    const tasks = await data.find('duly_task', { where: { duty: dutyId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      duty: dutyId,
      owner: 'user_alice',
      status: 'open',
    });
  });
});
