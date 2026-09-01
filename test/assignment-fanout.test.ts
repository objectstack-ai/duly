// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { AssignmentFanout } from '../src/flows/assignment.flow.js';
import { dulyFlows } from '../src/flows/index.js';
import { Assignment, Task } from '../src/objects/index.js';

/**
 * These are not schema tests — `pnpm validate` already parses the flow and
 * resolves every `record.<field>` in every predicate against the bound object
 * (measured: misspelling one fails validate with a located finding).
 *
 * What validate does NOT check is the part that makes this flow correct, and
 * that is what is pinned here:
 *
 *  - Nothing in the toolchain checks that the idempotency guard is per OWNER
 *    rather than per assignment, that `period_key` stays unwritten, or that the
 *    trigger token is a single string. Each of those fails SILENTLY: a
 *    per-assignment guard creates zero tasks for a sixth assignee, and an
 *    ARRAY `triggerType` leaves the flow unbound and firing never.
 *
 * The house rule "predicates say `record.<field>`" is deliberately NOT checked
 * here. It does need a repo-local gate — `objectstack validate` skips a bare
 * identifier inside a flow predicate on purpose, because the engine flattens
 * the trigger record's fields to top-level names and a bare name there may
 * genuinely be a flow variable — and `test/flow-predicates.test.ts` is that
 * gate, for every flow in `dulyFlows` rather than this one.
 *
 * This file used to carry a second, weaker copy of the rule. It found the bare
 * occurrence correctly and then asked whether the source CONTAINED
 * `record.<field>` anywhere, which is a different question, so a compound
 * predicate satisfied it with a genuine bare reference still in place.
 * Measured: with the start condition written
 * `status == "dispatched" && record.status != "cancelled"`, that assertion
 * passed while `test/flow-predicates.test.ts` reported
 * `duly_assignment_fanout · node 'start' config.condition: reads 'status'
 * bare`. One rule, one gate — and that gate is a stopgap that goes away when
 * objectstack-ai/objectstack#14089 lands and `pnpm validate` covers bare
 * identifiers itself.
 */

type AnyRec = Record<string, unknown>;
interface NodeLike { id: string; type: string; label: string; config?: AnyRec }
interface EdgeLike {
  id: string; source: string; target: string; isDefault?: boolean;
  condition?: string | { dialect?: string; source?: string };
}

const nodes = AssignmentFanout.nodes as unknown as NodeLike[];
const edges = AssignmentFanout.edges as unknown as EdgeLike[];

const node = (id: string): NodeLike => {
  const found = nodes.find((n) => n.id === id);
  if (!found) throw new Error(`no node '${id}' — ${nodes.map((n) => n.id).join(', ')}`);
  return found;
};
const startNode = (): NodeLike => {
  const found = nodes.find((n) => n.type === 'start');
  if (!found) throw new Error('flow has no start node');
  return found;
};
const loopBody = (): { nodes: NodeLike[]; edges: EdgeLike[] } => {
  const body = (node('fan_out').config?.body ?? {}) as { nodes?: NodeLike[]; edges?: EdgeLike[] };
  return { nodes: body.nodes ?? [], edges: body.edges ?? [] };
};
/** Every node in the flow, region bodies included. */
const allNodes = (): NodeLike[] => [...nodes, ...loopBody().nodes];
/** Every predicate authored anywhere, as its bare CEL source. */
const allPredicates = (): { where: string; source: string }[] => {
  const out: { where: string; source: string }[] = [];
  const read = (where: string, c: EdgeLike['condition']) => {
    if (c == null) return;
    const source = typeof c === 'string' ? c : (c.source ?? '');
    if (source !== '') out.push({ where, source });
  };
  for (const n of allNodes()) read(`node '${n.id}' condition`, n.config?.condition as EdgeLike['condition']);
  for (const e of [...edges, ...loopBody().edges]) read(`edge '${e.id}'`, e.condition);
  return out;
};

