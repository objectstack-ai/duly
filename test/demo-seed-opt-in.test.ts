// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_SEED_ENV_VAR } from '../src/data/index.js';

/**
 * The default seed is EMPTY, and stays empty.
 *
 * `pnpm dev` opens an empty Duly you put your own duties into; `pnpm demo`
 * opens the fictional manufacturer. That split is a product decision (argued
 * where the gate lives, in `src/data/index.ts`), and the thing that erodes it
 * is not a rewrite — it is one convenient row at a time. A single
 * "just the org units, they're harmless" dataset in the default path puts a
 * stranger's company back into every fresh deployment, and, because
 * `@objectstack/plugin-auth` only mints the dev admin on a ZERO-USER database,
 * a single `sys_user` row there also takes the login with it.
 *
 * So this suite asserts the shape rather than the story: what the running app
 * is handed by default, what the flag turns on, and that the flag is the only
 * thing that turns it on.
 *
 * Note the assertions are against `stack.data` — what `defineStack` actually
 * installs — and not only against the barrel's export. Wiring the config to
 * `demoSeeds` instead of `dulySeeds` would leave every barrel-level assertion
 * green and put all 459 rows back in the default path.
 */

/** Datasets, whatever the surface calls them. */
type Dataset = { object: string; records: readonly unknown[] };

const rowsIn = (datasets: readonly Dataset[]): number =>
  datasets.reduce((total, dataset) => total + dataset.records.length, 0);

/** A fresh evaluation of the barrel, reading the environment as it is now. */
const loadBarrel = async () => {
  vi.resetModules();
  return import('../src/data/index.js');
};

/** A fresh evaluation of the whole config, ditto. */
const loadStackData = async (): Promise<readonly Dataset[]> => {
  vi.resetModules();
  const stack = (await import('../objectstack.config.js')).default;
  return ((stack as { data?: readonly Dataset[] }).data ?? []) as readonly Dataset[];
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ───────────────────────────────────────────────────────────────────────────
describe('the default seed is empty', () => {
  it('installs no datasets at all when nothing asked for the demo', async () => {
    const { dulySeeds } = await loadBarrel();
    // Not "no users" — nothing. A default seed that still wrote duties into a
    // fresh deployment would be the same product mistake at a smaller scale.
    expect(dulySeeds).toEqual([]);
  });

  it('and the stack the runtime boots declares no data either', async () => {
    const data = await loadStackData();
    expect(rowsIn(data), 'rows the default `pnpm dev` writes into a fresh database').toBe(0);
    expect(data.map((dataset) => dataset.object)).toEqual([]);
  });

  it('in particular it seeds no sys_user, which is what keeps the dev admin loginable', async () => {
    // Named separately from the count above because this is the row whose
    // presence is not merely off-message: it is what stopped the platform's
    // zero-user admin seed from ever running on a clean checkout.
    const data = await loadStackData();
    expect(data.filter((dataset) => dataset.object === 'sys_user')).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the flag turns it on', () => {
  it('hands the whole demo to the stack when the demo is asked for', async () => {
    vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
    const { dulySeeds, demoSeeds } = await loadBarrel();
    // Identity, not equality: the gate selects the demo array, it does not
    // build a second one that could drift away from it.
    expect(dulySeeds).toBe(demoSeeds);

    const data = await loadStackData();
    expect(rowsIn(data)).toBe(rowsIn(demoSeeds as unknown as readonly Dataset[]));
  });

  it('and the demo is a real dataset, so "empty by default" cannot be met by deleting it', async () => {
    // Without this, emptying `demoSeeds` would satisfy every assertion above.
    vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
    const data = await loadStackData();
    expect(rowsIn(data), 'the demo organisation, its catalog and its history').toBeGreaterThan(400);
    expect(data.some((dataset) => dataset.object === 'sys_user'), 'the demo has people').toBe(true);
    expect(data.some((dataset) => dataset.object === 'duly_task'), 'the demo has history').toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('only an explicit opt-in turns it on', () => {
  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' 1 '])('%j asks for the demo', async (value) => {
    vi.stubEnv(DEMO_SEED_ENV_VAR, value);
    const { dulySeeds } = await loadBarrel();
    expect(dulySeeds.length).toBeGreaterThan(0);
  });

  it.each(['', '0', 'false', 'off', 'no', 'maybe'])('%j does not', async (value) => {
    // `DULY_DEMO_SEED=0` in particular: an operator who explicitly turned the
    // demo off must not get it because a truthiness check read "0" as set.
    vi.stubEnv(DEMO_SEED_ENV_VAR, value);
    const { dulySeeds } = await loadBarrel();
    expect(dulySeeds).toEqual([]);
  });
});
