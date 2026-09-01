// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { isPlatformProvidedObjectName } from '@objectstack/spec/system';
import { SystemFieldName } from '@objectstack/spec/system';

import { dulyApps } from '../src/apps/index.js';
import { dulyDashboards } from '../src/dashboards/index.js';
import { dulyDatasets } from '../src/datasets/index.js';
import { dulyObjects } from '../src/objects/index.js';
import { dulyViews } from '../src/views/index.js';

/**
 * ⚠️ STOPGAP — delete this file when objectstack-ai/objectstack#14105,
 * #14107 and #14108 land.
 *
 * This is not a repo-local house rule that wants maintaining forever. It is a
 * reference-resolution gap that every ObjectStack application would otherwise
 * re-implement. When the platform rules ship, `pnpm validate` covers this and
 * the right move is to REMOVE this file, not to keep two guards in step —
 * same convention as `test/flow-predicates.test.ts`.
 *
 * ── The gap, measured on `@objectstack/cli` 17.2.0 ───────────────────────
 * Field paths are resolved at author time NOWHERE in the UI or analytics
 * layer. Both `pnpm validate` and `pnpm build` exit 0 on:
 *
 *   | mutation                                   | validate | build |
 *   |--------------------------------------------|----------|-------|
 *   | view column → `subjekt_typo`               | 0        | 0     |
 *   | dataset field → `last_update_attt` (×7)    | 0        | 0     |
 *   | nav `viewName` → nonexistent               | 0        | 0     |
 *   | dimension / measure / filter key / include | 0        | 0     |
 *
 * What IS checked: CEL behind `record.` on record-scoped surfaces (AGENTS.md
 * rule 4), date-macro TOKENS inside a measure filter, and binding-block
 * PRESENCE on kanban / calendar / gantt. The asymmetry is what makes this
 * dangerous — a bad date macro on the same node is caught path-precisely, so
 * the layer looks guarded.
 *
 * The nav case (#14108) is the nastiest of the four: an unresolvable
 * `viewName` does not error, it falls back to the object's default view and
 * KEEPS THE AUTHORED LABEL. The screen looks right and shows the wrong rows.
 *
 * ── Relationship to `test/views.test.ts` — collapsed, not duplicated ────
 * Reference RESOLUTION on views and nav is owned HERE and nowhere else.
 * `test/views.test.ts` used to carry a second, weaker copy of it; duly#58
 * deleted that copy after measuring, mutation by mutation, that this walk
 * reports every defect the copy did. What stayed there is binding-block
 * PRESENCE (objectstack#14106 — "is there a `gantt` block at all") and the
 * product pins, neither of which this file checks. Presence and resolution
 * are different properties; do not move either one across.
 *
 * The five reasons the superset was worth having, and what each is worth now:
 *
 *  1. **Datasets were not covered there at all**, and `test/datasets.test.ts`
 *     pins caliber, date-macro grammar and the load-bearing absences — never
 *     that a `field` path names anything real.
 *  2. **Dotted paths were skipped there by construction**: that checker opened
 *     with `if (!name || name.includes('.')) return`. So `duty.frequency` —
 *     the one joined path this app ships — was resolved by NOTHING.
 *  3. **Its system-column list was hand-copied, and had drifted**: it carried
 *     `business_unit_id`, which is not a platform column, and omitted
 *     `owning_business_unit_id`, `tenant_id`, `user_id` and `deleted_at`,
 *     which are. Measured both ways before the deletion — a view column of
 *     `business_unit_id` passed there and fails here, and one of `deleted_at`
 *     failed there (a false positive) and passes here. This file reads the
 *     platform's own `SystemFieldName`, so it cannot drift again.
 *  4. **A view bound to a platform object would FAIL there**, because the
 *     bound object had to be in `dulyObjects`. Platform objects are resolved
 *     here from the platform's own registry.
 *  5. **Neither file had a self-test.** A guard that has never been observed
 *     failing is indistinguishable from a guard that cannot fail; the
 *     synthetic fixtures at the bottom pin both directions permanently.
 *
 * One thing the older copy DID cover that this walk did not: a nav entry
 * nested under an `object` entry rather than a `group`. That was a real hole,
 * not a redundancy — `walkNav` recursed on `group` alone — so it was closed
 * here (see the note in `walkNav`) BEFORE the copy was deleted, and pinned by
 * `reaches nav entries nested under an OBJECT entry` below. A collapse is
 * only sound once the surviving guard is a genuine superset.
 *
 * ── Narrowings, stated rather than hidden ────────────────────────────────
 * A guard people learn to ignore is worse than no guard, so this one only
 * fires where it is certain, and says where it stops:
 *
 *  - **Declared fields + the platform's system columns.** The anchor is
 *    `Object.keys(object.fields)` plus `SystemFieldName` — the platform's own
 *    registry, imported rather than transcribed. Hand-copying that list is
 *    what produced hole 3 above.
 *  - **A hop into a platform object is a BOUNDARY, not a resolution.** Nothing
 *    on disk carries the field set of `sys_user` / `sys_business_unit` —
 *    `@objectstack/spec` exports the platform object NAME registry
 *    (`isPlatformProvidedObjectName`) but no field lists — so a path like
 *    `owner.some_typo` cannot be judged. The hop itself is verified and the
 *    path is recorded as unresolvable; `no authored path crosses a platform
 *    object boundary` below keeps that from becoming a silent hole.
 *  - **Field-bearing slots are hand-listed, and the list polices itself.**
 *    The spec exports no slot table for view field references (unlike
 *    `FLOW_NODE_EXPRESSION_PATHS` for flow predicates), so the tables below
 *    are read off `view.zod.ts` / `dataset.zod.ts` with the declaring schema
 *    named. The `walks every field-bearing slot the metadata actually uses`
 *    tripwire fails loudly on a slot the walk does not know, so an unhandled
 *    key is a red test rather than an unchecked reference.
 *  - **Form views are not walked.** This app declares none. The tripwire below
 *    fails the day one appears rather than passing over it in silence.
 */

// ─── Resolution primitives ───────────────────────────────────────────────

type Rec = Record<string, unknown>;

interface DeclaredObject {
  readonly name: string;
  readonly fields: Rec;
}

/**
 * Columns the platform puts on every object. Imported from the spec's own
 * `SystemFieldName` rather than transcribed: a second hand-maintained copy of
 * platform knowledge drifts, and the copy `test/views.test.ts` used to carry
 * had — it listed `business_unit_id`, which is not a platform column, and
 * omitted four that are. That copy is gone (duly#58); this is the only one.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set(Object.values(SystemFieldName));

/** What resolving an object NAME can produce. */
type ObjectResolution =
  /** Declared in this stack — its field set is known. */
  | { readonly kind: 'declared'; readonly object: DeclaredObject }
  /**
   * Contributed by the runtime (`sys_` / `cloud_` / `ai_`), per the platform's
   * own registry. The name is real; the field set is not on disk.
   */
  | { readonly kind: 'platform'; readonly name: string }
  /** Names nothing — a typo, or a dependency this stack does not declare. */
  | { readonly kind: 'unknown'; readonly name: string };

const declaredObjects = new Map<string, DeclaredObject>(
  (dulyObjects as unknown as DeclaredObject[]).map((o) => [o.name, o]),
);

const makeObjectResolver =
  (objects: ReadonlyMap<string, DeclaredObject>) =>
  (name: string): ObjectResolution => {
    const declared = objects.get(name);
    if (declared) return { kind: 'declared', object: declared };
    // The platform's own registry — an app legitimately binds `sys_user` or
    // seeds the ADR-0090 business-unit tree, and those never appear in
    // `dulyObjects`. `isPlatformProvidedObjectName` is the NAME check (it
    // rejects `sys_bogus`), not merely the `sys_` prefix test.
    if (isPlatformProvidedObjectName(name)) return { kind: 'platform', name };
    return { kind: 'unknown', name };
  };

/** What resolving a field PATH can produce. */
type PathResolution =
  /** Every hop and the leaf resolved on declared metadata. */
  | { readonly kind: 'ok' }
  /**
   * A hop landed on a platform object, so the remainder cannot be judged.
   * Not a finding — a declared limit. See the narrowings above.
   */
  | { readonly kind: 'platform_boundary'; readonly at: string; readonly rest: string }
  /** A real dangling reference, with the reason. */
  | { readonly kind: 'bad'; readonly reason: string }
  /** The relationship hops this path traverses, for the `include` check. */
  ;

interface PathOutcome {
  readonly resolution: PathResolution;
  /** Relationship hop prefixes the path traverses, e.g. `duty` for `duty.frequency`. */
  readonly hops: readonly string[];
}

/**
 * Resolve `field` / `relationship[.relationship].field` against an object.
 *
 * A non-final segment must be a to-one relationship — a field carrying
 * `reference` (`lookup`, `master_detail` and `user` all set it; `Field.user`
 * fixes it to `sys_user`). Hopping through a scalar is a distinct, and more
 * legible, failure than "field not found".
 */
