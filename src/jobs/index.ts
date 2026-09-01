// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/jobs/.
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
// ⚠ A job needs TWO registrations, and the second one has no author-time gate.
// This barrel publishes the SCHEDULE; `src/functions/index.ts` publishes the
// HANDLER the schedule names. `AppPlugin` resolves the handler as
// `collectBundleFunctions(bundle)[job.handler]` and, on a miss, logs
// "job handler not found in bundle.functions — skipping" and carries on: the
// job is registered, listed, and never executed. `test/dispatch.test.ts`
// performs the same lookup so the pair cannot come apart.

import { DispatchJob } from './dispatch.job.js';

export { DispatchJob };

export const dulyJobs = [DispatchJob];
