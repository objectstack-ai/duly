// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { expandViewContainer } from '@objectstack/spec';

import stackConfig from '../objectstack.config.js';
import { dulyViews } from '../src/views/index.js';
import {
  bundleKeys,
  collectAuthoredText,
  COLLECTION_HANDLING,
  foldIntoBundle,
  keyPath,
  PLATFORM_TRANSLATABLE_TYPES,
} from '../src/translations/authored-text.js';
import type { TextStack } from '../src/translations/authored-text.js';
import { buildEnglishBundle, dulyTextStack, dulyEnglish } from '../src/translations/en.js';
import { dulyChinese } from '../src/translations/zh-CN.js';

/**
 * The i18n coverage gate.
 *
 * Two failures, both of them silent without this file:
 *
 *   1. **A declared label with no bundle key.** The screen renders in English
 *      inside a Chinese deployment, next to labels that did translate — which
 *      reads as a styling quirk, not as a missing translation.
 *   2. **A bundle key with no source.** A renamed field or a deleted view
 *      leaves an entry behind that resolves nothing. `@objectstack/rest`'s
 *      `validateTranslationReferences` reports most of these as a WARNING
 *      (`translation-target-unknown`); here it is an error, and it also covers
 *      the shapes that lint does not look at.
 *
 * ── Why this is a walk and not a checklist ───────────────────────────────
 * `src/translations/authored-text.ts` visits every string leaf in the metadata
 * and demands a verdict per normalised path. A path with no verdict is a
 * finding, so the next key somebody adds is a red test rather than an
 * unchecked string. That tripwire — not the key comparison — is the part of
 * this file meant to outlive the card, and it is the same idiom as
 * `walks every field-bearing slot the metadata actually uses` in
 * `test/metadata-bindings.test.ts`.
 *
 * ── The guard can fail ───────────────────────────────────────────────────
 * Every rule below is exercised a second time against SYNTHETIC metadata at
 * the bottom of this file. A guard that has never been observed failing is
 * indistinguishable from a guard that cannot fail.
 */

type Rec = Record<string, unknown>;

const SOURCE_LOCALE = 'en';
const TARGET_LOCALE = 'zh-CN';

const walk = collectAuthoredText(dulyTextStack);
const derivedKeys = walk.translatable.map((entry) => keyPath(entry.key!));
const englishKeys = new Set(bundleKeys((dulyEnglish as Rec)[SOURCE_LOCALE]));
const chineseKeys = new Set(bundleKeys((dulyChinese as Rec)[TARGET_LOCALE]));

// ─── The gate, over this app's real metadata ─────────────────────────────

