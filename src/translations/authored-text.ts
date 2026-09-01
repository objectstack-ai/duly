// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { expandViewContainer } from '@objectstack/spec';
import { TRANSLATABLE_METADATA_TYPES } from '@objectstack/spec/system';

/**
 * The authored-text walk — the one place that decides what in this app's
 * metadata is DISPLAY TEXT and, for each piece, which bundle key carries its
 * translation.
 *
 * `src/translations/en.ts` builds the English bundle out of this walk, so `en`
 * is DERIVED and cannot be hand-edited into disagreement with the source
 * (there is no English literal anywhere to edit). `test/i18n-coverage.test.ts`
 * turns the same walk into the CI gate: a declared label with no bundle key,
 * and a bundle key with no source, both fail.
 *
 * ── The rule that makes this outlive the card ────────────────────────────
 * The walk does not enumerate the slots it knows about and skip the rest. It
 * visits EVERY string leaf in the metadata and demands a verdict for each,
 * looked up by NORMALISED PATH ([] for an array index, {} for a record key).
 * A path with no verdict is a finding — `collectAuthoredText().unclassified` —
 * and the gate fails naming it. So the next key somebody adds is a red test,
 * not an unchecked string. Same idiom, and the same reason, as the
 * `walks every field-bearing slot the metadata actually uses` tripwire in
 * `test/metadata-bindings.test.ts`; read that file before changing this one.
 *
 * Three verdicts, and the middle one is the interesting half:
 *
 *  - `translate`     — display text WITH a bundle key. Goes into `en`, and
 *                      `zh-CN` must carry it.
 *  - `untranslatable` — display text with NO bundle key anywhere in the
 *                      platform's translation schema. Not silently dropped:
 *                      each entry names why and where it is filed, the gate
 *                      counts them, and an entry that stops matching anything
 *                      fails as STALE so the list cannot rot into an excuse.
 *  - `machine`       — not display text at all (a machine name, a CEL source,
 *                      an icon, a colour, a filter token).
 *
 * ── What is translatable is the PLATFORM's answer, not ours ──────────────
 * `TRANSLATABLE_METADATA_TYPES` is imported from `@objectstack/spec/system`,
 * where it is documented as "derived from the dispatch table — never restate
 * it". Measured on 17.2.0 it is exactly
 * `{ view, action, object, app, dashboard, page }`. Every other metadata type
 * this app ships — dataset, flow, job, hook, permission set, position,
 * sharing rule — has no translator and no bundle group, so its display text is
 * `untranslatable` by the platform's own declaration rather than by our
 * judgement. `test/i18n-coverage.test.ts` pins the set, so the day the
 * platform makes datasets translatable the pin goes red and this walk gets
 * extended instead of quietly staying behind.
 *
 * ── Measured behaviour the key builders below depend on ──────────────────
 * Run against `@objectstack/spec` 17.2.0's own resolvers, not assumed:
 *
 *   translateObject  label / pluralLabel / description; per field `label`,
 *                    `help` and per-option `label`. NOTE the field shape: a
 *                    field's authored `description` is NOT overwritten —
 *                    `help` is ADDED beside it out of
 *                    `objects.<o>.fields.<f>.help`. So `help` is the bundle
 *                    slot for an authored field `description`, which is why
 *                    the key builder below spells it that way.
 *   translateAction  label / confirmText / successMessage only. `description`
 *                    and `params.*` are declared by `TranslationItemSchema`,
 *                    and `@objectstack/rest`'s `validateTranslationReferences`
 *                    lints their KEYS — but `translateAction` applies neither.
 *                    They are authored anyway, for the same reason the gantt's
 *                    `viewMode` stays authored in `src/views/task.view.ts`:
 *                    the key is the spec's own, it is served to API and MCP
 *                    callers, and it starts rendering the moment the resolver
 *                    is fixed. Filed upstream; see the PR body.
 *   translateApp     app label / description, and each navigation node's
 *                    label addressed by its stable `id`, at any tree depth.
 *   translateDashboard  dashboard label / description, widget title /
 *                    description / subCaption.
 *   translateView    view label / description, keyed by the view's REGISTRY
 *                    name — `expandViewContainer` is what produces it (the
 *                    default `list` becomes `<object>.default`), so it is
 *                    imported here rather than transcribed.
 *
 * ── One half of the gate already exists upstream, as a WARNING ───────────
 * `@objectstack/rest` ships `validateTranslationReferences`
 * (`translation-target-unknown` / `translation-option-key-unknown`), which
 * reports a bundle key aimed at an object, field, option value, view, section,
 * action, param, app, nav id, dashboard or widget that the stack does not
 * declare. It is a warning, it does not cover `messages`, and it says nothing
 * about the FORWARD direction (a declared label nobody translated). The gate
 * here is the forward half plus the same reverse half as an ERROR.
 */

