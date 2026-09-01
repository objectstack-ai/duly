// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import {
  DueSoonReminder,
  LeadTimeReminder,
  OverdueOwnerEscalation,
  dulyFlows,
  dulyReminderFlows,
} from '../src/flows/index.js';
import { CatalogItem, Duty, Task } from '../src/objects/index.js';
import { planDispatch } from '../src/jobs/dispatch.plan.js';

/**
 * These are not schema tests. `pnpm validate` parses each flow and — measured
 * below the fold — resolves every `record.<field>` in every predicate against
 * the bound object, so a misspelt qualified read is already caught.
 *
 * What is pinned here is the part nothing in the toolchain checks, and every
 * one of these fails SILENTLY when it breaks:
 *
 *  - **The bound object.** `objectstack validate` anchors its record-read
 *    check on the start node's `objectName`, and so does the repo's
 *    bare-identifier stopgap (`test/flow-predicates.test.ts`, whose own
 *    "binds a declared object" assertion covers `record_change` flows only).
 *    On a `time_relative` flow the object ALSO lives at
 *    `config.timeRelative.object`, so it is easy to write the flow with only
 *    that one — and then both gates resolve nothing and pass. Measured on
 *    `@objectstack/cli` 17.2.0 by ablation, both legs in one shell:
 *
 *      misspell `record.due_date` → `record.due_dat`
 *        · with `objectName` on the start nodes  → validate EXIT 1, two located
 *          findings: "unknown field `due_dat` on `duly_task` — did you mean
 *          `due_date`?", naming edge `e_no_duty_day_one` and edge `e_day_one`
 *        · with `objectName` deleted             → validate EXIT 0,
 *          "✓ Validation passed", no finding at all
 *
 *    So `objectName` is not redundant with `timeRelative.object`; it is what
 *    keeps the whole predicate surface of these flows checked. Hence the test.
 *
 *  - **Volume discipline.** Nothing type-checks "one message per recipient",
 *    "nothing for a completed task", or "the escalation gate is day equality
 *    and not a threshold". A `>=` where a `==` belongs re-notifies daily and
 *    reads identically.
 *
 *  - **The two measured CEL traps** the flows are written around — the `P`
 *    tag's value interpolation, and `int()` placement in the grace
 *    arithmetic. Both produce a predicate that parses, ships, and means
 *    something else.
 */

type AnyRec = Record<string, unknown>;
interface NodeLike { id: string; type: string; label: string; config?: AnyRec }
interface EdgeLike {
  id: string; source: string; target: string; isDefault?: boolean;
  condition?: string | { dialect?: string; source?: string };
}
interface FlowLike {
  name: string; label: string; type: string; status?: string; runAs?: string;
  variables?: { name: string }[]; nodes: NodeLike[]; edges: EdgeLike[];
}

const flows = dulyReminderFlows as unknown as FlowLike[];

const startOf = (f: FlowLike): NodeLike => {
  const n = f.nodes.find((x) => x.type === 'start');
  if (!n) throw new Error(`flow '${f.name}' has no start node`);
  return n;
};
const nodesOf = (f: FlowLike, type: string): NodeLike[] => f.nodes.filter((n) => n.type === type);
const timeRelativeOf = (f: FlowLike): AnyRec => (startOf(f).config?.timeRelative ?? {}) as AnyRec;
const sourceOf = (c: EdgeLike['condition']): string =>
  c == null ? '' : typeof c === 'string' ? c : (c.source ?? '');
/** Every predicate authored anywhere in the flow, with its site. */
const predicatesOf = (f: FlowLike): { where: string; source: string }[] => {
  const out: { where: string; source: string }[] = [];
  for (const n of f.nodes) {
    const s = sourceOf(n.config?.condition as EdgeLike['condition']);
    if (s) out.push({ where: `${f.name} node '${n.id}'`, source: s });
  }
  for (const e of f.edges) {
    const s = sourceOf(e.condition);
    if (s) out.push({ where: `${f.name} edge '${e.id}'`, source: s });
  }
  return out;
};
/** Conditional edges into `target`, i.e. every gate a run must pass to reach it. */
const gatesInto = (f: FlowLike, target: string): EdgeLike[] =>
  f.edges.filter((e) => e.target === target && e.condition != null);

// ─── Wiring ──────────────────────────────────────────────────────────────