describe('i18n coverage — every authored label is translated, every key has a source', () => {
  it('every declared label the walk can address is carried by zh-CN', () => {
    const missing = walk.translatable
      .filter((entry) => !chineseKeys.has(keyPath(entry.key!)))
      .map((entry) => `${keyPath(entry.key!)}  ← ${entry.where} = ${JSON.stringify(entry.text)}`);
    expect(
      missing,
      'a declared label with no bundle key in zh-CN — it renders in English inside a '
      + 'Chinese deployment, beside labels that did translate',
    ).toEqual([]);
  });

  it('every zh-CN key still has a source in the metadata', () => {
    const sources = new Set(derivedKeys);
    expect(
      [...chineseKeys].filter((key) => !sources.has(key)).sort(),
      'a bundle key that names nothing the metadata declares — a rename or a deletion '
      + 'left it behind and it resolves nothing',
    ).toEqual([]);
  });

  it('walks every string-bearing slot the metadata actually uses', () => {
    // THE tripwire. A path the walk cannot classify would leave its string
    // unchecked while everything stayed green — so fail here, naming the path,
    // rather than there.
    expect(
      walk.unclassified,
      'a string-bearing path this walk has no verdict for — classify it in '
      + '`src/translations/authored-text.ts` (translate / untranslatable / machine) '
      + 'before trusting this gate',
    ).toEqual([]);
  });

  it('declares no untranslatable exemption that matches nothing', () => {
    // An exemption list that outlives what it excused is how "we know about
    // that one" turns into an unreviewed hole.
    expect(
      walk.staleExemptions,
      'an `untranslatable` verdict that no longer matches any authored string — delete it',
    ).toEqual([]);
  });

  it('finds no prose inside a subtree declared opaque', () => {
    // The backstop for having declared the wrong subtree opaque: a value bag
    // that grows a sentence is display text hiding behind a skipped walk.
    expect(
      walk.proseInOpaque,
      'human prose inside a subtree `OPAQUE` says holds machine values only — either it '
      + 'is display text (stop skipping the subtree) or the value is misplaced',
    ).toEqual([]);
  });

  it('resolves keys on every translatable surface, not just the easy one', () => {
    // A walk that silently stopped covering actions or nav would pass the two
    // assertions above by having nothing to compare. These keep green from
    // meaning vacuous.
    const surfaces = {
      objects: derivedKeys.filter((k) => k.startsWith('objects.')),
      views: derivedKeys.filter((k) => k.includes('._views.')),
      actions: derivedKeys.filter((k) => k.includes('._actions.')),
      globalActions: derivedKeys.filter((k) => k.startsWith('globalActions.')),
      apps: derivedKeys.filter((k) => k.startsWith('apps.')),
      navigation: derivedKeys.filter((k) => k.includes('.navigation.')),
      dashboards: derivedKeys.filter((k) => k.startsWith('dashboards.')),
      widgets: derivedKeys.filter((k) => k.includes('.widgets.')),
      options: derivedKeys.filter((k) => k.includes('.options.')),
      help: derivedKeys.filter((k) => k.endsWith('.help')),
    };
    for (const [surface, keys] of Object.entries(surfaces)) {
      expect(keys.length, `no ${surface} key was derived at all — the walk is broken`)
        .toBeGreaterThan(0);
    }
    // This app is ~230 addressable strings; a walk that collapsed to a handful
    // is broken in a way the per-surface counts would not catch.
    expect(derivedKeys.length, 'the walk derived implausibly few keys').toBeGreaterThan(180);
    expect(new Set(derivedKeys).size, 'two authored strings claimed the same bundle key')
      .toBe(derivedKeys.length);
  });

  it('keys every view by the name the REGISTRY uses, not by the authored key', () => {
    // `_views.<name>` is looked up by the view's registry name — the default
    // `list` is `<object>.default`, not `list`. Read off the platform's own
    // expansion so the two cannot drift.
    const expected = new Set<string>();
    for (const container of dulyViews as Rec[]) {
      const object = String(((container.list as Rec)?.data as Rec)?.object ?? '');
      if (!object) continue;
      for (const item of expandViewContainer(object, container) as unknown as Rec[]) {
        if (item.viewKind !== 'list') continue;
        expected.add(`objects.${object}._views.${String(item.name).slice(object.length + 1)}.label`);
      }
    }
    const derivedViewLabels = new Set(derivedKeys.filter((k) => k.endsWith('.label') && k.includes('._views.')));
    expect([...expected].sort(), 'a view the walk did not key, or keyed under the wrong name')
      .toEqual([...derivedViewLabels].sort());
  });
});

// ─── `en` is generated, and cannot quietly stop being ────────────────────

describe('the English bundle is derived from the metadata, never hand-written', () => {
  it('is byte-for-byte the fold of the walk over this app\'s own metadata', () => {
    expect(
      (dulyEnglish as Rec)[SOURCE_LOCALE],
      'the shipped `en` bundle is not what the walk produces — someone put a literal in '
      + 'front of the derivation, and a hand-edited `en` beats the source string silently',
    ).toEqual(foldIntoBundle(walk.translatable));
  });

  it('carries exactly the source strings, unmodified', () => {
    const wrong = walk.translatable
      .filter((entry) => {
        let node: unknown = (dulyEnglish as Rec)[SOURCE_LOCALE];
        for (const segment of entry.key!) node = (node as Rec | undefined)?.[segment];
        return node !== entry.text;
      })
      .map((entry) => keyPath(entry.key!));
    expect(wrong, '`en` is the SOURCE language — every value must equal the authored label')
      .toEqual([]);
  });

  it('produces a different bundle for different metadata — i.e. it is a function of it', () => {
    // The property a hand-written `en` could not have. Two synthetic stacks,
    // same shape, different strings: if the bundle is derived, the output
    // follows the input.
    const first = buildEnglishBundle(syntheticStack({ objectLabel: 'Widget' })) as Rec;
    const second = buildEnglishBundle(syntheticStack({ objectLabel: 'Gadget' })) as Rec;
    expect(((first.en as Rec).objects as Rec).syn_thing).toMatchObject({ label: 'Widget' });
    expect(((second.en as Rec).objects as Rec).syn_thing).toMatchObject({ label: 'Gadget' });
  });

  it('keys `en` and `zh-CN` identically', () => {
    expect([...englishKeys].sort()).toEqual([...chineseKeys].sort());
  });
});