// ─── Shapes ──────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** The metadata this walk reads. Shaped so a synthetic stack can be fed in. */
export interface TextStack {
  readonly objects: readonly unknown[];
  readonly views: readonly unknown[];
  readonly apps: readonly unknown[];
  readonly dashboards: readonly unknown[];
  readonly actions: readonly unknown[];
  readonly datasets: readonly unknown[];
  readonly flows: readonly unknown[];
  readonly jobs: readonly unknown[];
  readonly hooks: readonly unknown[];
  readonly positions: readonly unknown[];
  readonly permissions: readonly unknown[];
  readonly sharingRules: readonly unknown[];
  readonly pages: readonly unknown[];
}

/** One authored string, with the verdict the table gave it. */
export interface TextEntry {
  /** Human-readable site, e.g. `object duly_task · fields.status.label`. */
  readonly where: string;
  /** Normalised path, e.g. `object.fields{}.label`. */
  readonly path: string;
  readonly text: string;
  /** Bundle key path (`['objects','duly_task','label']`), or `undefined`. */
  readonly key?: readonly string[];
  /** Set on an `untranslatable` entry: why, and where it is filed. */
  readonly why?: string;
}

export interface AuthoredTextWalk {
  /** Display text WITH a bundle key. The English bundle is built from these. */
  readonly translatable: readonly TextEntry[];
  /** Display text with NO bundle key. Counted, named, never silently dropped. */
  readonly untranslatable: readonly TextEntry[];
  /** Strings the table calls machine values. Kept for the counters only. */
  readonly machine: readonly TextEntry[];
  /** Paths with no verdict — every one of these fails the gate. */
  readonly unclassified: readonly string[];
  /** `untranslatable` paths that matched nothing — a stale excuse. */
  readonly staleExemptions: readonly string[];
  /** Prose found inside a subtree declared opaque. Fails the gate. */
  readonly proseInOpaque: readonly string[];
}

// ─── The verdict table ───────────────────────────────────────────────────

interface KeyContext {
  /** Concrete path segments below the surface root. */
  readonly path: readonly string[];
  /** The object holding this string. */
  readonly parent: Rec;
  /** The surface's own identifiers (object name, view key, app name, …). */
  readonly ids: Rec;
}

type Verdict =
  | { readonly kind: 'translate'; readonly key: (ctx: KeyContext) => readonly string[] | undefined }
  | { readonly kind: 'machine'; readonly why: string }
  | { readonly kind: 'untranslatable'; readonly why: string };

const machine = (why: string): Verdict => ({ kind: 'machine', why });
const untranslatable = (why: string): Verdict => ({ kind: 'untranslatable', why });
const translate = (key: (ctx: KeyContext) => readonly string[] | undefined): Verdict =>
  ({ kind: 'translate', key });

const id = (ctx: KeyContext): string | undefined => str(ctx.ids.name);

/**
 * Subtrees the walk does not descend into, each with the reason. An opaque
 * subtree holds machine values only — a field payload, a filter, a binding
 * block. Choosing one is a decision, not a shortcut: it must be a VALUE bag,
 * never a structural container that could later grow a label. The prose net
 * below is the backstop for having chosen wrong.
 */
const OPAQUE: Readonly<Record<string, string>> = {
  'object.indexes': 'index definitions — field names and uniqueness scopes',
  'object.fields{}.summaryOperations': 'rollup wiring — object, field and function names',
  'object.enable': 'capability flags',
  'view.data': 'the view\'s data binding — provider and object name',
  'view.columns': 'column list — field paths',
  'view.sort': 'sort list — field paths and directions',
  'view.filter': 'filter rules — field paths, operators and machine values / date macros',
  'view.grouping': 'grouping fields',
  'view.kanban': 'kanban binding block — field paths',
  'view.calendar': 'calendar binding block — field paths',
  'view.gantt': 'gantt binding block — field paths and the view mode',
  'view.timeline': 'timeline binding block — field paths',
  'view.bulkActionDefs[].patch': 'the static update payload — stored field values',
  'app.branding': 'brand colours',
  'dashboard.header': 'header display flags',
  'dashboard.widgets[].layout': 'grid geometry',
  'dashboard.widgets[].chartConfig': 'chart type, colours and display flags',
  'dashboard.widgets[].options': 'renderer extras — sort key and direction',
  'dashboard.widgets[].filter': 'presentation-scope filter — field paths and date macros',
  'dataset.measures[].filter': 'measure filter — field paths, stored values and date macros',
  'flow.nodes[].config.fields': 'record payload — field names and `{template}` reads',
  'flow.nodes[].config.templateData': 'email render payload — `{{placeholder}}` values '
    + 'read off the record; the SENTENCES around them live in the email-template rows',
  'flow.nodes[].config.filter': 'record lookup filter — field names and `{template}` reads',
  'flow.nodes[].config.schedule': 'cron schedule',
  'flow.nodes[].config.timeRelative': 'time-relative trigger window — field, object and filter',
  'job.schedule': 'cron schedule',
  'job.retryPolicy': 'retry numbers',
  'permissionSet.objects': 'per-object CRUD scopes',
  'permissionSet.fieldPermissions': 'per-field read/write flags',
  'permissionSet.tabPermissions': 'per-app tab visibility',
};

