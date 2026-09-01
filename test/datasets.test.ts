// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { DATE_MACRO_WRAPPED_RE, isDateMacroToken } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';

import { dulyDatasets, GOVERNED_SOURCES } from '../src/datasets/index.js';

/**
 * These tests are not a second copy of the protocol — `pnpm validate` already
 * parses every dataset. They pin the two things a schema cannot see:
 *
 *  1. the CALIBER rule, which is a product invariant rather than a shape, and
 *  2. the absences that are load-bearing — the log entry that no dataset may
 *     read, the per-person comparison that must never be built, the
 *     completion percentage, and the `due_date` that must stay OUT of
 *     stagnation.
 *
 * Every walk below iterates `dulyDatasets` rather than naming files, so a
 * fourth dataset added later is covered the moment it enters the barrel. That
 * is deliberate: a rule with an opt-out list is a rule with a countdown on it.
 */

/** Every measure in the app, tagged with the dataset it came from. */
const allMeasures = dulyDatasets.flatMap((ds) =>
  ds.measures.map((m) => ({ dataset: ds.name, measure: m })),
);

/** Every dimension in the app, tagged with the dataset it came from. */
const allDimensions = dulyDatasets.flatMap((ds) =>
  ds.dimensions.map((d) => ({ dataset: ds.name, dimension: d })),
);

/** Recursively collect every `{ key: value }` leaf of a filter condition. */
const filterEntries = (node: unknown, path = ''): Array<[string, unknown]> => {
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => filterEntries(child, path));
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => [
    [path ? `${path}.${key}` : key, value] as [string, unknown],
    ...filterEntries(value, path ? `${path}.${key}` : key),
  ]);
};

/**
 * Every string anywhere in a node — KEYS INCLUDED.
 *
 * The keys matter at least as much as the values, and getting this wrong is
 * silent. In a filter condition the COLUMN is the key — `{ due_date: { $lt:
 * '{today}' } }` — so a values-only walk cannot see which column is being read
 * at all; it sees `{today}` and nothing else.
 *
 * That is not hypothetical. The first revision of this file walked
 * `Object.values` only, and the "stagnation never looks at due_date"
 * assertion below stayed GREEN with a real `due_date: { $lt: '{today}' }`
 * condition injected into a stagnation bucket. The single most important
 * assertion here was asserting nothing, and it took an ablation to find it —
 * a passing test is not evidence that a guard works.
 */
const deepText = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(deepText);
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => [
    key,
    ...deepText(value),
  ]);
};