// ─── The stack actually ships what this file checks ──────────────────────

describe('the bundles reach the stack', () => {
  it('declares one bundle per supported locale, in the shape the loader reads', () => {
    // `loadTranslations` does `Object.entries(bundle)` on every element of
    // `translations`, so each element must be a `locale → data` RECORD. A
    // single-locale `defineTranslation` item would be read as two locales
    // named `locale` and `objects`, and neither would load.
    const bundles = (stackConfig as { translations?: unknown[] }).translations ?? [];
    expect(bundles.length, 'the translations barrel did not reach the stack').toBe(2);
    const locales = bundles.flatMap((bundle) => Object.keys(bundle as Rec)).sort();
    const supported = [...((stackConfig as { i18n?: { supportedLocales?: string[] } }).i18n?.supportedLocales ?? [])].sort();
    expect(locales, 'the bundles do not cover exactly the locales the config advertises')
      .toEqual(supported);
  });

  it('every metadata collection in the config is either walked or declared text-free', () => {
    // Sibling tripwire to the slot one. A NEW collection must be classified
    // before it can ship strings this gate does not see. The classification
    // itself lives beside the walk (`COLLECTION_HANDLING`), so the reasoning
    // and the walk cannot drift apart.
    expect(
      Object.keys(stackConfig as Rec).filter((key) => !(key in COLLECTION_HANDLING)).sort(),
      'a metadata collection this gate has never seen — classify it in '
      + '`COLLECTION_HANDLING` (walked, localizes by another mechanism, or text-free) '
      + 'before it ships strings this gate cannot see',
    ).toEqual([]);
    // The middle category is the one that must not read as an oversight: a
    // type that localizes by another mechanism is NAMED, with the mechanism.
    expect(COLLECTION_HANDLING.emailTemplates, 'the email-template skip must state its mechanism')
      .toMatch(/localizes by row/);
  });

  it('pins the metadata types the PLATFORM says are translatable', () => {
    // The anchor the walk's `untranslatable` verdicts rest on: a dataset
    // measure label has no bundle key because the platform has no dataset
    // translator, not because we decided so. When this set grows, that
    // reasoning changes and the walk must be extended — so fail here.
    expect(
      [...PLATFORM_TRANSLATABLE_TYPES].sort(),
      'the platform\'s translatable metadata types changed — re-derive the '
      + '`untranslatable` verdicts in src/translations/authored-text.ts against the new set',
    ).toEqual(['action', 'app', 'dashboard', 'object', 'page', 'view']);
  });
});

// ─── Display text no bundle can reach — named, counted, never silent ─────