/**
 * Every normalised path this app's metadata produces, with its verdict.
 *
 * A path missing from here is NOT skipped — it lands in `unclassified` and the
 * gate fails naming it. That default is the whole design: the table is the
 * exception list, and the exception list is reviewed.
 */
const VERDICTS: Readonly<Record<string, Verdict>> = {
  // ── object ────────────────────────────────────────────────────────────
  'object.name': machine('object API name'),
  'object.label': translate((c) => (id(c) ? ['objects', id(c)!, 'label'] : undefined)),
  'object.pluralLabel': translate((c) => (id(c) ? ['objects', id(c)!, 'pluralLabel'] : undefined)),
  'object.description': translate((c) => (id(c) ? ['objects', id(c)!, 'description'] : undefined)),
  'object.icon': machine('icon name'),
  'object.sharingModel': machine('security posture'),
  'object.datasource': machine('datasource name'),
  'object.nameField': machine('field name'),
  'object.highlightFields[]': machine('field names'),
  'object.fields{}.label': translate((c) =>
    id(c) ? ['objects', id(c)!, 'fields', c.path[1]!, 'label'] : undefined),
  // The bundle slot for an authored field `description` is `help` — measured
  // above on `translateObject`, which adds `help` beside the description.
  'object.fields{}.description': translate((c) =>
    id(c) ? ['objects', id(c)!, 'fields', c.path[1]!, 'help'] : undefined),
  'object.fields{}.options[].label': translate((c) => {
    const value = str(c.parent.value);
    return id(c) && value ? ['objects', id(c)!, 'fields', c.path[1]!, 'options', value] : undefined;
  }),
  'object.fields{}.options[].value': machine('the stored option value — the option key itself'),
  'object.fields{}.options[].color': machine('option colour'),
  'object.fields{}.type': machine('field type'),
  'object.fields{}.reference': machine('lookup target object'),
  'object.fields{}.deleteBehavior': machine('referential action'),
  'object.fields{}.defaultValue': machine('default value or token'),
  'object.fields{}.defaultValue.dialect': machine('expression dialect'),
  'object.fields{}.defaultValue.source': machine('CEL source'),
  // No bundle slot exists for a custom validation rule's message. Measured on
  // `@objectstack/objectql` 17.2.0: a rule's `message` is put on the error
  // verbatim. `messages['validation.field.*']` overrides the platform's
  // BUILT-IN field catalog (which already ships zh-CN), not an authored rule.
  'object.validations[].message': untranslatable(
    'a custom validation rule\'s message is emitted verbatim — the bundle has no '
    + '`_validations` group and `messages.validation.field.*` addresses only the '
    + 'platform\'s built-in field catalog. Filed upstream; see the PR body.',
  ),
  'object.validations[].name': machine('rule name'),
  'object.validations[].type': machine('rule kind'),
  'object.validations[].severity': machine('rule severity'),
  'object.validations[].events[]': machine('lifecycle events'),
  'object.validations[].condition.dialect': machine('expression dialect'),
  'object.validations[].condition.source': machine('CEL source'),

  // ── view (walked per expanded view item, so `list` and `listViews.*`
  //    normalise to the same paths) ────────────────────────────────────────
  'view.label': translate((c) => {
    const object = str(c.ids.object);
    const key = str(c.ids.viewKey);
    return object && key ? ['objects', object, '_views', key, 'label'] : undefined;
  }),
  'view.description': translate((c) => {
    const object = str(c.ids.object);
    const key = str(c.ids.viewKey);
    return object && key ? ['objects', object, '_views', key, 'description'] : undefined;
  }),
  'view.type': machine('visualisation kind'),
  'view.inlineEdit': machine('editing flag'),
  // An authored `bulkActionDefs` entry is NOT an action document: it never
  // reaches `translateAction`, and there is no `_bulkActions` group. The
  // authored comment in `src/views/task.view.ts` said as much before this
  // bundle existed; it is now measured rather than assumed.
  'view.bulkActionDefs[].label': untranslatable(BULK_WHY('the toolbar button caption')),
  'view.bulkActionDefs[].confirmText': untranslatable(BULK_WHY('the confirmation prompt')),
  'view.bulkActionDefs[].confirmLabel': untranslatable(BULK_WHY('the confirm button caption')),
  'view.bulkActionDefs[].params[].label': untranslatable(BULK_WHY('a parameter\'s field label')),
  'view.bulkActionDefs[].params[].placeholder': untranslatable(BULK_WHY('a parameter\'s placeholder')),
  'view.bulkActionDefs[].params[].help': untranslatable(BULK_WHY('a parameter\'s help text')),
  'view.bulkActionDefs[].name': machine('bulk action name'),
  'view.bulkActionDefs[].icon': machine('icon name'),
  'view.bulkActionDefs[].operation': machine('data-plane operation'),
  'view.bulkActionDefs[].variant': machine('button variant'),
  'view.bulkActionDefs[].params[].name': machine('param name'),
  'view.bulkActionDefs[].params[].type': machine('param input type'),
  'view.bulkActionDefs[].visible.dialect': machine('expression dialect'),
  'view.bulkActionDefs[].visible.source': machine('CEL source'),

  // ── app ───────────────────────────────────────────────────────────────
  'app.name': machine('app name'),
  'app.icon': machine('icon name'),
  'app.label': translate((c) => (id(c) ? ['apps', id(c)!, 'label'] : undefined)),
  'app.description': translate((c) => (id(c) ? ['apps', id(c)!, 'description'] : undefined)),
  // `translateApp` addresses every navigation node by its stable `id`, at any
  // depth, out of one flat `apps.<app>.navigation` map — so both the group and
  // the child normalise to the same key shape.
  'app.navigation[].label': translate((c) => {
    const nav = str(c.parent.id);
    return id(c) && nav ? ['apps', id(c)!, 'navigation', nav, 'label'] : undefined;
  }),
  'app.navigation[].children[].label': translate((c) => {
    const nav = str(c.parent.id);
    return id(c) && nav ? ['apps', id(c)!, 'navigation', nav, 'label'] : undefined;
  }),
  'app.navigation[].id': machine('navigation node id — the translation key itself'),
  'app.navigation[].type': machine('navigation node kind'),
  'app.navigation[].icon': machine('icon name'),
  'app.navigation[].children[].id': machine('navigation node id — the translation key itself'),
  'app.navigation[].children[].type': machine('navigation node kind'),
  'app.navigation[].children[].icon': machine('icon name'),
  'app.navigation[].children[].objectName': machine('bound object'),
  'app.navigation[].children[].viewName': machine('bound view'),
  'app.navigation[].children[].dashboardName': machine('bound dashboard'),

  // ── dashboard ─────────────────────────────────────────────────────────
  'dashboard.name': machine('dashboard name'),
  'dashboard.label': translate((c) => (id(c) ? ['dashboards', id(c)!, 'label'] : undefined)),
  'dashboard.description': translate((c) => (id(c) ? ['dashboards', id(c)!, 'description'] : undefined)),
  'dashboard.widgets[].title': translate((c) => {
    const widget = str(c.parent.id);
    return id(c) && widget ? ['dashboards', id(c)!, 'widgets', widget, 'title'] : undefined;
  }),
  'dashboard.widgets[].description': translate((c) => {
    const widget = str(c.parent.id);
    return id(c) && widget ? ['dashboards', id(c)!, 'widgets', widget, 'description'] : undefined;
  }),
  'dashboard.widgets[].id': machine('widget id — the translation key itself'),
  'dashboard.widgets[].type': machine('widget kind'),
  'dashboard.widgets[].dataset': machine('bound dataset'),
  'dashboard.widgets[].dimensions[]': machine('dataset dimension names'),
  'dashboard.widgets[].values[]': machine('dataset measure names'),
  'dashboard.widgets[].colorVariant': machine('tile colour role'),

  // ── action ────────────────────────────────────────────────────────────
  // An object-bound action is addressed under its object; an object-less one
  // under `globalActions`. `validateTranslationReferences` refuses the wrong
  // one of the two explicitly, so the branch below is the platform's rule.
  'action.label': translate((c) => actionKey(c, 'label')),
  'action.description': translate((c) => actionKey(c, 'description')),
  'action.confirmText': translate((c) => actionKey(c, 'confirmText')),
  'action.successMessage': translate((c) => actionKey(c, 'successMessage')),
  'action.params[].label': translate((c) => actionParamKey(c, 'label')),
  'action.params[].helpText': translate((c) => actionParamKey(c, 'helpText')),
  'action.params[].placeholder': translate((c) => actionParamKey(c, 'placeholder')),
  'action.name': machine('action name'),
  'action.objectName': machine('bound object'),
  'action.icon': machine('icon name'),
  'action.type': machine('handler kind'),
  'action.target': machine('handler registration key'),
  'action.variant': machine('button variant'),
  'action.locations[]': machine('placement slots'),
  'action.requiredPermissions[]': machine('capability names'),
  'action.params[].name': machine('param name'),
  'action.params[].type': machine('param input type'),
  'action.visible.dialect': machine('expression dialect'),
  'action.visible.source': machine('CEL source'),

  // ── dataset — no translator, no bundle group ──────────────────────────
  'dataset.name': machine('dataset name'),
  'dataset.object': machine('base object'),
  'dataset.include[]': machine('join paths'),
  'dataset.label': untranslatable(DATASET_WHY()),
  'dataset.description': untranslatable(DATASET_WHY()),
  'dataset.dimensions[].label': untranslatable(DATASET_WHY()),
  'dataset.measures[].label': untranslatable(DATASET_WHY()),
  'dataset.dimensions[].name': machine('dimension name — bound by dashboards'),
  'dataset.dimensions[].field': machine('field path'),
  'dataset.dimensions[].type': machine('dimension kind'),
  'dataset.dimensions[].dateGranularity': machine('date bucket size'),
  'dataset.measures[].name': machine('measure name — bound by dashboards'),
  'dataset.measures[].field': machine('field path'),
  'dataset.measures[].aggregate': machine('aggregation function'),

  // ── flow — no translator, no bundle group ─────────────────────────────
  'flow.name': machine('flow name'),
  'flow.type': machine('trigger family'),
  'flow.status': machine('lifecycle state'),
  'flow.runAs': machine('execution identity'),
  'flow.label': untranslatable(FLOW_WHY()),
  'flow.description': untranslatable(FLOW_WHY()),
  'flow.nodes[].label': untranslatable(FLOW_WHY()),
  'flow.edges[].label': untranslatable(FLOW_WHY()),
  // ── The user-facing half, and how #69 closed it ──────────────────────
  // These nodes USED to carry an inline `title` / `message`, which reached a
  // person in English in every locale and had no bundle key of any kind. #69
  // replaced them with a template reference plus a render payload, and an
  // email template IS locale-resolved — `IEmailService` resolves
  // `(name, locale)` and renders the row it picks, so the translation is a
  // SIBLING ROW rather than a bundle key. Nothing here needs a bundle entry;
  // what needs checking is that every template name has a row per supported
  // locale, which `test/i18n-coverage.test.ts` asserts against the collection.
  //
  // This gate is what noticed the change: the two `untranslatable` verdicts
  // that used to sit here failed as STALE the moment #69 merged, rather than
  // sitting in the exemption list describing metadata that no longer exists.
  'flow.nodes[].config.template': machine(
    'email template NAME — resolved by `(name, locale)` against the '
    + '`emailTemplates` collection, whose per-locale rows carry the display text',
  ),
  'flow.nodes[].id': machine('node id'),
  'flow.nodes[].type': machine('node kind'),
  'flow.nodes[].config.objectName': machine('bound object'),
  'flow.nodes[].config.outputVariable': machine('flow variable name'),
  'flow.nodes[].config.iteratorVariable': machine('loop variable name'),
  'flow.nodes[].config.collection': machine('`{template}` read'),
  'flow.nodes[].config.recipients': machine('`{template}` read'),
  'flow.nodes[].config.severity': machine('notification severity'),
  'flow.nodes[].config.topic': machine('notification topic key'),
  'flow.nodes[].config.sourceId': machine('`{template}` read'),
  'flow.nodes[].config.sourceObject': machine('bound object'),
  'flow.nodes[].config.triggerType': machine('trigger kind'),
  'flow.nodes[].config.condition.dialect': machine('expression dialect'),
  'flow.nodes[].config.condition.source': machine('CEL source'),
  'flow.edges[].id': machine('edge id'),
  'flow.edges[].type': machine('edge kind'),
  'flow.edges[].source': machine('node id'),
  'flow.edges[].target': machine('node id'),
  'flow.edges[].condition.dialect': machine('expression dialect'),
  'flow.edges[].condition.source': machine('CEL source'),
  'flow.variables[].name': machine('flow variable name'),
  'flow.variables[].type': machine('flow variable type'),

  // ── job / hook — operator-facing, no translator, no bundle group ──────
  'job.name': machine('job name'),
  'job.handler': machine('handler registration key'),
  'job.label': untranslatable(ADMIN_WHY('job')),
  'job.description': untranslatable(ADMIN_WHY('job')),
  'hook.name': machine('hook name'),
  'hook.object': machine('bound object'),
  'hook.handler': machine('handler registration key'),
  'hook.events[]': machine('lifecycle events'),
  'hook.onError': machine('failure posture'),
  'hook.label': untranslatable(ADMIN_WHY('hook')),
  'hook.description': untranslatable(ADMIN_WHY('hook')),

  // ── security — operator-facing, no translator, no bundle group ────────
  'position.name': machine('position name'),
  'position.label': untranslatable(ADMIN_WHY('position')),
  'position.description': untranslatable(ADMIN_WHY('position')),
  'permissionSet.name': machine('permission set name'),
  'permissionSet.systemPermissions[]': machine('capability names'),
  'permissionSet.label': untranslatable(ADMIN_WHY('permission set')),
  'permissionSet.description': untranslatable(ADMIN_WHY('permission set')),
};

