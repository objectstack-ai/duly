// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';

import { CatalogItem } from '../objects/catalog-item.object.js';

import { CATALOG_ITEMS, cadenceOf } from './demo-catalog.js';

/**
 * The role catalog — twenty duty templates across three position codes.
 *
 * This is the screen that decides whether an evaluator believes the product:
 * "these are the 26 things a plant compliance officer owes" is the artefact
 * customers already have, usually as a spreadsheet, and seeing it rendered as
 * a first-class object is the moment the app stops looking like a to-do list.
 * `regulation_ref` is what does that work — a catalog without it reads as a
 * checklist, and with it as an audit answer.
 *
 * ── Cadence is filtered by form, not by hand ─────────────────────────────
 * `cadenceOf` decides which of the five cadence fields a row may carry (#61).
 * A standing item carrying a frequency is not merely odd — `standing_no_frequency`
 * REFUSES it, and the refusal takes the item, every duty instantiated from it
 * and every task under those duties. The two standing items below therefore
 * carry no frequency, no anchor, no offset, no lead and no grace; the
 * conditional `defaultValue` expressions resolve all five to null.
 */
export const catalogSeed = defineSeed(CatalogItem, {
  externalId: 'name',
  // Idempotent on re-run: matched by name, updated in place, and skipped
  // outright when nothing about the item has changed.
  mode: 'upsert',
  records: CATALOG_ITEMS.map((item) => ({
    name: item.name,
    position_code: item.position,
    form: item.form,
    description: item.description,
    regulation_ref: item.reference,
    active: item.active ?? true,
    ...cadenceOf(item),
  })),
});