describe('untranslatable display text is declared rather than dropped', () => {
  it('is exactly the set this repo has measured and filed', () => {
    // Not a tolerance: an exact set. A NEW untranslatable string fails here
    // and has to be argued for, and one that becomes translatable fails as a
    // stale exemption in the gate above.
    const paths = [...new Set(walk.untranslatable.map((entry) => entry.path))].sort();
    expect(
      paths,
      'authored display text with no bundle key that this repo has not recorded — either '
      + 'it has a key (add it to the walk) or it is a platform gap worth filing',
    ).toEqual([
      'dataset.description',
      'dataset.dimensions[].label',
      'dataset.label',
      'dataset.measures[].label',
      'flow.description',
      'flow.edges[].label',
      'flow.label',
      'flow.nodes[].label',
      'hook.description',
      'hook.label',
      'job.description',
      'job.label',
      'object.validations[].message',
      'page.regions[].components[].properties.content.en',
      'page.regions[].components[].properties.content.zh-CN',
      'permissionSet.description',
      'permissionSet.label',
      'position.description',
      'position.label',
      'view.bulkActionDefs[].confirmLabel',
      'view.bulkActionDefs[].confirmText',
      'view.bulkActionDefs[].label',
      'view.bulkActionDefs[].params[].help',
      'view.bulkActionDefs[].params[].label',
      'view.bulkActionDefs[].params[].placeholder',
    ]);
  });

  it('every one of them says why, so the list cannot decay into a shrug', () => {
    const silent = walk.untranslatable.filter((entry) => !entry.why || entry.why.length < 40);
    expect(silent.map((entry) => entry.path), 'an untranslatable verdict with no stated reason')
      .toEqual([]);
  });

  it('counts the user-facing half, which is what a reader of the PR needs', () => {
    // These three groups reach an END USER in English in a Chinese deployment.
    // The rest (flow node labels, job/hook/position/permission-set text) is
    // designer- or operator-facing. Asserted as counts so the PR body's
    // numbers cannot drift from the code.
    const count = (prefix: string): number =>
      walk.untranslatable.filter((entry) => entry.path.startsWith(prefix)).length;
    expect(count('view.bulkActionDefs'), 'bulk-action toolbar copy').toBe(35);
    // Was 11 before #107 added `review_status_transitions` and
    // `returned_needs_note`. Both messages are read by whoever is stopped by
    // them — a reviewer taking a step the pipeline does not have, an owner
    // returning a duty with no reason — so both enlarge the same declared gap
    // (a custom rule message has no bundle key anywhere in the platform's
    // schema) rather than opening a new kind of one.
    expect(count('object.validations'), 'custom validation messages').toBe(13);
    // Was 26 before #52 added the three on-time measures — `Done on time`,
    // `Completed late` and the `On-time rate` derived from them. A measure
    // label still has no bundle key anywhere in the platform's schema, so each
    // new one enlarges the same declared gap rather than opening a new kind of
    // one; the number moves with the code because that is what this pin is for.
    expect(count('dataset.'), 'dataset labels behind chart axes').toBe(29);
    // Was 6 before #99 (#69) landed: three `notify` nodes' inline title and
    // message. They now reference an email template, whose per-locale rows are
    // checked below — so this is a gap that CLOSED, pinned at zero so it
    // cannot silently reopen as inline copy.
    expect(count('flow.nodes[].config.'), 'inline notification copy — closed by #69').toBe(0);
    // `element:text` copy on `duly_member`, which IS end-user-facing and IS
    // localized — inline, because `PageTranslation.components` has no
    // `content` key (see the verdict's own note). Eight nodes × two locales.
    // The number is the size of the filed spec gap; when the key lands these
    // strings move into the bundles and this drops to 0.
    expect(count('page.regions'), '`element:text` copy localized inline').toBe(16);
  });
});

// ─── Email templates — a locale is a SIBLING TEMPLATE, not a bundle key ──

/**
 * `EmailTemplateDefinitionSchema` carries its own `locale`, and the platform
 * documents a template as "resolved by `(name, locale)`" — its `translations`
 * key is `z.ZodNever`. So the coverage rule for templates is not "has a bundle
 * key" but "has a sibling in every supported locale". Written now, against a
 * collection that is still empty, so #69's templates are covered the moment
 * they are wired in rather than after somebody remembers.
 */
interface TemplateLike { name?: unknown; locale?: unknown; subject?: unknown; bodyHtml?: unknown; bodyText?: unknown }