function BULK_WHY(what: string): string {
  return `${what} of an authored \`bulkActionDefs\` entry. A bulk-action def is not an `
    + 'action DOCUMENT — it never reaches `translateAction`, and `TranslationDataSchema` '
    + 'has no group that addresses one — so this string renders in the source locale in '
    + 'every locale. The alternative shape (`bulkActions: [\'duly_task_complete\']`, '
    + 'promoting the row actions) is rejected in `src/views/task.view.ts` for a measured '
    + 'reason: N elevated action dispatches instead of one data-plane write. Filed '
    + 'upstream; see the PR body.';
}

function DATASET_WHY(): string {
  return 'a dataset is not one of the platform\'s translatable metadata types '
    + '(`TRANSLATABLE_METADATA_TYPES`) and `TranslationDataSchema` has no `datasets` '
    + 'group, so a measure or dimension label reaches a chart axis in the source '
    + 'locale. Filed upstream; see the PR body.';
}

function FLOW_WHY(): string {
  return 'a flow is not one of the platform\'s translatable metadata types and the '
    + '`flows` bundle group addresses only `label` and SCREEN copy — this app declares '
    + 'no screen node. Designer-facing text; see the PR body.';
}

function ADMIN_WHY(kind: string): string {
  return `a ${kind} is not one of the platform's translatable metadata types and has no `
    + 'bundle group. Operator-facing text (Studio, the run log), not an end-user screen.';
}