describe('reminder sweeps — wiring', () => {
  it('all three are in dulyFlows (a flow not in its barrel never runs)', () => {
    for (const f of [LeadTimeReminder, DueSoonReminder, OverdueOwnerEscalation]) {
      expect(dulyFlows).toContain(f);
    }
    expect(dulyReminderFlows).toHaveLength(3);
  });

  it('each runs as system and is active, not draft', () => {
    // A sweep has no trigger user, so under the default `runAs: 'user'` every
    // data operation in the run is REFUSED (#3760) — the flow binds, fires and
    // does nothing. A `draft` flow registers and never dispatches, which looks
    // identical to a working flow from the outside.
    for (const f of flows) {
      expect(f.runAs, `flow '${f.name}'`).toBe('system');
      expect(f.status, `flow '${f.name}'`).toBe('active');
      expect(f.type, `flow '${f.name}'`).toBe('schedule');
    }
  });

  it('binds on the START node config, never at the flow top level', () => {
    // `FlowSchema` is strict and declares no `object` / `schedule` / `trigger`
    // key; the engine's `resolveTriggerBinding` reads the start node's config
    // and nowhere else.
    for (const f of flows) {
      for (const key of ['object', 'objectName', 'schedule', 'trigger', 'timeRelative']) {
        expect(Object.keys(f), `flow '${f.name}' top-level '${key}'`).not.toContain(key);
      }
      expect(startOf(f).config?.timeRelative, `flow '${f.name}'`).toBeDefined();
    }
  });

  it('carries the cron as a SIBLING of timeRelative, not a key inside it', () => {
    // The descriptor's own guidance channel exists for this exact wrong-layer
    // mistake; a `schedule` nested inside `timeRelative` is refused at bind.
    for (const f of flows) {
      expect(startOf(f).config?.schedule, `flow '${f.name}'`).toEqual({
        type: 'cron',
        expression: '0 8 * * *',
      });
      expect(Object.keys(timeRelativeOf(f)), `flow '${f.name}'`).not.toContain('schedule');
    }
  });

  it('every start node names the bound object, so both record-read gates anchor', () => {
    // See the file header: with `objectName` deleted, an ablated misspelling
    // in these predicates passes `pnpm validate` with exit 0 and no finding.
    const declared = new Set([Task.name, Duty.name]);
    for (const f of flows) {
      const objectName = startOf(f).config?.objectName;
      expect(objectName, `flow '${f.name}' start node has no objectName`).toBe(Task.name);
      expect(declared.has(String(objectName))).toBe(true);
      // …and it must agree with the object the sweep actually queries.
      expect(timeRelativeOf(f).object, `flow '${f.name}'`).toBe(objectName);
    }
  });

  it('declares `duty_record` bound, and it shadows no duly_task field', () => {
    // A `get_record` leaves its outputVariable unset when it does not run, and
    // an unbound name aborts the CEL predicate that reads it. A declared
    // variable named after a record field would silently REPLACE that field.
    const taskFields = Object.keys(Task.fields);
    for (const f of flows) {
      const declared = (f.variables ?? []).map((v) => v.name);
      expect(declared, `flow '${f.name}'`).toContain('duty_record');
      for (const name of declared) expect(taskFields, `flow '${f.name}'`).not.toContain(name);
    }
  });
});

// ─── The sweep windows are the schedule ──────────────────────────────────

describe('reminder sweeps — the windows say what the card says', () => {
  it('the two owner reminders use OFFSET mode, which is what makes them once-ever', () => {
    // In offset mode the trigger's dispatch-claim scope is the TARGET day plus
    // the offset, so a record matches on exactly one calendar day and claims
    // one key for good. In range mode the scope is the SWEEP day and the same
    // record re-fires daily — correct for the overdue lookback, fatal here.
    expect(timeRelativeOf(LeadTimeReminder as unknown as FlowLike)).toMatchObject({
      dateField: 'visible_from',
      offsetDays: [0],
    });
    expect(timeRelativeOf(DueSoonReminder as unknown as FlowLike)).toMatchObject({
      dateField: 'due_date',
      offsetDays: [2],
    });
    for (const f of [LeadTimeReminder, DueSoonReminder] as unknown as FlowLike[]) {
      expect(Object.keys(timeRelativeOf(f)), `flow '${f.name}'`).not.toContain('withinDays');
    }
  });

  it('the two reminders sweep DIFFERENT date fields — which is why they are two flows', () => {
    // A `timeRelative` descriptor carries exactly one `dateField`. The card
    // asks for one reminder on `visible_from` and one on `due_date`, so the
    // split is the descriptor's shape, not a choice. The budget the card sets
    // is per TASK (two, maximum, ever) and both flows respect it.
    const fields = [LeadTimeReminder, DueSoonReminder]
      .map((f) => timeRelativeOf(f as unknown as FlowLike).dateField);
    expect(new Set(fields).size).toBe(2);
  });

  it('the overdue sweep is a BOUNDED past-due lookback', () => {
    const tr = timeRelativeOf(OverdueOwnerEscalation as unknown as FlowLike);
    expect(tr.dateField).toBe('due_date');
    expect(tr.withinDays).toBe(-15);
    expect(Object.keys(tr)).not.toContain('offsetDays');
  });

  it('the lookback still covers the largest grace a duty can declare', () => {
    // The escalation day is `due_date + grace_days + 1`, so a duty whose grace
    // pushes that day outside the swept window is never escalated — silently.
    // Nothing but this assertion holds the two numbers together: they live in
    // two files (`src/flows/reminders.flow.ts`, `src/objects/duty.object.ts`)
    // and neither can see the other.
    const lookback = -Number(timeRelativeOf(OverdueOwnerEscalation as unknown as FlowLike).withinDays);
    const graceMax = (Duty.fields.grace_days as { max?: number }).max;
    expect(
      graceMax !== undefined && graceMax + 1 <= lookback,
      `duly_duty.grace_days declares max ${String(graceMax)}, which needs a lookback of at least ` +
        `${Number(graceMax) + 1} days; the sweep looks back ${lookback}`,
    ).toBe(true);
    // The direction the previous version of this test guarded — an UNBOUNDED
    // grace — is now closed by declaration (#82), and this half is what keeps
    // it closed. Deleting the field's `max` would put the silent case back:
    // every value above 14 saves clean and is never escalated, which is not a
    // gap a reader of either file would notice.
    expect(graceMax, 'grace_days lost its max — an unbounded grace is silently never escalated').toBe(
      lookback - 1,
    );
    // Both objects declare the same ceiling. `duly_catalog_item.grace_days` is
    // copied onto every duty an apply creates, so a laxer bound there is the
    // same silent hole reached one object earlier.
    expect((CatalogItem.fields.grace_days as { max?: number }).max).toBe(graceMax);
  });
});

