// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DemoStaffSchema, type DemoStaff } from '@objectstack/spec/system';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_SEED_ENV_VAR } from '../src/data/index.js';

/**
 * `defineStack({ demoStaff })` is what makes `pnpm demo` one boot (#131).
 *
 * A stack that declares demo accounts has its inline seed deferred until
 * after `@objectstack/plugin-auth` has minted the admin and the accounts, so
 * the seed's `sys_user` rows land on live accounts instead of inserting
 * credential-less copies. Each assertion below is a way that breaks with
 * every gate green:
 *
 *  - declared on `pnpm dev`: twelve known-password accounts in a database
 *    that was meant to hold nobody but the admin;
 *  - NOT declared on `pnpm demo`: the seed runs first again, and the admin
 *    you sign in as owns none of the demo's work;
 *  - a name that is not the seed's: the seed inserts a second person under
 *    the fixture's name, and the account that can sign in owns nothing;
 *  - the admin's address in the list: plugin-auth refuses every entry, since
 *    it creates demo accounts only once an account outside the list can sign in.
 *
 * Like `demo-seed-opt-in.test.ts`, it reads the CONFIG as well as the barrel,
 * because the platform reads `demoStaff` off the config, not the artifact.
 */

type UserRow = { name: string; email?: string };

const load = async () => {
  vi.resetModules();
  const barrel = await import('../src/data/index.js');
  const stack = (await import('../objectstack.config.js')).default as {
    demoStaff?: DemoStaff[];
    positions?: { name: string }[];
    permissions?: { name: string }[];
  };
  return { barrel, stack };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('demoStaff follows the demo gate', () => {
  it('declares no demo account when nothing asked for the demo', async () => {
    const { barrel, stack } = await load();
    expect(barrel.dulyDemoStaff).toEqual([]);
    expect(stack.demoStaff ?? []).toEqual([]);
  });

  it('declares the twelve, on the stack itself, when the demo is asked for', async () => {
    vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
    const { barrel, stack } = await load();
    expect(stack.demoStaff).toHaveLength(12);
    expect(stack.demoStaff).toEqual(barrel.dulyDemoStaff);
  });
});

describe.each(['', 'zh-CN'])('the declared accounts agree with the seed (locale %j)', (locale) => {
  const loadDemo = async () => {
    vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
    vi.stubEnv('DULY_DEMO_LOCALE', locale);
    const { barrel, stack } = await load();
    const { ADMIN } = await import('../src/data/demo-org.js');
    const users = barrel.userSeed.records as UserRow[];
    return { staff: stack.demoStaff ?? [], stack, users, admin: ADMIN };
  };

  it('every entry is a valid demoStaff entry', async () => {
    const { staff } = await loadDemo();
    for (const entry of staff) expect(() => DemoStaffSchema.parse(entry)).not.toThrow();
  });

  it('is exactly the seeded people other than the admin, by name and address', async () => {
    const { staff, users, admin } = await loadDemo();
    const people = users.filter((user) => user.name !== admin);
    expect(staff.map((entry) => [entry.name, entry.email])).toEqual(people.map((user) => [user.name, user.email]));
  });

  it('leaves the admin out, by name and by address', async () => {
    const { staff, admin } = await loadDemo();
    expect(staff.map((entry) => entry.name)).not.toContain(admin);
    // plugin-auth's default seed address; the demo never changes it.
    expect(staff.map((entry) => entry.email.toLowerCase())).not.toContain('admin@objectos.ai');
  });

  it('names only positions and permission sets this stack declares', async () => {
    const { staff, stack } = await loadDemo();
    const positions = new Set((stack.positions ?? []).map((position) => position.name));
    const sets = new Set((stack.permissions ?? []).map((set) => set.name));
    for (const entry of staff) {
      if (entry.position) expect(positions).toContain(entry.position);
      // Everyone owns duties, so everyone can open their own week.
      expect(entry.permissionSets).toContain('duly_member');
      for (const set of entry.permissionSets ?? []) expect(sets).toContain(set);
    }
  });
});