function actionKey(ctx: KeyContext, leaf: string): readonly string[] | undefined {
  const action = str(ctx.ids.name);
  if (!action) return undefined;
  const owner = str(ctx.ids.objectName);
  return owner
    ? ['objects', owner, '_actions', action, leaf]
    : ['globalActions', action, leaf];
}

function actionParamKey(ctx: KeyContext, leaf: string): readonly string[] | undefined {
  const param = str(ctx.parent.name);
  const base = actionKey(ctx, 'params');
  return param && base ? [...base, param, leaf] : undefined;
}

// ─── The walk ────────────────────────────────────────────────────────────

/**
 * Record-valued paths whose keys are DATA rather than structure, collapsed to
 * `{}` so one verdict covers every key. Anything not listed keeps its literal
 * segment, which is what makes an unknown map show up as an unclassified path
 * rather than being silently folded away.
 */
const RECORD_MAPS: ReadonlySet<string> = new Set(['object.fields']);

/**
 * Containers that RE-ENTER the vocabulary they sit inside, so the subtree
 * normalises onto the same paths as the outer one. A `loop` node's body holds
 * nodes and edges of exactly the same kinds as the flow around it; giving them
 * a second, `config.body`-prefixed copy of every verdict would be two tables to
 * keep in step, and the second copy is the one that would rot.
 */
