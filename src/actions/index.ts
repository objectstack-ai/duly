// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/actions/.
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

import {
  CatalogApplyAction,
  CatalogApplyToPeopleAction,
  CatalogSyncAction,
} from './catalog.actions.js';
import { TaskCompleteAction, TaskSkipAction, TaskUndoAction } from './task.actions.js';

export { CatalogApplyAction, CatalogApplyToPeopleAction, CatalogSyncAction };
export { TaskCompleteAction, TaskSkipAction, TaskUndoAction };

export const dulyActions = [
  CatalogApplyAction,
  CatalogSyncAction,
  // The object-bound twin of `duly_catalog_apply` — same handler, given a
  // place to be clicked. `objectName: 'duly_catalog_item'`, so defineStack()
  // merges it into that object's actions and its `list_toolbar` button
  // renders on the Role catalog list. Missing from this array it would be
  // dead metadata: it type-checks, it reads as wired, and no toolbar ever
  // sees it.
  CatalogApplyToPeopleAction,
  // Object-bound (`objectName: 'duly_task'`), so defineStack() merges them
  // into duly_task.actions and the dispatcher can find their declaration.
  // An action reachable from a row still needs its handler registered in
  // register-handlers.ts — see task.handlers.ts.
  TaskCompleteAction,
  TaskUndoAction,
  TaskSkipAction,
];
