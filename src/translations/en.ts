// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTranslationBundle } from '@objectstack/spec';

import { dulyActions } from '../actions/index.js';
import { dulyApps } from '../apps/index.js';
import { dulyDashboards } from '../dashboards/index.js';
import { dulyDatasets } from '../datasets/index.js';
import { dulyFlows } from '../flows/index.js';
import { dulyHooks } from '../hooks/index.js';
import { dulyJobs } from '../jobs/index.js';
import { dulyObjects } from '../objects/index.js';
import { dulyPages } from '../pages/index.js';
import { dulyPermissionSets, dulyPositions, dulySharingRules } from '../security/index.js';
import { dulyViews } from '../views/index.js';

import { collectAuthoredText, foldIntoBundle } from './authored-text.js';
import type { TextStack } from './authored-text.js';

/**
 * The English bundle — GENERATED from the source metadata, never written.
 *
 * ── Why there is no `en` literal in this file ────────────────────────────
 * A hand-maintained `en` entry beats the source string silently: the bundle
 * wins at render time, so the screen and the code disagree while every gate
 * stays green. The usual answer is to generate a file and add a staleness
 * check — but a checked-in generated file is only as good as whoever
 * remembers to re-run the generator, and the failure it guards against is
 * exactly the one nobody notices.
 *
 * So `en` is derived HERE, at config load, out of the same walk the coverage
 * gate uses. There is no stored copy, so there is nothing to go stale and
 * nothing a person could usefully hand-edit: changing an English string means
 * changing the label in `src/objects/`, `src/views/` or `src/apps/`, which is
 * the only place it was ever true.
 *
 * `test/i18n-coverage.test.ts` pins that property rather than trusting this
 * comment: it runs `buildEnglishBundle` over SYNTHETIC metadata and asserts
 * the output carries the synthetic strings. A hand-written bundle cannot pass
 * that, so the derivation cannot be quietly replaced by a literal later.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────
 * It is not a translation of anything. `en` is the source language
 * (AGENTS.md §8), and every value here is byte-identical to the authored
 * label it came from. Its job is to be the KEY SET the translated locales are
 * measured against.
 */

/** The metadata the English bundle is derived from. */
export const dulyTextStack: TextStack = {
  objects: dulyObjects,
  views: dulyViews,
  apps: dulyApps,
  dashboards: dulyDashboards,
  actions: dulyActions,
  datasets: dulyDatasets,
  flows: dulyFlows,
  jobs: dulyJobs,
  hooks: dulyHooks,
  positions: dulyPositions,
  permissions: dulyPermissionSets,
  sharingRules: dulySharingRules,
  pages: dulyPages,
};

/**
 * Fold a stack's authored text into one locale's worth of `TranslationData`.
 *
 * Exported so the gate can run it over synthetic metadata — the proof that the
 * bundle is a function of the metadata and not a transcription of it.
 */
export const buildEnglishBundle = (stack: TextStack) =>
  // `defineTranslationBundle` PARSES — `TranslationDataSchema` is strict, so a
  // key the walk built wrong (a retired group, a misspelt slot) is refused at
  // config load rather than shipped and silently unread. That is the whole
  // reason a derived bundle goes through the factory rather than being cast.
  defineTranslationBundle({ en: foldIntoBundle(collectAuthoredText(stack).translatable) });

/** The English bundle for this app. */
export const dulyEnglish = buildEnglishBundle(dulyTextStack);