const REENTER: Readonly<Record<string, string>> = {
  'flow.nodes[].config.body': 'flow',
};

/** Two words of three-plus letters — the shape machine values do not have. */
const PROSE = /[A-Za-z]{3,}\s+[A-Za-z]{3,}/;

interface Surface {
  readonly kind: string;
  readonly where: string;
  readonly node: Rec;
  readonly ids: Rec;
}

interface Sink {
  readonly translatable: TextEntry[];
  readonly untranslatable: TextEntry[];
  readonly machine: TextEntry[];
  readonly unclassified: Set<string>;
  readonly usedExemptions: Set<string>;
  readonly proseInOpaque: string[];
}

const walkSurface = (surface: Surface, sink: Sink): void => {
  const visit = (value: unknown, path: readonly string[], norm: string, parent: Rec): void => {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) visit(value[i], [...path, String(i)], `${norm}[]`, parent);
      return;
    }
    if (isRec(value)) {
      for (const [key, child] of Object.entries(value)) {
        const nextNorm = RECORD_MAPS.has(norm) ? `${norm}{}` : `${norm}.${key}`;
        const nextPath = [...path, key];
        const opaqueWhy = OPAQUE[nextNorm];
        if (opaqueWhy !== undefined) {
          collectOpaque(child, `${surface.where} · ${nextPath.join('.')}`, sink);
          continue;
        }
        visit(child, nextPath, REENTER[nextNorm] ?? nextNorm, value);
      }
      return;
    }
    if (typeof value !== 'string' || value.length === 0) return;

    const verdict = VERDICTS[norm];
    const where = `${surface.where} · ${path.join('.')}`;
    if (!verdict) {
      sink.unclassified.add(`${norm}   (first seen at ${where} = ${JSON.stringify(value.slice(0, 60))})`);
      return;
    }
    if (verdict.kind === 'machine') {
      sink.machine.push({ where, path: norm, text: value });
      return;
    }
    if (verdict.kind === 'untranslatable') {
      sink.usedExemptions.add(norm);
      sink.untranslatable.push({ where, path: norm, text: value, why: verdict.why });
      return;
    }
    const key = verdict.key({ path: path.slice(1), parent, ids: surface.ids });
    if (!key) {
      sink.unclassified.add(`${norm}   (translatable, but its key could not be built at ${where})`);
      return;
    }
    sink.translatable.push({ where, path: norm, text: value, key });
  };

  visit(surface.node, [surface.kind], surface.kind, surface.node);
};

