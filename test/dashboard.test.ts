// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { DATE_MACRO_WRAPPED_RE, isDateMacroToken } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';
import { DashboardSchema } from '@objectstack/spec/ui';

import { dulyApps } from '../src/apps/index.js';
import { dulyDashboards } from '../src/dashboards/index.js';
import { dulyDatasets } from '../src/datasets/index.js';
import { dulyObjects } from '../src/objects/index.js';

/**
 * The manager dashboard, pinned on the two axes a schema cannot see.
 *
 * ── 1. Bindings — the TWO the platform does not resolve ──────────────────
 *
 * The card and its PM note both assumed this whole surface was unguarded,
 * carrying #14105 (datasets) up a layer. Measured instead, by mutating this
 * dashboard one reference at a time on `@objectstack/cli` 17.2.0 — the table
 * is in `src/dashboards/index.ts` — and most of it IS guarded: a bad widget
 * `dataset`, `dimensions[]`, `values[]` or `{date-macro}` fails `validate`
 * and `build` with a named rule and a "did you mean", and an unresolvable nav
 * `dashboardName` is refused by `defineStack` itself.
 *
 * Two references are not resolved, and both fail silently. Filed upstream as
 * **objectstack-ai/objectstack#14148**; the binding half of this file is a
 * STOPGAP and should be deleted when that lands, not kept in step with it:
 *
 *  1. **A widget `filter` KEY.** `due_daet: { $gte: '{today}' }` → validate 0,
 *     build 0. The condition matches nothing and the widget renders EMPTY.
 *     On the SAME node a bad `{token}` IS caught, path-precisely
 *     (`widgets[4].filter.due_date.$lte`) — so the traversal reaches the
 *     filter and only the column resolution is missing, which is exactly the
 *     asymmetry #14105 records one layer down.
 *  2. **`options.sortBy` naming something the widget does not select.**
 *     validate 0, build 0; the authored order silently does not happen and
 *     the runtime falls back to the selected dimensions. On the by-unit chart
 *     that is the difference between "ordered by the org chart" and "ordered
 *     by whatever the runtime picked", and the card's rule — never order a
 *     unit chart by the count — is enforced by nothing else.
 *
 * On this screen an empty widget is the worst available failure: **an empty
 * "not moving" tile is indistinguishable from a healthy team.** A missing
 * number reads as zero, and zero is the answer a manager hopes for. So the
 * walk below is a resolver with self-tests rather than a few `toBeDefined()`
 * calls — and it resolves the dataset/dimension/measure names too, not
 * because they need it, but because resolving a filter key requires the
 * dataset in hand to reach its base object. That redundancy is stated rather
 * than sold: when the two holes above close upstream, this walk goes with
 * them and only the invariants below stay.
 *
 * ── 2. The product invariants ────────────────────────────────────────────
 *
 * No ranking of people, nothing editable, the caliber note on the screen, the
 * cumulative buckets never summed, and the lateness number that must stay
 * ABSENT until #52 decides what "late" means. Every walk iterates
 * `dulyDashboards`, so a second dashboard is covered the moment it enters the
 * barrel — a rule with an opt-out list is a rule with a countdown on it.
 */

type Rec = Record<string, unknown>;

interface Widget extends Rec {
  readonly id?: string;
  readonly type?: string;
  readonly dataset?: string;
  readonly dimensions?: readonly string[];
  readonly values?: readonly string[];
  readonly filter?: Rec;
  readonly options?: Rec;
  readonly layout?: { x: number; y: number; w: number; h: number };
  readonly chartConfig?: Rec;
}

interface Dash extends Rec {
  readonly name?: string;
  readonly description?: unknown;
  readonly header?: Rec;
  readonly widgets?: readonly Widget[];
}

const dashboards = dulyDashboards as unknown as readonly Dash[];

/** Every widget in the app, tagged with the dashboard it came from. */
const allWidgets: ReadonlyArray<{ dashboard: string; widget: Widget }> = dashboards.flatMap((d) =>
  (d.widgets ?? []).map((widget) => ({ dashboard: String(d.name ?? '(unnamed)'), widget })),
);

const site = (entry: { dashboard: string; widget: Widget }): string =>
  `dashboard ${entry.dashboard} · widget '${entry.widget.id ?? '(no id)'}'`;

// ─── Resolution primitives ───────────────────────────────────────────────

/**
 * Columns the platform puts on every object, read from the spec's own
 * registry rather than transcribed — the hand-copied list in
 * `test/views.test.ts` has already drifted, which is the reason
 * `test/metadata-bindings.test.ts` imports this too.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set(Object.values(SystemFieldName));

interface DeclaredObject {
  readonly name: string;
  readonly fields: Rec;
}

interface MeasureLike {
  readonly name: string;
  /** Absent on a derived measure — it combines other measures instead. */
  readonly aggregate?: string;
  /** Absent on `count`, and on a derived measure. */
  readonly field?: string;
  readonly derived?: unknown;
}

interface DatasetLike {
  readonly name: string;
  readonly object: string;
  readonly dimensions?: ReadonlyArray<{ name: string }>;
  readonly measures?: ReadonlyArray<MeasureLike>;
}

interface Finding {
  readonly where: string;
  readonly reference: string;
  readonly reason: string;
}

interface WalkResult {
  readonly findings: Finding[];
  /** Resolved sites, so a walk that silently stopped walking is visible. */
  readonly resolved: string[];
  /**
   * Filter keys this walk cannot judge — a dotted path through a join. No
   * widget authors one today; the tripwire below fails the day one does,
   * rather than letting it pass as resolved.
   */
  readonly boundaries: string[];
}

/**
 * Top-level field KEYS of a filter condition.
 *
 * The column is the KEY, not the value — `{ due_date: { $lt: '{today}' } }`.
 * `test/datasets.test.ts` records what a values-only walk costs: its most
 * important assertion stayed green with a real `due_date` condition injected.
 * `$and` / `$or` / `$not` re-enter; every other `$` key is an operator, which
 * lives one level DOWN from the column and is never a field.
 */
const filterFieldKeys = (filter: unknown, out: string[] = []): string[] => {
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return out;
  for (const [key, value] of Object.entries(filter as Rec)) {
    if (key === '$and' || key === '$or') {
      for (const branch of (value as unknown[]) ?? []) filterFieldKeys(branch, out);
      continue;
    }
    if (key === '$not') {
      filterFieldKeys(value, out);
      continue;
    }
    if (key.startsWith('$')) continue;
    out.push(key);
  }
  return out;
};

