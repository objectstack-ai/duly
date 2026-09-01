// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/objects/.
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

import { Duty } from './duty.object.js';
import { Task } from './task.object.js';
import { CatalogItem } from './catalog-item.object.js';
import { Assignment } from './assignment.object.js';
import { LogEntry } from './log-entry.object.js';

export { Duty, Task, CatalogItem, Assignment, LogEntry };

export const dulyObjects = [Duty, Task, CatalogItem, Assignment, LogEntry];
