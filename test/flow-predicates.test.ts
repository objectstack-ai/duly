// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import {
  FLOW_NODE_EXPRESSION_PATHS,
  FLOW_REGION_CONFIG_KEYS,
  collectFlowGraphs,
} from '@objectstack/spec/automation';
import { JobSchema } from '@objectstack/spec/system';

import { dulyFlows } from '../src/flows/index.js';
import { dulyJobs } from '../src/jobs/index.js';
import { dulyObjects } from '../src/objects/index.js';

/**
 * ⚠️ STOPGAP — delete this file when objectstack-ai/objectstack#14089 lands.
 *
 * This is not a repo-local house rule that wants maintaining forever. It is a
 * lint gap in `@objectstack/lint` that every ObjectStack application would
 * otherwise re-implement, filed upstream as **objectstack-ai/objectstack#14089**.
 * When the platform rule ships, `pnpm validate` covers this and the right move
 * is to REMOVE this file, not to keep two guards in step.
 *
 * ── What the gap is, and how narrow it is ────────────────────────────────
 * This file covers the ONLY predicate surfaces the platform leaves open. What
 * decides that is SCOPE, not surface name. A record-scoped expression — an
 * object validation rule, a field conditional rule, an action `visible` /
 * `disabled`, a sharing rule, a hook condition — binds the record as the
 * `record` namespace and nothing at top level, so a bare name binds nothing
 * and `validate` rejects it, located and corrective. Measured on
 * `@objectstack/cli` 17.2.0, `duly_task`'s `skip_needs_reason` rule mutated to
 * a bare `status` exits 1 with "bare reference `status` — … resolves to
 * nothing and the expression silently evaluates to null. Write
 * `record.status`."
 *
 * Flow node and edge conditions are the exception. They run in FLATTENED
 * scope, where the engine spreads the trigger record's fields to top-level
 * names and a bare identifier may genuinely be a flow variable, so
 * `collectBoundRecordReads` deliberately never judges one — a false finding
 * there is the trust-killer ADR-0072 D1 names. Measured at the same version:
 * a start condition mutated to `status == "dispatched"` passes validate with
 * exit 0, while `record.needs_colection` at the same site fails with a located
 * message. So the gate exists for qualified reads everywhere, and for bare
 * ones everywhere EXCEPT here — which is the whole scope of this file.
 *
 * ── The bar this file enforces ───────────────────────────────────────────
 * A bare identifier in a flow predicate is a finding when BOTH hold:
 *
 *   1. it names a DECLARED field of the flow's bound object, and
 *   2. it names no variable the flow declares.
 *
 * That is deliberately the same bar #14089 proposes upstream, so this guard
 * and the eventual platform rule cannot disagree about what is a defect.
 * Condition (2) is the platform's exemption, kept: a loop iterator, an index,
 * a `get_record` output and an `assignment` target are all legitimately bare.
 *
 * ── Narrowings, stated rather than hidden ────────────────────────────────
 * A guard people learn to ignore is worse than no guard, so this one only
 * fires where it is certain, and says where it stops:
 *
 *  - **Declared fields only.** The anchor is `Object.keys(object.fields)`.
 *    System columns (`id`, `created_at`, `created_by`, …) are not declared in
 *    application metadata and `@objectstack/spec` exports no list of them, so
 *    a bare `id` is NOT flagged. Hand-copying that list here would be a second
 *    copy of platform knowledge that silently drifts.
 *  - **Bound object required.** A predicate in a flow whose start node binds no
 *    object this repo declares has no field set to anchor on, so it yields no
 *    findings. `every record_change flow binds a declared object` below keeps
 *    that from becoming a silent hole.
 *  - **Neither-field-nor-variable is never a finding.** CEL builtins
 *    (`isBlank`, `has`, `size`), comprehension bindings and literals are left
 *    alone by construction — they are not fields, so rule (1) excludes them.
 *
 * ── Why it uses the platform's own walk ──────────────────────────────────
 * Region recursion is `collectFlowGraphs` (ADR-0031 containers: `loop.body`,
 * `parallel.branches[]`, `try_catch.try`/`.catch`, nested), the predicate slot
 * table is `FLOW_NODE_EXPRESSION_PATHS`, and the "config without its regions"
 * view is `FLOW_REGION_CONFIG_KEYS`. A hand-rolled `config.body.edges` walk —
 * the shape this repo already had, scoped to one flow — covers `loop` and
 * silently misses `parallel` and `try_catch`. Reading the platform's tables
 * means a container type or predicate slot added upstream is covered here
 * without anyone editing this file.
 */