/** Every string anywhere in a node, KEYS INCLUDED. */
const deepText = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(deepText);
  return Object.entries(node as Rec).flatMap(([key, value]) => [key, ...deepText(value)]);
};

/**
 * The whole rule, in one function, so the self-tests at the bottom exercise
 * the same code path this app's real metadata goes through.
 */
export const dashboardBindingFindings = (stack: {
  readonly dashboards: readonly Dash[];
  readonly datasets: readonly DatasetLike[];
  readonly objects: readonly DeclaredObject[];
}): WalkResult => {
  const result: WalkResult = { findings: [], resolved: [], boundaries: [] };
  const datasets = new Map(stack.datasets.map((d) => [d.name, d]));
  const objects = new Map(stack.objects.map((o) => [o.name, o]));

  for (const dashboard of stack.dashboards) {
    for (const widget of dashboard.widgets ?? []) {
      const where = `dashboard ${dashboard.name ?? '(unnamed)'} · widget '${widget.id ?? '(no id)'}'`;

      const datasetName = String(widget.dataset ?? '');
      const dataset = datasets.get(datasetName);
      if (!dataset) {
        result.findings.push({
          where,
          reference: datasetName || '(none)',
          reason:
            `binds dataset "${datasetName || '(nothing)'}", which is not in the datasets barrel — `
            + `the widget renders EMPTY and every gate exits 0. Declared: `
            + `${[...datasets.keys()].sort().join(', ') || '(none)'}`,
        });
        continue;
      }
      result.resolved.push(`${where} · dataset → ${datasetName}`);

      const dimensionNames = new Set((dataset.dimensions ?? []).map((d) => d.name));
      const measureNames = new Set((dataset.measures ?? []).map((m) => m.name));

      for (const name of widget.dimensions ?? []) {
        if (dimensionNames.has(name)) {
          result.resolved.push(`${where} · dimensions[] → ${datasetName}.${name}`);
          continue;
        }
        result.findings.push({
          where: `${where} · dimensions[]`,
          reference: name,
          reason:
            `${datasetName} declares no dimension named "${name}" — the axis renders empty. `
            + `Declared: ${[...dimensionNames].sort().join(', ') || '(none)'}`,
        });
      }

      for (const name of widget.values ?? []) {
        if (measureNames.has(name)) {
          result.resolved.push(`${where} · values[] → ${datasetName}.${name}`);
          continue;
        }
        result.findings.push({
          where: `${where} · values[]`,
          reference: name,
          reason:
            `${datasetName} declares no measure named "${name}" — the widget renders empty, which `
            + `on a count tile is indistinguishable from a zero. Declared: `
            + `${[...measureNames].sort().join(', ') || '(none)'}`,
        });
      }

      /**
       * `options.sortBy` must name something this widget SELECTS — the spec
       * says so in its own words ("must be one this widget actually selects").
       * An unselected name is not ordered by anything; the runtime falls back
       * to the selected dimensions and the authored order silently does not
       * happen.
       */
      const sortBy = widget.options?.sortBy;
      if (typeof sortBy === 'string' && sortBy !== '') {
        const selected = new Set([...(widget.dimensions ?? []), ...(widget.values ?? [])]);
        if (selected.has(sortBy)) {
          result.resolved.push(`${where} · options.sortBy → ${sortBy}`);
        } else {
          result.findings.push({
            where: `${where} · options.sortBy`,
            reference: sortBy,
            reason:
              `orders by "${sortBy}", which this widget does not select — the order silently `
              + `falls back to the selected dimensions. Selected: ${[...selected].sort().join(', ')}`,
          });
        }
      }

      // The widget's own presentation filter is a data-layer condition ANDed
      // into the dataset query, so its KEYS are field paths on the dataset's
      // BASE OBJECT — not dimension names. (`due_date`, never `due_week`.)
      const base = objects.get(dataset.object);
      for (const key of filterFieldKeys(widget.filter)) {
        if (key.includes('.')) {
          result.boundaries.push(`${where} · filter key "${key}" reaches through a join`);
          continue;
        }
        if (!base) {
          result.findings.push({
            where: `${where} · filter`,
            reference: key,
            reason: `dataset ${datasetName} is based on "${dataset.object}", which this stack does not declare`,
          });
          continue;
        }
        if (Object.hasOwn(base.fields, key) || SYSTEM_FIELDS.has(key)) {
          result.resolved.push(`${where} · filter key → ${dataset.object}.${key}`);
          continue;
        }
        result.findings.push({
          where: `${where} · filter`,
          reference: key,
          reason:
            `filters on "${key}", which ${dataset.object} does not declare — the condition matches `
            + `nothing and the widget renders empty`,
        });
      }

      /**
       * Every `{token}` in the widget filter must be real. An unknown token is
       * rejected by `@objectstack/lint`'s `validate-filter-tokens` at build
       * time — this asserts the same property at the unit level, where the
       * failure names the widget.
       */
      for (const text of deepText(widget.filter)) {
        const match = text.match(DATE_MACRO_WRAPPED_RE);
        if (!match) continue;
        if (isDateMacroToken(match[1]!)) {
          result.resolved.push(`${where} · filter token → {${match[1]}}`);
          continue;
        }
        result.findings.push({
          where: `${where} · filter`,
          reference: text,
          reason: `"${text}" is not a date-macro token — it would compare as a literal string and match nothing`,
        });
      }
    }
  }

  return result;
};

const result = dashboardBindingFindings({
  dashboards,
  datasets: dulyDatasets as unknown as DatasetLike[],
  objects: dulyObjects as unknown as DeclaredObject[],
});

// ─── The dashboard itself ────────────────────────────────────────────────

