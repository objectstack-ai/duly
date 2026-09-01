// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/data/.
//
// Every metadata directory is pre-created and already wired into
// objectstack.config.ts — including the empty ones — so a feature branch adds
// its entry HERE and never edits the config. The config is the one file every
// parallel task would otherwise collide on.
//
// The collection is a named array rather than `Object.values(barrel)`: on an
// empty namespace `Object.values` has nothing to infer from and TypeScript
// resolves it against the keyed branch of `MetadataCollectionInput`, which
// makes `name` optional and fails the assignment. A named array is `never[]`
// while empty and infers correctly the moment something is pushed into it.

import type { Seed } from '@objectstack/spec/data';

import { assignmentSeed } from './assignment.seed.js';
import { catalogSeed } from './catalog.seed.js';
import { dutySeed } from './duty.seed.js';
import { logEntrySeed } from './log-entry.seed.js';
import { businessUnitSeed, userSeed } from './org.seed.js';
import {
  taskAdHocSeed,
  taskAdHocTouchSeed,
  taskHistorySeed,
  taskHistoryTouchSeed,
} from './task.seed.js';

export {
  assignmentSeed,
  businessUnitSeed,
  catalogSeed,
  dutySeed,
  logEntrySeed,
  taskAdHocSeed,
  taskAdHocTouchSeed,
  taskHistorySeed,
  taskHistoryTouchSeed,
  userSeed,
};

/**
 * The demo dataset — a fictional manufacturer, its org chart, what each role
 * owes, and six months of history behind it.
 *
 * It is what `pnpm demo` opens on. It is NOT what `pnpm dev` opens on; see
 * `dulySeeds` below for the gate and for why the default is empty.
 *
 * ── Order ─────────────────────────────────────────────────────────────────
 * The loader sorts datasets topologically by reference before it runs them, so
 * this array is written for a READER rather than for the loader. Two things
 * about it are load-bearing anyway:
 *
 *  - **`sys_user` and `sys_business_unit` come first.** They are the targets
 *    every `duly_*` owner and unit reference resolves against. The topological
 *    sort would hoist them regardless; listing them first means nobody has to
 *    know that to see why the seed works. (#32: without the user rows, every
 *    task row is refused with `Owner is required` — measured, 0 inserted, 4
 *    errored.)
 *  - **The two `mode: 'update'` task passes come LAST, after both inserts.**
 *    Datasets targeting the same object keep their relative order through the
 *    sort (it is stable), and these two only work if the rows they backdate
 *    already exist. They are what makes "Not moving" non-empty; see
 *    `task.seed.ts` for why an insert can never carry `last_update_at`.
 *
 * ── Environment ───────────────────────────────────────────────────────────
 * Every dataset takes `Seed.env`'s default — `['prod', 'dev', 'test']` — so
 * the demo loads wherever the app is booted once it has been ASKED for, which
 * is what makes it testable as well as demonstrable. Scoping it to `dev`
 * instead would answer a different question than the one the opt-in answers:
 * `env` decides which deployments a seed is *eligible* for, `DULY_DEMO_SEED`
 * decides whether this deployment wanted a demo at all.
 */
export const demoSeeds: Seed[] = [
  // 1. The org, first — everything below resolves its people and units here.
  businessUnitSeed,
  userSeed,

  // 2. What roles owe, and who owes it.
  catalogSeed,
  dutySeed,

  // 3. The work itself.
  assignmentSeed,
  taskHistorySeed,
  taskAdHocSeed,

  // 4. The backdate passes. Last, and not optional.
  taskHistoryTouchSeed,
  taskAdHocTouchSeed,

  // 5. The personal work log — deliberately attached to nothing scoreable.
  logEntrySeed,
];

// ─── The demo is opt-in, and off by default ─────────────────────────────────
//
// `data` carries the demo only when `DULY_DEMO_SEED` is set. `pnpm demo` sets
// it; `pnpm dev` does not.
//
// This is a product decision, not a switch bolted on to route around a defect.
// Duly is meant to be a general product, and a general product does not
// install 459 rows of a fictional manufacturer's org chart into every fresh
// deployment. Someone evaluating Duly FOR THEIR OWN COMPANY wants an empty app
// they can put their own duties into — handing them somebody else's org chart
// to delete first is not a neutral default, it is a different product than the
// one they asked for. Someone evaluating THE IDEA wants the demo, fully
// populated, immediately. Those are two intentions, and they get two commands.
//
// "Off" means genuinely empty, not "empty of users". A default seed that still
// wrote duties would be the same product mistake at a smaller scale, so the
// gate wraps the WHOLE array rather than filtering rows out of it.
//
// ── What this also settles, and what changes when the platform lands ───────
//
// `@objectstack/plugin-auth` mints the dev admin (`admin@objectos.ai`) on a
// ZERO-USER database, from the `kernel:ready` hook — which fires AFTER the
// app's declarative seed has run. While the demo's thirteen `sys_user` rows
// were in the default path, a clean `git clone && pnpm dev` was never
// zero-user by the time that check ran: the admin was never created, and
// because the gate is "any human row exists" it was never created on a later
// boot either. `sign-in` returned 401, `sys_account` was empty, and
// `bootstrap-status` reported `{"hasOwner": true}` so the console offered no
// first-admin flow to recover through.
//
// With the demo off by default that path is simply gone. The default boot
// leaves the database zero-user and the admin is minted exactly as
// documented — nobody typing `pnpm dev` has to know any of the above.
//
// The ordering itself is the platform's question and is filed as
// objectstack-ai/objectstack#14157. When it lands, exactly ONE thing here
// collapses: `pnpm demo` stops having to sequence two boots (see
// `scripts/demo.mjs`) and becomes a single boot with the flag set. This gate
// stays. It was never really about the bug.
//
// ── One mechanical detail: the flag is read at COMPILE time ────────────────
//
// The seed is baked into `dist/objectstack.json`, so this gate is evaluated
// when the artifact is compiled — not when the server starts — and `os dev`
// reuses an existing artifact instead of recompiling it. Both `pnpm dev` and
// `pnpm demo` therefore boot with `--compile`, so every boot's artifact
// matches the flag that boot was started with. Without that, `pnpm demo`
// followed by `pnpm dev` would silently serve the previous run's demo
// artifact, and the default would not be a default.

/** The environment variable that asks for the demo dataset. */
export const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';

// The one Node global this app reads. `@types/node` is deliberately not a
// dependency of a metadata package, so the single property the gate needs is
// declared narrowly and locally rather than pulling the whole Node type
// surface in for it. Module-scoped, so it shadows nothing globally.
declare const process: { env: Record<string, string | undefined> };

/** Opt-in spellings. Anything else — including unset — means off. */
const OPT_IN = ['1', 'true', 'on', 'yes'];

/** Whether this compile was asked for the demo dataset. */
export const demoSeedRequested = (): boolean =>
  OPT_IN.includes((process.env[DEMO_SEED_ENV_VAR] ?? '').trim().toLowerCase());

/**
 * What `defineStack({ data })` installs: nothing at all, unless the demo was
 * asked for.
 *
 * `test/demo-seed-opt-in.test.ts` fails if this stops being empty by default —
 * which is what keeps the demo from drifting back into the default path one
 * convenient row at a time.
 */
export const dulySeeds: Seed[] = demoSeedRequested() ? demoSeeds : [];
