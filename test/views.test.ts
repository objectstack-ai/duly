// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { dulyApps } from '../src/apps/index.js';
import { dulyViews } from '../src/views/index.js';

/**
 * View tests — two jobs, kept apart on purpose.
 *
 * ── 1. A STOPGAP for what `pnpm validate` does not see ───────────────────
 * ⚠️ Delete the stopgap half when the upstream rule lands. It is not a house
 * rule that wants maintaining forever; it is author-time coverage every
 * ObjectStack app would otherwise re-implement, and it is written to be
 * removed rather than kept in step with the platform:
 *
 *   objectstack-ai/objectstack#14106 — `view/layout-without-binding` covers
 *     `kanban` / `calendar` / `gantt` only. `timeline`, `tree` and `map` have
 *     the same literal-default fallback in the renderer and no gate.
 *
 * Measured against this repo on `@objectstack/cli` 17.2.0 by mutating a view
 * and re-running the gates. The reading is in the issue.
 *
 * What is left here is binding-block PRESENCE and nothing else: "is there a
 * `gantt` block at all", which is what #14106 is about.
 *
 * ── Reference RESOLUTION lives in `test/metadata-bindings.test.ts` ───────
 * This file used to carry a second, weaker copy of it — one assertion
 * resolving view field names, one resolving nav `viewName` (#14107 / #14108).
 * duly#58 deleted both after measuring, mutation by mutation, that the walk
 * in `test/metadata-bindings.test.ts` reports every defect they did. It is a
 * genuine superset: it resolves dotted paths (the copy here returned early on
 * every one), reads the platform's own `SystemFieldName` registry instead of
 * a hand-copied list that had already drifted, and covers datasets, bulk
 * actions and dashboards besides.
 *
 * Presence and resolution are DIFFERENT properties. Do not move the check
 * below across to that file, and do not re-grow a resolution check here: two
 * guards on one rule is the cost both headers warn against.
 *
 * ── 2. PRODUCT pins that outlive the platform gaps ───────────────────────
 * The gantt starting at `visible_from`, the timeline ordering by
 * `last_update_at`, one colour source for status, nothing ordered by a count.
 * Those stay when the stopgap goes: no upstream rule can know them.
 */

type Rec = Record<string, unknown>;

interface NamedView {
  /** e.g. `duly_task › listViews.board` — the string an assertion failure prints. */
  where: string;
  object: string;
  view: Rec;
}

/** Every list view in the stack, flattened, each tagged with its bound object. */
const allViews: NamedView[] = [];
for (const entry of dulyViews as unknown as Array<{ list?: Rec; listViews?: Record<string, Rec> }>) {
  const push = (label: string, view: Rec | undefined) => {
    if (!view) return;
    const object = ((view.data as Rec | undefined)?.object as string | undefined) ?? '(no data.object)';
    allViews.push({ where: `${object} › ${label}`, object, view });
  };
  push('list', entry.list);
  for (const [name, view] of Object.entries(entry.listViews ?? {})) push(`listViews.${name}`, view);
}

const byName = (name: string): NamedView => {
  const found = allViews.find((v) => v.where.endsWith(`listViews.${name}`));
  if (!found) throw new Error(`no list view named "${name}" — declared: ${allViews.map((v) => v.where).join(', ')}`);
  return found;
};