describe('dashboard protocol', () => {
  it('every dashboard parses against the dashboard schema', () => {
    for (const dashboard of dashboards) {
      expect(() => DashboardSchema.parse(dashboard), `dashboard ${dashboard.name}`).not.toThrow();
    }
  });

  it('the barrel carries the manager dashboard', () => {
    expect(dashboards.map((d) => d.name)).toEqual(['duly_duty_health']);
  });

  it('is reachable from the app — a `dashboard` nav entry in the Team group', () => {
    const app = (dulyApps as unknown as Array<{ name: string; navigation: Rec[] }>)[0]!;
    const team = app.navigation.find((item) => item.id === 'group_team') as
      | { children?: Rec[] }
      | undefined;
    expect(team, 'the Team nav group is gone').toBeDefined();

    const entries = (team!.children ?? []).filter((item) => item.type === 'dashboard');
    expect(entries.map((item) => item.dashboardName)).toEqual(['duly_duty_health']);
    // A metadata file not reachable from the app is dead metadata that
    // type-checks — the nav entry is the whole difference between a screen and
    // a source file. (`metadata-bindings.test.ts` resolves the NAME; this pins
    // the placement the card asks for.)
    expect(entries[0]!.id).toBe('nav_duty_health');
  });
});

// ─── Bindings ────────────────────────────────────────────────────────────

describe('widget bindings — every reference resolves (stopgap for objectstack#14148)', () => {
  it('every widget dataset, dimension, measure, filter key and date macro names something real', () => {
    expect(
      result.findings.map((f) => `${f.where}: "${f.reference}" — ${f.reason}`),
      'a dashboard binding that resolves to nothing; validate and build both exit 0 on these, and '
        + 'the widget renders empty',
    ).toEqual([]);
  });

  it('resolved enough references to prove the walk ran', () => {
    // Green-because-vacuous is the failure mode a binding guard dies of.
    expect(result.resolved.length, 'the walk resolved implausibly few references').toBeGreaterThan(10);
    for (const kind of ['dataset →', 'dimensions[] →', 'values[] →', 'filter key →', 'filter token →']) {
      expect(
        result.resolved.some((entry) => entry.includes(kind)),
        `no ${kind} reference was resolved at all — that part of the walk is not running`,
      ).toBe(true);
    }
  });

  it('no widget filter reaches through a join, which this walk cannot resolve', () => {
    expect(
      result.boundaries,
      'a widget filters on a dotted path; teach this walk to resolve joins before trusting it',
    ).toEqual([]);
  });

  it('every widget binds a DATASET, never an object', () => {
    for (const entry of allWidgets) {
      expect(typeof entry.widget.dataset, `${site(entry)} has no dataset`).toBe('string');
      // The pre-ADR-0021 inline shape. `DashboardWidgetSchema` rejects these
      // with a prescription, so this is belt-and-braces on the ONE rule the
      // card states first — and it also covers a widget object that never
      // reached the schema (a fixture, a future builder).
      for (const key of ['object', 'objectName', 'categoryField', 'valueField', 'aggregate']) {
        expect(Object.hasOwn(entry.widget, key), `${site(entry)} carries the legacy key '${key}'`).toBe(false);
      }
    }
  });
});

// ─── Product invariants ──────────────────────────────────────────────────

/**
 * A dimension is a PERSON dimension when the field it reads is a lookup at
 * `sys_user`. Read off the object rather than from a name list: `owner` is
 * the only one today, and a second one added later must not need this file
 * edited to be covered.
 */
const personDimensionNames = (datasetName: string): ReadonlySet<string> => {
  const dataset = (dulyDatasets as unknown as DatasetLike[]).find((d) => d.name === datasetName);
  if (!dataset) return new Set();
  const base = (dulyObjects as unknown as DeclaredObject[]).find((o) => o.name === dataset.object);
  if (!base) return new Set();
  const names = new Set<string>();
  for (const dimension of (dataset.dimensions ?? []) as Array<{ name: string; field?: string }>) {
    const field = base.fields[String(dimension.field ?? dimension.name)] as Rec | undefined;
    if (field && field.reference === 'sys_user') names.add(dimension.name);
  }
  return names;
};

describe('no ranking of people', () => {
  it('no widget slices by a person dimension at all', () => {
    const offenders = allWidgets.flatMap((entry) => {
      const people = personDimensionNames(String(entry.widget.dataset ?? ''));
      return (entry.widget.dimensions ?? [])
        .filter((name) => people.has(name))
        .map((name) => `${site(entry)} groups by '${name}'`);
    });
    expect(
      offenders,
      'a manager screen that groups counts by person is a performance score, whatever the title '
        + 'says. Unit comparison is a workload question and is fine; person comparison is not, and '
        + 'this product does not have one.',
    ).toEqual([]);
  });

  it('no widget orders a person dimension by a count, or truncates one to a top N', () => {
    // The rule that must hold even if a per-person WORKLOAD widget is ever
    // added deliberately (`duly_workload` keeps `owner` for exactly that: "is
    // ONE person's next fortnight unsurvivable"). Ordering that by a measure,
    // or cutting it to the worst N, is the ranking the workload question is
    // not.
    for (const entry of allWidgets) {
      const people = personDimensionNames(String(entry.widget.dataset ?? ''));
      const slicesPeople = (entry.widget.dimensions ?? []).some((name) => people.has(name));
      if (!slicesPeople) continue;
      const sortBy = entry.widget.options?.sortBy;
      expect(
        (entry.widget.values ?? []).includes(String(sortBy ?? '')),
        `${site(entry)} sorts a person dimension by the measure '${String(sortBy)}'`,
      ).toBe(false);
      expect(entry.widget.options?.limit, `${site(entry)} truncates a person dimension to a top N`)
        .toBeUndefined();
    }
  });

  it('every widget that orders at all orders by something count-independent, or by a date', () => {
    // The card's rule for the unit chart, stated as a property: unit order is
    // the org chart's, never this week's counts.
    for (const entry of allWidgets) {
      const sortBy = entry.widget.options?.sortBy;
      if (typeof sortBy !== 'string' || sortBy === '') continue;
      expect(
        (entry.widget.dimensions ?? []).includes(sortBy),
        `${site(entry)} orders by '${sortBy}', which is a measure — order by a dimension so the `
          + 'order cannot move when the numbers do',
      ).toBe(true);
    }
  });
});

