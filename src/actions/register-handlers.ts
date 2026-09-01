// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
 */
export interface HandlerRegistrationContext {
  registerAction: (...args: unknown[]) => void;
}

export function registerDulyActionHandlers(_ql: HandlerRegistrationContext): void {
  // Register handlers here, one call per action:
  //   registerTaskActionHandlers(ql);
}
