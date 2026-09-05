// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { JobServicePlugin } from '@objectstack/service-job';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { EmailServicePlugin } from '@objectstack/plugin-email';

import stack from '../objectstack.config.js';
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
interface RegionLike { nodes?: NodeLike[]; edges?: EdgeLike[] }

/** The ADR-0031 container slots this flow uses, in the order they nest. */
const region = (n: NodeLike, slot: 'body' | 'try' | 'catch'): RegionLike =>
  ((n.config?.[slot] ?? {}) as RegionLike);

/** The loop's outermost body region — one node, the `try_catch` container. */
const loopRegion = (): RegionLike => region(node('fan_out'), 'body');

/** The `try_catch` container the loop body is made of. */
const attempt = (): NodeLike => {
  const found = (loopRegion().nodes ?? []).find((n) => n.type === 'try_catch');
  if (!found) throw new Error('the loop body holds no try_catch container');
  return found;
};

/**
 * The PROTECTED region — what used to be the loop body directly.
 *
 * Every assertion below that reads "the loop body" means this: the three nodes
 * that do one assignee's work. They moved one level down when #123 wrapped them
 * in a `try_catch`, and reading them through this helper is what keeps those
 * assertions about the same three nodes instead of quietly finding nothing.
 */
const loopBody = (): { nodes: NodeLike[]; edges: EdgeLike[] } => {
  const body = region(attempt(), 'try');
  return { nodes: body.nodes ?? [], edges: body.edges ?? [] };
};

/** The handler region — what runs for an assignee whose work threw. */
const catchBody = (): { nodes: NodeLike[]; edges: EdgeLike[] } => {
  const body = region(attempt(), 'catch');
  return { nodes: body.nodes ?? [], edges: body.edges ?? [] };
};