describe('lateness is on the screen, and only in the one shape that respects grace', () => {
  /**
   * #52 decided what "late" means: `late_after` (`due_date + grace_days`) is
   * stamped at dispatch and `completed_late` at completion, both write-once, so
   * every lateness number is a count over a stamp rather than a comparison the
   * query grammar cannot make.
   *
   * The assertion that used to live here — "no widget binds a lateness measure"
   * — was the right rule while the only expressible version ignored grace. What
   * replaces it is not weaker: any lateness number on this screen must trace
   * back to those stamps, and the grace-free window remains banned outright by
   * the test below it, which is the one that would actually be reintroduced by
   * accident.
   */
  it('every lateness number a widget binds is built on the stamps, not on a due-date window', () => {
    const measuresByDataset = new Map(
      dulyDatasets.map((ds) => [ds.name, new Map(ds.measures.map((m) => [m.name, m]))]),
    );

    /** The measure text, following a derived measure through to its operands. */
    const sourcesOf = (dataset: string, name: string, seen = new Set<string>()): string[] => {
      if (seen.has(name)) return [];
      seen.add(name);
      const measure = measuresByDataset.get(dataset)?.get(name);
      if (!measure) return [];
      const derived = (measure as { derived?: { of: string[] } }).derived;
      if (derived) return derived.of.flatMap((operand) => sourcesOf(dataset, operand, seen));
      return [JSON.stringify(measure)];
    };

    let checked = 0;
    for (const entry of allWidgets) {
      for (const name of entry.widget.values ?? []) {
        if (!/on_?time|late|overdue/i.test(name)) continue;
        checked += 1;
        const sources = sourcesOf(String(entry.widget.dataset ?? ''), name);
        expect(sources.length, `${site(entry)} binds '${name}', which resolves to no measure`)
          .toBeGreaterThan(0);
        // At least one operand must READ a stamp. Not every one: a rate's
        // denominator is an honest plain count (`tasks_done`), and demanding
        // the stamp there would only teach the next author to bolt a redundant
        // condition onto it.
        expect(
          sources.some((source) => source.includes('completed_late') || source.includes('late_after')),
          `${site(entry)} binds '${name}', which is computed without the lateness stamps — a `
            + 'lateness number that does not read them is one that ignores grace',
        ).toBe(true);
        // And none of them may reach for a due-date window instead. This is the
        // MEASURE-side half of the widget-filter rule below: the grace-free
        // approximation is two lines wherever it is written, and a measure is
        // the place a reviewer is least likely to look for it.
        for (const source of sources) {
          expect(
            source.includes('due_date'),
            `${site(entry)} binds '${name}', whose measures read due_date — lateness is the stamp, `
              + 'and a due-date window is the grace-free approximation under another name',
          ).toBe(false);
        }
      }
    }
    expect(checked, 'the on-time number is gone from the screen entirely').toBeGreaterThan(0);
  });

  it('no widget rebuilds a grace-free lateness out of a due-date window', () => {
    /**
     * The approximation needs no platform change and no new measure: a widget
     * `filter` of `due_date < {today}` over `tasks_due` is a "late" count in
     * two lines. It is wrong for every duty with a non-zero `grace_days`, and
     * wrong in the direction the customer configured AGAINST — a 7-day grace
     * gets its people listed late the morning after the due date (#48 is that
     * exact bug in the `late` LIST view). Bounding `due_date` ABOVE by now or
     * by a past moment is the shape of it; bounding it above by a FUTURE token
     * is the forward look, which is a different question and is allowed.
     */
    const pastward = (comparand: unknown): boolean => {
      if (typeof comparand !== 'string') return false;
      const match = comparand.match(DATE_MACRO_WRAPPED_RE);
      if (!match) return false;
      const token = match[1]!;
      return token === 'today' || token === 'now' || token === 'yesterday' || /_ago$/.test(token);
    };

    for (const entry of allWidgets) {
      const dueDate = (entry.widget.filter ?? {}).due_date as Rec | undefined;
      if (!dueDate || typeof dueDate !== 'object') continue;
      for (const op of ['$lt', '$lte'] as const) {
        expect(
          pastward(dueDate[op]),
          `${site(entry)} counts work whose due date is already past — that is a lateness number `
            + 'that ignores every duty\'s grace_days. The product decision is open on #52.',
        ).toBe(false);
      }
    }
  });

  it('says what the on-time rate is a rate OF, so nobody has to guess the denominator', () => {
    // The rate counts COMPLETED work, not everything that was owed. A reader
    // who assumes the denominator is `tasks_due` reads a materially different
    // number off the same tile, so the screen says which it is.
    for (const dashboard of dashboards) {
      const binds = (dashboard.widgets ?? []).some((w) =>
        (w.values ?? []).some((name) => /on_?time/i.test(name)),
      );
      if (!binds) continue;
      const text = `${dashboard.description ?? ''} ${(dashboard.widgets ?? [])
        .map((w) => `${w.title ?? ''} ${w.description ?? ''}`)
        .join(' ')}`.toLowerCase();
      expect(text, `${dashboard.name} shows an on-time rate without saying what it is a rate of`)
        .toContain('completed');
      expect(text, `${dashboard.name} does not say the rate respects each duty's grace`)
        .toContain('grace');
    }
  });

  it('explains the absence on the screen, for as long as the number is missing', () => {
    // An unexplained absence is a wrong number with no digits: a manager
    // reading "not moving: 3" on a screen silent about lateness concludes
    // there are three problems. This assertion dissolves on its own the day a
    // lateness measure is bound — it only demands the sentence while the
    // number is missing.
    for (const dashboard of dashboards) {
      const bindsLateness = (dashboard.widgets ?? []).some((w) =>
        (w.values ?? []).some((name) => /on_?time|late|overdue/i.test(name)),
      );
      if (bindsLateness) continue;
      expect(
        String(dashboard.description ?? '').toLowerCase(),
        `${dashboard.name} shows no lateness number and does not say so — silence reads as good news`,
      ).toContain('grace');
    }
  });
});