// ─── The predicate inventory ─────────────────────────────────────────────

type AnyRec = Record<string, unknown>;

/** A CEL envelope as `P` / `cel` emit it: `{ dialect: 'cel', source }`. */
const celSource = (v: unknown): string | undefined => {
  if (typeof v !== 'object' || v === null) return undefined;
  const e = v as AnyRec;
  if (e.dialect !== 'cel') return undefined;
  return typeof e.source === 'string' ? e.source : undefined;
};

/**
 * Path suffixes at which a BARE STRING is CEL shorthand rather than data.
 *
 * `ExpressionInputSchema` accepts `z.string()` and normalises it to
 * `{ dialect: 'cel', source }` at build, so an author may write either form
 * and both must be walked. The declared slots come from the platform's own
 * predicate table; `condition` is added by hand, and that is the platform's
 * instruction rather than a gap to report:
 * `FLOW_NODE_EXPRESSION_PATHS` lists the slots a builtin's `configSchema`
 * DECLARES, and its docstring says `config.condition` and `edge.condition` are
 * left out deliberately because they are structural predicate surfaces present
 * on every node and edge rather than declared config properties. So the table
 * covers the declared slots and this constant adds the two structural ones —
 * do not "fix" that upstream.
 *
 * Matching is on the FULL suffix, not the last segment: a schedule flow keeps
 * its cron at `config.schedule` on the start node, and `schedule.expression`
 * must not be read as `conditions.expression`.
 */
const CEL_STRING_PATH_SUFFIXES: readonly string[] = [
  'condition',
  ...FLOW_NODE_EXPRESSION_PATHS.filter((p) => p.role === 'predicate').map((p) =>
    p.path.replace(/\[\]/g, ''),
  ),
];

const isCelStringPath = (path: readonly string[]): boolean =>
  CEL_STRING_PATH_SUFFIXES.some((suffix) => {
    const want = suffix.split('.');
    if (want.length > path.length) return false;
    return want.every((seg, i) => path[path.length - want.length + i] === seg);
  });

interface Predicate {
  /** Human-readable site, e.g. `duly_assignment_fanout · loop 'fan_out' body · edge 'fanout_e_missing'`. */
  readonly where: string;
  readonly source: string;
}

/** Collect every CEL expression under `value`, recursing through arrays and objects. */
const scan = (
  value: unknown,
  path: readonly string[],
  where: (path: readonly string[]) => string,
  out: Predicate[],
): void => {
  const envelope = celSource(value);
  if (envelope !== undefined) {
    out.push({ where: where(path), source: envelope });
    return;
  }
  if (typeof value === 'string') {
    if (isCelStringPath(path)) out.push({ where: where(path), source: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => scan(item, [...path, String(i)], where, out));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value as AnyRec)) {
      scan(child, [...path, key], where, out);
    }
  }
};

/**
 * Every predicate authored anywhere in a flow, region bodies included.
 *
 * Region slots are skipped when scanning a container's own config — the region
 * arrives as its own graph from `collectFlowGraphs`, and scanning it twice
 * would report every nested finding a second time against the container that
 * physically holds it. That is exactly what `FLOW_REGION_CONFIG_KEYS` is for.
 */
const predicatesOf = (flow: AnyRec): Predicate[] => {
  const out: Predicate[] = [];
  const flowName = String(flow.name);
  for (const graph of collectFlowGraphs(flow as never)) {
    const scope = graph.scope === '' ? '' : ` · ${graph.scope}`;
    for (const node of graph.nodes as unknown as { id: string; type: string; config?: AnyRec }[]) {
      const config = Object.fromEntries(
        Object.entries(node.config ?? {}).filter(([k]) => !FLOW_REGION_CONFIG_KEYS.has(k)),
      );
      scan(config, [], (p) => `${flowName}${scope} · node '${node.id}' config.${p.join('.')}`, out);
    }
    for (const edge of graph.edges as unknown as { id: string }[]) {
      scan(edge, [], (p) => `${flowName}${scope} · edge '${edge.id}' ${p.join('.')}`, out);
    }
  }
  return out;
};