/** Every node in the flow, every container region included. */
const allNodes = (): NodeLike[] => [
  ...nodes,
  ...(loopRegion().nodes ?? []),
  ...loopBody().nodes,
  ...catchBody().nodes,
];
/** Every edge in the flow, every container region included. */
const allEdges = (): EdgeLike[] => [
  ...edges,
  ...(loopRegion().edges ?? []),
  ...loopBody().edges,
  ...catchBody().edges,
];
/** Every predicate authored anywhere, as its bare CEL source. */
const allPredicates = (): { where: string; source: string }[] => {
  const out: { where: string; source: string }[] = [];
  const read = (where: string, c: EdgeLike['condition']) => {
    if (c == null) return;
    const source = typeof c === 'string' ? c : (c.source ?? '');
    if (source !== '') out.push({ where, source });
  };
  for (const n of allNodes()) read(`node '${n.id}' condition`, n.config?.condition as EdgeLike['condition']);
  for (const e of allEdges()) read(`edge '${e.id}'`, e.condition);
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

// ─────────────────────────────────────────────────────────────────────────
// One bad assignee, isolated — the structure (#123)
// ─────────────────────────────────────────────────────────────────────────

describe('assignment fan-out — a bad row costs one task, not the fan-out', () => {
  it('the loop body is a try_catch container and nothing else', () => {
    // `loop-node.ts` iterates with a bare `await runRegion(...)` and holds no
    // try/catch of its own, so anything that can throw must be INSIDE one. A
    // second node beside the container would be exactly that unprotected gap.
    const body = loopRegion();
    expect((body.nodes ?? []).map((n) => n.type)).toEqual(['try_catch']);
    expect(body.edges ?? []).toEqual([]);
  });

  it('every node that can fail sits inside the protected region', () => {
    // The three data nodes are the ones that return `success: false` or throw;
    // a `get_record`/`create_record` left outside the `try` would abort the
    // whole loop exactly as before the wrapper existed.
    expect(loopBody().nodes.map((n) => n.id)).toEqual([
      'fanout_find_existing', 'fanout_find_unit', 'fanout_create_task',
    ]);
    for (const n of loopBody().nodes) {
      expect(['get_record', 'create_record'], `${n.id}`).toContain(n.type);
    }
  });

  it('the handler tells the ASSIGNER, and names the assignee from the iterator', () => {
    const handler = catchBody().nodes;
    expect(handler.map((n) => n.type)).toEqual(['notify']);
    const config = (handler[0].config ?? {}) as AnyRec;
    expect(config.recipients).toBe('{record.assigner}');
    const templateData = (config.templateData ?? {}) as AnyRec;
    // `fanout_assignee` is re-bound by the loop before every iteration.
    // `fanout_assignee_user` is NOT: a region that throws at `fanout_find_unit`
    // leaves it holding the PREVIOUS assignee's row, so a handler reading a
    // name from it would calmly name the wrong colleague.
    expect(templateData.assignee).toBe('{fanout_assignee}');
    expect(JSON.stringify(templateData)).not.toContain('fanout_assignee_user');
  });

  it('the handler says something, in a bundle, never inline', () => {
    // AGENTS.md §8. `NotifyConfigSchema` refuses `template` beside inline
    // `title`/`message`, so the check that matters is that a template is named
    // at all — a handler with neither would not parse, and one with inline copy
    // would ship English into a zh-CN deployment.
    const config = (catchBody().nodes[0].config ?? {}) as AnyRec;
    expect(config.template).toBe('duly.assignment_fanout_failed');
    expect(Object.keys(config)).not.toContain('title');
    expect(Object.keys(config)).not.toContain('message');
  });

  it('the handler still writes nothing back onto the assignment', () => {
    // A write to the trigger record re-enters this same flow (the start node is
    // `record-after-write` on a row still `dispatched`), so the notification
    // would be re-sent on every re-entry. The inbox costs no such loop.
    for (const n of catchBody().nodes) {
      expect(['create_record', 'update_record', 'delete_record'], `${n.id}`).not.toContain(n.type);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The same claim, against a REAL booted engine (#123)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Everything above is structure. None of it can answer the question the card
 * is actually about — *what does the engine do with a bad row* — because the
 * abort lived in `loop-node.ts`, not in this flow's shape.
 *
 * ── Why the run is started by `automation.execute` and not by an insert ──
 * This repo installs no `record_change` trigger. The triggers ship as separate
 * packages (`@objectstack/trigger-*`) and only `trigger-schedule` is a
 * devDependency here, so a `duly_assignment` insert fires nothing and the boot
 * says so out loud:
 *
 *   WARN flow 'duly_assignment_fanout' declares a 'record_change' trigger but
 *   is NOT bound — it will never auto-launch.
 *
 * `execute(flowName, context)` is not a test-only side door around that: it is
 * the *same* door the trigger uses. `AutomationEngine.registerFlow` arms every
 * trigger with `trigger.start(binding, (ctx) => this.execute(flowName, ctx))`,
 * so a record-change fire and the call below differ only in who assembles the
 * context. WHICH context the trigger would assemble is pinned separately, by
 * the start-node assertions at the top of this file.
 */
describe('assignment fan-out — one bad row, driven through the real engine', () => {
  let kernel: any;
  let data: any;
  /** The two assignees whose rows are fine, and the manager who assigned. */
  let alice: string;
  let carol: string;
  let boss: string;
  let assignmentId: string;
  let result: AnyRec;
  let tasks: AnyRec[];
  let assignmentAfter: AnyRec;
  let inbox: AnyRec[];
  let notifications: AnyRec[];

  const SUBJECT = 'Quarterly control walkthrough';

  /** Per-node rollup from the run summary, by node id. */
  const nodeSummary = (id: string): AnyRec => {
    const nodesOut = ((result.summary as AnyRec)?.nodes ?? []) as AnyRec[];
    const found = nodesOut.find((n) => n.nodeId === id);
    if (!found) throw new Error(`run summary has no node '${id}'`);
    return found;
  };

  beforeAll(async () => {
    const { plugins } = await createStandaloneStack({
      // Memory, not sqlite: nothing here rests on a unique index (a fan-out
      // task writes neither `duty` nor `period_key`, so the dispatch identity
      // index cannot constrain these rows — see the idempotency block above).
      // What this suite DOES need is `sys_user`, which the bare standalone
      // stack does not declare — hence PlatformObjectsPlugin below. Measured:
      // on `databaseDriver: 'sqlite'` the `sys_user` read inside the loop is
      // refused by the driver, and every iteration fails for a reason that has
      // nothing to do with this card.
      databaseDriver: 'memory',
      skipSeedData: true,
      // Same reason as every other suite here: left to its default this
      // resolves `<cwd>/dist/objectstack.json`, and a local `pnpm build` would
      // make the run report on the last BUILD rather than on `src/`.
      artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
    });
    kernel = new ObjectKernel();
    for (const plugin of plugins) await kernel.use(plugin);
    await kernel.use(new PlatformObjectsPlugin());
    await kernel.use(new AppPlugin(stack as any, undefined, { skipSeedData: true }));
    await kernel.use(new JobServicePlugin());
    await kernel.use(new AutomationServicePlugin());
    // The handler's notification only reaches an inbox row if the delivery
    // path is real, and "a notification was emitted" is not the claim being
    // tested — "the assigner can read what went wrong" is.
    await kernel.use(new MessagingServicePlugin());
    await kernel.use(new EmailServicePlugin());
    await kernel.bootstrap();
    data = kernel.getService('data');
    const automation = kernel.getService('automation') as {
      execute(flow: string, ctx: AnyRec): Promise<AnyRec>;
    };

    const mkUser = async (name: string): Promise<string> => {
      const created = await data.insert(
        'sys_user',
        { name, username: name, email: `${name}@example.test` },
        { context: { isSystem: true } },
      );
      const row = (Array.isArray(created) ? created[0] : created) as AnyRec;
      return String(row.id);
    };
    alice = await mkUser('fanout_alice');
    carol = await mkUser('fanout_carol');
    boss = await mkUser('fanout_boss');

    const created = await data.insert('duly_assignment', {
      subject: SUBJECT,
      assigner: boss,
      // Three people, and the middle row is bad — a blank entry, the "missing
      // owner" shape from the card. The position is the point: `carol` comes
      // AFTER the failure, so a task of hers is proof the loop kept going
      // rather than proof it never had to.
      assignees: [alice, '', carol],
      due_date: '2026-10-01',
      status: 'dispatched',
      needs_collection: false,
    });
    const assignment = (Array.isArray(created) ? created[0] : created) as AnyRec;
    assignmentId = String(assignment.id);

    result = await automation.execute('duly_assignment_fanout', {
      record: assignment,
      object: 'duly_assignment',
      event: 'afterInsert',
    });

    tasks = (await data.find('duly_task', { where: { assignment: assignmentId } })) as AnyRec[];
    assignmentAfter = ((await data.find('duly_assignment', { where: { id: assignmentId } })) as AnyRec[])[0];
    // The messaging service hands the inbox channel the delivery and returns;
    // the row lands a moment later, so poll rather than sleep a fixed guess.
    const deadline = Date.now() + 10_000;
    for (;;) {
      inbox = (await data.find('sys_inbox_message', { where: { user_id: boss } })) as AnyRec[];
      if (inbox.length > 0 || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    notifications = (await data.find('sys_notification', {})) as AnyRec[];
  }, 180_000);

  afterAll(async () => {
    await kernel?.shutdown?.();
  });

  it('creates the other two tasks — including the assignee AFTER the bad row', () => {
    // The regression, stated as the product outcome: two of the three people
    // are holding their work. Without the try_catch this is ONE task (the loop
    // threw on the middle item and iteration three never ran).
    expect(tasks.map((t) => String(t.owner)).sort()).toEqual([alice, carol].sort());
    expect(tasks.every((t) => t.subject === SUBJECT)).toBe(true);
    expect(tasks.every((t) => t.status === 'open' && t.source === 'assigned')).toBe(true);
  });

  it('the count the assigner reads is the tasks that exist — two', () => {
    // `task_count` is a `Field.summary` over the children, so it cannot drift
    // from the rows; this asserts the rows are what a partial fan-out should
    // leave behind, not three and not zero.
    expect(assignmentAfter.task_count).toBe(2);
  });

  it('the run finishes and REPORTS the two it wrote, instead of acted: 0', () => {
    // The measured symptom in the card: an aborted loop never returns its
    // `childSteps`, so the two rows it had already written were invisible to
    // the run summary and it reported `acted: 0` next to `status: failed`.
    expect(result.success, String(result.error ?? '')).toBe(true);
    expect((result.summary as AnyRec).acted).toBe(2);
  });

  it('records the failure rather than swallowing it', () => {
    // "Recovered" must not read as "clean". The container reports success —
    // that is the point of catching — and underneath it the failing node still
    // carries its own failure, once, at the iteration it happened in.
    expect(nodeSummary('fanout_attempt')).toMatchObject({
      nodeType: 'try_catch', runs: 3, failures: 0,
    });
    expect(nodeSummary('fanout_create_task')).toMatchObject({
      nodeType: 'create_record', runs: 3, failures: 1, acted: 2,
    });
  });

  it('tells the assigner, in their inbox, which row failed and why', () => {
    // Not "a notification was emitted": a template that resolves to nothing
    // emits one too. The assertion is on the words the assigner reads.
    expect(inbox.length, 'the assigner got no notification at all').toBe(1);
    const message = inbox[0];
    expect(message.topic).toBe('duly.assignment_fanout_failed');
    expect(message.severity).toBe('warning');
    // The subject rides in unescaped (`{{{subject}}}`) — the inbox title is not
    // an HTML document.
    expect(message.title).toBe(`No task was created for one assignee: ${SUBJECT}`);
    // The engine's own sentence, naming the node and the real cause.
    expect(String(message.body_md)).toContain('Owner is required');
    expect(String(message.body_md)).toContain('fanout_create_task');
    // And a way back to the assignment, so the assigner can fix the row.
    expect(String(message.action_url)).toContain(assignmentId);
  });

  it('one notification per failed assignee — not one per fan-out', () => {
    // Three assignees, one bad row, one message. A handler that fired per RUN
    // could not name the person; one that fired per iteration would tell the
    // assigner twice about the people who are fine.
    expect(notifications.length).toBe(1);
  });

  it('the handler read the ITERATOR, not the previous assignee it looked up', () => {
    // `fanout_assignee_user` still holds ALICE's row when the middle iteration
    // fails — the loop shares one variable scope across iterations. A handler
    // that named the person from it would have reported Alice, who is fine.
    // The blank handle below is the bad row's own value, and its blankness is
    // the evidence: a stale read could not have produced it.
    const payload = (notifications[0].payload ?? {}) as AnyRec;
    const templateData = (payload.templateData ?? {}) as AnyRec;
    expect(templateData.assignee).toBe('');
    expect(templateData.subject).toBe(SUBJECT);
    expect(String(templateData.reason)).toContain('Owner is required');
  });
});
