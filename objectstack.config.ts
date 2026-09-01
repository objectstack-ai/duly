// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';

import * as objects from './src/objects/index.js';
import * as views from './src/views/index.js';
import * as apps from './src/apps/index.js';

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
  requires: ['automation'],

  plugins: [
    new ConnectorRestPlugin(),
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin(),
  ],

  objects: Object.values(objects),
  views: Object.values(views),
  apps: Object.values(apps),

  // Duly is sold worldwide; English is the source language and every authored
  // label is expected to have a bundle entry. See `src/translations/`.
  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN'],
    fallbackLocale: 'en',
  },
});