describe('every non-grid lens is bound to real fields', () => {
  /**
   * The binding block each view type needs, and the keys inside it that MUST
   * be present for the view to render anything at all. Read off each block's
   * Zod schema in `@objectstack/spec/ui` (`view.zod.ts`) — these are the keys
   * declared without `.optional()`.
   *
   * The platform's own `view/layout-without-binding` gate knows only the first
   * three rows (#14106). `timeline` and `tree` are here because this repo uses
   * them and nothing else checks them.
   */
  const REQUIRED_BINDINGS: Record<string, { block: string; keys: string[] }> = {
    kanban: { block: 'kanban', keys: ['groupByField', 'columns'] },
    calendar: { block: 'calendar', keys: ['startDateField', 'titleField'] },
    gantt: { block: 'gantt', keys: ['startDateField', 'endDateField', 'titleField'] },
    timeline: { block: 'timeline', keys: ['startDateField', 'titleField'] },
    // `TreeConfigSchema`'s keys are all optional, so "has a block" is a weak
    // assertion here — but a tree with no `parentField` on an object with no
    // self-reference renders FLAT, not empty, which is why this repo does not
    // author one at all (objectstack-ai/objectstack#14109).
    tree: { block: 'tree', keys: [] },
    map: { block: 'map', keys: [] },
  };

  it('declares the binding block its type needs', () => {
    for (const { where, view } of allViews) {
      const spec = REQUIRED_BINDINGS[view.type as string];
      if (!spec) continue;
      const block = view[spec.block] as Rec | undefined;
      expect(
        block,
        `${where} is a \`${view.type}\` view with no \`${spec.block}\` block — the renderer falls back to `
        + 'literal default field names and the view renders empty while authoring reports success',
      ).toBeTypeOf('object');
      for (const key of spec.keys) {
        expect(block?.[key], `${where}: \`${spec.block}.${key}\` is required for this view to render`).toBeTruthy();
      }
    }
  });

  /**
   * Whether the names INSIDE that block resolve is a different property, and
   * it is checked in `test/metadata-bindings.test.ts` (#14107) — over dotted
   * paths, the platform's real system columns, and every binding-block key
   * the Zod schemas declare, none of which this file did.
   */
});