describe('dataset protocol', () => {
  it('every dataset parses against the ADR-0021 dataset schema', () => {
    for (const ds of dulyDatasets) {
      const parsed = DatasetSchema.safeParse(ds);
      expect(parsed.success, `${ds.name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('the barrel carries the three datasets the manager side binds', () => {
    // Dashboards bind BY NAME (#10). A rename here is a silent empty chart
    // there, so the names are pinned rather than derived.
    expect(dulyDatasets.map((ds) => ds.name)).toEqual([
      'duly_duty_health',
      'duly_stagnation',
      'duly_workload',
    ]);
  });
});

describe('caliber — self-declared work is surfaced, never scored', () => {
  it('EVERY measure is filtered to source IN (catalog, assigned)', () => {
    /**
     * A DERIVED measure (ADR-0021 Q1) carries no filter of its own — it names
     * other measures and nothing else — so the gate reaches it through its
     * operands instead of exempting it. Both halves matter: an operand that
     * does not exist would be an empty chart reporting success, and an operand
     * outside this dataset would be a gate this walk cannot see. `on_time_rate`
     * is governed exactly because `tasks_done_on_time` and `tasks_done` are.
     */
    expect(allMeasures.length).toBeGreaterThan(0);
    for (const { dataset, measure } of allMeasures) {
      const derived = (measure as { derived?: { op: string; of: string[] } }).derived;
      if (derived) {
        const siblings = new Set(
          dulyDatasets.find((ds) => ds.name === dataset)!.measures.map((m) => m.name),
        );
        expect(derived.of.length, `${dataset}.${measure.name} derives from nothing`).toBeGreaterThan(0);
        for (const operand of derived.of) {
          expect(
            siblings.has(operand),
            `${dataset}.${measure.name} derives from '${operand}', which this dataset does not `
              + 'declare — a widget binding it renders empty and reports success',
          ).toBe(true);
          const source = dulyDatasets
            .find((ds) => ds.name === dataset)!
            .measures.find((m) => m.name === operand)!;
          expect(
            (source.filter as Record<string, unknown> | undefined)?.source,
            `${dataset}.${measure.name} inherits its caliber from '${operand}', which is ungoverned`,
          ).toEqual({ $in: [...GOVERNED_SOURCES] });
        }
        continue;
      }
      const filter = measure.filter as Record<string, unknown> | undefined;
      expect(filter, `${dataset}.${measure.name} has no filter at all`).toBeDefined();
      expect(
        filter?.source,
        `${dataset}.${measure.name} must filter on source — an unscored measure that folds in `
          + 'self-declared work punishes whoever declared the most',
      ).toEqual({ $in: [...GOVERNED_SOURCES] });
    }
  });

  it('the governed set is exactly catalog + assigned — self is never in it', () => {
    expect(GOVERNED_SOURCES).toEqual(['catalog', 'assigned']);
    expect(GOVERNED_SOURCES as readonly string[]).not.toContain('self');
  });

  it('source stays available as a dimension, so the governed split is visible', () => {
    const health = dulyDatasets.find((ds) => ds.name === 'duly_duty_health');
    expect(health?.dimensions.map((d) => d.name)).toContain('source');
  });

  it('no measure reaches source through the duty join instead of the task column', () => {
    // `duly_task.source` is stamped at dispatch, so a task keeps the caliber it
    // was dispatched under. Reading `duty.source` would retroactively rewrite
    // history the day a duty is re-sourced.
    for (const { dataset, measure } of allMeasures) {
      const keys = filterEntries(measure.filter).map(([key]) => key);
      expect(keys, `${dataset}.${measure.name}`).not.toContain('duty.source');
    }
  });
});

describe('the absences that are the product', () => {
  it('no dataset reads duly_log_entry, at any depth', () => {
    // Base object, join paths, dimension/measure field paths, filter keys and
    // filter values — all of it. The work log is unscoreable by construction
    // and a dataset is the one place that could quietly undo it.
    for (const ds of dulyDatasets) {
      expect(ds.object, `${ds.name} base object`).not.toBe('duly_log_entry');
      for (const text of deepText(ds)) {
        expect(text, `${ds.name} references the work log`).not.toContain('duly_log_entry');
      }
    }
  });

  it('no measure ranks or compares item counts across people', () => {
    // A leaderboard never arrives called a leaderboard; it arrives as
    // "tasks logged" or "most active" on an otherwise reasonable ticket.
    const banned = [
      'rank', 'ranking', 'leaderboard', 'top_', 'most_active', 'activity',
      'tasks_logged', 'logged', 'contribution', 'contributor', 'score', 'points',
    ];
    for (const { dataset, measure } of allMeasures) {
      const haystack = `${measure.name} ${JSON.stringify(measure.label ?? '')}`.toLowerCase();
      for (const word of banned) {
        expect(haystack, `${dataset}.${measure.name} smells like a ranking`).not.toContain(word);
      }
    }
    for (const { dataset, dimension } of allDimensions) {
      for (const word of banned) {
        expect(dimension.name.toLowerCase(), `${dataset}.${dimension.name}`).not.toContain(word);
      }
    }
  });

  it('no completion-percentage measure exists', () => {
    // Progress lives in `status` and `last_update_at`. A percentage is a number
    // nobody can verify, which is exactly why it becomes the number everyone
    // reports — and 80% on an untouched task stays 80% forever.
    for (const { dataset, measure } of allMeasures) {
      const name = measure.name.toLowerCase();
      for (const word of ['percent', 'pct', 'completion', 'progress']) {
        expect(name, `${dataset}.${measure.name}`).not.toContain(word);
      }
      const fields = deepText(measure).join(' ');
      expect(fields, `${dataset}.${measure.name}`).not.toContain('progress_percent');
    }
  });

  it('no measure filter uses a $field column-to-column reference', () => {
    // Declared in the filter grammar, resolved by the in-memory evaluator, and
    // REFUSED by driver-sql with INVALID_FILTER / 400 (objectstack#5222). In a
    // dataset that split is the worst kind: the same measure would answer on a
    // memory driver and 400 on a SQL one, so correctness would depend on the
    // deployment. This is the tripwire for the on-time workaround that must not
    // be written locally — see the docblock in `duty-health.dataset.ts`.
    for (const { dataset, measure } of allMeasures) {
      const keys = filterEntries(measure.filter).map(([key]) => key);
      const offenders = keys.filter((k) => k.endsWith('$field'));
      expect(offenders, `${dataset}.${measure.name} uses $field`).toEqual([]);
    }
  });

  it('lateness is never stored — no measure reads a MAINTAINED flag', () => {
    /**
     * The banned shape is a flag whose truth changes with the clock: it needs a
     * writer every midnight and lies on the day it does not run. `completed_late`
     * is deliberately not one of these and is deliberately not in the list — it
     * is written once, at completion, and never recomputed (`AGENTS.md` rule 5
     * carries the boundary). The difference is not the name: it is whether a
     * second write ever has to happen.
     */
    for (const { dataset, measure } of allMeasures) {
      const text = deepText(measure).join(' ');
      for (const flag of ['is_late', 'is_overdue', 'is_open', 'is_completed']) {
        expect(text, `${dataset}.${measure.name}`).not.toContain(flag);
      }
    }
  });
});

describe('duly_stagnation — stagnation is not lateness', () => {
  const stagnation = dulyDatasets.find((ds) => ds.name === 'duly_stagnation')!;

  it('exists with business_unit and owner as its axes', () => {
    expect(stagnation).toBeDefined();
    expect(stagnation.dimensions.map((d) => d.name)).toEqual(['business_unit', 'owner']);
  });

  it('NO stagnation measure mentions due_date — an untouched, not-yet-due task still counts', () => {
    // The single most important assertion in this file. The moment a due-date
    // condition appears here the dataset stops answering "what is going
    // nowhere" and starts answering "what has already failed", which the
    // lateness measures are for and which arrives weeks too late to act on.
    for (const measure of stagnation.measures) {
      const text = deepText(measure).join(' ');
      expect(text, `${measure.name} must not look at due_date`).not.toContain('due_date');
    }
  });

  it('every bucket is computed from last_update_at', () => {
    const buckets = stagnation.measures.filter((m) => m.name.startsWith('untouched_over_'));
    expect(buckets.map((m) => m.name)).toEqual([
      'untouched_over_7d',
      'untouched_over_14d',
      'untouched_over_30d',
    ]);
    for (const bucket of buckets) {
      const entries = filterEntries(bucket.filter);
      const touch = entries.find(([key]) => key === 'last_update_at');
      expect(touch, `${bucket.name} must threshold last_update_at`).toBeDefined();
    }
  });

  it('the bucket thresholds are real date-macro tokens, resolved server-side', () => {
    // A token outside the vocabulary is not a no-op: before `resolveFilterTokens`
    // it compared as a literal string and matched nothing, silently. Judged
    // against the spec's OWN grammar rather than a regex written here, so a
    // vocabulary change upstream turns this red instead of leaving it stale.
    const expected: Record<string, string> = {
      untouched_over_7d: '{7_days_ago}',
      untouched_over_14d: '{14_days_ago}',
      untouched_over_30d: '{30_days_ago}',
    };
    for (const [name, token] of Object.entries(expected)) {
      const measure = stagnation.measures.find((m) => m.name === name)!;
      const entries = filterEntries(measure.filter);
      const threshold = entries.find(([key]) => key === 'last_update_at.$lt')?.[1];
      expect(threshold, `${name} threshold`).toBe(token);

      const match = String(threshold).match(DATE_MACRO_WRAPPED_RE);
      expect(match, `${name}: ${token} is not a {placeholder}`).not.toBeNull();
      expect(isDateMacroToken(match![1]), `${name}: ${token} is not a known token`).toBe(true);
    }
  });

  it('buckets count only open work, and the thresholds nest', () => {
    // Cumulative, not disjoint: >14d includes everything >30d. A dashboard that
    // sums or pie-charts them double-counts. Pinned here because the shape is
    // invisible from the widget end.
    const days = [7, 14, 30];
    for (const n of days) {
      const measure = stagnation.measures.find((m) => m.name === `untouched_over_${n}d`)!;
      const entries = filterEntries(measure.filter);
      expect(entries.find(([key]) => key === 'status')?.[1]).toEqual({
        $in: ['open', 'in_progress'],
      });
    }
  });

  it('the oldest-touch measure is a timestamp, not a score', () => {
    const oldest = stagnation.measures.find((m) => m.name === 'oldest_last_update_at');
    expect(oldest?.aggregate).toBe('min');
    expect(oldest?.field).toBe('last_update_at');
  });
});

describe('duly_duty_health', () => {
  const health = dulyDatasets.find((ds) => ds.name === 'duly_duty_health')!;

  it('carries the five dimensions the manager side slices by', () => {
    expect(health.dimensions.map((d) => d.name)).toEqual([
      'business_unit', 'owner', 'period_key', 'frequency', 'source',
    ]);
  });

  it('reaches frequency through the declared duty join, not a denormalised copy', () => {
    // Proof that the semantic layer CAN reach a related object's field. It is
    // the arithmetic and the column-to-column comparison that it cannot do —
    // see the docblock in `duty-health.dataset.ts` for why the on-time measures
    // are filed upstream rather than approximated here.
    const frequency = health.dimensions.find((d) => d.name === 'frequency');
    expect(frequency?.field).toBe('duty.frequency');
    expect(health.include).toContain('duty');
  });

  it('does not denormalise grace_days onto the task', () => {
    // A copy on `duly_task` would be a second writer that drifts the day a duty
    // is re-graced — AGENTS.md rule 5. If a measure ever needs grace, it reads
    // it through the join or it does not exist.
    for (const measure of health.measures) {
      const text = deepText(measure).join(' ');
      expect(text).not.toContain('grace_days');
    }
  });
});

describe('duly_workload — the forward look', () => {
  const workload = dulyDatasets.find((ds) => ds.name === 'duly_workload')!;

  it('buckets due_date by week and by month off one column', () => {
    const week = workload.dimensions.find((d) => d.name === 'due_week');
    const month = workload.dimensions.find((d) => d.name === 'due_month');
    expect(week?.field).toBe('due_date');
    expect(week?.dateGranularity).toBe('week');
    expect(month?.field).toBe('due_date');
    expect(month?.dateGranularity).toBe('month');
  });

  it('carries exactly one measure — volume, never a comparison', () => {
    expect(workload.measures.map((m) => m.name)).toEqual(['tasks_due']);
  });
});

describe('one name, one meaning across the semantic layer', () => {
  it('tasks_due is defined identically wherever it appears', () => {
    // Two datasets declare it; a dashboard author reading a single legend
    // should not have to know which one produced the number.
    const definitions = allMeasures
      .filter(({ measure }) => measure.name === 'tasks_due')
      .map(({ measure }) => JSON.stringify({ aggregate: measure.aggregate, filter: measure.filter }));
    expect(definitions.length).toBeGreaterThan(1);
    expect(new Set(definitions).size, `tasks_due drifted: ${definitions.join(' vs ')}`).toBe(1);
  });

  it('a cancelled task is never counted as due — it was withdrawn, not owed', () => {
    for (const { dataset, measure } of allMeasures) {
      if (measure.name !== 'tasks_due') continue;
      const entries = filterEntries(measure.filter);
      expect(entries.find(([key]) => key === 'status')?.[1], dataset).toEqual({ $ne: 'cancelled' });
    }
  });
});