describe('the four numbers the sales deck p20 promises are all on the screen', () => {
  /**
   * The deck's leadership first screen is four KPI cards: stagnation, overdue,
   * on-time rate and list completeness. Two of them arrived late (#52 for the
   * rate, this card for the other two), and the failure mode for a demo screen
   * is not an error — it is a tile quietly missing, which reads as a screen
   * that never promised it. So the four are pinned by the MEASURE each one
   * binds rather than by widget id, which is the part that cannot be satisfied
   * by renaming a tile.
   *
   * Stagnation is deliberately two tiles, not one; the dashboard file header
   * carries why (nested thresholds must not be summable by eye), and the >30d
   * tile's "subset" wording is pinned above. It was three until #122 retired
   * the oldest-touch tile — an instant, where every other tile on the row is a
   * number; the last describe in this file is what stops it coming back.
   */
  const boundMeasures = new Set(allWidgets.flatMap((entry) => entry.widget.values ?? []));

  it('binds a stagnation count, an overdue count, an on-time rate and a completeness rate', () => {
    for (const measure of ['untouched_over_14d', 'tasks_overdue', 'on_time_rate', 'approved_rate']) {
      expect(boundMeasures.has(measure), `no widget binds '${measure}' — a p20 card is missing`).toBe(true);
    }
  });

  it('the work-mix chart counts DUTIES, because a standing duty has no task to count', () => {
    // The one widget on this screen over `duly_duty`. Re-binding it to a
    // task-based dataset would drop standing work entirely and lose nothing
    // visible: the chart would still render, with two slices instead of three.
    const mix = allWidgets.find((entry) => entry.widget.id === 'work_mix');
    expect(mix, 'the work-mix chart is gone').toBeDefined();
    const dataset = (dulyDatasets as unknown as DatasetLike[])
      .find((ds) => ds.name === String(mix!.widget.dataset));
    expect(dataset?.object, 'the work-mix chart counts tasks, not duties').toBe('duly_duty');
    expect(mix!.widget.dimensions).toEqual(['form']);
  });

  it('says the completion rate covers recurring work only, where the mix is shown', () => {
    // p20's own caption. Beside a three-slice composition chart, an on-time
    // rate reads as a rate over all three unless the screen says otherwise —
    // and two of the three forms cannot have one.
    const mix = allWidgets.find((entry) => entry.widget.id === 'work_mix')!;
    expect(String(mix.widget.description ?? '').toLowerCase()).toContain('recurring');
  });
});

describe('the caliber note is on the screen, not in a tooltip', () => {
  it('the dashboard description carries it', () => {
    for (const dashboard of dashboards) {
      const description = String(dashboard.description ?? '').toLowerCase();
      expect(description, `${dashboard.name} has no caliber note`).toContain('governed');
      expect(description).toContain('self-declared');
      expect(description).toContain('excluded');
    }
  });

  it('the header renders the description — the note is not authored into a hidden slot', () => {
    for (const dashboard of dashboards) {
      // `showDescription` defaults to true, so the failure this catches is an
      // explicit `false` added later by someone tidying the header — which
      // would delete the note without touching the text.
      expect(dashboard.header?.showDescription, `${dashboard.name} hides its own description`)
        .not.toBe(false);
    }
  });

  it('the headline tile repeats it, because a tile is read alone', () => {
    const headline = allWidgets.find((entry) => entry.widget.id === 'not_moving_14d');
    expect(String(headline?.widget.description ?? '').toLowerCase()).toContain('self-declared');
  });
});

describe('nothing on this dashboard is editable', () => {
  it('declares no header actions — the only affordance a dashboard can dispatch', () => {
    for (const dashboard of dashboards) {
      const actions = (dashboard.header as { actions?: unknown[] } | undefined)?.actions ?? [];
      expect(actions, `${dashboard.name} dispatches an action from its header`).toEqual([]);
    }
  });

  it('no widget carries an action key', () => {
    // `actionUrl` / `actionType` / `actionIcon` are retired keys — the schema
    // rejects them with a prescription. Pinned here as a product rule too:
    // managers read on this screen, and assigning is their only write.
    for (const entry of allWidgets) {
      for (const key of Object.keys(entry.widget)) {
        expect(/^action/i.test(key), `${site(entry)} carries '${key}'`).toBe(false);
      }
    }
  });
});

describe('the not-moving tile is the visual focus', () => {
  const headline = allWidgets.find((entry) => entry.widget.id === 'not_moving_14d')!;

  it('is the first widget, top-left', () => {
    expect(allWidgets[0]!.widget.id, 'reading order starts somewhere else').toBe('not_moving_14d');
    expect(headline.widget.layout).toMatchObject({ x: 0, y: 0 });
  });

  it('is the largest tile on the screen', () => {
    /**
     * "Largest" is judged against the other TILES, not against the charts: a
     * bar chart needs plot area to be readable at all, and a KPI card that
     * out-areas one would be a worse screen, not a more focused one. What the
     * card is asking for is that no other NUMBER competes with this one — so
     * that is what is asserted, plus the position above.
     */
    const area = (w: Widget): number => (w.layout ? w.layout.w * w.layout.h : 0);
    const tiles = allWidgets.filter((entry) => entry.widget.type === 'metric' || entry.widget.type === 'kpi');
    expect(tiles.length, 'no metric tiles at all').toBeGreaterThan(1);
    for (const entry of tiles) {
      if (entry.widget.id === headline.widget.id) continue;
      expect(area(headline.widget), `${site(entry)} is at least as large as the headline`)
        .toBeGreaterThan(area(entry.widget));
    }
  });

  it('nothing is placed above it or to its left', () => {
    for (const entry of allWidgets) {
      const layout = entry.widget.layout;
      if (!layout) continue;
      expect(layout.y, `${site(entry)} sits above the headline`).toBeGreaterThanOrEqual(0);
      if (layout.y === 0 && entry.widget.id !== headline.widget.id) {
        expect(layout.x, `${site(entry)} shares the top row and starts left of the headline's edge`)
          .toBeGreaterThanOrEqual(headline.widget.layout!.w);
      }
    }
  });
});

