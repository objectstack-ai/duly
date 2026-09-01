// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { validateActionParams } from '@objectstack/spec/ui';

import { dulyActions } from '../src/actions/index.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import type { HandlerRegistrationContext } from '../src/actions/register-handlers.js';
import {
  CATALOG_APPLY_ACTION,
  CATALOG_APPLY_TO_PEOPLE_ACTION,
  CATALOG_ITEM_OBJECT,
  CATALOG_SYNC_ACTION,
  GLOBAL_ACTION_OBJECT,
  applyCatalogHandler,
} from '../src/actions/catalog.handlers.js';

/**
 * Where `duly_catalog_apply` can be CLICKED — and the wiring that makes the
 * click do something.
 *
 * `test/catalog-instantiate.test.ts` owns what the action DOES. This file owns
 * its placement: that the object-bound twin exists, that it is the same action
 * rather than a second one, that its capability gate is not weaker than the
 * global's, and — the part with no author-time gate at all — that its handler
 * is registered under the one engine key its dispatch can reach.
 *
 * That last one is the failure this suite exists for. An action whose handler
 * is not registered RENDERS, is clickable, and fails at call time with
 * `Action '<name>' on object '<object>' not found`. `pnpm validate` parses the
 * declaration and knows nothing about the registry, so it passes green either
 * way. The ablation is in the PR body: deleting the twin's `registerAction`
 * line turns "wired under the key its dispatch reaches" red and leaves
 * `pnpm validate` at exit 0.
 */

function registered(): Array<{ object: string; action: string; handler: unknown }> {
  const calls: Array<{ object: string; action: string; handler: unknown }> = [];
  const ql: HandlerRegistrationContext = {
    registerAction: (...args: unknown[]) => {
      calls.push({ object: String(args[0]), action: String(args[1]), handler: args[2] });
    },
    // This suite is about the action-handler registry, so the engine methods
    // `bindDispatchEngine(ql)` needs are unused no-ops rather than a real one.
    find: async () => [],
    insert: async () => ({}),
    update: async () => undefined,
  };
  registerDulyActionHandlers(ql);
  return calls;
}

const twin = () => dulyActions.find((a) => a.name === CATALOG_APPLY_TO_PEOPLE_ACTION);
const global = () => dulyActions.find((a) => a.name === CATALOG_APPLY_ACTION);

describe('the catalog-apply twin is reachable from the UI', () => {
  it('is in the barrel — an action missing from it is dead metadata that type-checks', () => {
    expect(twin()).toBeDefined();
  });

  it('binds to duly_catalog_item and declares the one location a renderer serves', () => {
    // `global_nav` was retired in protocol 17 and every surviving location is
    // object-bound, so `objectName` is what buys the placement: defineStack()
    // merges the action into that object's `actions`, which is the array the
    // list toolbar filters by location.
    expect(twin()?.objectName).toBe(CATALOG_ITEM_OBJECT);
    expect(twin()?.locations).toEqual(['list_toolbar']);
  });

  it('leaves the global action headless and registered — REST and MCP still use it', () => {
    // The twin adds a placement; it does not replace the object-less action.
    expect(global()?.objectName).toBeUndefined();
    expect(global()?.locations).toEqual([]);
    const wired = registered().map((c) => `${c.object}:${c.action}`);
    expect(wired).toContain(`${GLOBAL_ACTION_OBJECT}:${CATALOG_APPLY_ACTION}`);
    expect(wired).toContain(`${GLOBAL_ACTION_OBJECT}:${CATALOG_SYNC_ACTION}`);
  });
});

