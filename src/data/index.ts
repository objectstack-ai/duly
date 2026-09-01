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
 * The demo seed — what `pnpm dev` opens on with an empty database.
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
 * the demo loads wherever the app is booted, which is what makes it testable
 * as well as demonstrable. Scoping it to `dev` would be defensible for a
 * shipping product; it is the wrong trade for an app whose entire purpose
 * right now is to be looked at and evaluated.
 */
export const dulySeeds: Seed[] = [
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