describe('the stagnation buckets are cumulative, and are never drawn as if they partition', () => {
  const CUMULATIVE = ['untouched_over_7d', 'untouched_over_14d', 'untouched_over_30d'];
  /** Families that draw a value as a share of a whole. */
  const PART_OF_WHOLE = ['pie', 'donut', 'funnel', 'treemap', 'sankey', 'radar'];

  it('no widget puts two nested thresholds in one visualisation', () => {
    for (const entry of allWidgets) {
      const nested = (entry.widget.values ?? []).filter((name) => CUMULATIVE.includes(name));
      expect(
        nested.length,
        `${site(entry)} selects ${nested.join(' + ')} together — \`>14d\` COUNTS everything \`>30d\` `
          + 'counts, so side-by-side bars invite an addition that double-counts. Separate tiles, or '
          + 'difference them first.',
      ).toBeLessThan(2);
    }
  });

  it('no cumulative measure is drawn as a share of a whole, or stacked', () => {
    for (const entry of allWidgets) {
      const nested = (entry.widget.values ?? []).some((name) => CUMULATIVE.includes(name));
      if (!nested) continue;
      expect(
        PART_OF_WHOLE.includes(String(entry.widget.type)),
        `${site(entry)} draws a cumulative threshold as a ${entry.widget.type}`,
      ).toBe(false);
      const series = (entry.widget.chartConfig?.series as Array<{ stack?: unknown }> | undefined) ?? [];
      for (const one of series) {
        expect(one.stack, `${site(entry)} stacks a cumulative threshold`).toBeUndefined();
      }
    }
  });

  it('the >30d tile says it is a subset, in the description a reader sees', () => {
    const tile = allWidgets.find((entry) => entry.widget.id === 'not_moving_30d');
    expect(String(tile?.widget.description ?? '').toLowerCase()).toContain('subset');
  });
});

describe('contrast — no text is ever drawn on a fill', () => {
  it('data labels are off on every chart', () => {
    /**
     * The one contrast failure this screen could ship: a value label printed
     * ON a bar. Both chart fills are mid-tones chosen to clear 3:1 as
     * graphical objects against a white AND a near-black card, and at that
     * lightness white label text on the amber fill is 3.7:1 — a failure for
     * text (AA wants 4.5:1). The two constraints have no common solution in
     * one hex, so the labels come off the fill: every label on this screen
     * renders as axis or legend text on the card background, which the theme
     * owns. `showDataLabels` defaults to false; it is stated explicitly, and
     * asserted here, because it is load-bearing rather than decorative.
     */
    for (const entry of allWidgets) {
      const config = entry.widget.chartConfig;
      if (!config) continue;
      expect(config.showDataLabels, `${site(entry)} prints value labels on its fills`).toBe(false);
    }
  });

  it('every chart fill is a mid-tone that clears 3:1 on both a light and a dark card', () => {
    // WCAG 1.4.11 for a graphical object, measured against #FFFFFF and
    // #0B0F14. The band is relative luminance in [0.118, 0.30]: below it a
    // fill disappears on a dark card, above it on a light one. Metadata
    // carries no per-theme colour, so a single hex has to clear both.
    const channel = (c: number): number => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string): number =>
      0.2126 * channel(parseInt(hex.slice(1, 3), 16))
      + 0.7152 * channel(parseInt(hex.slice(3, 5), 16))
      + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));
    const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    const light = luminance('#FFFFFF');
    const dark = luminance('#0B0F14');
    let checked = 0;
    for (const entry of allWidgets) {
      const colors = entry.widget.chartConfig?.colors;
      if (!Array.isArray(colors)) continue;
      for (const hex of colors as string[]) {
        expect(hex, `${site(entry)} uses a non-hex fill`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        const l = luminance(hex);
        expect(ratio(l, light), `${site(entry)} fill ${hex} is invisible on a light card`)
          .toBeGreaterThanOrEqual(3);
        expect(ratio(l, dark), `${site(entry)} fill ${hex} is invisible on a dark card`)
          .toBeGreaterThanOrEqual(3);
        checked += 1;
      }
    }
    expect(checked, 'no fill was checked — this assertion is vacuous').toBeGreaterThan(0);
  });

  it('nothing on this screen reads as blame', () => {
    // Late and not-moving are ATTENTION, not failure. `danger` is the red the
    // platform reserves for a failure state, and a stalled task is a thing to
    // go and look at, not a verdict on a person.
    for (const entry of allWidgets) {
      expect(entry.widget.colorVariant, `${site(entry)} is painted as a failure`).not.toBe('danger');
    }
  });
});

// ─── The guard can fail (self-test on synthetic metadata) ────────────────

describe('widget bindings — the guard can fail (self-test on synthetic metadata)', () => {
  /**
   * A guard that has never been observed failing is indistinguishable from a
   * guard that cannot fail. Same posture as `test/metadata-bindings.test.ts`:
   * one fixture per reference kind, in both directions.
   *
   * Each case below was also run as an ablation against the REAL dashboard —
   * mutation confirmed on disk with `grep -F` before the gates, restored by a
   * trap after. What that measured is in `src/dashboards/index.ts`; the two
   * rows this file exists for are the ones where both gates exit 0:
   *
   *   | mutation on the real widget      | validate | build | this file |
   *   |----------------------------------|----------|-------|-----------|
   *   | filter key → `due_daet`          | 0        | 0     | fails     |
   *   | sortBy → `not_selected`          | 0        | 0     | fails     |
   *   | dataset → `duly_stagnatoin`      | 1        | 1     | fails     |
   *   | measure → `untouched_over_14`    | 1        | 1     | fails     |
   *   | dimension → `business_unitt`     | 1        | 1     | fails     |
   *   | token → `{14_days_hence}`        | 1        | 1     | fails     |
   */
  const objects: DeclaredObject[] = [
    { name: 'fx_task', fields: { status: { type: 'select' }, due_date: { type: 'date' } } },
  ];
  const datasets: DatasetLike[] = [
    {
      name: 'fx_metrics',
      object: 'fx_task',
      dimensions: [{ name: 'week' }],
      measures: [{ name: 'n' }],
    },
  ];
  const widget = (overrides: Rec = {}): Widget => ({
    id: 'w',
    type: 'bar',
    dataset: 'fx_metrics',
    dimensions: ['week'],
    values: ['n'],
    ...overrides,
  });
  const run = (over: Rec = {}): WalkResult =>
    dashboardBindingFindings({
      dashboards: [{ name: 'fx_dash', widgets: [widget(over)] }],
      datasets,
      objects,
    });

  it('the baseline fixture is clean — otherwise every case below is meaningless', () => {
    const clean = run();
    expect(clean.findings).toEqual([]);
    expect(clean.boundaries).toEqual([]);
    expect(clean.resolved.length).toBeGreaterThan(0);
  });

  it('fires on a dataset the barrel does not declare', () => {
    const r = run({ dataset: 'fx_ghost' });
    expect(r.findings.map((f) => f.reference)).toEqual(['fx_ghost']);
  });

  it('fires on a dimension the dataset does not declare', () => {
    const r = run({ dimensions: ['weekk'] });
    expect(r.findings.map((f) => f.reference)).toEqual(['weekk']);
    expect(r.findings[0]!.where).toContain('dimensions[]');
  });

  it('fires on a measure the dataset does not declare', () => {
    const r = run({ values: ['nn'] });
    expect(r.findings.map((f) => f.reference)).toEqual(['nn']);
    expect(r.findings[0]!.reason).toContain('indistinguishable from a zero');
  });

  it('fires on a filter key the BASE OBJECT does not declare', () => {
    const r = run({ filter: { due_daet: { $lt: '{today}' } } });
    expect(r.findings.map((f) => f.reference)).toEqual(['due_daet']);
  });

  it('fires on a filter token outside the date-macro vocabulary', () => {
    const r = run({ filter: { due_date: { $lt: '{14_days_hence}' } } });
    expect(r.findings.map((f) => f.reference)).toEqual(['{14_days_hence}']);
  });

  it('fires on a sortBy naming something the widget does not select', () => {
    const r = run({ options: { sortBy: 'month' } });
    expect(r.findings.map((f) => f.reference)).toEqual(['month']);
  });

  it('does not fire on a platform system column as a filter key', () => {
    expect(run({ filter: { created_at: { $gte: '{30_days_ago}' } } }).findings).toEqual([]);
  });

  it('records a boundary — not a pass — for a filter key that reaches through a join', () => {
    const r = run({ filter: { 'duty.frequency': 'monthly' } });
    expect(r.findings).toEqual([]);
    expect(r.boundaries).toEqual([expect.stringContaining('duty.frequency')]);
  });
});

