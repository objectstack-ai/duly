// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { P } from '@objectstack/spec';
import { defineFlow } from '@objectstack/spec';

/**
 * `duly_assignment_fanout` — one piece of work becomes N independent tasks.
 *
 * Assigning is the ONLY write a manager makes in this product, and every
 * decision below protects that. Five names on one assignment become five
 * `duly_task` rows, one owner each, each updated only by its owner. The
 * manager's "3 of 5" is `duly_assignment.task_count` — a `Field.summary`
 * rollup over the children, computed on read and maintained by nobody. This
 * flow writes no progress field, no status rollup, and nothing back onto the
 * assignment.
 *
 * ── Where the trigger binding lives ──────────────────────────────────────
 * NOT at the flow top level. `FlowSchema` is `.strict()` and carries neither
 * `object` nor `trigger`; writing either is a parse error whose message says
 * so ("a record-change flow binds its object on the START node's `config`
 * (`{ objectName, triggerType, condition }`)"). The engine's
 * `resolveTriggerBinding` reads exactly those three keys off the node whose
 * `type` is `'start'`, and reads `objectName` only — `object` is a load-time
 * alias for the CRUD nodes, not for the trigger.
 *
 * ── Why the gate is STATE, not TRANSITION ────────────────────────────────
 * The platform CAN see a transition: `AutomationContext.previous` is bound on
 * every run, so `previous.status != "dispatched"` is expressible. It is
 * deliberately NOT used here, for two independent reasons.
 *
 * 1. The acceptance criteria require firing when there is no transition.
 *    "Adding a 6th assignee to an already-dispatched assignment creates
 *    exactly 1" is a save on which `status` does not move — a transition gate
 *    fires zero times and creates zero tasks. Idempotency is therefore carried
 *    by the per-assignee guard below, which has to exist anyway, rather than
 *    by the gate; making the gate load-bearing would buy nothing and cost the
 *    6th assignee.
 *
 * 2. `previous` is bound to `null` on an insert (`seedRunVariables`:
 *    `variables.set('previous', context?.previous ?? null)`), and CEL field
 *    access through a `null` root ABORTS the predicate rather than yielding
 *    false. `evaluateCondition` never swallows that to `false` — it throws —
 *    so `previous.status != "dispatched"` would fault the flow on every
 *    assignment born directly in `dispatched` (an import, a REST create, a
 *    seed). `record.status` cannot fault the same way: the record-change
 *    trigger runs `materializeDeclaredFields` over both CEL roots, so every
 *    DECLARED field of `duly_assignment` is present, at worst as `null`.
 *
 * `record-after-write` is the create-OR-update union (`afterInsert` +
 * `afterUpdate`), so an assignment dispatched at birth and one dispatched by a
 * later edit take the same path.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 * The `duly_task` unique index covers `(duty, owner, period_key)`. For a
 * fan-out task `duty` is null and `period_key` is unset, so the index does not
 * constrain these rows at all and cannot be the guard. The guard is explicit
 * and PER OWNER, not per assignment: each iteration reads back
 * `duly_task where { assignment, owner }` and creates only on a miss. Adding a
 * sixth name to a dispatched assignment therefore creates exactly one row —
 * per-assignment guards create zero, which is the failure this shape exists to
 * avoid.
 *
 * The guard filters on `(assignment, owner)` and nothing else — deliberately
 * not on `subject`. A subject-aware guard would create a duplicate task for
 * every owner the moment somebody edits the assignment's subject and re-saves,
 * which is a worse failure than the one it would fix. One consequence, stated
 * so it is a decision and not an accident: an assigner who is also one of the
 * assignees already owns a task on this assignment, so `needs_collection` adds
 * no second one for them.
 */
