// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, buildContextForUser } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';

import { ADMIN, ADMIN_PERMISSION_SETS } from '../src/data/demo-org.js';

/**
 * The account `pnpm demo` signs you in as can run every action the app
 * declares (#152; #60's scope 3).
 *
 * Every action test in this repo can pass while the person trying the demo
 * cannot see a single action: the actions are gated on app-declared `duly.*`
 * capabilities (`requiredPermissions`), the console hides what the server
 * would refuse, and the demo account is a PLATFORM admin that held no Duly set
 * — so My week showed Edit and Delete, and `POST …/duly_task_complete/ID`
 * answered `403 PERMISSION_DENIED`. Nothing errored anywhere.
 *
 * So this asks the question the server asks, end to end:
 *
 *  - **What is required** is read off the action metadata — every declared
 *    action's `requiredPermissions`, top-level and object-bound alike — never a
 *    hand list, so a new action gated on a new capability goes red here until
 *    the demo account can reach it.
 *  - **What is held** comes from the platform's own resolver,
 *    `buildContextForUser` — the function every inbound request resolves its
 *    execution context through — over the rows the demo seed ACTUALLY wrote,
 *    in the organization the seed's system write was stamped with. Its
 *    `systemPermissions` is the list the action door checks
 *    `requiredPermissions` against.
 *
 * The demo is opt-in (see `src/data/index.ts`), so the variable is set before
 * the config is imported — the same pattern, and the same reason, as
 * `test/seed.test.ts`.
 */
const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';

const SYSTEM = { isSystem: true } as const;

type Action = { name: string; requiredPermissions?: readonly string[] };

let kernel: any;
let data: any;
let ql: any;
let stack: { actions?: Action[]; objects?: { actions?: Action[] }[] };

const all = async (object: string, where: Record<string, unknown> = {}): Promise<any[]> =>
  (await data.find(object, { where }, { context: SYSTEM })) ?? [];

/** Every declared action, by name: the stack's own list plus any merged onto an object. */
const declaredActions = (): Action[] => {
  const byName = new Map<string, Action>();
  for (const action of stack.actions ?? []) byName.set(action.name, action);
  for (const object of stack.objects ?? []) {
    for (const action of object.actions ?? []) byName.set(action.name, action);
  }
  return [...byName.values()];
};

beforeAll(async () => {
  vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
  stack = (await import('../objectstack.config.js')).default as unknown as typeof stack;

  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // Same guard as `test/seed.test.ts`: never load a stale `pnpm build`.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(createIdentityObjectsPlugin());
  await kernel.use(new SharingServicePlugin());
  // `sys_user_permission_set` and the resolver that reads it — mounted on
  // every real boot.
  await kernel.use(new SecurityPlugin());
  await kernel.use(new AppPlugin(stack as any, undefined, { skipSeedData: false }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  ql = kernel.getService('objectql');

  // The inline seed can outlive bootstrap; wait for the grants themselves.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const grants = await all('sys_user_permission_set');
    if (grants.length >= ADMIN_PERMISSION_SETS.length) break;
    if (Date.now() > deadline) throw new Error(`seed did not settle: ${grants.length} grants after 120s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
  vi.unstubAllEnvs();
});

describe('the demo sign-in account', () => {
  it('reads its requirement off the action metadata, and finds one', () => {
    const required = new Set(declaredActions().flatMap((action) => action.requiredPermissions ?? []));
    // A derivation that came back empty would make the next test vacuous.
    expect(required.has('duly.task.update_status')).toBe(true);
  });

  it('is granted its Duly sets once, not once per boot', async () => {
    const [admin] = await all('sys_user', { name: ADMIN });
    const grants = await all('sys_user_permission_set', { user_id: admin.id });
    expect(grants.map((grant) => grant.permission_set).sort()).toEqual([...ADMIN_PERMISSION_SETS].sort());
  });

  it('holds every capability a declared action requires', async () => {
    const admins = await all('sys_user', { name: ADMIN });
    expect(admins, `exactly one sys_user named ${ADMIN}`).toHaveLength(1);
    const grants = await all('sys_user_permission_set', { user_id: admins[0].id });
    const organizations = [...new Set(grants.map((grant) => grant.organization_id))];
    expect(organizations, 'every grant stamped with one organization').toHaveLength(1);

    const context = await buildContextForUser(ql, String(admins[0].id), Date.now(), organizations[0]);
    const held = new Set<string>(context?.systemPermissions ?? []);

    const unreachable = declaredActions()
      .map((action) => ({
        action: action.name,
        missing: (action.requiredPermissions ?? []).filter((permission) => !held.has(permission)),
      }))
      .filter((entry) => entry.missing.length > 0);
    expect(unreachable, 'actions the demo account would be refused').toEqual([]);
  });
});