// ─── The flow's own declared variable names ──────────────────────────────

/**
 * Config keys whose STRING VALUE is a variable name the flow binds.
 *
 * Sourced from the spec, one entry per declaring schema — not guessed:
 *  - `iteratorVariable` / `indexVariable` — `LoopConfigSchema`, `MapConfigSchema`
 *  - `outputVariable`   — `GetRecordConfigSchema`, `ScriptConfigSchema`,
 *                         `SubflowConfigSchema`, flow-function nodes
 *  - `idVariable`       — `ScreenConfigSchema`, object-form mode
 *  - `errorVariable`    — `TryCatchConfigSchema`
 *
 * `assignment` is not in this table because it cannot be: with no `assignments`
 * wrapper, the TOP-LEVEL config keys of an `assignment` node ARE the author's
 * variable names (the spec records that exemption by name). Handled below.
 */
const VARIABLE_BINDING_KEYS = new Set([
  'iteratorVariable',
  'indexVariable',
  'outputVariable',
  'idVariable',
  'errorVariable',
]);

interface VariableScan {
  readonly names: Set<string>;
  /** `*Variable` keys seen that this walk does not know how to read. */
  readonly unknownBinders: string[];
}

const declaredVariables = (flow: AnyRec): VariableScan => {
  const names = new Set<string>();
  const unknownBinders: string[] = [];

  for (const v of (flow.variables ?? []) as { name?: unknown }[]) {
    if (typeof v?.name === 'string') names.add(v.name);
  }

  // A region executes in the ENCLOSING variable scope (FlowRegionSchema), so
  // every binder anywhere in the flow contributes to one flat namespace.
  for (const graph of collectFlowGraphs(flow as never)) {
    for (const node of graph.nodes as unknown as { type: string; config?: AnyRec }[]) {
      const config = node.config ?? {};
      if (node.type === 'assignment') {
        for (const key of Object.keys(config)) names.add(key);
        continue;
      }
      for (const [key, value] of Object.entries(config)) {
        if (VARIABLE_BINDING_KEYS.has(key)) {
          if (typeof value === 'string') names.add(value);
          continue;
        }
        if (/variable/i.test(key)) unknownBinders.push(`${node.type}.config.${key}`);
      }
    }
  }
  return { names, unknownBinders };
};

// ─── Bare-identifier extraction ──────────────────────────────────────────

/** String literals hold data, not references — blank them before tokenising. */
const withoutStringLiterals = (source: string): string =>
  source.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => ' '.repeat(m.length));

/**
 * Identifiers read as bare names: not reached through a `.`, not a call.
 * `record.status` yields nothing; `isBlank(x)` yields `x`; `status` yields
 * `status`.
 */
const bareIdentifiers = (source: string): string[] => {
  const out: string[] = [];
  const re = /(^|[^.\w$])([A-Za-z_][A-Za-z0-9_]*)\s*(\(?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutStringLiterals(source))) !== null) {
    if (m[3] === '(') continue; // a function call, not a reference
    out.push(m[2]);
    re.lastIndex = m.index + m[1].length + m[2].length;
  }
  return out;
};

// ─── The check ───────────────────────────────────────────────────────────

const objectByName = new Map(
  (dulyObjects as unknown as { name: string; fields: AnyRec }[]).map((o) => [o.name, o]),
);

const boundObjectName = (flow: AnyRec): string | undefined => {
  const start = (flow.nodes as unknown as { type: string; config?: AnyRec }[]).find(
    (n) => n.type === 'start',
  );
  const name = start?.config?.objectName;
  return typeof name === 'string' ? name : undefined;
};

interface Finding {
  readonly where: string;
  readonly identifier: string;
  readonly source: string;
}

/**
 * The whole rule, in one function, so the self-tests below exercise the same
 * code path the real metadata goes through.
 */