describe('the lenses say what the product means', () => {
  /**
   * The whole argument for `lead_days` is visible here as bar LENGTH. A bar
   * that starts on the due date is a task that first appeared the day it was
   * already owed — a report on a failure, not a reminder.
   */
  it('the gantt bar starts at visible_from and ends at due_date', () => {
    const gantt = byName('schedule').view.gantt as Rec;
    expect(gantt.startDateField).toBe('visible_from');
    expect(gantt.endDateField).toBe('due_date');
    expect(
      gantt.startDateField,
      'start and end on the same column is a zero-length bar — lead time dropped',
    ).not.toBe(gantt.endDateField);
  });

  /**
   * `last_update_at` is hook-stamped on a status change or a note edit and
   * deliberately does NOT advance on an administrative write, which is what
   * makes this the companion to the stagnation number rather than a "recently
   * touched by anything" list.
   */
  it('the timeline reads last_update_at, newest first', () => {
    const recent = byName('recent').view;
    expect((recent.timeline as Rec).startDateField).toBe('last_update_at');
    expect(recent.sort).toEqual([{ field: 'last_update_at', order: 'desc' }]);
  });

  /**
   * One source of truth for status colour: `duly_task.status`'s own
   * `options[].color`. A view that hand-authors a colour map is a second
   * source that drifts the moment an option is added.
   */
  it('every lens colours from status, and no view carries its own colour map', () => {
    for (const { where, view } of allViews) {
      expect(view.rowColor, `${where}: a rowColor map is a second colour source — colour from the field`).toBeUndefined();
      expect(view.conditionalFormatting, `${where}: hand-authored row styling duplicates the status palette`).toBeUndefined();
      for (const block of ['kanban', 'calendar', 'gantt', 'timeline'] as const) {
        const cfg = view[block] as Rec | undefined;
        if (cfg?.colorField !== undefined) {
          expect(cfg.colorField, `${where}: \`${block}.colorField\` must be "status"`).toBe('status');
        }
      }
    }
    expect((byName('board').view.kanban as Rec).groupByField).toBe('status');
  });

  /**
   * ⚠️ Do NOT "fix" this by adding `colorField: 'status'` to the gantt.
   * Measured on @objectstack/console 17.2.0: the gantt renderer puts
   * `record[colorField]` straight into `backgroundColor`, so the key resolves
   * to `background: "open"` — invalid CSS, dropped, EVERY BAR IDENTICAL. With
   * the key absent the same renderer falls through to its status-derived
   * palette and the bars separate by state. Filed as
   * objectstack-ai/objectstack#14110; revisit when that lands.
   */
  it('the gantt deliberately declares no colorField', () => {
    expect(byName('schedule').view.gantt as Rec).not.toHaveProperty('colorField');
  });

  /**
   * #108 — the frontline screen the deck's p16 draws.
   *
   * The column SET and its ORDER are both the card's, so this is not a
   * restatement of the file: a reorder here is a product change and should
   * have to be argued for. The two new columns are the ones the whole card is
   * about — a list without them is the list we already had.
   */
  it('my_week carries the deck\'s columns, in the deck\'s order', () => {
    const fields = ((byName('my_week').view.columns as Rec[]) ?? []).map((c) => String(c.field));
    expect(fields).toEqual(['status', 'subject', 'source', 'due_date', 'progress', 'attachments']);
  });

  /**
   * Inline edit is what makes reporting progress ONE TAP rather than a record
   * page — and it is deliberately not on the manager lenses, because
   * "Managers do not enter status; assigning is their only write" is a product
   * invariant and an editable status cell on a team lens breaks it one row at
   * a time.
   */
  it('the owner\'s lenses edit in place; the manager\'s lenses do not', () => {
    for (const name of ['my_week', 'board']) {
      expect(byName(name).view.inlineEdit, `${name} is an owner screen — the phrase is one tap`).toBe(true);
    }
    for (const name of ['late', 'stalled', 'by_unit']) {
      expect(
        byName(name).view.inlineEdit,
        `${name} is a manager lens — inline status entry is the invariant being broken quietly`,
      ).not.toBe(true);
    }
  });

  /**
   * #108 / deck p17 — the card face carries where it came from, when it is
   * owed, and the last word on it. Every card field must also be in the view's
   * own `columns`: the projection is built from those alone, so a face field
   * missing from them arrives `undefined` and renders blank with nothing in
   * error (the same defect `business_unit` had on `by_unit`).
   */
  it('the board card shows source, due and progress — and projects them', () => {
    const board = byName('board').view;
    const face = ((board.kanban as Rec).columns as string[]) ?? [];
    for (const field of ['source', 'due_date', 'progress']) {
      expect(face, `the deck asks for ${field} on the card`).toContain(field);
    }
    const projected = new Set(((board.columns as Rec[]) ?? []).map((c) => String(c.field)));
    for (const field of face) {
      expect(
        projected,
        `\`${field}\` is on the card face but not in \`columns\` — it will arrive undefined`,
      ).toContain(field);
    }
  });

  /**
   * Swimlanes are OFF on purpose, and this pin is the decision rather than a
   * restatement of the file.
   *
   * They are authorable — `grouping: { fields: [{ field: 'source' }] }` on
   * this view turns them on, confirmed in a browser. Turning them on also
   * renders the status column-header row at height 0 on console 17.2.0, so the
   * board loses `OPEN / IN PROGRESS / DONE / SKIPPED` entirely — filed as
   * objectstack-ai/objectui#7303. The view file carries the measurement; what
   * must not happen is
   * somebody adding the key back because the deck asks for lanes, without
   * knowing it takes the column titles with it.
   *
   * ⛔ `kanban.swimlaneField` is a different mistake and fails `pnpm validate`
   * — the schema is strict. Pinned so the failure has an explanation attached.
   */
  it('the board carries no swimlane key while the header row is broken upstream', () => {
    const board = byName('board').view;
    expect(board.kanban, 'the strict kanban schema has no swimlaneField — the key is `grouping`')
      .not.toHaveProperty('swimlaneField');
    expect(
      board.grouping,
      'swimlanes render the status column headers at height 0 — see the view file before re-adding',
    ).toBeUndefined();
  });

  /**
   * The board writes `status` on every card drag, so its rows must be the
   * viewer's own — "Managers do not enter status" is a product invariant, and
   * a board of other people's tasks is a one-gesture way past it. It is also
   * what keeps the lens inside one fetched page; the view file carries the
   * measurement.
   */
  it('the board shows only the viewer\'s own tasks', () => {
    expect(byName('board').view.filter).toEqual([
      { field: 'owner', operator: 'equals', value: '{current_user_id}' },
    ]);
  });

  /** Item counts are never ranked or compared — not as a sort, not as a total. */
  it('no view orders or totals anything by a count', () => {
    for (const { where, view } of allViews) {
      expect(
        (view.kanban as Rec | undefined)?.summarizeField,
        `${where}: a kanban column total is a number nobody asked for`,
      ).toBeUndefined();
      for (const col of (view.columns as unknown[]) ?? []) {
        const summary = (col as Rec)?.summary;
        expect(summary, `${where}: a column footer aggregation puts a count in the UI`).toBeUndefined();
      }
      for (const s of (Array.isArray(view.sort) ? view.sort : []) as Rec[]) {
        expect(
          String(s.field),
          `${where}: sorting by a count ranks whoever the rows belong to`,
        ).not.toMatch(/count|total|_num$/);
      }
    }
  });

  /**
   * Lateness and stagnation are asked of stored, indexed columns — since #52
   * that includes `late_after`, the deadline stamped on the row at dispatch.
   * What stays banned is the MAINTAINED flag: one whose truth changes with the
   * clock, needing a writer every midnight and lying the night it does not run.
   * A formula field is worse again — virtual, so a filter naming one silently
   * matches nothing.
   */
  it('no filter reaches for a derived flag', () => {
    for (const { where, view } of allViews) {
      for (const rule of (view.filter as Rec[]) ?? []) {
        expect(String(rule.field), `${where}: filter on a flag that does not exist`).not.toMatch(
          /^is_(late|overdue|open|completed)$/,
        );
      }
    }
  });
});

