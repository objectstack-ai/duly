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
// and — unlike the dataset-to-object binding one layer down (#14105) — the
// platform DOES resolve most of that at author time. Measured on
// `@objectstack/cli` 17.2.0 by mutating this dashboard, one reference at a
// time, and re-running both gates:
//
//   | mutated reference                     | validate | build | rule            |
//   |---------------------------------------|----------|-------|-----------------|
//   | widget `dataset`                      | 1        | 1     | widget-dataset-unknown   |
//   | widget `dimensions[]`                 | 1        | 1     | widget-dimension-unknown |
//   | widget `values[]` (measure)           | 1        | 1     | widget-measure-unknown   |
//   | `{token}` in a widget filter          | 1        | 1     | filter-token-unknown     |
//   | nav `dashboardName`                   | 1        | 2     | defineStack cross-ref    |
//   | widget `filter` KEY (`due_daet`)      | **0**    | **0** | —                        |
//   | `options.sortBy` naming nothing shown | **0**    | **0** | —                        |
//
// So the last two are the holes, and the second-to-last is the sharpest one:
// on the SAME filter node, a bad date-macro token is caught path-precisely
// (`widgets[4].filter.due_date.$lte`) while a misspelt COLUMN is not — the
// traversal is there, only the field resolution is missing, which is exactly
// the asymmetry #14105 records one layer down. A widget filtering on a column
// that does not exist matches nothing and renders EMPTY, and an empty "not
// moving" tile reads exactly like a healthy team.
//
// Filed upstream as **objectstack-ai/objectstack#14148** (both halves, with
// the measurements above). `test/dashboard.test.ts` is the repo-local stopgap
// that closes them and is written to be DELETED when #14148 lands, not
// maintained — same posture as `test/flow-predicates.test.ts`. It also pins
// the product invariants, which are not going anywhere.
// `test/metadata-bindings.test.ts` covers views, datasets and nav, and does
// NOT reach inside a dashboard.

import { DutyHealthDashboard } from './duty-health.dashboard.js';

export { DutyHealthDashboard };

export const dulyDashboards = [DutyHealthDashboard];
