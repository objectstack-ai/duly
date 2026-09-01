// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { Stagnation } from '../src/datasets/index.js';
import { Task } from '../src/objects/index.js';
import { dulyViews } from '../src/views/index.js';

/**
 * The premise under `task.hook.ts`'s decision NOT to stamp `last_update_at` on
 * a predicate (bulk) write — and the one thing that can silently invalidate it.
 *
 * ── What the hook decided, and what it rests on ───────────────────────────
 * A `multi: true` write carries ONE payload for all N matched rows (ADR-0058
 * Addendum II D3), so a stamp computed from any single row's pre-image is
 * written to every row in the batch. `task.hook.ts` therefore writes no
 * `last_update_at` at all on that path — the honest answer, rather than
 * writing one row's truth onto all of them.
 *
 * That is only harmless because of a fact about the BULK ACTIONS, not about
 * the hook: stagnation is defined over OPEN work, and every bulk action this
 * product ships moves the rows it touches out of that set. A row that leaves a
 * bulk write with an unrefreshed clock is a row no stagnation query will ever
 * evaluate again — the clock is a value nothing reads.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * Add a bulk "set note", a bulk reassign, or a bulk re-date, and the premise
 * is false: those rows stay `open`, their clocks stay frozen, and the "Not
 * moving" list quietly stops listing them. Nothing errors. There is no stack
 * trace and no wrong number to notice — the signal simply goes silent, which
 * is the exact failure the stagnation column was designed to prevent.
 *
 * So the premise is asserted here, against the REAL metadata on both sides:
 *
 *  - the stagnation set is read out of `duly_stagnation`'s own measure filters
 *    and out of the "Not moving" lens's own filter, and the two are required
 *    to agree — a set restated here by hand would keep agreeing with itself
 *    after somebody widened the real one;
 *  - the bulk actions are read out of `dulyViews`, so a def added to any view
 *    bound to `duly_task` is inspected whether or not this file is edited.
 *
 * If this test goes red, `src/hooks/task.hook.ts` is what has to change — its
 * per-row skip, or the new action. Do not relax the assertion.
 */

type Rec = Record<string, any>;

const TASK_OBJECT = 'duly_task';

/** Every view in the app, flattened, with the key it is reachable under. */
function everyView(): Array<{ where: string; view: Rec }> {
  const out: Array<{ where: string; view: Rec }> = [];
  for (const [i, group] of (dulyViews as Rec[]).entries()) {
    if (group?.list) out.push({ where: `dulyViews[${i}].list`, view: group.list });
    for (const [key, view] of Object.entries((group?.listViews ?? {}) as Rec)) {
      if (view) out.push({ where: `dulyViews[${i}].listViews.${key}`, view: view as Rec });
    }
  }
  return out;
}

/** Views bound to `duly_task` — the only ones the stagnation clock is about. */
const taskViews = () => everyView().filter(({ view }) => view?.data?.object === TASK_OBJECT);

/** Every bulk def declared on a `duly_task` view, with where it was found. */
function taskBulkDefs(): Array<{ where: string; def: Rec }> {
  return taskViews().flatMap(({ where, view }) =>
    ((view.bulkActionDefs ?? []) as Rec[]).map((def) => ({ where: `${where}.bulkActionDefs`, def })),
  );
}

// ── The stagnation set, read from the two places that define it ────────────

/**
 * `duly_stagnation` is the stagnation picture; every measure on it filters the
 * population it counts. Union across the measures rather than reaching for one
 * by name, so a measure added with a wider status filter widens this set too.
 */
function statusesFromDataset(): string[] {
  const seen = new Set<string>();
  for (const measure of (Stagnation as Rec).measures as Rec[]) {
    const clause = measure?.filter?.status?.$in;
    if (Array.isArray(clause)) for (const value of clause) seen.add(String(value));
  }
  return [...seen].sort();
}

/**
 * The "Not moving" lens, found STRUCTURALLY: a stagnation lens is any
 * `duly_task` view that filters on `last_update_at`. Found by shape rather
 * than by the key `stalled`, so a second lens added later is read too.
 */
function stagnationLenses(): Array<{ where: string; statuses: string[] }> {
  const out: Array<{ where: string; statuses: string[] }> = [];
  for (const { where, view } of taskViews()) {
    const filter = (view.filter ?? []) as Rec[];
    if (!filter.some((f) => f?.field === 'last_update_at')) continue;
    const status = filter.find((f) => f?.field === 'status' && f?.operator === 'in');
    out.push({ where, statuses: [...((status?.value ?? []) as string[])].map(String).sort() });
  }
  return out;
}

