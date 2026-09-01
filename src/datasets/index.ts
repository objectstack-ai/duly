// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/datasets/.
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
//
// ⚠ A dataset is a CONTRACT, not an implementation detail. Dashboards and
// reports bind dimensions and measures BY NAME (ADR-0021), and a widget naming
// one that does not exist renders an empty chart and reports success. Renaming
// or dropping anything declared in these files breaks its consumers silently —
// grep the dashboards barrel before you touch a name.

import { DutyHealth } from './duty-health.dataset.js';
import { Stagnation } from './stagnation.dataset.js';
import { Workload } from './workload.dataset.js';

export { DutyHealth, Stagnation, Workload };
export { GOVERNED_SOURCES, governed } from './governed.js';

export const dulyDatasets = [DutyHealth, Stagnation, Workload];