const templateGaps = (templates: readonly TemplateLike[], locales: readonly string[]): string[] => {
  const byName = new Map<string, Set<string>>();
  for (const template of templates) {
    const name = typeof template?.name === 'string' ? template.name : '';
    if (!name) continue;
    // `locale` has a schema default, so an omitted one is the default locale.
    const locale = typeof template?.locale === 'string' ? template.locale : SOURCE_LOCALE;
    const seen = byName.get(name) ?? new Set<string>();
    seen.add(locale);
    byName.set(name, seen);
  }
  const gaps: string[] = [];
  for (const [name, seen] of byName) {
    for (const locale of locales) {
      if (!seen.has(locale)) gaps.push(`email template "${name}" has no ${locale} sibling`);
    }
  }
  return gaps.sort();
};

/** Literal authored words in a template row, with `{{holes}}` removed. */
const literalWords = (template: TemplateLike & { bodyHtml?: unknown; bodyText?: unknown }): string =>
  [template.subject, template.bodyHtml, template.bodyText]
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ')
    .replace(/\{\{\{?[^}]*\}?\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Names whose locale rows carry identical authored wording. */
const sameWordsAcrossLocales = (templates: readonly TemplateLike[]): string[] => {
  const byName = new Map<string, string[]>();
  for (const template of templates) {
    const name = typeof template?.name === 'string' ? template.name : '';
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), literalWords(template)]);
  }
  return [...byName]
    .filter(([, words]) => words.length > 1 && words.some((w) => w.length > 0)
      && new Set(words).size < words.length)
    .map(([name]) => name)
    .sort();
};

describe('email templates carry a sibling per supported locale', () => {
  const templates = ((stackConfig as { emailTemplates?: readonly TemplateLike[] }).emailTemplates ?? []);
  const locales = (stackConfig as { i18n?: { supportedLocales?: string[] } }).i18n?.supportedLocales ?? [];

  it('every declared template resolves in every supported locale', () => {
    expect(
      templateGaps(templates, locales),
      'a template subject/body that reaches a person in the source language only — a '
      + 'template is resolved by (name, locale), so the translation is a sibling row',
    ).toEqual([]);
  });

  it('is checking real rows, not passing on an empty collection', () => {
    // Non-vacuity. #69 landed three template NAMES × two locales; if the
    // collection ever empties, the assertion above would pass by having
    // nothing to check, and this is what says so.
    const names = new Set(templates.map((t) => String(t.name)));
    expect(names.size, 'no email template reached the config — the check above is vacuous')
      .toBeGreaterThan(0);
    expect(templates.length, 'one row per (name, locale): three names across two locales')
      .toBe(names.size * locales.length);
  });

  it('gives each locale row its own words, not a copy of the source row', () => {
    // A sibling row that duplicates the source-locale wording is a row that
    // exists and translates nothing — the row-shaped version of an English
    // value pasted into `zh-CN`, and the shape a per-locale COUNT cannot see.
    //
    // Compared on LITERAL text only: `{{holes}}` are stripped first, because a
    // field that is nothing but a placeholder is carrying record data rather
    // than authored words. `subject: '{{{subject}}}'` is the same string in
    // both rows on purpose — it renders the task's own subject line — and
    // flagging it would be flagging the data.
    expect(sameWordsAcrossLocales(templates), 'a locale row repeats the source row\'s wording')
      .toEqual([]);
  });
});

// ─── The guard can fail (self-test on synthetic metadata) ────────────────

const emptyStack = (): TextStack => ({
  objects: [], views: [], apps: [], dashboards: [], actions: [], datasets: [],
  flows: [], jobs: [], hooks: [], positions: [], permissions: [], sharingRules: [],
  pages: [],
});

const syntheticStack = (opts: { objectLabel?: string; extraField?: Rec; opaqueProse?: boolean } = {}): TextStack => ({
  ...emptyStack(),
  objects: [
    {
      name: 'syn_thing',
      label: opts.objectLabel ?? 'Widget',
      pluralLabel: 'Widgets',
      fields: {
        status: {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [{ label: 'Open', value: 'open' }],
          ...(opts.extraField ?? {}),
        },
      },
      ...(opts.opaqueProse
        ? { indexes: [{ name: 'syn_index', fields: ['status'], unique: 'a whole sentence hiding here' }] }
        : {}),
    },
  ],
});

