// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { registerCatalogActionHandlers } from './catalog.handlers.js';
import { registerTaskActionHandlers } from './task.handlers.js';
import { bindDispatchEngine, type DispatchEngine } from '../jobs/dispatch.job.js';

/**
 * Action handler registration.
 *
 * Action METADATA (`*.actions.ts`) declares the button; the HANDLER is runtime
 * code the kernel wires separately, via `defineStack({ onEnable })`. This
 * function is that single wiring point — already imported by
 * objectstack.config.ts, so adding a handler means editing this file and never
 * the config.
 *
 * An action whose handler is not registered here renders, is clickable, and
 * fails at call time. There is no author-time gate for it.
 *
 * It is also, not just incidentally, the only place `duly_dispatch` gets its
 * data engine: `defineStack({ onEnable })` is the sole spot an ObjectStack
 * application is handed `ctx.ql`, and `src/jobs/dispatch.job.ts` cannot reach
 * one on its own (a job handler is invoked with `{ jobId, data, bundle }` —
 * see that file's header, and objectstack#14094 upstream). So this function
 * both registers action handlers AND binds the dispatch engine — two
 * unrelated things sharing the one seam the platform gives an application.
 */
export interface HandlerRegistrationContext extends DispatchEngine {
  registerAction: (...args: unknown[]) => void;
}

export function registerDulyActionHandlers(ql: HandlerRegistrationContext): void {
  // Register handlers here, one call per feature:
  registerCatalogActionHandlers(ql);
  registerTaskActionHandlers(ql);
  // Gives `duly_dispatch` its data engine (see file-header note above and
  // dispatch.job.ts's own header). Until this call existed, the job was
  // registered, scheduled and rendered configured — and dispatched nothing.
  bindDispatchEngine(ql);
}
