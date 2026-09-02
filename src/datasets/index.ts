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
//
// ⚠ And the binding UNDER a dataset is not checked either: `objectstack validate`
// and `objectstack build` both exit 0 on a dataset whose base `object`, `include`
// path or dimension/measure `field` paths name nothing at all (measured, and filed
// as objectstack-ai/objectstack#14105 — a bad date-macro TOKEN in the same measure
// filter IS caught, so the traversal exists and only the reference resolution is
// missing). Until that lands, `test/datasets.test.ts` pinning the field paths is
// the only thing standing between a typo here and a chart that renders empty while
// every gate reports success.

// ⚠ Three of the four are based on `duly_task` and one — `duly_duty_register`
// — is based on `duly_duty`. That is not a detail of convenience: a task-based
// dataset structurally cannot see a `standing` duty (it never generates a
// task) or an unapproved one (it never dispatches), so a question about the
// DUTY LIST has to be asked of the duty list. Check which object a dataset
// sits on before adding a measure to it; a duty count and a task count that
// share a screen are two different populations, and only their names look
// alike.

import { DutyHealth } from './duty-health.dataset.js';
import { DutyRegister } from './duty-register.dataset.js';
import { Stagnation } from './stagnation.dataset.js';
import { Workload } from './workload.dataset.js';

export { DutyHealth, DutyRegister, Stagnation, Workload };
export { GOVERNED_SOURCES, governed } from './governed.js';

export const dulyDatasets = [DutyHealth, DutyRegister, Stagnation, Workload];