describe('the twin is the same action, not a second implementation', () => {
  it('is wired to the SAME handler function reference as the global action', () => {
    // Identity, not equivalence. Two functions that behave the same today are
    // two functions to keep in step tomorrow, and this card was explicitly not
    // allowed to buy that.
    const calls = registered();
    const globalCall = calls.find(
      (c) => c.object === GLOBAL_ACTION_OBJECT && c.action === CATALOG_APPLY_ACTION,
    );
    const twinCall = calls.find(
      (c) => c.object === CATALOG_ITEM_OBJECT && c.action === CATALOG_APPLY_TO_PEOPLE_ACTION,
    );
    expect(twinCall?.handler).toBe(applyCatalogHandler);
    expect(twinCall?.handler).toBe(globalCall?.handler);
  });

  it('is wired under the key its dispatch reaches, and nowhere else', () => {
    // THE UNGATED FAILURE. `executeAction` is an exact-string Map lookup on
    // `<object>:<name>` and tries the action's own object before `global`, so
    // an object-bound action registered under `global` is a button that 404s.
    // Nothing at author time says so — this assertion is the whole guard.
    const wired = new Set(registered().map((c) => `${c.object}:${c.action}`));
    expect(wired).toContain(`${CATALOG_ITEM_OBJECT}:${CATALOG_APPLY_TO_PEOPLE_ACTION}`);
    expect(wired).not.toContain(`${GLOBAL_ACTION_OBJECT}:${CATALOG_APPLY_TO_PEOPLE_ACTION}`);
  });

  it('names its own target, so the declaration cannot point at a key nobody registered', () => {
    expect(twin()?.target).toBe(CATALOG_APPLY_TO_PEOPLE_ACTION);
  });

  it('carries the same param contract as the global, key for key', () => {
    // The dispatcher validates the params of the action you CALLED (ADR-0104
    // D2). Two hand-maintained copies drift, and the drift is silent in the
    // direction that matters — a twin that stopped requiring `users` would
    // accept a dialog the global route refuses.
    const shape = (action: ReturnType<typeof global>) =>
      (action?.params ?? []).map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        multiple: p.multiple,
      }));
    expect(shape(twin())).toEqual(shape(global()));
    // Non-vacuous: the comparison above would also pass if both were empty.
    expect(shape(global())).toHaveLength(2);
  });

  it('does not weaken the capability gate — an object-bound bypass is not a convenience', () => {
    // Same 403 on the platform action route, same hide on the toolbar. A twin
    // that dropped `duly.catalog.apply` would hand anyone who can reach the
    // Role catalog the power to mint duties for any user id they typed.
    expect(twin()?.requiredPermissions).toEqual(['duly.catalog.apply']);
    expect(twin()?.requiredPermissions).toEqual(global()?.requiredPermissions);
  });

  it('is not exposed to agents — bulk-creating duties for arbitrary people is a deliberate decision', () => {
    expect(twin()?.ai?.exposed).toBeFalsy();
    expect(global()?.ai?.exposed).toBeFalsy();
  });
});

describe('the input a list_toolbar action can actually collect', () => {
  // Measured before the twin was written, because the alternative — select
  // catalog rows, then a modal for the people — is a different handler
  // contract (`_selectedIds` in place of `position_code`). It can, so the
  // one-step dialog is what ships.

  it('declares position_code plus a multi-person picker', () => {
    const params = twin()?.params ?? [];
    const position = params.find((p) => p.name === 'position_code');
    expect(position?.type).toBe('text');
    expect(position?.required).toBe(true);

    const users = params.find((p) => p.name === 'users');
    expect(users?.type).toBe('user');
    expect(users?.multiple).toBe(true);
    expect(users?.required).toBe(true);
  });

  it('the bag that dialog submits passes the dispatcher\'s own param contract', () => {
    // Not a restatement of the declaration: this runs the spec's
    // `validateActionParams` — the same ADR-0104 D2 check the REST and MCP
    // dispatch paths run before the handler — over the values the multi-person
    // picker produces.
    const resolved = (twin()?.params ?? []).map((p) => ({
      name: String(p.name),
      type: p.type,
      required: p.required,
      multiple: p.multiple,
    }));
    expect(
      validateActionParams(resolved, {
        position_code: 'plant_compliance_officer',
        users: ['user_a', 'user_b', 'user_c'],
      }),
    ).toEqual([]);
  });

  it('and that contract is enforced, not merely declared — a scalar in `users` is refused', () => {
    // The negative leg. Without it the assertion above would pass just as
    // happily against a param whose value shape was left open.
    const resolved = (twin()?.params ?? []).map((p) => ({
      name: String(p.name),
      type: p.type,
      required: p.required,
      multiple: p.multiple,
    }));
    const issues = validateActionParams(resolved, {
      position_code: 'plant_compliance_officer',
      users: 'user_a',
    });
    expect(issues.map((i) => i.param)).toContain('users');
    expect(issues.find((i) => i.param === 'users')?.code).toBe('invalid_shape');
  });
});