/** Inside an opaque subtree the only thing checked is that it holds no prose. */
const collectOpaque = (value: unknown, where: string, sink: Sink): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectOpaque(item, where, sink);
    return;
  }
  if (isRec(value)) {
    for (const [key, child] of Object.entries(value)) collectOpaque(child, `${where}.${key}`, sink);
    return;
  }
  if (typeof value === 'string' && PROSE.test(value)) {
    sink.proseInOpaque.push(`${where} = ${JSON.stringify(value.slice(0, 80))}`);
  }
};

/** Every list view in a container, tagged with its object and REGISTRY key. */
const viewSurfaces = (views: readonly unknown[]): Surface[] => {
  const out: Surface[] = [];
  for (const container of views as Rec[]) {
    if (!isRec(container)) continue;
    const list = isRec(container.list) ? container.list : undefined;
    const object = str((isRec(list?.data) ? list!.data : {}).object) ?? '';
    // `expandViewContainer` is the platform's own naming — `listViews` keys in
    // author order, then the default `list` as `<object>.default`. Reading the
    // names from it is what keeps `_views` keys from drifting out of step with
    // the registry the resolver looks them up in.
    const prefix = `${object}.`;
    const strip = (name: unknown): string => {
      const text = String(name ?? '');
      return text.startsWith(prefix) ? text.slice(prefix.length) : text;
    };
    const listItems = (expandViewContainer(object, container) as unknown as Rec[])
      .filter((item) => item.viewKind === 'list');
    const namedKeys = listItems.filter((item) => !item.isDefault).map((item) => strip(item.name));
    const defaultKey = strip(listItems.find((item) => item.isDefault)?.name ?? 'default');
    const named = Object.entries(isRec(container.listViews) ? container.listViews : {});
    named.forEach(([authored, view], at) => {
      if (!isRec(view)) return;
      out.push({
        kind: 'view',
        where: `view ${object} › listViews.${authored}`,
        node: view,
        ids: { object, viewKey: namedKeys[at] ?? authored },
      });
    });
    if (list) {
      out.push({
        kind: 'view',
        where: `view ${object} › list`,
        node: list,
        ids: { object, viewKey: defaultKey },
      });
    }
  }
  return out;
};

const simpleSurfaces = (kind: string, nodes: readonly unknown[]): Surface[] =>
  (nodes as Rec[])
    .filter(isRec)
    .map((node) => ({
      kind,
      where: `${kind} ${str(node.name) ?? '(unnamed)'}`,
      node,
      ids: node,
    }));

/**
 * Walk every authored string in the stack and give each one a verdict.
 *
 * Deterministic and pure — the same stack in, the same walk out — which is
 * what lets `test/i18n-coverage.test.ts` run it over synthetic metadata and
 * prove the guard can fail.
 */
export const collectAuthoredText = (stack: TextStack): AuthoredTextWalk => {
  const sink: Sink = {
    translatable: [],
    untranslatable: [],
    machine: [],
    unclassified: new Set(),
    usedExemptions: new Set(),
    proseInOpaque: [],
  };

  const surfaces: Surface[] = [
    ...simpleSurfaces('object', stack.objects),
    ...viewSurfaces(stack.views),
    ...simpleSurfaces('app', stack.apps),
    ...simpleSurfaces('dashboard', stack.dashboards),
    ...simpleSurfaces('action', stack.actions),
    ...simpleSurfaces('dataset', stack.datasets),
    ...simpleSurfaces('flow', stack.flows),
    ...simpleSurfaces('job', stack.jobs),
    ...simpleSurfaces('hook', stack.hooks),
    ...simpleSurfaces('position', stack.positions),
    ...simpleSurfaces('permissionSet', stack.permissions),
    ...simpleSurfaces('sharingRule', stack.sharingRules),
    ...simpleSurfaces('page', stack.pages),
  ];
  for (const surface of surfaces) walkSurface(surface, sink);

  const declaredExemptions = Object.entries(VERDICTS)
    .filter(([, v]) => v.kind === 'untranslatable')
    .map(([path]) => path);

  return {
    translatable: sink.translatable,
    untranslatable: sink.untranslatable,
    machine: sink.machine,
    unclassified: [...sink.unclassified].sort(),
    staleExemptions: declaredExemptions.filter((p) => !sink.usedExemptions.has(p)).sort(),
    proseInOpaque: sink.proseInOpaque.sort(),
  };
};