describe('navigation', () => {
  interface NavItem { id?: string; type?: string; objectName?: string; viewName?: string; children?: NavItem[] }

  const navItems: NavItem[] = [];
  const walk = (items: NavItem[] | undefined) => {
    for (const item of items ?? []) {
      navItems.push(item);
      walk(item.children);
    }
  };
  for (const app of dulyApps as unknown as Array<{ navigation?: NavItem[] }>) walk(app.navigation);

  /**
   * That a nav entry's `objectName` / `viewName` RESOLVE (#14108) is checked
   * in `test/metadata-bindings.test.ts`, which also reaches entries nested
   * under an `object` parent and resolves `dashboardName` and `filters` keys.
   * The two tests below are the other question — reachability and placement —
   * and no reference walk can answer either.
   */
  it('every lens this app adds is reachable from navigation', () => {
    const reachable = new Set(navItems.map((i) => `${i.objectName}.${i.viewName}`));
    const expected = [
      ['duly_task', 'board'],
      ['duly_task', 'schedule'],
      ['duly_task', 'recent'],
      ['duly_task', 'by_unit'],
      ['duly_duty', 'catalog_tree'],
    ] as const;
    for (const [object, view] of expected) {
      expect(reachable, `${object}.${view} has no nav entry — a view nobody can reach is dead metadata`)
        .toContain(`${object}.${view}`);
    }
  });

  /**
   * Managers do not enter status; assigning is their only write. The board
   * writes `status` on every card drag, so it belongs with the owner's own
   * screens and not in the manager's section.
   */
  it('the board sits under My work, not Team', () => {
    const me = navItems.find((i) => i.id === 'group_me');
    expect(me?.children?.map((c) => c.id)).toContain('nav_board');
    const team = navItems.find((i) => i.id === 'group_team');
    expect(team?.children?.map((c) => c.id)).not.toContain('nav_board');
  });
});