// ─── Volume discipline — the acceptance criteria ─────────────────────────

describe('reminder sweeps — volume discipline', () => {
  it('nothing fires for done / skipped / cancelled — enforced in the sweep FILTER', () => {
    // In the filter rather than in a gate: a completed task then never launches
    // a run at all, so it also never consumes a dispatch claim. That is what
    // makes "completing a task produces no further notifications of any kind"
    // true by construction instead of by a condition repeated on every path.
    for (const f of flows) {
      expect(timeRelativeOf(f).filter, `flow '${f.name}'`).toEqual({
        status: { $in: ['open', 'in_progress'] },
      });
    }
    const live = ['open', 'in_progress'];
    const statuses = (Task.fields.status as { options: { value: string }[] }).options
      .map((o) => o.value);
    // Pins the complement rather than the list: a new terminal status added to
    // duly_task would otherwise start receiving reminders unnoticed.
    expect(statuses.filter((s) => !live.includes(s)).sort())
      .toEqual(['cancelled', 'done', 'skipped']);
  });

  it('every notification goes to the task OWNER and to nobody else', () => {
    // This file is the owner-facing half of the card by decision. The manager
    // digests are absent (see the flow file header and the report), and the
    // card's "the stagnation digest never addresses the task owner" has its
    // mirror here: no sweep in this file addresses a manager.
    for (const f of flows) {
      const notifies = nodesOf(f, 'notify');
      expect(notifies.length, `flow '${f.name}' should send exactly one notification`).toBe(1);
      const cfg = notifies[0]!.config ?? {};
      expect(cfg.recipients, `flow '${f.name}'`).toBe('{record.owner}');
      expect(JSON.stringify(cfg), `flow '${f.name}' mentions a manager`).not.toMatch(/manager/i);
    }
  });

  it('the click-through target is a complete pair, never half-specified', () => {
    // `sourceObject` / `sourceId` only take effect together; a half-specified
    // target is dropped at execute time and the inbox renders no link at all.
    for (const f of flows) {
      const cfg = nodesOf(f, 'notify')[0]!.config ?? {};
      expect(cfg.sourceObject, `flow '${f.name}'`).toBe(Task.name);
      expect(cfg.sourceId, `flow '${f.name}'`).toBe('{record.id}');
    }
  });

  it('the overdue gate is day EQUALITY, not a threshold', () => {
    // `>=` re-notifies on every remaining day of the lookback window and reads
    // identically to the correct predicate.
    const escalation = OverdueOwnerEscalation as unknown as FlowLike;
    const gates = gatesInto(escalation, 'notify_owner').map((e) => sourceOf(e.condition));
    expect(gates.length).toBe(2); // the duty path and the duty-less path
    for (const g of gates) {
      expect(g).toMatch(/daysBetween\(record\.due_date, today\(\)\) ==/);
      expect(g, 'a threshold here re-notifies daily').not.toMatch(/daysBetween\([^)]*\)[^=]*>=/);
    }
  });

  it('no reminder can be reached without passing the duty effective-window gate', () => {
    // "Nothing fires outside a duty's effective_from / effective_to window."
    // The duty-less path is the deliberate exemption: an assignment fan-out
    // task names no duty and so has no window to be outside of.
    for (const f of flows) {
      const viaDuty = f.edges.filter((e) => e.source === 'read_duty' && e.target === 'notify_owner');
      expect(viaDuty.length, `flow '${f.name}'`).toBe(1);
      const gate = sourceOf(viaDuty[0]!.condition);
      expect(gate, `flow '${f.name}'`).toContain('effective_from');
      expect(gate, `flow '${f.name}'`).toContain('effective_to');
      expect(gate, `flow '${f.name}' compares the window against today`).toContain('today()');
    }
  });

  it('a standing duty never produces a task, so no sweep can ever match one', () => {
    // The card asks for this to be asserted rather than assumed: it is free
    // only for as long as the dispatcher keeps refusing to draft one, and a
    // change there would turn "falls out for free" into a silent regression.
    const plan = planDispatch({
      duties: [{
        id: 'd_standing',
        name: 'Keep the register current',
        form: 'standing',
        owner: 'u1',
        status: 'active',
        // Everything a dispatchable duty would need, so the only reason the
        // plan can come back empty is the form.
        frequency: 'monthly',
        due_anchor: 'period_end',
        due_offset_days: 0,
        lead_days: 7,
        timezone: 'UTC',
        source: 'catalog',
      }],
      now: new Date('2026-09-01T08:00:00.000Z'),
    });
    expect(plan.drafts, 'a standing duty drafted a task').toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['standing']);

    // The control leg: the SAME duty as `recurring` does draft, so the empty
    // plan above is the form being refused and not the fixture being inert.
    const control = planDispatch({
      duties: [{
        id: 'd_recurring',
        name: 'File the emissions return',
        form: 'recurring',
        owner: 'u1',
        status: 'active',
        frequency: 'monthly',
        due_anchor: 'period_end',
        due_offset_days: 0,
        lead_days: 7,
        timezone: 'UTC',
        source: 'catalog',
      }],
      now: new Date('2026-09-01T08:00:00.000Z'),
    });
    expect(control.drafts.length, 'the control duty drafted nothing — fixture is inert')
      .toBeGreaterThan(0);
  });
});