/**
 * How every collection in `objectstack.config.ts` is handled, and why.
 *
 * Three categories, and the middle one is the reason this map exists rather
 * than being implied by what `TextStack` happens to list: a metadata type that
 * localizes through a DIFFERENT mechanism must not look like a type the walk
 * forgot. A silent skip and an unhandled key read identically at a glance, and
 * only one of them is safe.
 *
 *  - `walked`            — its display text is bundle-keyed; the walk covers it.
 *  - `localizes by …`    — real display text, localized by a mechanism that is
 *                          not the translation bundle. Checked elsewhere, named
 *                          here, never counted as untranslated.
 *  - anything else       — carries no authored display text at all.
 *
 * `test/i18n-coverage.test.ts` fails when the config grows a key this map does
 * not have, so a new collection is classified before it can ship strings the
 * gate cannot see.
 */
export const COLLECTION_HANDLING: Readonly<Record<string, string>> = {
  objects: 'walked',
  views: 'walked',
  apps: 'walked',
  dashboards: 'walked',
  actions: 'walked',
  datasets: 'walked',
  flows: 'walked',
  jobs: 'walked',
  hooks: 'walked',
  positions: 'walked',
  permissions: 'walked',
  sharingRules: 'walked',
  pages: 'walked',
  // ⛔ NOT bundle-keyed, and deliberately not walked. `translation.zod.ts`
  // mentions email templates nowhere, and `EmailTemplateDefinitionSchema`'s
  // own `translations` key is `z.ZodNever`; the platform documents a template
  // as "resolved by `(name, locale)`" and materializes one
  // `sys_email_template` ROW PER LOCALE. So a template's translation is a
  // SIBLING ROW with the same `name` and a different `locale`. Demanding a
  // bundle key for a template subject would make this gate permanently and
  // unfixably red. The equivalent question — "is there a translation for every
  // supported locale" — is asked of the row shape instead, in
  // `test/i18n-coverage.test.ts`.
  emailTemplates: 'localizes by row: one `sys_email_template` per (name, locale)',
  manifest: 'package registry metadata — `name` and `description` describe the PACKAGE, '
    + 'not a screen, and no bundle group addresses them',
  data: 'seed rows — data a deployment replaces, not authored labels',
  functions: 'handler registrations',
  plugins: 'plugin instances',
  requires: 'capability tokens',
  mappings: 'field mappings — machine names',
  i18n: 'the locale configuration these bundles serve',
  translations: 'the bundles themselves',
};

/** The platform's translatable metadata types, re-exported for the pin test. */
export const PLATFORM_TRANSLATABLE_TYPES: ReadonlySet<string> = TRANSLATABLE_METADATA_TYPES;

// ─── Bundle assembly ─────────────────────────────────────────────────────

/** `['objects','duly_task','label']` → `objects.duly_task.label`. */
export const keyPath = (key: readonly string[]): string => key.join('.');

/**
 * Fold a list of `(key, text)` pairs into the nested `TranslationData` shape.
 * Used for `en` (from the walk) and, in the gate, to compare `zh-CN`'s key set
 * against it.
 */
export const foldIntoBundle = (entries: readonly TextEntry[]): Rec => {
  const root: Rec = {};
  for (const entry of entries) {
    if (!entry.key) continue;
    let node = root;
    for (const segment of entry.key.slice(0, -1)) {
      const next = node[segment];
      if (isRec(next)) node = next;
      else {
        const created: Rec = {};
        node[segment] = created;
        node = created;
      }
    }
    node[entry.key[entry.key.length - 1]!] = entry.text;
  }
  return root;
};

/** Every dotted key a bundle carries, for set comparison in the gate. */
export const bundleKeys = (data: unknown, trail: readonly string[] = []): string[] => {
  if (typeof data === 'string') return [trail.join('.')];
  if (!isRec(data)) return [];
  return Object.entries(data).flatMap(([key, child]) => bundleKeys(child, [...trail, key]));
};
