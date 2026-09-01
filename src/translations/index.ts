// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/translations/.
//
// Every metadata directory is pre-created and already wired into
// objectstack.config.ts — including the empty ones — so a feature branch adds
// its entry HERE and never edits the config. The config is the one file every
// parallel task would otherwise collide on.
//
// ⚠ `defineStack({ translations })` takes an array of BUNDLES — each one a
// `locale → TranslationData` record — not an array of single-locale items.
// Measured on `@objectstack/runtime` 17.2.0, whose `loadTranslations` does
// `for (const [locale, data] of Object.entries(bundle))` on every element:
// pushing a `defineTranslation({ locale: 'zh-CN', … })` ITEM here would have
// the loader read `locale` and `objects` as two locale names and load neither.
// The array below therefore holds `{ en: … }` and `{ 'zh-CN': … }`.
//
// ⚠ `en` is DERIVED from the source metadata (see `en.ts`) — there is no
// English literal in this directory to hand-edit, which is the whole point: a
// hand-maintained `en` entry silently beats the source string and the served
// text drifts from the code under a green gate. `zh-CN` is hand-written, and
// `test/i18n-coverage.test.ts` holds its key set to `en`'s in both directions.

import { dulyEnglish } from './en.js';
import { dulyChinese } from './zh-CN.js';

export { dulyEnglish, dulyChinese };
export { buildEnglishBundle, dulyTextStack } from './en.js';
export {
  collectAuthoredText,
  bundleKeys,
  foldIntoBundle,
  keyPath,
  PLATFORM_TRANSLATABLE_TYPES,
} from './authored-text.js';
export type { AuthoredTextWalk, TextEntry, TextStack } from './authored-text.js';

export const dulyTranslations = [dulyEnglish, dulyChinese];