const makePathResolver =
  (resolveObject: (name: string) => ObjectResolution) =>
  (objectName: string, path: string): PathOutcome => {
    const segments = path.split('.');
    const hops: string[] = [];
    let current = resolveObject(objectName);

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]!;
      const isLeaf = i === segments.length - 1;

      if (current.kind === 'unknown') {
        return {
          resolution: { kind: 'bad', reason: `object "${current.name}" is not declared by this stack` },
          hops,
        };
      }
      if (current.kind === 'platform') {
        return {
          resolution: {
            kind: 'platform_boundary',
            at: current.name,
            rest: segments.slice(i).join('.'),
          },
          hops,
        };
      }

      const owner = current.object;
      const field = owner.fields[segment] as Rec | undefined;

      if (isLeaf) {
        if (field !== undefined) return { resolution: { kind: 'ok' }, hops };
        if (SYSTEM_FIELDS.has(segment)) return { resolution: { kind: 'ok' }, hops };
        return {
          resolution: {
            kind: 'bad',
            reason:
              `"${segment}" is not a field on ${owner.name}. Declared: `
              + `${Object.keys(owner.fields).sort().join(', ')}`,
          },
          hops,
        };
      }

      if (field === undefined) {
        return {
          resolution: { kind: 'bad', reason: `"${segment}" is not a field on ${owner.name}, so it cannot be traversed` },
          hops,
        };
      }
      const reference = field.reference;
      if (typeof reference !== 'string') {
        return {
          resolution: {
            kind: 'bad',
            reason:
              `"${segment}" on ${owner.name} is a \`${String(field.type)}\` field, not a relationship — `
              + 'only a lookup / master_detail / user field can be traversed',
          },
          hops,
        };
      }
      hops.push(segments.slice(0, i + 1).join('.'));
      current = resolveObject(reference);
    }

    /* c8 ignore next — an empty path cannot reach here: ''.split('.') is ['']. */
    return { resolution: { kind: 'ok' }, hops };
  };

// ─── Findings ────────────────────────────────────────────────────────────

interface Finding {
  /** e.g. `view duly_task › listViews.board · kanban.groupByField`. */
  readonly where: string;
  readonly reference: string;
  readonly reason: string;
}

/** A path this walk verified as far as a platform object and no further. */
interface Boundary {
  readonly where: string;
  readonly reference: string;
  readonly at: string;
}

interface WalkResult {
  readonly findings: Finding[];
  readonly boundaries: Boundary[];
  /** Every reference the walk actually resolved — the non-vacuity counter. */
  readonly resolved: string[];
  /** Field-bearing slot paths the walk does not know how to read. */
  readonly unknownSlots: string[];
}

const emptyResult = (): {
  findings: Finding[];
  boundaries: Boundary[];
  resolved: string[];
  unknownSlots: string[];
} => ({ findings: [], boundaries: [], resolved: [], unknownSlots: [] });

/** A column / tooltip entry is either a bare field name or `{ field }`. */
const fieldOf = (entry: unknown): string | undefined => {
  if (typeof entry === 'string') return entry;
  const field = (entry as Rec | undefined)?.field;
  return typeof field === 'string' ? field : undefined;
};

// ─── View field slots ────────────────────────────────────────────────────

/**
 * Binding-block keys whose STRING VALUE is a field name on the bound object.
 *
 * One entry per declaring schema in `@objectstack/spec/ui` (`view.zod.ts`) —
 * read off the schemas, not guessed:
 *  - `KanbanConfigSchema`   — groupByField, summarizeField, + `columns: string[]`
 *  - `CalendarConfigSchema` — startDateField, endDateField, titleField, colorField
 *  - `GanttConfigSchema`    — the timeline / hierarchy / baseline / resource set,
 *                             + `tooltipFields`, + `quickFilters[].field`
 *  - `TimelineConfigSchema` — startDateField, endDateField, titleField,
 *                             groupByField, colorField
 *  - `GalleryConfigSchema`  — coverField, titleField, + `visibleFields: string[]`
 *  - `TreeConfigSchema`     — parentField, labelField, + `fields: string[]`
 *  - `ListMapConfigSchema`  — latitude/longitude/location/title/descriptionField
 *
 * `chart` is deliberately absent: `ListChartConfigSchema`'s `dimensions` and
 * `values` are DATASET dimension and measure names, not object fields, and
 * resolving them here would be a confidently wrong check.
 */
const BINDING_BLOCK_FIELD_KEYS: Readonly<Record<string, readonly string[]>> = {
  kanban: ['groupByField', 'summarizeField'],
  calendar: ['startDateField', 'endDateField', 'titleField', 'colorField'],
  gantt: [
    'startDateField', 'endDateField', 'titleField', 'progressField', 'dependenciesField',
    'colorField', 'parentField', 'typeField', 'baselineStartField', 'baselineEndField',
    'groupByField', 'assigneeField', 'effortField',
  ],
  timeline: ['startDateField', 'endDateField', 'titleField', 'groupByField', 'colorField'],
  gallery: ['coverField', 'titleField'],
  tree: ['parentField', 'labelField'],
  map: ['latitudeField', 'longitudeField', 'locationField', 'titleField', 'descriptionField'],
};

/** Binding-block keys holding an ARRAY of field names (bare, or `{ field }`). */
const BINDING_BLOCK_FIELD_LISTS: Readonly<Record<string, readonly string[]>> = {
  kanban: ['columns'],
  gantt: ['tooltipFields'],
  gallery: ['visibleFields'],
  tree: ['fields'],
};

/** List-view keys holding an ARRAY of bare field names (`ListViewSchema`). */
const VIEW_FIELD_NAME_LISTS = ['searchableFields', 'filterableFields', 'hiddenFields', 'fieldOrder'] as const;

/**
 * Every field-bearing slot path this walk reads, normalised with `[]` for an
 * array index. The tripwire compares the slots the metadata ACTUALLY uses
 * against this set, so a slot the walk cannot read fails loudly.
 */
const KNOWN_VIEW_SLOTS: ReadonlySet<string> = new Set([
  'columns', 'columns[].field', 'columns[].summary.field', 'columns[].prefix.field',
  'filter[].field', 'sort[].field',
  'grouping.fields', 'grouping.fields[].field',
  'rowColor.field',
  ...VIEW_FIELD_NAME_LISTS,
  ...Object.entries(BINDING_BLOCK_FIELD_KEYS).flatMap(([block, keys]) => keys.map((k) => `${block}.${k}`)),
  ...Object.entries(BINDING_BLOCK_FIELD_LISTS).flatMap(([block, keys]) =>
    keys.flatMap((k) => [`${block}.${k}`, `${block}.${k}[].field`]),
  ),
  'gantt.quickFilters[].field',
  // Not field references — recorded so the tripwire does not report them.
  // `chart.dimensions` / `chart.values` are dataset names (see above);
  // `bulkActionDefs[].params[].labelField` names a field on the PARAM's own
  // lookup target, not on this view's object.
  'chart.dimensions', 'chart.values',
  'bulkActionDefs[].params[].labelField',
  'userFilters.fields', 'userFilters.fields[].field',
]);

/** Key names that mark a slot as field-bearing, for the tripwire scan. */
const isFieldishKey = (key: string): boolean =>
  key === 'field' || key === 'fields' || key === 'columns' || /Fields?$/.test(key);

/**
 * Every field-ish slot path present in `value`, normalised with `[]`.
 * Recording the PATH (not the key) is what lets `kanban.columns` — a list of
 * bare field names — be told apart from `columns[].field`.
 */
const fieldishSlots = (value: unknown, path: readonly string[] = [], out: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(value)) {
    for (const item of value) fieldishSlots(item, [...path, '[]'], out);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, child] of Object.entries(value as Rec)) {
    const here = [...path, key];
    if (isFieldishKey(key)) out.add(here.join('.').replace(/\.\[\]/g, '[]'));
    fieldishSlots(child, here, out);
  }
  return out;
};

interface NamedView {
  readonly where: string;
  readonly object: string;
  readonly key: string | undefined;
  readonly view: Rec;
}

/** Every list view in a view barrel, flattened, tagged with its bound object. */
const flattenViews = (views: readonly unknown[]): NamedView[] => {
  const out: NamedView[] = [];
  for (const container of views as Array<{ list?: Rec; listViews?: Record<string, Rec> }>) {
    if (container.list) {
      const object = ((container.list.data as Rec | undefined)?.object as string | undefined) ?? '';
      out.push({ where: `view ${object || '(unbound)'} › list`, object, key: undefined, view: container.list });
    }
    for (const [name, view] of Object.entries(container.listViews ?? {})) {
      const object = ((view.data as Rec | undefined)?.object as string | undefined) ?? '';
      out.push({ where: `view ${object || '(unbound)'} › listViews.${name}`, object, key: name, view });
    }
  }
  return out;
};

/** Containers declaring a form view — not walked; see the narrowings. */
const formViewSites = (views: readonly unknown[]): string[] => {
  const out: string[] = [];
  for (const container of views as Array<{ form?: Rec; formViews?: Record<string, Rec>; list?: Rec }>) {
    const object = ((container.list?.data as Rec | undefined)?.object as string | undefined) ?? '(unknown object)';
    if (container.form) out.push(`${object} › form`);
    for (const name of Object.keys(container.formViews ?? {})) out.push(`${object} › formViews.${name}`);
  }
  return out;
};

// ─── The walks ───────────────────────────────────────────────────────────

interface Stack {
  readonly views: readonly unknown[];
  readonly datasets: readonly unknown[];
  readonly apps: readonly unknown[];
  readonly objects: readonly DeclaredObject[];
  /**
   * Dashboards are here for ONE reason: a `type: 'dashboard'` nav entry
   * targets one by name, and the walk has to READ that name rather than skip
   * the type. (The platform does resolve this one — see the branch in
   * `walkNav` — unlike the `viewName` case #14108 is about.)
   *
   * The bindings INSIDE a dashboard (widget → dataset → dimension/measure,
   * and the widget's own `filter` keys) are NOT walked here; they are the
   * subject of `test/dashboard.test.ts`, which resolves them against
   * `dulyDatasets`. Optional so the self-test fixtures below can omit it.
   */
  readonly dashboards?: readonly unknown[];
}

/**
 * The whole rule, in one function, so the self-tests below exercise the same
 * code path the real metadata goes through.
 */