export const bareFieldReferences = (flow: AnyRec): Finding[] => {
  const bound = objectByName.get(boundObjectName(flow) ?? '');
  if (!bound) return [];
  const fields = new Set(Object.keys(bound.fields));
  const { names: variables } = declaredVariables(flow);

  const findings: Finding[] = [];
  for (const { where, source } of predicatesOf(flow)) {
    for (const identifier of bareIdentifiers(source)) {
      if (!fields.has(identifier)) continue; // not a field of the bound object
      if (variables.has(identifier)) continue; // a legitimate flow variable
      findings.push({ where, identifier, source });
    }
  }
  return findings;
};

const flows = dulyFlows as unknown as AnyRec[];

describe('flow predicates — no bare field reference (stopgap for objectstack#14089)', () => {
  it('every predicate in dulyFlows qualifies its record reads with `record.`', () => {
    const findings = flows.flatMap((flow) => bareFieldReferences(flow));
    expect(
      findings.map(
        (f) => `${f.where}: reads '${f.identifier}' bare — write record.${f.identifier}  [${f.source}]`,
      ),
      'a bare name that is a field of the bound object and not a declared flow variable',
    ).toEqual([]);
  });

  it('the walk reaches predicates inside loop / parallel / try_catch bodies', () => {
    // The nested predicate is the one a hand-written walk misses, so the walk
    // reaching it is asserted rather than assumed. Vacuously passing here would
    // make the guard above worthless for exactly the site it exists to cover.
    const scopes = flows.flatMap((flow) => predicatesOf(flow)).map((p) => p.where);
    expect(scopes.length, 'no predicate found at all — the collector is broken').toBeGreaterThan(0);
    expect(
      scopes.some((s) => /·\s(loop|parallel|try_catch)\s/.test(s)),
      `no predicate found inside a region body; sites were:\n  ${scopes.join('\n  ')}`,
    ).toBe(true);
  });

  it('every record_change flow binds an object this repo declares', () => {
    // The rule is anchored on the bound object's field list. A flow whose start
    // node names an object we cannot resolve would pass by having nothing to
    // check — this is the assertion that keeps that from being silent.
    for (const flow of flows) {
      if (flow.type !== 'record_change') continue;
      const name = boundObjectName(flow);
      expect(name, `flow '${String(flow.name)}' declares no start-node objectName`).toBeDefined();
      expect(
        objectByName.has(name!),
        `flow '${String(flow.name)}' binds '${name}', which is not in dulyObjects — the bare-reference check has no field list to anchor on`,
      ).toBe(true);
    }
  });

  it('no declared flow variable shadows a field of the bound object', () => {
    // This is what makes the variable exemption SOUND rather than a hole. A
    // variable named after a field would both (a) exempt a genuine bare field
    // reference from the check above and (b) silently replace the field for the
    // rest of the flow, since variables are seeded before the trigger record is
    // flattened to top-level names.
    for (const flow of flows) {
      const bound = objectByName.get(boundObjectName(flow) ?? '');
      if (!bound) continue;
      const fields = Object.keys(bound.fields);
      for (const name of declaredVariables(flow).names) {
        expect(
          fields,
          `flow '${String(flow.name)}': variable '${name}' shadows the '${bound.name}' field of the same name`,
        ).not.toContain(name);
      }
    }
  });

  it('knows every variable-binding config key present in dulyFlows', () => {
    // The variable table above is hand-maintained against the spec. If a flow
    // uses a binder this walk cannot read, its variable is invisible to the
    // exemption and the check would report a FALSE POSITIVE. Fail here, loudly
    // and specifically, rather than there.
    for (const flow of flows) {
      expect(
        declaredVariables(flow).unknownBinders,
        `flow '${String(flow.name)}' uses a variable-binding key this walk does not know — teach VARIABLE_BINDING_KEYS about it before trusting the check`,
      ).toEqual([]);
    }
  });
});