describe('assignment fan-out — wiring', () => {
  it('is registered in dulyFlows (a flow not in its barrel never runs)', () => {
    expect(dulyFlows).toContain(AssignmentFanout);
  });

  it('runs as system and is active, not draft', () => {
    // The assignees are not the actor. A draft flow is registered and never
    // dispatches, which looks identical to a working flow from the outside.
    expect(AssignmentFanout.runAs).toBe('system');
    expect(AssignmentFanout.status).toBe('active');
    expect(AssignmentFanout.type).toBe('record_change');
  });
});

describe('assignment fan-out — the trigger binds where the engine reads it', () => {
  it('binds on the START node config, never at the flow top level', () => {
    // `FlowSchema` is strict and carries no `object` / `trigger` key; the
    // engine's `resolveTriggerBinding` reads `objectName` / `triggerType` /
    // `condition` off the start node and nowhere else.
    expect(Object.keys(AssignmentFanout)).not.toContain('trigger');
    expect(Object.keys(AssignmentFanout)).not.toContain('object');
    expect(startNode().config?.objectName).toBe(Assignment.name);
  });

  it('uses a single-string record-* trigger token (an array binds nothing)', () => {
    const triggerType = startNode().config?.triggerType;
    expect(typeof triggerType, 'an ARRAY triggerType leaves the flow unbound').toBe('string');
    expect(triggerType).toMatch(/^record-(before|after)-(create|insert|update|delete|write)$/);
  });

  it('fires on create OR update, so an assignment born dispatched still fans out', () => {
    // `record-after-write` maps to ['afterInsert', 'afterUpdate']. Narrowing it
    // to '-update' would silently skip every assignment created straight into
    // `dispatched` by an import, a REST create or a seed.
    expect(startNode().config?.triggerType).toBe('record-after-write');
  });
});

describe('assignment fan-out — the gate is state, not transition', () => {
  it('gates on the dispatched STATE', () => {
    const condition = startNode().config?.condition as { source?: string };
    expect(condition?.source).toBe('record.status == "dispatched"');
  });

  it('no predicate reads `previous.` — it is null on insert and aborts the run', () => {
    // The engine binds `previous` to null on an insert, and CEL field access
    // through a null root throws rather than yielding false — `evaluateCondition`
    // never swallows it. A transition gate would fault the flow on every
    // assignment created directly as dispatched.
    for (const { where, source } of allPredicates()) {
      expect(source, `${where} must not gate on a transition`).not.toContain('previous.');
    }
  });

  it('a transition gate would also break the sixth assignee, so state is required', () => {
    // Adding a name to an already-dispatched assignment moves no status. The
    // acceptance criterion "creates exactly 1" is only reachable if the flow
    // fires on a save with no transition — which is what makes the per-owner
    // guard below the idempotency mechanism rather than the gate.
    const condition = startNode().config?.condition as { source?: string };
    expect(condition?.source).not.toMatch(/previous/);
  });
});