export const metadataBindingFindings = (stack: Stack): WalkResult => {
  const objects = new Map(stack.objects.map((o) => [o.name, o]));
  const dashboardNames = new Set(
    (stack.dashboards ?? []).map((d) => String((d as Rec).name ?? '')).filter(Boolean),
  );
  const resolveObject = makeObjectResolver(objects);
  const resolvePath = makePathResolver(resolveObject);
  const result = emptyResult();

  const check = (where: string, reference: unknown, objectName: string, at: string): void => {
    if (typeof reference !== 'string' || reference === '') return;
    const { resolution } = resolvePath(objectName, reference);
    const site = `${where} · ${at}`;
    if (resolution.kind === 'ok') {
      result.resolved.push(`${site} → ${reference}`);
      return;
    }
    if (resolution.kind === 'platform_boundary') {
      result.boundaries.push({ where: site, reference, at: resolution.at });
      return;
    }
    result.findings.push({ where: site, reference, reason: resolution.reason });
  };

  // ── Views ──────────────────────────────────────────────────────────────
  const views = flattenViews(stack.views);
  for (const { where, object, view } of views) {
    const bound = resolveObject(object);
    if (bound.kind !== 'declared') {
      result.findings.push({
        where,
        reference: object || '(none)',
        reason:
          bound.kind === 'unknown'
            ? `the view's \`data.object\` names "${object || '(nothing)'}", which this stack does not declare`
            : `the view is bound to the platform object "${object}", whose field set is not on disk — `
              + 'this walk cannot resolve its columns',
      });
      continue;
    }

    for (const column of (view.columns as unknown[]) ?? []) {
      check(where, fieldOf(column), object, 'columns[].field');
      const summary = (column as Rec | undefined)?.summary as Rec | undefined;
      if (summary && typeof summary === 'object') check(where, summary.field, object, 'columns[].summary.field');
      const prefix = (column as Rec | undefined)?.prefix as Rec | undefined;
      if (prefix) check(where, prefix.field, object, 'columns[].prefix.field');
    }
    for (const rule of (view.filter as Rec[]) ?? []) check(where, rule.field, object, 'filter[].field');

    const sort = view.sort;
    if (typeof sort === 'string') {
      // Legacy `"field desc"` spelling, still accepted by `ListViewSchema`.
      check(where, sort.trim().split(/\s+/)[0], object, 'sort (legacy string)');
    } else {
      for (const entry of (sort as Rec[]) ?? []) check(where, entry.field, object, 'sort[].field');
    }

    for (const level of ((view.grouping as Rec | undefined)?.fields as Rec[]) ?? []) {
      check(where, level.field, object, 'grouping.fields[].field');
    }
    check(where, (view.rowColor as Rec | undefined)?.field, object, 'rowColor.field');

    for (const key of VIEW_FIELD_NAME_LISTS) {
      for (const name of (view[key] as unknown[]) ?? []) check(where, name, object, `${key}[]`);
    }

    for (const [block, keys] of Object.entries(BINDING_BLOCK_FIELD_KEYS)) {
      const config = view[block] as Rec | undefined;
      if (!config) continue;
      for (const key of keys) check(where, config[key], object, `${block}.${key}`);
      for (const key of BINDING_BLOCK_FIELD_LISTS[block] ?? []) {
        for (const entry of (config[key] as unknown[]) ?? []) check(where, fieldOf(entry), object, `${block}.${key}[]`);
      }
      for (const quick of (config.quickFilters as Rec[]) ?? []) {
        check(where, quick.field, object, `${block}.quickFilters[].field`);
      }
    }

    /**
     * `bulkActionDefs` with `operation: 'update'` writes FIELDS: the static
     * `patch` keys, and the collected `params[].name` values, which
     * `BulkActionDefSchema` documents as merged over the patch ("the collected
     * values ARE the patch"). A typo in either is a write to a column that
     * does not exist — the same defect class, one layer down. Only `update`:
     * on a `custom` def the params are action params, not fields.
     */
    for (const def of (view.bulkActionDefs as Rec[]) ?? []) {
      if (def.operation !== 'update') continue;
      const name = String(def.name);
      for (const key of Object.keys((def.patch as Rec | undefined) ?? {})) {
        check(where, key, object, `bulkActionDefs '${name}'.patch key`);
      }
      for (const param of (def.params as Rec[]) ?? []) {
        check(where, param.name, object, `bulkActionDefs '${name}'.params[].name`);
      }
    }

    for (const slot of fieldishSlots(view)) {
      if (!KNOWN_VIEW_SLOTS.has(slot)) result.unknownSlots.push(`${where} · ${slot}`);
    }
  }

  // ── Datasets ───────────────────────────────────────────────────────────
  for (const raw of stack.datasets) {
    const ds = raw as Rec;
    const where = `dataset ${String(ds.name)}`;
    const base = String(ds.object ?? '');
    const bound = resolveObject(base);
    if (bound.kind !== 'declared') {
      result.findings.push({
        where: `${where} · object`,
        reference: base || '(none)',
        reason:
          bound.kind === 'unknown'
            ? `base object "${base || '(nothing)'}" is not declared by this stack`
            : `base object "${base}" is a platform object, whose field set is not on disk`,
      });
      continue;
    }

    /**
     * Joins are COMPILED from `include` (ADR-0071) — a dotted path whose
     * relationship is not included has no join to travel, so it resolves
     * against nothing at query time even though every segment names something
     * real. Declaring `a.b` implicitly includes `a`, so the set is every
     * prefix of every entry.
     */
    const included = new Set<string>();
    for (const entry of (ds.include as unknown[]) ?? []) {
      if (typeof entry !== 'string') continue;
      const segments = entry.split('.');
      for (let i = 1; i <= segments.length; i += 1) included.add(segments.slice(0, i).join('.'));
      // Each include path must itself be a chain of real relationships. The
      // path resolver needs a leaf, so the final hop is verified by resolving
      // the path as `<chain>` — a relationship field IS a field.
      check(where, entry, base, 'include[]');
    }

    const requireIncluded = (site: string, reference: string): void => {
      const { hops } = resolvePath(base, reference);
      for (const hop of hops) {
        if (included.has(hop)) continue;
        result.findings.push({
          where: `${where} · ${site}`,
          reference,
          reason:
            `traverses the relationship "${hop}", which is not in \`include\` — joins are compiled from `
            + `\`include\` (ADR-0071), so this path has no join to travel. Declared include: `
            + `${[...included].sort().join(', ') || '(none)'}`,
        });
      }
    };

    for (const dimension of (ds.dimensions as Rec[]) ?? []) {
      const site = `dimensions '${String(dimension.name)}'.field`;
      check(where, dimension.field, base, site);
      if (typeof dimension.field === 'string') requireIncluded(site, dimension.field);
    }

    for (const measure of (ds.measures as Rec[]) ?? []) {
      const name = String(measure.name);
      if (typeof measure.field === 'string') {
        const site = `measures '${name}'.field`;
        check(where, measure.field, base, site);
        requireIncluded(site, measure.field);
      }
      for (const key of filterFieldKeys(measure.filter)) {
        const site = `measures '${name}'.filter key`;
        check(where, key, base, site);
        requireIncluded(site, key);
      }
    }

    for (const key of filterFieldKeys(ds.filter)) {
      check(where, key, base, 'filter key');
      requireIncluded('filter key', key);
    }
  }

  // ── App navigation ─────────────────────────────────────────────────────
  /** `<object>.<viewKey>` for every named list view the stack declares. */
  const viewsByObject = new Map<string, Set<string>>();
  const objectsWithDefaultList = new Set<string>();
  for (const { object, key } of views) {
    if (key === undefined) {
      objectsWithDefaultList.add(object);
      continue;
    }
    const set = viewsByObject.get(object) ?? new Set<string>();
    set.add(key);
    viewsByObject.set(object, set);
  }

  const walkNav = (items: readonly Rec[] | undefined, appName: string): void => {
    for (const item of items ?? []) {
      const id = String(item.id ?? '(no id)');
      const where = `app ${appName} · nav '${id}'`;
      const type = String(item.type ?? '');

      /**
       * Children are walked for EVERY item type, not only `group`. The spec
       * ties the recursive knot on the object branch as well —
       * `NavigationItem` is `(ObjectNavItem & { children?: NavigationItem[] })
       * | … | GroupNavItem` — so a nav entry nested under an OBJECT entry is
       * legal metadata that the shell renders. Recursing only on `group` left
       * those children unvisited: measured on this app by hanging a child
       * carrying `viewName: 'ghost_view'` off `nav_log`, this walk stayed
       * GREEN while the reference resolved to nothing (duly#58). A `group`
       * carries no binding of its own, so it stops here; everything else
       * falls through and is resolved below.
       */
      walkNav(item.children as Rec[] | undefined, appName);
      if (type === 'group') continue;
      if (type === 'dashboard') {
        /**
         * `DashboardNavItemSchema` carries `dashboardName`, not an object, so
         * the reference to resolve is the DASHBOARD.
         *
         * Unlike `viewName` (#14108), this one is NOT an unguarded reference:
         * measured on `@objectstack/cli` 17.2.0 by pointing the entry at a
         * `duly_ghost`, `defineStack`'s own cross-reference validation refuses
         * the stack — validate exits 1, build exits 2, and every test that
         * imports the config goes red at once. The branch is here so the walk
         * READS the type instead of dropping it into `unknownSlots`, and so a
         * miss names the nav entry at unit level before the whole suite
         * explodes at config load. It is not standing in for a missing gate.
         */
        const dashboardName = String(item.dashboardName ?? '');
        if (dashboardNames.has(dashboardName)) {
          result.resolved.push(`${where} · dashboardName → ${dashboardName}`);
          continue;
        }
        result.findings.push({
          where: `${where} · dashboardName`,
          reference: dashboardName || '(none)',
          reason:
            `no dashboard named "${dashboardName || '(nothing)'}" is declared — the entry keeps its `
            + `authored label and opens nothing. Declared: ${[...dashboardNames].sort().join(', ') || '(none)'}`,
        });
        continue;
      }
      if (type !== 'object') {
        // Not a hole: page / url / report / action / component entries carry
        // no object binding for this walk to resolve. The `knows every nav
        // item type` tripwire is what keeps a NEW object-bearing type from
        // slipping through unchecked.
        result.unknownSlots.push(`${where} · nav type '${type}'`);
        continue;
      }

      const objectName = String(item.objectName ?? '');
      const bound = resolveObject(objectName);
      if (bound.kind === 'unknown') {
        result.findings.push({
          where,
          reference: objectName || '(none)',
          reason: `targets object "${objectName || '(nothing)'}", which this stack does not declare`,
        });
        continue;
      }
      result.resolved.push(`${where} → ${objectName}`);

      // `filters` targets the parameterized data surface; its KEYS are fields.
      for (const key of Object.keys((item.filters as Rec | undefined) ?? {})) {
        if (bound.kind === 'declared') check(where, key, objectName, 'filters key');
      }

      const viewName = item.viewName;
      if (typeof viewName !== 'string' || viewName === '') {
        /**
         * No `viewName` means the shell opens the object's default list.
         * `ObjectNavItemSchema` documents the default as `"all"`, and this app
         * declares its default as the container's `list` — so the entry is
         * only sound if that container exists.
         */
        if (bound.kind === 'declared' && !objectsWithDefaultList.has(objectName)) {
          result.findings.push({
            where,
            reference: objectName,
            reason:
              `declares no \`viewName\` and ${objectName} has no default \`list\` view — the shell has `
              + 'nothing to fall back to',
          });
        }
        continue;
      }

      if (bound.kind === 'platform') {
        result.boundaries.push({ where: `${where} · viewName`, reference: viewName, at: objectName });
        continue;
      }
      const known = viewsByObject.get(objectName) ?? new Set<string>();
      if (known.has(viewName)) {
        result.resolved.push(`${where} · viewName → ${objectName}.${viewName}`);
        continue;
      }
      result.findings.push({
        where: `${where} · viewName`,
        reference: viewName,
        reason:
          `${objectName} declares no list view named "${viewName}" — the shell SILENTLY falls back to the `
          + `default view and keeps this entry's authored label. Declared: `
          + `${[...known].sort().join(', ') || '(none)'}`,
      });
    }
  };

  for (const app of stack.apps as Array<{ name?: unknown; navigation?: Rec[] }>) {
    walkNav(app.navigation, String(app.name ?? '(unnamed)'));
  }

  return result;
};