describe('flow predicates — the guard can fail (self-test on synthetic metadata)', () => {
  // A guard that has never been observed failing is indistinguishable from a
  // guard that cannot fail. These fixtures pin both directions permanently, so
  // the property survives a refactor of the walk above.
  const fixture = (bodyEdgeCondition: unknown, extra: AnyRec = {}): AnyRec => ({
    name: 'fixture_flow',
    type: 'record_change',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'start',
        config: { objectName: 'duly_assignment', triggerType: 'record-after-write' },
      },
      {
        id: 'sweep',
        type: 'loop',
        label: 'sweep',
        config: {
          collection: '{record.assignees}',
          body: {
            nodes: [{ id: 'inner', type: 'get_record', label: 'inner', config: { objectName: 'duly_task' } }],
            edges: [{ id: 'inner_edge', source: 'inner', target: 'inner', condition: bodyEdgeCondition }],
          },
          ...extra,
        },
      },
    ],
    edges: [],
  });

  it('flags a bare field reference nested in a loop body', () => {
    const findings = bareFieldReferences(fixture({ dialect: 'cel', source: 'status == "dispatched"' }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.identifier).toBe('status');
    expect(findings[0]!.where).toContain("loop 'sweep' body");
  });

  it('flags the bare-string shorthand form too, not only the `P` envelope', () => {
    // `ExpressionInputSchema` accepts a raw string; build normalises it later.
    const findings = bareFieldReferences(fixture('needs_collection == true'));
    expect(findings.map((f) => f.identifier)).toEqual(['needs_collection']);
  });

  it('does not flag the same read written correctly', () => {
    expect(bareFieldReferences(fixture({ dialect: 'cel', source: 'record.status == "dispatched"' }))).toEqual([]);
  });

  it('does not flag a bare name that is a declared loop iterator', () => {
    // The false positive the platform exemption exists for. `status` here is
    // the loop's iterator variable, not the record field of the same name.
    expect(bareFieldReferences(fixture({ dialect: 'cel', source: 'status != ""' }, { iteratorVariable: 'status' }))).toEqual([]);
  });

  it('does not flag CEL builtins, string literals or qualified reads', () => {
    const flow = fixture({
      dialect: 'cel',
      source: 'isBlank(vars.existing) && record.subject != "status" && size(record.assignees) > 0',
    });
    expect(bareFieldReferences(flow)).toEqual([]);
  });

  it('reports each bare field in a compound predicate, not just the first', () => {
    // The scoped walk this file replaces asked "does the source CONTAIN
    // `record.<field>`", so `status == "x" && record.status == "y"` passed.
    const findings = bareFieldReferences(
      fixture({ dialect: 'cel', source: 'status == "x" && record.status == "y" && due_date != null' }),
    );
    expect(findings.map((f) => f.identifier).sort()).toEqual(['due_date', 'status']);
  });
});

describe('flow predicates — dulyJobs', () => {
  // Measured against `JobSchema` at @objectstack/spec 17.2.0: a job declares
  // `name / label / description / schedule / handler / retryPolicy / timeout /
  // enabled` and NO predicate slot. Its schedule is a `cron` envelope, not CEL,
  // and its logic is a named handler function — imperative TypeScript, outside
  // any CEL surface. So the walk over jobs is a TRIPWIRE, not a live check:
  // the day a job carries a CEL expression, these go red and say what to do.
  const jobs = dulyJobs as unknown as AnyRec[];

  it('JobSchema still declares no predicate slot', () => {
    const declared = Object.keys((JobSchema as unknown as { shape: AnyRec }).shape);
    expect(
      declared.filter((k) => ['condition', 'criteria', 'visibleWhen', 'predicate', 'filter'].includes(k)),
      'a job grew a predicate slot — extend the flow walk to cover it and drop this tripwire',
    ).toEqual([]);
  });

  it('no job carries a CEL expression the flow walk cannot check', () => {
    // A job has no bound object, so the field-anchored rule has nothing to
    // resolve against. Rather than pass vacuously, fail with the reason.
    for (const job of jobs) {
      const found: Predicate[] = [];
      scan(job, [], (p) => `job '${String(job.name)}' ${p.join('.')}`, found);
      expect(
        found.map((f) => `${f.where}: ${f.source}`),
        'a job authored a CEL expression; a job binds no object, so this guard cannot anchor a bare-reference check on it — give the job walk a field source before relying on it',
      ).toEqual([]);
    }
  });
});