describe('assignment fan-out — N assignees, N independent tasks', () => {
  it('loops over the assignment\'s assignees', () => {
    const cfg = node('fan_out').config ?? {};
    expect(node('fan_out').type).toBe('loop');
    // A `flow-template` slot: single-brace interpolation of the whole string
    // returns the raw array. `assignees` is multi-valued; `assigner` is not.
    expect(cfg.collection).toBe('{record.assignees}');
    expect(Assignment.fields.assignees.multiple).toBe(true);
    expect(cfg.iteratorVariable).toBe('fanout_assignee');
  });

  it('creates one duly_task per iteration, owned by the iterated assignee', () => {
    const create = loopBody().nodes.find((n) => n.type === 'create_record');
    expect(create, 'the loop body must create a task').toBeDefined();
    const fields = (create!.config?.fields ?? {}) as AnyRec;
    expect(create!.config?.objectName).toBe(Task.name);
    expect(fields.owner).toBe('{fanout_assignee}');
    expect(fields.subject).toBe('{record.subject}');
    expect(fields.assignment).toBe('{record.id}');
    expect(fields.source).toBe('assigned');
    expect(fields.status).toBe('open');
  });

  it('denormalises the business unit from the assignee, not the assigner', () => {
    const create = loopBody().nodes.find((n) => n.type === 'create_record')!;
    const fields = (create.config?.fields ?? {}) as AnyRec;
    expect(fields.business_unit).toBe('{fanout_assignee_user.primary_business_unit_id}');
  });

  it('an assignment has no lead time: visible_from tracks due_date', () => {
    for (const create of allNodes().filter((n) => n.type === 'create_record')) {
      const fields = (create.config?.fields ?? {}) as AnyRec;
      expect(fields.visible_from, `${create.id}`).toBe(fields.due_date);
      expect(fields.due_date, `${create.id}`).toBe('{record.due_date}');
    }
  });

  it('never writes period_key — an assignment has no period', () => {
    for (const create of allNodes().filter((n) => n.type === 'create_record')) {
      expect(
        Object.keys((create.config?.fields ?? {}) as AnyRec),
        `${create.id} must leave period_key unwritten`,
      ).not.toContain('period_key');
    }
  });

  it('every created task has exactly one owner', () => {
    for (const create of allNodes().filter((n) => n.type === 'create_record')) {
      const fields = (create.config?.fields ?? {}) as AnyRec;
      expect(typeof fields.owner, `${create.id}`).toBe('string');
      expect(Array.isArray(fields.owner), `${create.id}`).toBe(false);
    }
  });
});

describe('assignment fan-out — idempotency is explicit and PER OWNER', () => {
  it('the unique index cannot be the guard here', () => {
    // (duty, owner, period_key) — a fan-out task sets none of duty or
    // period_key, so the index never constrains these rows. This assertion is
    // the reason the guard below has to exist at all.
    const identity = Task.indexes?.find((i) => i.name === 'duly_task_dispatch_identity');
    expect(identity?.fields).toEqual(['duty', 'owner', 'period_key']);
    const create = loopBody().nodes.find((n) => n.type === 'create_record')!;
    const fields = Object.keys((create.config?.fields ?? {}) as AnyRec);
    expect(fields).not.toContain('duty');
    expect(fields).not.toContain('period_key');
  });

  it('reads back an existing task before creating one', () => {
    const guard = loopBody().nodes.find((n) => n.type === 'get_record' && n.config?.objectName === Task.name);
    expect(guard, 'the loop body must read duly_task back').toBeDefined();
    expect(guard!.config?.outputVariable).toBe('existing_task');
  });

  it('the guard filters per OWNER, not per assignment', () => {
    // The whole point. A guard keyed on `assignment` alone finds the first of
    // the five tasks and creates NOTHING for a sixth assignee — zero, where the
    // acceptance criterion says exactly one.
    const guard = loopBody().nodes.find((n) => n.type === 'get_record' && n.config?.objectName === Task.name)!;
    const filter = (guard.config?.filter ?? {}) as AnyRec;
    expect(Object.keys(filter).sort()).toEqual(['assignment', 'owner']);
    expect(filter.assignment).toBe('{record.id}');
    expect(filter.owner).toBe('{fanout_assignee}');
  });

  it('the create is reachable only through the guard predicate', () => {
    const body = loopBody();
    const create = body.nodes.find((n) => n.type === 'create_record')!;
    // Walk back from the create to the guard; every hop must be gated or a
    // straight continuation of a gated hop.
    const incoming = (id: string) => body.edges.filter((e) => e.target === id);
    const seenGate: string[] = [];
    let frontier = [create.id];
    for (let hop = 0; hop < body.nodes.length && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of incoming(id)) {
          const source = typeof e.condition === 'string' ? e.condition : e.condition?.source;
          if (source) seenGate.push(source);
          else next.push(e.source);
        }
      }
      frontier = next;
    }
    expect(seenGate, 'the create must sit behind a guard predicate').toContain(
      'isBlank(vars.existing_task)',
    );
  });

  it('the guard variable is DECLARED with a default, so it is never unbound', () => {
    // `get_record` skips setting its outputVariable when no data engine is
    // registered, and an unbound name aborts a strict-CEL predicate instead of
    // yielding false. A declared default removes the unbound state.
    const declared = AssignmentFanout.variables ?? [];
    for (const name of ['existing_task', 'existing_assigner_task']) {
      const v = declared.find((d) => d.name === name);
      expect(v, `${name} must be declared`).toBeDefined();
      expect(v!.defaultValue, `${name} must carry a default`).toBeNull();
    }
  });

  it('no declared variable shadows a duly_assignment field', () => {
    // A declared variable is seeded BEFORE the trigger record is flattened to
    // top-level names, so a same-named declaration silently replaces the field.
    const fields = Object.keys(Assignment.fields);
    for (const v of AssignmentFanout.variables ?? []) {
      expect(fields, `variable '${v.name}' would shadow the record field`).not.toContain(v.name);
    }
  });
});

