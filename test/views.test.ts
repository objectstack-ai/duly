// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { dulyApps } from '../src/apps/index.js';
import { dulyObjects } from '../src/objects/index.js';
import { dulyViews } from '../src/views/index.js';

/**
 * View tests — two jobs, kept apart on purpose.
 *
 * ── 1. A STOPGAP for what `pnpm validate` does not see ───────────────────
 * ⚠️ Delete the stopgap half when the upstream rules land. It is not a house
 * rule that wants maintaining forever; it is author-time coverage every
 * ObjectStack app would otherwise re-implement, and it is written to be
 * removed rather than kept in step with the platform:
 *
 *   objectstack-ai/objectstack#14106 — `view/layout-without-binding` covers
 *     `kanban` / `calendar` / `gantt` only. `timeline`, `tree` and `map` have
 *     the same literal-default fallback in the renderer and no gate.
 *   objectstack-ai/objectstack#14107 — NO field reference on a list view is
 *     resolved at author time: not `columns`, `filter`, `sort`, `grouping`,
 *     nor any binding block. Neither `os validate` NOR `os build` sees it.
 *   objectstack-ai/objectstack#14108 — a nav `viewName` naming a view that
 *     does not exist silently opens the default view instead.
 *
 * All three were measured against this repo on `@objectstack/cli` 17.2.0 by
 * mutating a view and re-running the gates. The readings are in the issues.
 *
 * ── 2. PRODUCT pins that outlive the platform gaps ───────────────────────
 * The gantt starting at `visible_from`, the timeline ordering by
 * `last_update_at`, one colour source for status, nothing ordered by a count.
 * Those stay when the stopgap goes: no upstream rule can know them.
 */

type Rec = Record<string, unknown>;

const objectFields = new Map<string, Set<string>>(
  (dulyObjects as unknown as Array<{ name: string; fields: Rec }>).map(
    (o) => [o.name, new Set(Object.keys(o.fields))] as const,
  ),
);

/**
 * Fields the platform provides on every object. A view may legitimately name
 * one, and they are not in the authored `fields` map.
 */
const SYSTEM_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'owner_id',
  'organization_id', 'business_unit_id',
]);

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

const fieldOf = (col: unknown): string | undefined =>
  typeof col === 'string' ? col : typeof (col as Rec)?.field === 'string' ? (col as Rec).field as string : undefined;

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
   * #14107: a misspelt field name anywhere on a view is parse-clean, publishes
   * green, and renders blank. Resolve every one of them here instead.
   */
  it('names only fields that exist on the object it is bound to', () => {
    const bindingFieldKeys = [
      'groupByField', 'summarizeField', 'startDateField', 'endDateField', 'titleField',
      'colorField', 'labelField', 'parentField', 'progressField', 'dependenciesField',
      'assigneeField', 'effortField', 'baselineStartField', 'baselineEndField',
      'locationField', 'latitudeField', 'longitudeField', 'coverField', 'allDayField',
    ];

    for (const { where, object, view } of allViews) {
      const known = objectFields.get(object);
      expect(known, `${where}: bound to "${object}", which no object in this stack defines`).toBeDefined();
      const check = (name: string | undefined, at: string) => {
        if (!name || name.includes('.')) return;
        expect(
          known!.has(name) || SYSTEM_FIELDS.has(name),
          `${where}: ${at} names "${name}", which is not a field on ${object}. `
          + `Fields: ${[...known!].sort().join(', ')}`,
        ).toBe(true);
      };

      for (const col of (view.columns as unknown[]) ?? []) check(fieldOf(col), 'columns[]');
      for (const rule of (view.filter as Rec[]) ?? []) check(rule.field as string, 'filter[].field');
      if (Array.isArray(view.sort)) for (const s of view.sort as Rec[]) check(s.field as string, 'sort[].field');
      for (const g of ((view.grouping as Rec | undefined)?.fields as Rec[]) ?? []) {
        check(g.field as string, 'grouping.fields[].field');
      }
      check((view.rowColor as Rec | undefined)?.field as string, 'rowColor.field');

      for (const spec of Object.values(REQUIRED_BINDINGS)) {
        const block = view[spec.block] as Rec | undefined;
        if (!block) continue;
        for (const key of bindingFieldKeys) check(block[key] as string, `${spec.block}.${key}`);
        for (const col of (block.columns as unknown[]) ?? []) check(fieldOf(col), `${spec.block}.columns[]`);
        for (const f of (block.fields as unknown[]) ?? []) check(fieldOf(f), `${spec.block}.fields[]`);
        for (const t of (block.tooltipFields as unknown[]) ?? []) check(fieldOf(t), `${spec.block}.tooltipFields[]`);
      }
    }
  });
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
   * Lateness and stagnation are asked of stored, indexed columns. A stored
   * flag needs a writer that runs every midnight; a formula field is virtual
   * and a filter naming one silently matches nothing.
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
   * #14108: a nav entry naming a view that does not exist does not fail — it
   * falls back to the default view, keeps its authored label, and looks right
   * in review. This is the check that would have caught it.
   */
  it('every nav entry resolves to a view that exists on the object it names', () => {
    for (const item of navItems) {
      if (item.type !== 'object' || !item.objectName) continue;
      expect(
        objectFields.has(item.objectName),
        `nav "${item.id}" targets object "${item.objectName}", which this stack does not define`,
      ).toBe(true);
      if (!item.viewName) continue; // no viewName = the object's default list
      const known = allViews
        .filter((v) => v.object === item.objectName)
        .map((v) => v.where.split('listViews.')[1])
        .filter(Boolean);
      expect(
        known,
        `nav "${item.id}" opens viewName "${item.viewName}", which ${item.objectName} does not declare — `
        + 'the shell silently falls back to the default view',
      ).toContain(item.viewName);
    }
  });

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
