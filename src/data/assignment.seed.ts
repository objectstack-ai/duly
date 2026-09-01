// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';

import { Assignment } from '../objects/assignment.object.js';

import { ASSIGNMENTS } from './demo-assignments.js';

/**
 * Two assignments: one fanned out to four people with mixed completion, one
 * with `needs_collection` ticked.
 *
 * `task_count` is NOT seeded and must not be — it is an ADR-0021 summary the
 * platform computes over the children on read. Writing it would be a second
 * writer for a number the server owns, and it would be wrong the moment
 * anybody closed a task.
 *
 * `assignees` is `multiple: true`, so it is seeded as an ARRAY of natural
 * keys, one per element — a lone string is accepted as one-element shorthand,
 * which is not what these need.
 */
export const assignmentSeed = defineSeed(Assignment, {
  externalId: 'subject',
  mode: 'upsert',
  records: ASSIGNMENTS.map((assignment) => ({
    subject: assignment.subject,
    description: assignment.description,
    assigner: assignment.assigner,
    assignees: [...assignment.assignees],
    due_date: assignment.dueDate,
    // `dispatched`, not `draft`: the tasks exist, so the assignment that owns
    // them has to say it went out. A `draft` assignment with four children
    // would be a state the flow can never produce.
    status: 'dispatched',
    needs_collection: assignment.needsCollection,
  })),
});