describe('the stagnation set — read, not restated', () => {
  it('duly_stagnation declares one', () => {
    const statuses = statusesFromDataset();
    expect(
      statuses.length,
      'no status filter found on duly_stagnation — this guard would be vacuous',
    ).toBeGreaterThan(0);
    // Every value must be a real option, or the dataset counts nothing and the
    // guard below would be comparing against a set that matches no row.
    const declared = (Task.fields.status as { options: { value: string }[] }).options.map((o) => o.value);
    for (const status of statuses) expect(declared, `${status} must be a duly_task status`).toContain(status);
  });

  it('every measure on it agrees — one population, not a per-measure opinion', () => {
    const union = statusesFromDataset();
    for (const measure of (Stagnation as Rec).measures as Rec[]) {
      expect(
        [...((measure?.filter?.status?.$in ?? []) as string[])].map(String).sort(),
        `measure '${measure?.name}' must count the same population as the rest`,
      ).toEqual(union);
    }
  });

  it('the "Not moving" lens is scoped to the SAME set as the dataset', () => {
    const lenses = stagnationLenses();
    expect(lenses.length, 'no view filters on last_update_at — the lens has gone missing').toBeGreaterThan(0);
    for (const lens of lenses) {
      expect(
        lens.statuses,
        `${lens.where} shows a different population than duly_stagnation counts`,
      ).toEqual(statusesFromDataset());
    }
  });
});

// ── The guard ──────────────────────────────────────────────────────────────

describe('every bulk action must move its rows OUT of the stagnation set', () => {
  /**
   * The union of both sources. Union rather than either one alone is the
   * fail-safe direction: if they ever disagree (the test above goes red at the
   * same time) this guard is the stricter of the two readings, never the
   * looser.
   */
  const stagnationStatuses = () =>
    [...new Set([...statusesFromDataset(), ...stagnationLenses().flatMap((l) => l.statuses)])].sort();

  it('found the real defs — a renamed key must not make this vacuous', () => {
    const found = taskBulkDefs();
    expect(found.length, 'no bulkActionDefs found on any duly_task view').toBeGreaterThan(0);
    const names = found.map(({ def }) => def?.name);
    // The two the hook's decision was measured against. Not a list to maintain
    // — it is proof that the walk above reaches `src/views/task.view.ts` and
    // did not silently return nothing after a rename or a refactor.
    expect(names).toContain('duly_task_bulk_complete');
    expect(names).toContain('duly_task_bulk_skip');
  });

  it('the same def name means the same patch on every view offering it', () => {
    const byName = new Map<string, Array<{ where: string; def: Rec }>>();
    for (const entry of taskBulkDefs()) {
      const list = byName.get(entry.def?.name) ?? [];
      list.push(entry);
      byName.set(entry.def?.name, list);
    }
    for (const [name, entries] of byName) {
      const first = JSON.stringify(entries[0].def?.patch ?? null);
      for (const entry of entries) {
        expect(
          JSON.stringify(entry.def?.patch ?? null),
          `'${name}' writes a different patch at ${entry.where} — one variant could leave rows stagnant`,
        ).toBe(first);
      }
    }
  });

  it.each(taskBulkDefs().map(({ where, def }) => [String(def?.name ?? '(unnamed)'), where, def] as const))(
    '%s writes a status outside the stagnation set',
    (name, where, def) => {
      const stagnant = stagnationStatuses();

      // 1. Only a declarative data-plane patch can be certified from here. An
      //    `operation: 'custom'` def runs a handler this file cannot read, so
      //    the premise has to be re-argued by hand rather than assumed.
      expect(
        def?.operation,
        `${name} at ${where} is not an 'update' — task.hook.ts's per-row skip cannot be certified `
        + 'against it; re-argue the premise on the card before adding it',
      ).toBe('update');

      // 2. A patch with no `status` leaves every row exactly where it was. If
      //    any of them were open, their clocks are now frozen and invisible.
      const patch = (def?.patch ?? {}) as Rec;
      expect(
        Object.prototype.hasOwnProperty.call(patch, 'status'),
        `${name} writes no status, so its rows keep the one they had — including ${stagnant.join('/')}, `
        + 'whose stagnation clock task.hook.ts no longer refreshes on this path',
      ).toBe(true);

      // 3. It must be a fixed value. A caller-chosen status is a status this
      //    file cannot certify.
      expect(typeof patch.status, `${name} must write a literal status`).toBe('string');
      const declared = (Task.fields.status as { options: { value: string }[] }).options.map((o) => o.value);
      expect(declared, `${name} writes '${String(patch.status)}', which is not a duly_task status`)
        .toContain(patch.status);

      // 4. …and outside the stagnation set. THE assertion.
      expect(
        stagnant,
        `${name} leaves its rows in the stagnation set ('${String(patch.status)}'). `
        + 'task.hook.ts skips the last_update_at stamp on the bulk path because every bulk action '
        + 'moves its rows out of that set — this def breaks that premise, so those rows will sit in '
        + '"Not moving" with a clock that never advances again. Fix the hook, not this test.',
      ).not.toContain(patch.status);

      // 5. A param may not put `status` back in play: params are collected
      //    from the user and merged OVER the static patch, so a `status` param
      //    hands the caller the very choice step 3 refused.
      const params = (def?.params ?? []) as Rec[];
      expect(
        params.map((p) => p?.name),
        `${name} exposes status as a parameter, which overrides the patch above`,
      ).not.toContain('status');
    },
  );
});