/**
 * ── A metric tile prints a NUMBER, never an instant (#122) ───────────────
 *
 * `duly_stagnation.oldest_last_update_at` is `min(last_update_at)`, and the
 * "Oldest untouched task" tile bound it. A metric widget renders the measure's
 * value as it arrives, and what arrives for an instant is the instant:
 * `POST /api/v1/analytics/dataset/query` answered
 * `"2026-07-04T07:00:00.000Z"` on a real boot of this app — under a `fields[]`
 * entry typed `number`, which is the mismatch underneath the symptom.
 *
 * What the reader saw depended on the console version, and that is the reason
 * this is pinned in the repo rather than left to the renderer: on Console
 * 17.2.0 the tile printed the ISO string verbatim and overflowed; on 17.3.0 the
 * same value renders through a locale date formatter (`2026年7月4日 07:00` /
 * `Jul 4, 2026, 07:00 AM`) and fits. Better, and still a DATE — carrying a
 * time-of-day that is the dispatch clock — sitting in a row of counts and
 * rates, where the number a manager wants is "how many days".
 *
 * That number is not expressible here: `AggregationFunction` has no
 * date-difference member, and a derived measure's `of` takes other MEASURE
 * NAMES only — no literal, no `now` — so `today − min(last_update_at)` has
 * nothing to put on the left of the minus. Measured, on a temporary measure
 * added to the real dataset and queried on a real boot: `{ op: 'difference',
 * of: [<max instant>, <min instant>] }` answers `null`, because the executor's
 * `computeDerived` coerces operands with `Number()` and an ISO string is
 * `NaN`. A stored `days_stalled` is AGENTS.md rule 5's banned shape.
 *
 * So the rule is about the BINDING, not about the measure: the measure stays a
 * legitimate semantic-layer value (a table column, a report, an API read) and
 * this walk bans putting one on a tile whose whole content is one value. It
 * iterates the dashboards barrel, so a second dashboard is covered the moment
 * it enters — and it resolves the measure's field against the objects barrel
 * rather than matching on a name, because the next one will not be called
 * `oldest_last_update_at`.
 */

/** Field types whose value is an instant, not a magnitude. */
const INSTANT_FIELD_TYPES: ReadonlySet<string> = new Set(['date', 'datetime', 'time']);

/**
 * Aggregations that hand back a value of the FIELD's own type. `count` /
 * `count_distinct` always return a number, whatever they count.
 */
const VALUE_PRESERVING_AGGREGATES: ReadonlySet<string> = new Set(['min', 'max', 'sum', 'avg']);

/** Widget types that render exactly one value, with no axis to date it. */
const SINGLE_VALUE_WIDGETS: ReadonlySet<string> = new Set(['metric', 'kpi']);

export const instantTileFindings = (stack: {
  readonly dashboards: readonly Dash[];
  readonly datasets: readonly DatasetLike[];
  readonly objects: readonly DeclaredObject[];
}): WalkResult => {
  const result: WalkResult = { findings: [], resolved: [], boundaries: [] };
  const datasets = new Map(stack.datasets.map((d) => [d.name, d]));
  const objects = new Map(stack.objects.map((o) => [o.name, o]));

  for (const dashboard of stack.dashboards) {
    for (const widget of dashboard.widgets ?? []) {
      if (!SINGLE_VALUE_WIDGETS.has(String(widget.type))) continue;
      const where = `dashboard ${dashboard.name ?? '(unnamed)'} · widget '${widget.id ?? '(no id)'}'`;
      const dataset = datasets.get(String(widget.dataset ?? ''));
      // An unresolvable dataset is the other walk's finding, not this one's.
      if (!dataset) continue;

      for (const name of widget.values ?? []) {
        const measure = (dataset.measures ?? []).find((m) => m.name === name);
        if (!measure) continue;
        // Derived measures are arithmetic over other measures — always a
        // number, or `null` when an operand will not coerce.
        if (measure.derived) {
          result.resolved.push(`${where} · ${name} → derived, a number`);
          continue;
        }
        const aggregate = String(measure.aggregate ?? '');
        if (!VALUE_PRESERVING_AGGREGATES.has(aggregate)) {
          result.resolved.push(`${where} · ${name} → ${aggregate || '(none)'}, a number`);
          continue;
        }
        const path = String(measure.field ?? '');
        if (path.includes('.')) {
          // A joined path. No measure authors one today; this walk resolves
          // base fields only, so record it rather than pass it — the day one
          // appears, the tripwire below says so instead of reading as clean.
          result.boundaries.push(`${where} · ${name} aggregates "${path}" through a join`);
          continue;
        }
        const base = objects.get(dataset.object);
        const field = base && Object.hasOwn(base.fields, path)
          ? (base.fields[path] as { type?: unknown })
          : undefined;
        if (!field) {
          result.boundaries.push(
            `${where} · ${name} aggregates "${path}", which is not a declared field of ${dataset.object}`,
          );
          continue;
        }
        const type = String(field.type ?? '');
        if (!INSTANT_FIELD_TYPES.has(type)) {
          result.resolved.push(`${where} · ${name} → ${aggregate}(${type}), a number`);
          continue;
        }
        result.findings.push({
          where,
          reference: `${dataset.name}.${name}`,
          reason:
            `a ${widget.type} tile renders one value and this one is an INSTANT: `
            + `${aggregate}(${dataset.object}.${path}), a ${type}. The tile prints what the `
            + `analytics door returns — an ISO string, typed \`number\` in the response's own `
            + `fields[] — so the reader gets a date where the row beside it shows counts and `
            + `rates, and how it reads is the console's choice, not this repo's (17.2.0 printed `
            + `the raw ISO and overflowed; 17.3.0 formats it). "Days since" is not expressible: `
            + `no date-difference aggregate, and a derived measure's \`of\` takes measure names `
            + `only. Put the instant in a LIST ordered by it — task.view.ts's \`stalled\` — or `
            + `bind a count. #122`,
        });
      }
    }
  }
  return result;
};