describe('assignment fan-out — the assigner task is opt-in', () => {
  it('is reached only behind needs_collection', () => {
    const gate = edges.find((e) => e.target === 'find_assigner_task');
    expect(gate, 'the assigner branch must be gated').toBeDefined();
    const source = typeof gate!.condition === 'string' ? gate!.condition : gate!.condition?.source;
    expect(source).toBe('record.needs_collection == true');
    expect(gate!.isDefault).not.toBe(true);
  });

  it('the default path skips the assigner entirely', () => {
    // A manager who assigns work must not inherit a to-do list from having
    // assigned it, so "no opinion" has to route past the assigner branch.
    const fallback = edges.find((e) => e.source === 'fan_out' && e.isDefault === true);
    expect(fallback, 'fan_out needs a default out-edge').toBeDefined();
    expect(fallback!.target).toBe('end');
  });

  it('creates at most one assigner task, behind its own per-owner guard', () => {
    const guard = node('find_assigner_task');
    expect(guard.type).toBe('get_record');
    const filter = (guard.config?.filter ?? {}) as AnyRec;
    expect(Object.keys(filter).sort()).toEqual(['assignment', 'owner']);
    expect(filter.owner).toBe('{record.assigner}');

    const gate = edges.find((e) => e.source === 'find_assigner_task' && e.target === 'find_assigner_unit');
    const source = typeof gate?.condition === 'string' ? gate.condition : gate?.condition?.source;
    expect(source).toBe('isBlank(vars.existing_assigner_task)');

    const create = (node('create_assigner_task').config?.fields ?? {}) as AnyRec;
    expect(create.owner).toBe('{record.assigner}');
    expect(create.source).toBe('assigned');
  });
});

describe('assignment fan-out — invariants a refactor would undo', () => {
  it('nobody maintains a status rollup: the flow never writes duly_assignment', () => {
    // `task_count` is a Field.summary computed on read. A create/update node
    // pointed back at the assignment would also re-enter this same flow.
    const writers = allNodes().filter((n) => ['create_record', 'update_record', 'delete_record'].includes(n.type));
    expect(writers.length).toBeGreaterThan(0);
    for (const w of writers) {
      expect(w.config?.objectName, `${w.id} must not write the assignment`).toBe(Task.name);
    }
    expect(Assignment.fields.task_count.type).toBe('summary');
  });

  it('no predicate is wrapped in template braces', () => {
    // `{amount}` parses as a CEL map literal and fails at registration.
    for (const { where, source } of allPredicates()) {
      expect(source.trim(), `${where}`).not.toMatch(/^\{.*\}$/);
    }
  });

  it('every node id is unique across the graph and its regions', () => {
    const ids = allNodes().map((n) => n.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('no authored display text is hard-coded into a created record', () => {
    // English is the source language and every authored label belongs in a
    // translation bundle. A literal subject here would be untranslatable.
    for (const create of allNodes().filter((n) => n.type === 'create_record')) {
      const fields = (create.config?.fields ?? {}) as AnyRec;
      expect(fields.subject, `${create.id}`).toBe('{record.subject}');
    }
  });
});