export const AssignmentFanout = defineFlow({
  name: 'duly_assignment_fanout',
  label: 'Assignment fan-out',
  description:
    'Turns a dispatched assignment into one independent task per assignee, and — only when the assigner asked for it — one follow-up task of their own.',

  type: 'record_change',
  status: 'active',

  // The assignees are not the actor: a manager who can assign work is not
  // thereby able to write rows owned by the people they assigned it to. #1888
  // still forwards the triggering user, so `created_by` and the tenant stamp
  // land exactly as they would on a user-path insert.
  runAs: 'system',

  /**
   * Declared so they are BOUND (#4697), not merely documented.
   *
   * A `get_record` sets its `outputVariable` on every hit AND every miss — but
   * it returns early WITHOUT setting it when no data engine is registered, and
   * a name that was never set is unbound, which in strict CEL aborts the
   * predicate reading it instead of yielding false. A declared `defaultValue`
   * removes the unbound state entirely, which is the platform's own stated
   * answer here (a `has()` guard would encode "unanswered means no" and leave
   * the graph defect in place).
   *
   * None of these names collide with a `duly_assignment` field: a declared
   * variable SHADOWS a record field of the same name, so a collision would
   * silently replace the field the rest of the flow reads.
   */
  variables: [
    { name: 'existing_task', type: 'record', defaultValue: null },
    { name: 'existing_assigner_task', type: 'record', defaultValue: null },
    { name: 'fanout_assignee_user', type: 'record', defaultValue: null },
    { name: 'assigner_user', type: 'record', defaultValue: null },
  ],

  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Assignment saved',
      config: {
        objectName: 'duly_assignment',
        // create OR update — see the header. `record-after-write` maps to
        // ['afterInsert', 'afterUpdate']; multi-event ARRAYS are unsupported
        // and leave the flow silently unbound, so this stays a single token.
        triggerType: 'record-after-write',
        condition: P`record.status == "dispatched"`,
      },
    },

    {
      id: 'fan_out',
      type: 'loop',
      label: 'One task per assignee',
      config: {
        // `flow-template` slot: single-brace interpolation, NOT bare CEL. A
        // whole-string single token returns the raw value, so this resolves to
        // the array itself — `Field.user({ multiple: true })` stores an array
        // of `sys_user` ids.
        collection: '{record.assignees}',
        iteratorVariable: 'fanout_assignee',
        body: {
          nodes: [
            {
              id: 'fanout_find_existing',
              type: 'get_record',
              label: 'Does this assignee already have a task?',
              config: {
                objectName: 'duly_task',
                // Per OWNER, not per assignment. `limit` omitted → findOne →
                // the variable is set to the row or to null, never to [].
                filter: { assignment: '{record.id}', owner: '{fanout_assignee}' },
                fields: ['id'],
                outputVariable: 'existing_task',
              },
            },
            {
              id: 'fanout_find_unit',
              type: 'get_record',
              label: "Read the assignee's business unit",
              config: {
                objectName: 'sys_user',
                filter: { id: '{fanout_assignee}' },
                fields: ['id', 'primary_business_unit_id'],
                outputVariable: 'fanout_assignee_user',
              },
            },
            {
              id: 'fanout_create_task',
              type: 'create_record',
              label: 'Create the assignee task',
              config: {
                objectName: 'duly_task',
                fields: {
                  subject: '{record.subject}',
                  owner: '{fanout_assignee}',
                  // Denormalised at dispatch so a later transfer does not
                  // rewrite history (see duly_task.business_unit).
                  business_unit: '{fanout_assignee_user.primary_business_unit_id}',
                  assignment: '{record.id}',
                  source: 'assigned',
                  due_date: '{record.due_date}',
                  // An assignment has no lead time to spread, so the task is
                  // visible from the day it is due.
                  visible_from: '{record.due_date}',
                  status: 'open',
                  // `period_key` is NOT written. An assignment has no period,
                  // and the dispatch identity index does not apply to it.
                },
              },
            },
          ],
          edges: [
            {
              id: 'fanout_e_missing',
              source: 'fanout_find_existing',
              target: 'fanout_find_unit',
              type: 'conditional',
              label: 'No task yet',
              // `isBlank` takes the value itself (`dyn`), so it is total over
              // null/undefined/'' /[] — unlike a field access through a null
              // root, which aborts the predicate.
              condition: P`isBlank(vars.existing_task)`,
            },
            { id: 'fanout_e_create', source: 'fanout_find_unit', target: 'fanout_create_task' },
          ],
        },
      },
    },

    {
      id: 'find_assigner_task',
      type: 'get_record',
      label: 'Does the assigner already have a task?',
      config: {
        objectName: 'duly_task',
        filter: { assignment: '{record.id}', owner: '{record.assigner}' },
        fields: ['id'],
        outputVariable: 'existing_assigner_task',
      },
    },
    {
      id: 'find_assigner_unit',
      type: 'get_record',
      label: "Read the assigner's business unit",
      config: {
        objectName: 'sys_user',
        filter: { id: '{record.assigner}' },
        fields: ['id', 'primary_business_unit_id'],
        outputVariable: 'assigner_user',
      },
    },
    {
      id: 'create_assigner_task',
      type: 'create_record',
      label: 'Create the follow-up task',
      config: {
        objectName: 'duly_task',
        fields: {
          // The assignment's own subject. No literal display text is authored
          // here: English is the source language and every authored label
          // belongs in a translation bundle, never inlined in a flow.
          subject: '{record.subject}',
          owner: '{record.assigner}',
          business_unit: '{assigner_user.primary_business_unit_id}',
          assignment: '{record.id}',
          // Still assignment-sourced: this row came out of an assignment, and
          // `source` is the column metrics read. `self` is for work somebody
          // declared for themselves, which this is not.
          source: 'assigned',
          due_date: '{record.due_date}',
          visible_from: '{record.due_date}',
          status: 'open',
        },
      },
    },

    { id: 'end', type: 'end', label: 'Done' },
  ],

  edges: [
    { id: 'e_start', source: 'start', target: 'fan_out' },

    // The opt-in. A manager who assigns work does not inherit a to-do list
    // from having assigned it; only ticking `needs_collection` gives them one.
    {
      id: 'e_collection',
      source: 'fan_out',
      target: 'find_assigner_task',
      type: 'conditional',
      label: 'Assigner asked to follow up',
      condition: P`record.needs_collection == true`,
    },
    { id: 'e_no_collection', source: 'fan_out', target: 'end', isDefault: true },

    {
      id: 'e_assigner_missing',
      source: 'find_assigner_task',
      target: 'find_assigner_unit',
      type: 'conditional',
      label: 'No follow-up task yet',
      condition: P`isBlank(vars.existing_assigner_task)`,
    },
    { id: 'e_assigner_present', source: 'find_assigner_task', target: 'end', isDefault: true },

    { id: 'e_assigner_create', source: 'find_assigner_unit', target: 'create_assigner_task' },
    { id: 'e_assigner_done', source: 'create_assigner_task', target: 'end' },
  ],
});