describe('a metric tile prints a number, never an instant', () => {
  const stack = {
    dashboards,
    datasets: dulyDatasets as unknown as readonly DatasetLike[],
    objects: dulyObjects as unknown as readonly DeclaredObject[],
  };

  it('no tile on any dashboard binds an aggregate over a date/datetime field', () => {
    const result = instantTileFindings(stack);
    expect(
      result.findings.map((f) => `${f.where} · ${f.reference}: ${f.reason}`),
      'a metric tile is bound to an instant',
    ).toEqual([]);
  });

  it('the walk actually reached the tiles — an empty walk proves nothing', () => {
    const result = instantTileFindings(stack);
    // Six metric tiles minus the one #122 removed; the count is not asserted,
    // the REACH is: every tile resolved at least one measure to a verdict.
    expect(result.resolved.length, 'the walk judged no measure at all').toBeGreaterThan(0);
    expect(result.boundaries, 'a measure this walk cannot judge').toEqual([]);
  });

  it('the retired tile is gone, and its measure is still declared', () => {
    // Both halves matter. Deleting the measure too would be a contract change
    // nobody asked for (the dataset already ships measures no widget binds);
    // keeping the tile is the defect.
    const ids = allWidgets.map((entry) => entry.widget.id);
    expect(ids, 'the oldest-touch tile is back').not.toContain('oldest_touch');
    const stagnation = (dulyDatasets as unknown as readonly DatasetLike[])
      .find((d) => d.name === 'duly_stagnation');
    expect(
      (stagnation?.measures ?? []).map((m) => m.name),
      'the semantic-layer measure was dropped with the tile',
    ).toContain('oldest_last_update_at');
  });
});

describe('the instant-tile guard can fail (self-test on synthetic metadata)', () => {
  /**
   * The guard that has never been observed failing is indistinguishable from
   * the guard that cannot fail — and this one is written to stay green on the
   * real barrel forever, so its only evidence is here.
   */
  const objects: DeclaredObject[] = [
    {
      name: 'fx_task',
      fields: {
        touched_at: { type: 'datetime' },
        due_date: { type: 'date' },
        amount: { type: 'number' },
      },
    },
  ];
  const datasets: DatasetLike[] = [
    {
      name: 'fx_metrics',
      object: 'fx_task',
      dimensions: [{ name: 'week' }],
      measures: [
        { name: 'n', aggregate: 'count' },
        { name: 'total', aggregate: 'sum', field: 'amount' },
        { name: 'oldest', aggregate: 'min', field: 'touched_at' },
        { name: 'earliest_due', aggregate: 'min', field: 'due_date' },
        { name: 'joined', aggregate: 'min', field: 'duty.reviewed_at' },
        { name: 'ghost', aggregate: 'min', field: 'not_a_field' },
        { name: 'rate', derived: { op: 'ratio', of: ['n', 'total'] } },
      ],
    },
  ];
  const run = (widget: Widget): WalkResult =>
    instantTileFindings({ dashboards: [{ name: 'fx_dash', widgets: [widget] }], datasets, objects });

  const tile = (values: string[], type = 'metric'): Widget => ({
    id: 'w', type, dataset: 'fx_metrics', values,
  });

  it('is clean on a count tile — otherwise every case below is meaningless', () => {
    const r = run(tile(['n']));
    expect(r.findings).toEqual([]);
    expect(r.boundaries).toEqual([]);
    expect(r.resolved.length).toBeGreaterThan(0);
  });

  it('is clean on a sum over a number', () => {
    expect(run(tile(['total'])).findings).toEqual([]);
  });

  it('is clean on a derived ratio', () => {
    expect(run(tile(['rate'])).findings).toEqual([]);
  });

  it('FIRES on min() over a datetime — the #122 shape', () => {
    const r = run(tile(['oldest']));
    expect(r.findings.map((f) => f.reference)).toEqual(['fx_metrics.oldest']);
    expect(r.findings[0]!.reason).toContain('INSTANT');
  });

  it('FIRES on min() over a date as well — the type set is not one spelling', () => {
    expect(run(tile(['earliest_due'])).findings.map((f) => f.reference)).toEqual(['fx_metrics.earliest_due']);
  });

  it('fires on a kpi tile too, not just a metric one', () => {
    expect(run(tile(['oldest'], 'kpi')).findings).toHaveLength(1);
  });

  it('does NOT fire on a chart — an instant on an axis is legitimate', () => {
    expect(run(tile(['oldest'], 'bar')).findings).toEqual([]);
  });

  it('records a boundary — not a pass — for a joined measure path', () => {
    const r = run(tile(['joined']));
    expect(r.findings).toEqual([]);
    expect(r.boundaries).toEqual([expect.stringContaining('duty.reviewed_at')]);
  });

  it('records a boundary for a measure field the object does not declare', () => {
    expect(run(tile(['ghost'])).boundaries).toEqual([expect.stringContaining('not_a_field')]);
  });
});