/**
 * Top-level field paths of a `FilterCondition`.
 *
 * ⚠️ The column is the KEY, not the value. `test/datasets.test.ts` records the
 * same trap from the other side: its first revision walked `Object.values`
 * only, and its single most important assertion passed while asserting
 * nothing. `$and` / `$or` / `$not` re-enter as nested conditions
 * (`FilterConditionSchema`); every other `$`-prefixed key is an operator, and
 * operators live one level DOWN from the column, so they are never reached
 * here in the first place.
 */
function filterFieldKeys(filter: unknown, out: string[] = []): string[] {
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
}

// ─── The check, over this app's real metadata ────────────────────────────

const stack: Stack = {
  views: dulyViews as unknown[],
  datasets: dulyDatasets as unknown[],
  apps: dulyApps as unknown[],
  objects: dulyObjects as unknown as DeclaredObject[],
  dashboards: dulyDashboards as unknown[],
};

const result = metadataBindingFindings(stack);

describe('metadata bindings — every reference resolves (stopgap for objectstack#14105 / #14107 / #14108)', () => {
  it('every view, dataset and nav reference names something real', () => {
    expect(
      result.findings.map((f) => `${f.where}: "${f.reference}" — ${f.reason}`),
      'a reference in shipped metadata that resolves to nothing; validate and build both exit 0 on these',
    ).toEqual([]);
  });

  it('resolves references on all three surfaces, not just the easy one', () => {
    // A walk that silently stopped covering datasets or nav would pass the
    // assertion above by having nothing to check. These are the counters that
    // keep "green" from meaning "vacuous".
    const surfaces = {
      view: result.resolved.filter((r) => r.startsWith('view ')),
      dataset: result.resolved.filter((r) => r.startsWith('dataset ')),
      nav: result.resolved.filter((r) => r.startsWith('app ')),
    };
    for (const [name, hits] of Object.entries(surfaces)) {
      expect(hits.length, `no ${name} reference was resolved at all — the walk is broken`).toBeGreaterThan(0);
    }
    // The whole app is ~150 references; a walk that collapsed to a handful is
    // broken in a way the per-surface counts above would not catch.
    expect(result.resolved.length, 'the walk resolved implausibly few references').toBeGreaterThan(100);
  });

  it('resolves the joined path this app ships, through the lookup to the target field', () => {
    // `duty.frequency` is the one multi-hop path in the stack, and it is the
    // path the deleted copy in `test/views.test.ts` skipped by construction
    // (`if (!name || name.includes('.')) return`). Asserting it is REACHED,
    // not merely that nothing failed.
    expect(
      result.resolved.some((r) => r.endsWith('→ duty.frequency')),
      'the joined path duly_task→duty.frequency was never resolved — the multi-hop walk is not running',
    ).toBe(true);
  });

  it('walks every field-bearing slot the metadata actually uses', () => {
    // The slot tables are hand-maintained against `view.zod.ts` (the spec
    // exports no slot table for view field references, unlike
    // `FLOW_NODE_EXPRESSION_PATHS` for flow predicates). A slot this walk
    // cannot read would leave its reference UNCHECKED while everything stays
    // green — so fail here, loudly and specifically, rather than there.
    expect(
      result.unknownSlots,
      'a field-bearing slot this walk does not know — teach the slot tables about it before trusting the check',
    ).toEqual([]);
  });

  it('no authored path crosses a platform-object boundary', () => {
    // `@objectstack/spec` exports the platform object NAME registry but no
    // field lists, so a path like `owner.some_typo` cannot be judged. Rather
    // than let that be a silent hole, fail the day one is authored.
    expect(
      result.boundaries.map((b) => `${b.where}: "${b.reference}" stops at ${b.at}`),
      'a reference reaches into a platform object, whose fields are not on disk — this guard cannot check it',
    ).toEqual([]);
  });

  it('declares no form view, which this walk does not cover', () => {
    expect(
      formViewSites(stack.views),
      'a form view was added; its `sections[].fields[].field` references are NOT walked by this file',
    ).toEqual([]);
  });

  it('the platform objects this app references are real platform names', () => {
    // Requirement: `sys_user` / `sys_business_unit` must RESOLVE rather than
    // read as typos. They are checked against the platform's own registry, so
    // `sys_bogus` is still a finding — the typo net stays intact.
    const referenced = new Set<string>();
    for (const object of stack.objects) {
      for (const field of Object.values(object.fields) as Rec[]) {
        const reference = field?.reference;
        if (typeof reference === 'string' && !stack.objects.some((o) => o.name === reference)) {
          referenced.add(reference);
        }
      }
    }
    expect(referenced.size, 'no platform object referenced at all — the lookup walk is not reading `reference`')
      .toBeGreaterThan(0);
    for (const name of referenced) {
      expect(
        isPlatformProvidedObjectName(name),
        `a lookup targets "${name}", which is neither declared here nor a platform-provided object`,
      ).toBe(true);
    }
    expect([...referenced].sort()).toEqual(['sys_business_unit', 'sys_user']);
  });

  it('knows every nav item type present in this app', () => {
    // Same shape as the slot tripwire: a nav type carrying an object binding
    // this walk does not read would be unchecked while green.
    const navTypes = new Set<string>();
    const walk = (items: Rec[] | undefined): void => {
      for (const item of items ?? []) {
        navTypes.add(String(item.type));
        walk(item.children as Rec[] | undefined);
      }
    };
    for (const app of stack.apps as Array<{ navigation?: Rec[] }>) walk(app.navigation);
    // `dashboard` joined `group` / `object` when the manager dashboard landed:
    // `walkNav` reads its `dashboardName` and resolves it against the
    // dashboards barrel, so it is a READ type, not an ignored one. Anything
    // else still fails here rather than passing unchecked.
    expect(
      [...navTypes].filter((t) => t !== 'group' && t !== 'object' && t !== 'dashboard').sort(),
      'a nav item type this walk does not read — teach walkNav about it before trusting the nav check',
    ).toEqual([]);
  });
});

// ─── The guard can fail (self-test on synthetic fixtures) ────────────────

