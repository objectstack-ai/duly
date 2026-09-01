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
 * ── Relationship to `test/views.test.ts` — declared, not hidden ──────────
 * That file's stopgap half already resolves the SIMPLE view surface (bare
 * `columns` / `filter` / `sort` / `grouping` / `rowColor` / binding-block keys
 * against the bound object) and the nav `objectName` / `viewName` pair. This
 * file is a strict superset of that half, and exists because the superset is
 * where the remaining holes are:
 *
 *  1. **Datasets are not covered there at all**, and `test/datasets.test.ts`
 *     pins caliber, date-macro grammar and the load-bearing absences — never
 *     that a `field` path names anything real.
 *  2. **Dotted paths are skipped there by construction**: its checker opens
 *     with `if (!name || name.includes('.')) return`. So `duty.frequency` —
 *     the one joined path this app ships — is resolved by NOTHING today.
 *  3. **Its system-column list is hand-copied** (and therefore already drifted:
 *     it carries `business_unit_id`, which is not a platform column, and omits
 *     `owning_business_unit_id`, `tenant_id`, `user_id` and `deleted_at`,
 *     which are). This file reads the platform's own `SystemFieldName`.
 *  4. **A view bound to a platform object would FAIL there**, because the
 *     bound object must be in `dulyObjects`. Platform objects are resolved
 *     here from the platform's own registry.
 *  5. **Neither file had a self-test.** A guard that has never been observed
 *     failing is indistinguishable from a guard that cannot fail; the
 *     synthetic fixtures at the bottom pin both directions permanently.
 *
 * Collapsing the two into one is a follow-up, not this card: deleting another
 * card's guard is not a rider on this one. Until then the overlap is benign —
 * this file is the superset, so any disagreement reds HERE first.
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
 * platform knowledge drifts, and `test/views.test.ts`'s copy already has.
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
   * targets one by name, and an unresolvable `dashboardName` is the same
   * #14108 failure as an unresolvable `viewName` — the shell has nothing to
   * open and the authored label stays on the entry either way.
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

      if (type === 'group') {
        walkNav(item.children as Rec[] | undefined, appName);
        continue;
      }
      if (type === 'dashboard') {
        /**
         * `DashboardNavItemSchema` carries `dashboardName`, not an object —
         * so the reference to resolve is the DASHBOARD, and the failure it
         * guards is #14108's: nothing resolves this name at author time, and
         * a miss is a nav entry that opens nothing while keeping the label
         * that promised a screen.
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
    // path `test/views.test.ts` skips by construction (`name.includes('.')`).
    // Asserting it is REACHED, not merely that nothing failed.
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