describe('i18n coverage guard — the guard can fail (self-test on synthetic metadata)', () => {
  it('derives a key for an ordinary label', () => {
    const found = collectAuthoredText(syntheticStack()).translatable.map((e) => keyPath(e.key!));
    expect(found).toContain('objects.syn_thing.label');
    expect(found).toContain('objects.syn_thing.fields.status.label');
    expect(found).toContain('objects.syn_thing.fields.status.options.open');
  });

  it('reports a string-bearing path it has no verdict for', () => {
    const result = collectAuthoredText(syntheticStack({ extraField: { bannerText: 'Read me first' } }));
    expect(result.unclassified.join('\n'))
      .toContain('object.fields{}.bannerText');
    expect(
      result.translatable.some((e) => e.text === 'Read me first'),
      'an unclassified string must NOT be silently translated',
    ).toBe(false);
  });

  it('reports prose hiding inside an opaque subtree', () => {
    const result = collectAuthoredText(syntheticStack({ opaqueProse: true }));
    expect(result.proseInOpaque.join('\n')).toContain('a whole sentence hiding here');
  });

  it('reports an exemption that matches nothing', () => {
    // The empty stack matches no `untranslatable` path at all, so every
    // declared exemption is stale — which is exactly the failure this catches
    // when one authored string is deleted.
    const result = collectAuthoredText(emptyStack());
    expect(result.staleExemptions.length, 'a stack with no authored text must make every exemption stale')
      .toBeGreaterThan(10);
    expect(result.staleExemptions).toContain('object.validations[].message');
  });

  it('detects a missing translation, and an orphan key', () => {
    const stack = syntheticStack();
    const source = new Set(collectAuthoredText(stack).translatable.map((e) => keyPath(e.key!)));
    const partial = new Set(['objects.syn_thing.label', 'objects.syn_thing.fields.ghost.label']);
    expect([...source].filter((k) => !partial.has(k)), 'the forward direction must find the gap')
      .toContain('objects.syn_thing.fields.status.label');
    expect([...partial].filter((k) => !source.has(k)), 'the reverse direction must find the orphan')
      .toEqual(['objects.syn_thing.fields.ghost.label']);
  });

  it('reports an email template with no sibling in a supported locale', () => {
    expect(
      templateGaps(
        [
          { name: 'duly_task_due_soon', locale: 'en' },
          { name: 'duly_task_due_soon', locale: 'zh-CN' },
          { name: 'duly_task_overdue', locale: 'en' },
        ],
        ['en', 'zh-CN'],
      ),
    ).toEqual(['email template "duly_task_overdue" has no zh-CN sibling']);
  });

  it('reports a locale row that copies the source row\'s wording', () => {
    expect(sameWordsAcrossLocales([
      { name: 'duly.copied', locale: 'en', subject: 'Due soon', bodyText: 'Due {{due_date}}.' },
      { name: 'duly.copied', locale: 'zh-CN', subject: 'Due soon', bodyText: 'Due {{due_date}}.' },
      { name: 'duly.real', locale: 'en', subject: 'Due soon', bodyText: 'Due {{due_date}}.' },
      { name: 'duly.real', locale: 'zh-CN', subject: '即将到期', bodyText: '{{due_date}} 到期。' },
    ])).toEqual(['duly.copied']);
  });

  it('does not flag a field that is nothing but a placeholder', () => {
    // `subject: '{{{subject}}}'` is identical in every locale by design.
    expect(sameWordsAcrossLocales([
      { name: 'duly.holes', locale: 'en', subject: '{{{subject}}}', bodyText: 'Due {{due_date}}.' },
      { name: 'duly.holes', locale: 'zh-CN', subject: '{{{subject}}}', bodyText: '{{due_date}} 到期。' },
    ])).toEqual([]);
  });

  it('treats a template with no explicit locale as the source locale', () => {
    // `locale` carries a schema default, so an omitted one is not "every
    // locale" — it is `en`, and it still needs a zh-CN sibling.
    expect(templateGaps([{ name: 'duly_welcome' }], ['en', 'zh-CN']))
      .toEqual(['email template "duly_welcome" has no zh-CN sibling']);
  });
});
