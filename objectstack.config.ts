// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';

// ─── Barrels ────────────────────────────────────────────────────────────────
// Every metadata directory is wired here up front, including the ones that are
// still empty. A feature branch adds its entry to its OWN barrel and never
// edits this file — which is the one file every parallel task would otherwise
// collide on. See src/*/index.ts for why each collection is a named array
// rather than `Object.values(barrel)`.
import { dulyObjects } from './src/objects/index.js';
import { dulyViews } from './src/views/index.js';
import { dulyApps } from './src/apps/index.js';
import { dulyPages } from './src/pages/index.js';
import { dulyActions } from './src/actions/index.js';
import { dulyFlows } from './src/flows/index.js';
import { dulyJobs } from './src/jobs/index.js';
import { dulyDashboards } from './src/dashboards/index.js';
import { dulyDatasets } from './src/datasets/index.js';
import { dulyMappings } from './src/mappings/index.js';
import { dulyTranslations } from './src/translations/index.js';
import { dulySeeds } from './src/data/index.js';
// [#7036] Lifecycle hooks are NOT collected from the objects barrel — the
// runtime reads them from `defineStack({ hooks })` only. A `*.hook.ts` that is
// not exported from src/hooks/ is dead metadata: it type-checks, it reads as
// wired, and it never runs.
import { dulyHooks } from './src/hooks/index.js';
import { dulyFunctions } from './src/functions/index.js';
import { dulyPositions, dulyPermissionSets, dulySharingRules } from './src/security/index.js';

// ─── Action handler registration ────────────────────────────────────────────
// Action metadata declares the button; the handler is runtime code the kernel
// wires here, after the engine is ready. Pre-wired for the same reason as the
// barrels — handlers are added in src/actions/register-handlers.ts, not here.
import { registerDulyActionHandlers } from './src/actions/register-handlers.js';
import type { HandlerRegistrationContext } from './src/actions/register-handlers.js';

export const onEnable = async (ctx: { ql: HandlerRegistrationContext }) => {
  registerDulyActionHandlers(ctx.ql);
};

export default defineStack({
  manifest: {
    id: 'ai.objectstack.duly',
    namespace: 'duly',
    version: '0.1.0',
    type: 'app',
    name: 'Duly',
    description:
      'Recurring obligation and duty management: every role\'s standing duties dispatched on time, tracked to completion, and visible up the line without a status meeting.',
    // Protocol compatibility range (ADR-0087 D1): an incompatible runtime
    // refuses this package at the boundary with the exact migration command
    // instead of failing deep in a schema parse.
    engines: { protocol: '^17' },
  },

  // `automation` backs flow and job execution, and materialises declarative
  // `connectors:` entries at boot (ADR-0097). The dispatcher lives there.
  //
  // `hierarchy-security` is deliberately NOT declared here. Manager visibility
  // is authored with the ADR-0057 depth scopes ('own_and_reports', 'unit',
  // 'unit_and_below', 'org'), which @objectstack/security-enterprise resolves —
  // enterprise deployments have it, so no application-level fallback is built.
  // This open-edition checkout runs without it and those scopes resolve to
  // owner-only; that is the expected open-edition behaviour, not a bug to work
  // around. Declaring the capability would make an open-edition boot fail.
  requires: ['automation'],

  plugins: [
    new ConnectorRestPlugin(),
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin(),
  ],

  objects: dulyObjects,
  views: dulyViews,
  apps: dulyApps,
  pages: dulyPages,
  actions: dulyActions,
  flows: dulyFlows,
  jobs: dulyJobs,
  dashboards: dulyDashboards,
  datasets: dulyDatasets,
  mappings: dulyMappings,
  translations: dulyTranslations,
  data: dulySeeds,
  hooks: dulyHooks,
  functions: dulyFunctions,

  // Security posture. Hierarchy read scopes ('own_and_reports', 'unit',
  // 'unit_and_below', 'org') are resolved by @objectstack/security-enterprise,
  // which is a HARD product dependency — without it they fail closed to
  // owner-only, silently. See docs/product/data-model.md#security-posture.
  positions: dulyPositions,
  permissions: dulyPermissionSets,
  sharingRules: dulySharingRules,

  // Duly is sold worldwide; English is the source language and every authored
  // label is expected to have a bundle entry. See src/translations/.
  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN'],
    fallbackLocale: 'en',
  },
});