describe('metadata bindings — the guard can fail (self-test on synthetic metadata)', () => {
  /**
   * A guard that has never been observed failing is indistinguishable from a
   * guard that cannot fail. These fixtures pin BOTH directions permanently, so
   * the property survives a refactor of the walk above — one case per surface
   * the card names, plus the three shapes that must NOT fire.
   */
  const objects: DeclaredObject[] = [
    {
      name: 'fx_task',
      fields: {
        subject: { type: 'text' },
        status: { type: 'select' },
        due_date: { type: 'date' },
        duty: { type: 'lookup', reference: 'fx_duty' },
        owner: { type: 'user', reference: 'sys_user' },
      },
    },
    {
      name: 'fx_duty',
      fields: { frequency: { type: 'select' }, name: { type: 'text' } },
    },
  ];

  const view = (overrides: Rec = {}, key = 'lens'): unknown => ({
    listViews: {
      [key]: {
        label: 'Lens',
        type: 'grid',
        data: { provider: 'object', object: 'fx_task' },
        columns: [{ field: 'subject' }],
        ...overrides,
      },
    },
  });

  const dataset = (overrides: Rec = {}): unknown => ({
    name: 'fx_dataset',
    label: 'Fixture',
    object: 'fx_task',
    include: ['duty'],
    dimensions: [{ name: 'status', field: 'status' }],
    measures: [{ name: 'n', aggregate: 'count', filter: { status: 'open' } }],
    ...overrides,
  });

  const app = (children: Rec[]): unknown => ({
    name: 'fx_app',
    navigation: [{ id: 'g', type: 'group', label: 'G', children }],
  });

  const run = (over: Partial<Stack> = {}): WalkResult =>
    metadataBindingFindings({
      views: [view()],
      datasets: [dataset()],
      apps: [app([{ id: 'n', type: 'object', objectName: 'fx_task', viewName: 'lens' }])],
      objects,
      ...over,
    });

  const messages = (r: WalkResult): string[] => r.findings.map((f) => `${f.where}: ${f.reason}`);

  it('the baseline fixture is clean — otherwise every case below is meaningless', () => {
    const clean = run();
    expect(messages(clean)).toEqual([]);
    expect(clean.boundaries).toEqual([]);
    expect(clean.unknownSlots).toEqual([]);
    expect(clean.resolved.length).toBeGreaterThan(0);
  });

  // ── 1. View column ─────────────────────────────────────────────────────
  it('fires on a view column naming a field that does not exist', () => {
    const r = run({ views: [view({ columns: [{ field: 'subjekt_typo' }] })] });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.reference).toBe('subjekt_typo');
    expect(r.findings[0]!.where).toContain('columns[].field');
  });

  it('fires on the bare-string column shorthand too, not only the `{ field }` form', () => {
    // `ListViewSchema.columns` is `string[] | ListColumn[]`; both must be walked.
    const r = run({ views: [view({ columns: ['subjekt_typo'] })] });
    expect(r.findings.map((f) => f.reference)).toEqual(['subjekt_typo']);
  });

  it('fires on a binding-block field, and on a bare field name inside `kanban.columns`', () => {
    const r = run({
      views: [view({ type: 'kanban', kanban: { groupByField: 'statuss', columns: ['subject', 'ownerr'] } })],
    });
    expect(r.findings.map((f) => f.reference).sort()).toEqual(['ownerr', 'statuss']);
  });

  it('fires on a bulk-action patch key and on a collected param name', () => {
    const r = run({
      views: [
        view({
          bulkActionDefs: [
            { name: 'bulk', operation: 'update', patch: { statuss: 'done' }, params: [{ name: 'skip_reasonn' }] },
          ],
        }),
      ],
    });
    expect(r.findings.map((f) => f.reference).sort()).toEqual(['skip_reasonn', 'statuss']);
  });

  // ── 2. Dataset filter KEY ──────────────────────────────────────────────
  it('fires on a dataset filter KEY, which is where a values-only walk asserts nothing', () => {
    const r = run({ datasets: [dataset({ measures: [{ name: 'n', aggregate: 'count', filter: { statuss: 'open' } }] })] });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.reference).toBe('statuss');
    expect(r.findings[0]!.where).toContain('filter key');
  });

  it('reaches a filter key nested inside `$and` / `$or` / `$not`', () => {
    const r = run({
      datasets: [
        dataset({
          measures: [
            {
              name: 'n',
              aggregate: 'count',
              filter: { $and: [{ status: 'open' }, { $or: [{ due_datee: 1 }] }, { $not: { subjectt: 'x' } }] },
            },
          ],
        }),
      ],
    });
    expect(r.findings.map((f) => f.reference).sort()).toEqual(['due_datee', 'subjectt']);
  });

  it('does not mistake a filter OPERATOR for a column', () => {
    const r = run({
      datasets: [dataset({ measures: [{ name: 'n', aggregate: 'count', filter: { status: { $in: ['open'] } } }] })],
    });
    expect(messages(r)).toEqual([]);
  });

  it('fires on a dataset base object, dimension field and measure field', () => {
    expect(run({ datasets: [dataset({ object: 'fx_nope' })] }).findings[0]!.reason).toContain('not declared');
    expect(
      run({ datasets: [dataset({ dimensions: [{ name: 'd', field: 'statuss' }] })] }).findings.map((f) => f.reference),
    ).toEqual(['statuss']);
    expect(
      run({
        datasets: [dataset({ measures: [{ name: 'm', aggregate: 'min', field: 'due_datee' }] })],
      }).findings.map((f) => f.reference),
    ).toEqual(['due_datee']);
  });

  // ── 3. Joined path ─────────────────────────────────────────────────────
  it('fires on a joined path whose LEAF does not exist on the target object', () => {
    const r = run({ datasets: [dataset({ dimensions: [{ name: 'f', field: 'duty.frequencee' }] })] });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.reason).toContain('not a field on fx_duty');
  });

  it('fires on a joined path whose RELATIONSHIP does not exist', () => {
    const r = run({ datasets: [dataset({ dimensions: [{ name: 'f', field: 'dutyy.frequency' }] })] });
    expect(r.findings[0]!.reason).toContain('cannot be traversed');
  });

  it('fires on a path that hops through a scalar field instead of a relationship', () => {
    const r = run({ datasets: [dataset({ dimensions: [{ name: 'f', field: 'status.frequency' }] })] });
    expect(r.findings[0]!.reason).toContain('not a relationship');
  });

  it('fires on a joined path whose relationship is not in `include`', () => {
    // Every segment names something real, so a per-segment check passes — but
    // the join is compiled from `include`, so the path has nothing to travel.
    const r = run({
      datasets: [dataset({ include: [], dimensions: [{ name: 'f', field: 'duty.frequency' }] })],
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.reason).toContain('not in `include`');
  });

  it('does NOT fire on a joined path that resolves through a declared include', () => {
    expect(messages(run({ datasets: [dataset({ dimensions: [{ name: 'f', field: 'duty.frequency' }] })] }))).toEqual([]);
  });

  // ── 4. Nav ─────────────────────────────────────────────────────────────
  it('fires on a nav `viewName` that names no view on the object', () => {
    const r = run({
      apps: [app([{ id: 'n', type: 'object', objectName: 'fx_task', viewName: 'ghost', label: 'Looks fine' }])],
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.reference).toBe('ghost');
    expect(r.findings[0]!.reason).toContain('SILENTLY falls back');
  });

  it('fires on a nav `viewName` that exists on a DIFFERENT object', () => {
    // The failure mode a "does any view have this key" check misses entirely.
    const r = run({
      views: [view({}, 'lens'), { listViews: { other: { type: 'grid', data: { provider: 'object', object: 'fx_duty' }, columns: [{ field: 'name' }] } } }],
      apps: [app([{ id: 'n', type: 'object', objectName: 'fx_task', viewName: 'other' }])],
    });
    expect(r.findings.map((f) => f.reference)).toEqual(['other']);
  });

  it('fires on a nav `objectName` this stack does not declare', () => {
    const r = run({ apps: [app([{ id: 'n', type: 'object', objectName: 'fx_ghost' }])] });
    expect(r.findings[0]!.reason).toContain('does not declare');
  });

  it('reaches nav entries nested inside a group', () => {
    // A walk that never recursed would report nothing at all and read green.
    const r = run({
      apps: [
        {
          name: 'fx_app',
          navigation: [
            { id: 'outer', type: 'group', children: [{ id: 'inner', type: 'group', children: [{ id: 'deep', type: 'object', objectName: 'fx_task', viewName: 'ghost' }] }] },
          ],
        },
      ],
    });
    expect(r.findings.map((f) => f.where)).toEqual([expect.stringContaining("nav 'deep'")]);
  });

  it('reaches nav entries nested under an OBJECT entry, which the schema also allows', () => {
    // `NavigationItem` ties the `children` knot on the object branch too, so
    // this shape is legal metadata. Recursing only on `group` left it
    // unvisited and the walk read GREEN on a ghost `viewName` (duly#58) —
    // this is the case that kept `test/views.test.ts`'s nav assertion alive
    // until the walk was fixed.
    const r = run({
      apps: [
        {
          name: 'fx_app',
          navigation: [
            {
              id: 'parent', type: 'object', objectName: 'fx_task', viewName: 'lens',
              children: [{ id: 'nested', type: 'object', objectName: 'fx_task', viewName: 'ghost' }],
            },
          ],
        },
      ],
    });
    expect(r.findings.map((f) => f.reference)).toEqual(['ghost']);
    expect(r.findings[0]!.where).toContain("nav 'nested'");
  });

  // ── Must NOT fire ──────────────────────────────────────────────────────
  it('does not fire on a platform-object reference — it records a boundary instead', () => {
    const r = run({ datasets: [dataset({ include: ['owner'], dimensions: [{ name: 'o', field: 'owner.full_name' }] })] });
    expect(messages(r), 'a hop into sys_user is not a dangling reference').toEqual([]);
    expect(r.boundaries.map((b) => b.at)).toEqual(['sys_user']);
  });

  it('does not fire on a platform system column, which no object declares', () => {
    expect(messages(run({ views: [view({ sort: [{ field: 'created_at', order: 'desc' }] })] }))).toEqual([]);
  });

  it('does not fire on a nav entry with no `viewName` when a default list exists', () => {
    const withList = {
      list: { type: 'grid', data: { provider: 'object', object: 'fx_task' }, columns: [{ field: 'subject' }] },
    };
    expect(
      messages(run({ views: [withList], apps: [app([{ id: 'n', type: 'object', objectName: 'fx_task' }])] })),
    ).toEqual([]);
  });

  it('DOES fire on a nav entry with no `viewName` when the object has no default list', () => {
    // The other half of the case above — otherwise "no viewName" is a hole.
    const r = run({ apps: [app([{ id: 'n', type: 'object', objectName: 'fx_task' }])] });
    expect(r.findings[0]!.reason).toContain('no default `list` view');
  });

  // ── 5. Dashboard nav ───────────────────────────────────────────────────
  it('fires on a nav `dashboardName` that names no dashboard', () => {
    const r = run({
      apps: [app([{ id: 'd', type: 'dashboard', dashboardName: 'fx_ghost', label: 'Ghost' }])],
      dashboards: [{ name: 'fx_real' }],
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.reference).toBe('fx_ghost');
    expect(r.findings[0]!.where).toContain('dashboardName');
  });

  it('does not fire on a nav `dashboardName` that names a declared dashboard', () => {
    const r = run({
      apps: [app([{ id: 'd', type: 'dashboard', dashboardName: 'fx_real', label: 'Real' }])],
      dashboards: [{ name: 'fx_real' }],
    });
    expect(messages(r)).toEqual([]);
    expect(r.resolved.some((entry) => entry.endsWith('dashboardName → fx_real'))).toBe(true);
    // And it is a READ type, not one dropped into `unknownSlots` unchecked.
    expect(r.unknownSlots).toEqual([]);
  });

  it('reports every dangling reference in one view, not just the first', () => {
    const r = run({
      views: [view({ columns: [{ field: 'a_typo' }], filter: [{ field: 'b_typo', operator: 'equals', value: 1 }], sort: [{ field: 'c_typo', order: 'asc' }], grouping: { fields: [{ field: 'd_typo' }] } })],
    });
    expect(r.findings.map((f) => f.reference).sort()).toEqual(['a_typo', 'b_typo', 'c_typo', 'd_typo']);
  });

  it('flags a field-bearing slot the walk does not know', () => {
    // The tripwire that keeps the hand-maintained slot tables honest.
    const r = run({ views: [view({ gallery: { inventedField: 'subject' } })] });
    expect(r.unknownSlots).toEqual([expect.stringContaining('gallery.inventedField')]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// A grouped grid must FETCH what it groups by (stopgap for objectui#7179)
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ SECOND, INDEPENDENT STOPGAP — it does NOT get deleted with the walk
 * above. That one goes when objectstack#14105 / #14107 / #14108 land; this
 * one goes when **objectstack-ai/objectui#7179** lands, and not before.
 *
 * ── The defect, measured on `19a0306` with the #75 seed ─────────────────
 * `/_console/apps/ai.objectstack.duly/duly_task/view/by_unit` rendered ONE
 * collapsible group — `(empty)`, holding all 186 rows. The rows were right;
 * only the grouping did nothing, and nothing errored. `duly_duty`'s grouped
 * lens rendered `(empty)` on BOTH of its levels.
 *
 * The grid builds its query projection from `columns` ALONE. Captured off the
 * page load:
 *
 *   GET /api/v1/data/duly_task?select=id,subject,status,due_date,period_key,owner,source
 *     → business_unit: undefined      (on all 186 rows)
 *
 * `business_unit` was the `grouping` field and was not a column, so it was
 * never requested, so the renderer's `buildSegmentLabel` took its first line
 * — `if (value === undefined || …) return '(empty)'` — for every row.
 *
 * ── Why the walk above cannot see it ────────────────────────────────────
 * That walk resolves `business_unit` against `duly_task`'s schema and it
 * RESOLVES — a real, populated, correctly-typed lookup. Every binding here
 * was valid. This defect is a relationship between TWO CONFIG KEYS
 * (`grouping` vs `columns`), not a dangling reference, so no amount of
 * reference checking sees it. That is why this is a separate function rather
 * than another `check()` call.
 *
 * ── Scope: `grouping` ONLY, and that is a MEASURED narrowing ────────────
 * The card that filed this assumed the kanban board was "fine by luck"
 * because its group field happened to be displayed. It is not luck, and the
 * board's `status` is NOT one of its `columns`. Ablated against a booted app
 * (`objectstack dev`, #75 seed, 186 tasks), one leg at a time, each mutation
 * confirmed on disk and reverted through a restore trap:
 *
 *   | leg | mutation                                          | resulting `select`             |
 *   |-----|---------------------------------------------------|--------------------------------|
 *   | A   | board `kanban.groupByField` → `business_unit`      | …,source,**business_unit**,status |
 *   | B   | A + `business_unit` added to `kanban.columns`      | unchanged from A               |
 *   | C   | schedule `gantt.groupByField` → `business_unit`    | …,due_date,**business_unit**   |
 *   | D   | recent gains `timeline.groupByField: business_unit`| …,**business_unit**,due_date   |
 *
 * So the three BINDING-BLOCK group keys — `kanban` / `gantt` / `timeline`
 * `groupByField` — are each unioned into the projection by their own
 * adapter, with no column needed. The grid's `grouping` block is the one that
 * is not, which is exactly what #7179 asks upstream to fix. Legs A and B
 * together also say WHERE a field has to go if one ever were needed:
 * `kanban.columns` is the card face (`cardFields` in the console's view
 * adapter) and never the projection.
 *
 * This guard therefore covers `grouping.fields[]` and nothing else. Widening
 * it to the three group keys that measurably work would be the same mistake
 * the card warns against for `sort` — a rule that fires on non-bugs teaches
 * the next reader that the test lies. The other sites are still INVENTORIED
 * below, so adding one lands here for a human read rather than passing
 * silently.
 *
 * ── Proven red before the fix ───────────────────────────────────────────
 * Written against the views as they stood at `19a0306` and run there first.
 * `npx vitest run test/metadata-bindings.test.ts` exited 1 with exactly:
 *
 *   AssertionError: a grouped grid buckets rows by a field its `columns` do
 *   not carry …: expected [ …(3) ] to deeply equal []
 *   + "view duly_task › listViews.by_unit · grouping.fields[0].field groups
 *      by \"business_unit\", columns: subject, status, due_date, period_key,
 *      owner, source"
 *   + "view duly_duty › listViews.catalog_tree · grouping.fields[0].field
 *      groups by \"business_unit\", columns: name, form, frequency, source,
 *      status"
 *   + "view duly_duty › listViews.catalog_tree · grouping.fields[1].field
 *      groups by \"owner\", columns: name, form, frequency, source, status"
 *
 * A guard nobody watched fail is indistinguishable from a guard that cannot
 * fail, so the synthetic fixtures below pin both directions permanently.
 */
interface GroupingFinding {
  /** e.g. `view duly_task › listViews.by_unit`. */
  readonly where: string;
  /** e.g. `grouping.fields[0].field`. */
  readonly at: string;
  readonly field: string;
  readonly columns: readonly string[];
}

interface GroupingWalk {
  readonly findings: GroupingFinding[];
  /** Grid grouping levels examined — the non-vacuity counter. */
  readonly checked: string[];
  /**
   * Group keys that are NOT judged, because their adapter unions them into
   * the projection itself (legs A–D above). Inventoried so a new one is read
   * by a human instead of being silently exempt.
   */
  readonly exempt: string[];
}

/** Binding blocks whose `groupByField` the adapter adds to the projection. */
const SELF_PROJECTING_GROUP_BLOCKS = ['kanban', 'gantt', 'timeline'] as const;

export const groupingProjectionFindings = (views: readonly unknown[]): GroupingWalk => {
  const findings: GroupingFinding[] = [];
  const checked: string[] = [];
  const exempt: string[] = [];

  for (const { where, view } of flattenViews(views)) {
    // `ListViewSchema.columns` is `string[] | ListColumn[]`; both spellings
    // land in the projection the same way, so both are read here.
    const columns = ((view.columns as unknown[]) ?? [])
      .map((column) => fieldOf(column))
      .filter((field): field is string => typeof field === 'string' && field !== '');
    const projected = new Set(columns);

    const levels = ((view.grouping as Rec | undefined)?.fields as Rec[]) ?? [];
    levels.forEach((level, index) => {
      const field = level?.field;
      if (typeof field !== 'string' || field === '') return;
      const at = `grouping.fields[${index}].field`;
      checked.push(`${where} · ${at} → ${field}`);
      if (projected.has(field)) return;
      findings.push({ where, at, field, columns });
    });

    for (const block of SELF_PROJECTING_GROUP_BLOCKS) {
      const groupBy = (view[block] as Rec | undefined)?.groupByField;
      if (typeof groupBy === 'string' && groupBy !== '') {
        exempt.push(`${where} · ${block}.groupByField → ${groupBy}`);
      }
    }
  }

  return { findings, checked, exempt };
};

const groupingMessages = (walk: GroupingWalk): string[] =>
  walk.findings.map(
    (f) => `${f.where} · ${f.at} groups by "${f.field}", columns: ${f.columns.join(', ') || '(none)'}`,
  );

const grouping = groupingProjectionFindings(stack.views);

describe('grouped grids fetch what they group by (stopgap for objectui#7179)', () => {
  it('every grid grouping field is one of its own view\'s columns', () => {
    expect(
      groupingMessages(grouping),
      'a grouped grid buckets rows by a field its `columns` do not carry — the grid\'s projection is built '
        + 'from `columns` alone, so the field arrives `undefined` and every row lands in one `(empty)` '
        + 'bucket. Nothing errors, and `validate`, `typecheck`, `test` and `build` all stay green. Add the '
        + 'field to that view\'s `columns` (on a by-X view the X column is worth showing anyway).',
    ).toEqual([]);
  });

  it('actually examined this app\'s grouped grids', () => {
    // A walk that stopped seeing `grouping` — a renamed key, a refactor of
    // `flattenViews` — would pass the assertion above by checking nothing.
    expect(grouping.checked.sort(), 'the grouping walk examined the wrong set of levels').toEqual([
      'view duly_duty › listViews.catalog_tree · grouping.fields[0].field → business_unit',
      'view duly_duty › listViews.catalog_tree · grouping.fields[1].field → owner',
      'view duly_task › listViews.by_unit · grouping.fields[0].field → business_unit',
    ]);
  });

  it('inventories the group keys it deliberately does not judge', () => {
    // Legs A–D: these three are unioned into the projection by their own
    // adapter. A NEW one showing up here means someone should re-read that
    // measurement before trusting the exemption — it is upstream behaviour,
    // not a schema guarantee.
    expect(grouping.exempt.sort(), 'a self-projecting group key changed — re-read the ablation above').toEqual([
      'view duly_task › listViews.board · kanban.groupByField → status',
      'view duly_task › listViews.schedule · gantt.groupByField → owner',
    ]);
  });
});

describe('grouping-projection guard — the guard can fail (self-test on synthetic metadata)', () => {
  const grid = (overrides: Rec, key = 'lens'): unknown => ({
    listViews: {
      [key]: {
        label: 'Lens',
        type: 'grid',
        data: { provider: 'object', object: 'fx_task' },
        columns: [{ field: 'subject' }, { field: 'status' }],
        ...overrides,
      },
    },
  });

  it('does NOT fire when the grouping field is one of the columns', () => {
    const walk = groupingProjectionFindings([grid({ grouping: { fields: [{ field: 'status' }] } })]);
    expect(groupingMessages(walk)).toEqual([]);
    expect(walk.checked).toHaveLength(1);
  });

  it('fires when a grid groups by a field its columns do not carry', () => {
    const walk = groupingProjectionFindings([grid({ grouping: { fields: [{ field: 'business_unit' }] } })]);
    expect(walk.findings).toHaveLength(1);
    expect(walk.findings[0]!.field).toBe('business_unit');
    expect(walk.findings[0]!.at).toBe('grouping.fields[0].field');
    expect(walk.findings[0]!.columns).toEqual(['subject', 'status']);
  });

  it('reports EVERY level of a multi-level grouping, not just the first', () => {
    // `duly_duty`'s grouped lens is exactly this shape and was broken on both
    // levels; a guard that stopped at the first would have half-fixed it.
    const walk = groupingProjectionFindings([
      grid({ grouping: { fields: [{ field: 'business_unit' }, { field: 'owner' }] } }),
    ]);
    expect(walk.findings.map((f) => `${f.at}:${f.field}`)).toEqual([
      'grouping.fields[0].field:business_unit',
      'grouping.fields[1].field:owner',
    ]);
  });

  it('reads the bare-string column shorthand, which `ListViewSchema` also accepts', () => {
    const walk = groupingProjectionFindings([
      grid({ columns: ['subject', 'business_unit'], grouping: { fields: [{ field: 'business_unit' }] } }),
    ]);
    expect(groupingMessages(walk)).toEqual([]);
    expect(walk.checked).toHaveLength(1);
  });

  it('does NOT fire on kanban / gantt / timeline `groupByField` — it inventories them', () => {
    // Measured (legs A–D), not assumed: each adapter unions its own
    // `groupByField` into `$select`, so a column is not required and a
    // finding here would be a false one.
    const walk = groupingProjectionFindings([
      grid({ type: 'kanban', kanban: { groupByField: 'business_unit', columns: ['subject'] } }, 'k'),
      grid({ type: 'gantt', gantt: { groupByField: 'owner' } }, 'g'),
      grid({ type: 'timeline', timeline: { groupByField: 'source' } }, 't'),
    ]);
    expect(walk.findings).toEqual([]);
    expect(walk.exempt.map((e) => e.split(' · ')[1])).toEqual([
      'kanban.groupByField → business_unit',
      'gantt.groupByField → owner',
      'timeline.groupByField → source',
    ]);
  });

  it('examines nothing, and finds nothing, on a view that does not group', () => {
    const walk = groupingProjectionFindings([grid({})]);
    expect(walk.findings).toEqual([]);
    expect(walk.checked).toEqual([]);
    expect(walk.exempt).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Grouped lenses and the scope each one carries
//   · by_unit  — stays scoped to open work (stopgap for objectui#7189)
//   · schedule — stays scoped to open work (a product decision, NOT a stopgap)
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THIRD STOPGAP, and it is the SAME defect family as the grouping-
 * projection guard directly above — deliberately in this file, next to it,
 * rather than as a second mechanism somewhere else. That one makes the
 * grouping field arrive; this one keeps the grouped set small enough for the
 * grouping to be COMPLETE. Both go when **objectstack-ai/objectui#7189**
 * lands, and not before.
 *
 * ── The defect, measured on `0f0ec49` with the #75 seed ─────────────────
 * `/_console/apps/ai.objectstack.duly/duly_task/view/by_unit` carried no
 * filter, so it rendered all 186 tasks — 151 of them `done`. The request is
 * `top=100`, the grid groups CLIENT-SIDE over the rows already fetched, and
 * its per-group counts are `computeAggregations` over that same array
 * (objectui's `useGroupedData`). There is no server-side grouping path for a
 * grid at all. What the screen showed:
 *
 *   | group header         | shown |  in store |
 *   |----------------------|-------|-----------|
 *   | Northgate Operations |    33 |        61 |
 *   | Northgate Plant      |     3 |         7 |
 *   | Northgate Quality    |    46 |        86 |
 *   | Riverside Plant      |    18 |        31 |
 *   | Central Office       |   — no group at all — |         1 |
 *
 * Every count was a page slice reading as a total, and one of the five units
 * was ABSENT with nothing on screen saying so. The absent unit is the sharper
 * half: a wrong number invites a second look, a missing row does not.
 *
 * Scoped to `status in ('open','in_progress')` the lens fits in one page:
 * 27 `open` + 6 `in_progress` = 33 rows, all five units present, every count
 * true. Counted off the seed, not off the screen.
 *
 * ── Why this is a PIN on named lenses, not "grouped views must be filtered" ──
 * A filter requirement over every grouped view would fire on `duly_duty ›
 * catalog_tree`, which groups two levels deep and carries no filter — and
 * measurably does not need one: the seed holds **31** duties, one page, all
 * groups present, all counts true. It would fire on `duly_task › board` too,
 * whose kanban groups BY `status`: a status scope there would delete columns
 * from the board, which is the opposite of a fix. Making either declare a
 * filter to satisfy a rule is the same mistake the guard above narrows away
 * from — a rule that fires on a non-bug teaches the next reader that the test
 * lies, and that rule has now been measured firing on a healthy view twice.
 * What is actually being guarded is not "has a filter", it is a DECISION about
 * a named lens, so this pins those decisions and INVENTORIES the rest: a newly
 * added grouped view, or a re-spelled filter, changes the inventory and lands
 * here for a human read instead of passing silently.
 *
 * ── The `schedule` pin, and why it is NOT a #7189 stopgap ───────────────
 * The walk covers two different grouping mechanisms, so the inventory names
 * which one each lens uses. A grid groups through its `grouping` block; the
 * `kanban` / `gantt` / `timeline` binding blocks group through their own
 * `groupByField` (the same three the projection guard above inventories, for
 * the same reason — they are the blocks that carry a group key at all).
 *
 * `duly_task › schedule` is the gantt, and its scope is pinned here for a
 * reason that is NOT the one holding up `by_unit`, which matters when someone
 * comes to delete this file:
 *
 *  - `by_unit` is scoped because the grid's grouping and counts are computed
 *    over the fetched page. That is objectui#7189, and when #7189 lands the
 *    mechanical need goes with it.
 *  - `schedule` is scoped because a gantt of FINISHED work is not what the
 *    screen is for — 151 of the 186 scheduled tasks on the #75 seed are
 *    `done`. No platform fix retires that.
 *
 * Measured in a browser against `pnpm demo` before the filter was added, and
 * recorded because the card that asked for it assumed otherwise: the gantt is
 * NOT page-scoped. Its chart is served by the non-grid fetch, which sends no
 * `top`, so it drew all 186 rows and all 12 owner groups over the full
 * 2026-01-31 → 2026-12-31 span, while a SEPARATE `top=100` fetch fed the "100
 * records · Showing first 100 records" footer beneath it. So do not restore
 * this filter, or cite it, on the grounds that an owner group would otherwise
 * vanish — on this console build it would not. The details are in the block
 * above `filter` in `src/views/task.view.ts`.
 *
 * That inventory is also the non-vacuity counter. A walk that stopped seeing
 * `grouping` — a renamed key, a refactor of `flattenViews` — would satisfy a
 * bare "by_unit is scoped" assertion by finding nothing at all.
 *
 * ── What the walk reads, and what it deliberately does not ──────────────
 * Membership scoping only: `status` + `in` + a value list. A re-spelling that
 * excludes the same rows a different way (`status not_in ['done', …]`) reads
 * as `(none)` here and fails the pin. That is intended rather than an
 * oversight — the two are different decisions with different edges
 * (`not_in ['done']` also admits `cancelled` and `skipped`), and a changed
 * decision on this lens is exactly the thing that should stop a human.
 *
 * ── Proven red before the fix ───────────────────────────────────────────
 * Run against `src/views/task.view.ts` as it stood at `0f0ec49` — the fix
 * committed first, then that one file restored to its pre-fix state, so the
 * revert had somewhere to come back from. `npx vitest run
 * test/metadata-bindings.test.ts` exited 1 on both assertions; the excerpt is
 * in the PR body.
 */
interface GroupedScope {
  /** e.g. `view duly_task › listViews.by_unit`. */
  readonly where: string;
  /**
   * WHICH grouping mechanism this entry is about — `grid grouping` for the
   * `grouping` block, or `<block>.groupByField` for a binding block. A view
   * carrying both yields one entry per site rather than a merged one.
   */
  readonly via: string;
  /** Grouping levels, in the order they nest. A `groupByField` has exactly one. */
  readonly groupsBy: readonly string[];
  /** `status` values the lens is scoped to; empty when it carries no such filter. */
  readonly statusScope: readonly string[];
}

/** Every list view that groups — by either mechanism — with the scope it carries. */
export const groupedLensScopes = (views: readonly unknown[]): GroupedScope[] => {
  const out: GroupedScope[] = [];

  for (const { where, view } of flattenViews(views)) {
    // `ListViewSchema.filter` is a rule array; anything else is not a scope
    // this walk can read, and reads as unscoped rather than being assumed.
    const rules = Array.isArray(view.filter) ? (view.filter as Rec[]) : [];
    const statusScope = rules
      .filter((rule) => rule?.field === 'status' && rule?.operator === 'in')
      .flatMap((rule) => (Array.isArray(rule.value) ? (rule.value as unknown[]) : []))
      .filter((value): value is string => typeof value === 'string')
      .sort();

    const gridLevels = (((view.grouping as Rec | undefined)?.fields as Rec[]) ?? [])
      .map((level) => fieldOf(level))
      .filter((field): field is string => typeof field === 'string' && field !== '');
    if (gridLevels.length > 0) out.push({ where, via: 'grid grouping', groupsBy: gridLevels, statusScope });

    // The binding blocks that carry a group key — the same three the
    // projection guard above inventories, and for the same reason.
    for (const block of SELF_PROJECTING_GROUP_BLOCKS) {
      const groupBy = (view[block] as Rec | undefined)?.groupByField;
      if (typeof groupBy !== 'string' || groupBy === '') continue;
      out.push({ where, via: `${block}.groupByField`, groupsBy: [groupBy], statusScope });
    }
  }

  return out;
};

const scopeLines = (scopes: readonly GroupedScope[]): string[] =>
  scopes.map(
    (s) => `${s.where} · ${s.via}: ${s.groupsBy.join(', ')} · status scope: ${s.statusScope.join(', ') || '(none)'}`,
  );

const groupedScopes = groupedLensScopes(stack.views);
const scopeAt = (where: string, via: string): GroupedScope | undefined =>
  groupedScopes.find((s) => s.where === where && s.via === via);

describe('grouped lenses keep the scope each one was given', () => {
  it('`by_unit` carries the open-work status filter its grouping depends on', () => {
    const byUnit = scopeAt('view duly_task › listViews.by_unit', 'grid grouping');
    expect(byUnit, 'the by-unit lens no longer exists, or no longer groups').toBeDefined();
    expect(
      byUnit!.statusScope,
      'the by-unit lens lost the status filter that keeps its grouping complete. The grid groups over '
        + 'the FETCHED PAGE, so widening this filter puts 151 finished tasks back in front of the open '
        + 'ones, the lens pages again, and a whole business unit drops off the screen with nothing saying '
        + 'a unit is missing — no error, and `validate`, `typecheck`, `test` and `build` all stay green. '
        + 'Restore `status in [\'open\', \'in_progress\']`, and do not reach for a bigger page size: that '
        + 'moves the cliff instead of removing it. See objectstack-ai/objectui#7189.',
    ).toEqual(['in_progress', 'open']);
  });

  it('`schedule` carries the open-work status filter that makes it a schedule', () => {
    const schedule = scopeAt('view duly_task › listViews.schedule', 'gantt.groupByField');
    expect(schedule, 'the schedule lens no longer exists, or no longer groups by owner').toBeDefined();
    expect(
      schedule!.statusScope,
      'the schedule lens lost the open-work scope. This one is NOT a page-scoping stopgap and does not '
        + 'retire with objectui#7189: a gantt of FINISHED work is not what the screen is for. Widen it and '
        + '151 completed bars go back in front of the 33 open ones on the demo seed, and the footer\'s '
        + '"more data may be available" goes back under a chart that is in fact complete. Measured in a '
        + 'browser: the gantt is NOT page-scoped — its chart is served by an unpaginated fetch — so do not '
        + 'restore this on the grounds that an owner group would otherwise vanish, and do not reach for a '
        + 'page size, which is not what holds this chart together. Restore '
        + '`status in [\'open\', \'in_progress\']`; the measurement is in the block above `filter` in '
        + 'src/views/task.view.ts.',
    ).toEqual(['in_progress', 'open']);
  });

  it('inventories every grouped lens and the scope it carries', () => {
    // Doubles as the non-vacuity counter for both assertions above. A NEW
    // grouped lens appearing here is not automatically a defect — judge it the
    // way `catalog_tree` and `board` were judged. `catalog_tree`: does its
    // whole result set fit in one page (31 duties, yes)? `board`: it groups BY
    // `status`, so a status scope would delete columns from the board. Only a
    // lens whose grouped set can outgrow a page, or whose subject is the wrong
    // work, needs a scope here.
    expect(
      scopeLines(groupedScopes).sort(),
      'the set of grouped lenses, or the scope one carries, changed — read the note above before updating this',
    ).toEqual([
      'view duly_duty › listViews.catalog_tree · grid grouping: business_unit, owner · status scope: (none)',
      'view duly_task › listViews.board · kanban.groupByField: status · status scope: (none)',
      'view duly_task › listViews.by_unit · grid grouping: business_unit · status scope: in_progress, open',
      'view duly_task › listViews.schedule · gantt.groupByField: owner · status scope: in_progress, open',
    ]);
  });
});

describe('grouped-lens scope guard — the guard can fail (self-test on synthetic metadata)', () => {
  const grouped = (overrides: Rec, key = 'lens'): unknown => ({
    listViews: {
      [key]: {
        label: 'Lens',
        type: 'grid',
        data: { provider: 'object', object: 'fx_task' },
        columns: [{ field: 'subject' }, { field: 'business_unit' }],
        grouping: { fields: [{ field: 'business_unit' }] },
        ...overrides,
      },
    },
  });

  it('reads the open-work scope off an `in` filter', () => {
    const scopes = groupedLensScopes([
      grouped({ filter: [{ field: 'status', operator: 'in', value: ['open', 'in_progress'] }] }),
    ]);
    expect(scopes.map((s) => s.statusScope)).toEqual([['in_progress', 'open']]);
  });

  it('reports `(none)` for a grouped grid carrying no filter at all — the pre-fix by_unit', () => {
    const scopes = groupedLensScopes([grouped({})]);
    expect(scopeLines(scopes)).toEqual([
      'view fx_task › listViews.lens · grid grouping: business_unit · status scope: (none)',
    ]);
  });

  it('reports `(none)` when the filter is present but scopes another field', () => {
    // `catalog_tree` is unscoped this way too — a filter that narrows on
    // something else does not bound the grouped set by status.
    const scopes = groupedLensScopes([
      grouped({ filter: [{ field: 'due_date', operator: 'less_than', value: '{today}' }] }),
    ]);
    expect(scopes[0]!.statusScope).toEqual([]);
  });

  it('sees a WIDENED scope as a different scope — this is what catches the regression', () => {
    const scopes = groupedLensScopes([
      grouped({ filter: [{ field: 'status', operator: 'in', value: ['open', 'in_progress', 'done'] }] }),
    ]);
    expect(scopes[0]!.statusScope).toEqual(['done', 'in_progress', 'open']);
  });

  it('does not read a `not_in` re-spelling as the same decision', () => {
    // Deliberate: `not_in ['done']` also admits `cancelled` and `skipped`, so
    // it is a different decision and should stop a human rather than pass.
    const scopes = groupedLensScopes([
      grouped({ filter: [{ field: 'status', operator: 'not_in', value: ['done'] }] }),
    ]);
    expect(scopes[0]!.statusScope).toEqual([]);
  });

  it('records every grouping level, so the inventory line names the real shape', () => {
    const scopes = groupedLensScopes([
      grouped({ grouping: { fields: [{ field: 'business_unit' }, { field: 'owner' }] } }),
    ]);
    expect(scopes[0]!.groupsBy).toEqual(['business_unit', 'owner']);
  });

  it('reads a binding block\'s `groupByField` as a grouped lens too', () => {
    // The extension for `schedule`. A gantt carries no `grouping` block, so a
    // walk that only read that one would inventory nothing for it and the pin
    // above would pass by finding nothing.
    const scopes = groupedLensScopes([
      grouped({
        type: 'gantt',
        grouping: undefined,
        gantt: { groupByField: 'owner' },
        filter: [{ field: 'status', operator: 'in', value: ['open', 'in_progress'] }],
      }),
    ]);
    expect(scopeLines(scopes)).toEqual([
      'view fx_task › listViews.lens · gantt.groupByField: owner · status scope: in_progress, open',
    ]);
  });

  it('names WHICH mechanism groups, and reports a view using both as two entries', () => {
    // The `via` field is why the inventory can hold both mechanisms without a
    // reader having to guess which one a line is about.
    const scopes = groupedLensScopes([
      grouped({ type: 'kanban', kanban: { groupByField: 'status' } }),
    ]);
    expect(scopes.map((entry) => `${entry.via}:${entry.groupsBy.join('+')}`)).toEqual([
      'grid grouping:business_unit',
      'kanban.groupByField:status',
    ]);
  });

  it('examines nothing on a view that groups by neither mechanism', () => {
    expect(groupedLensScopes([grouped({ grouping: undefined })])).toEqual([]);
  });
});