// ─── The two measured CEL traps ──────────────────────────────────────────

describe('reminder sweeps — the predicates are written around measured traps', () => {
  it('no predicate carries a QUOTED CEL fragment (the P`${…}` interpolation trap)', () => {
    // Measured on @objectstack/spec 17.2.0:
    //   const X = 'has(record.duty)';
    //   P`${X} && true` → source: '"has(record.duty)" && true'
    // The fragment becomes a string LITERAL, so the composed predicate is not
    // the one that was written. `expression(source)` splices text instead.
    for (const f of flows) {
      for (const { where, source } of predicatesOf(f)) {
        expect(source, `${where}: a CEL call appears inside a string literal`)
          .not.toMatch(/"[a-zA-Z_]+\(/);
      }
    }
  });

  it('every isBlank() on a record field is guarded by has() first', () => {
    // The time-relative trigger does no `materializeDeclaredFields` (only the
    // record-change trigger does), so a NULL column can be ABSENT from the row
    // the sweep hands the flow. Measured: `isBlank(record.duty)` on a row with
    // no `duty` key THROWS `No such key: duty`, and a throwing predicate faults
    // the run. `has()` is total over absent AND null.
    for (const f of flows) {
      for (const { where, source } of predicatesOf(f)) {
        for (const m of source.matchAll(/isBlank\((record\.[a-z_]+|vars\.[a-z_.]+)\)/g)) {
          expect(source, `${where}: isBlank(${m[1]}) without a has() guard`)
            .toContain(`has(${m[1]})`);
        }
      }
    }
  });

  it('int() wraps the grace FIELD, never the sum', () => {
    // Measured on @objectstack/formula 17.2.0 with the scope shape
    // `evaluateCondition` builds, for a task 7 days past due and grace 6:
    //   daysBetween(due, today()) == 1 + grace        → false
    //   daysBetween(due, today()) == int(1 + grace)   → false
    //   daysBetween(due, today()) == int(grace) + 1   → TRUE
    // daysBetween() returns a CEL int; a host number makes the arithmetic a
    // double, and int == double answers `false` here rather than throwing the
    // `no such overload` it throws for two literals.
    const escalation = OverdueOwnerEscalation as unknown as FlowLike;
    const dutyGate = sourceOf(
      escalation.edges.find((e) => e.id === 'e_day_one')!.condition,
    );
    expect(dutyGate).toContain('int((has(vars.duty_record.grace_days)');
    expect(dutyGate, 'int() around the SUM is measurably not equivalent')
      .not.toMatch(/int\(\s*1\s*\+/);
    expect(dutyGate).toMatch(/int\([^;]*\)\s*\+\s*1/);
  });
});
