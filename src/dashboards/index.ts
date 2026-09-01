// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/dashboards/.
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

// ⚠ A widget binds its dataset, dimensions and measures BY NAME (ADR-0021),
// and NOTHING resolves those names at author time: `pnpm validate` and
// `pnpm build` both exit 0 on a widget naming a dataset, dimension or measure
// that does not exist, and the widget then renders EMPTY. An empty "not
// moving" tile reads exactly like a healthy team, which is the worst possible
// silent failure on this particular screen. `test/dashboard.test.ts` resolves
// every binding in this barrel against `dulyDatasets` until the platform
// does — same stopgap posture as `test/metadata-bindings.test.ts`, which
// covers views, datasets and nav but does NOT reach dashboard widgets.

import { DutyHealthDashboard } from './duty-health.dashboard.js';

export { DutyHealthDashboard };

export const dulyDashboards = [DutyHealthDashboard];
