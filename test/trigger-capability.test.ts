// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { FlowSchema } from '@objectstack/spec/automation';
import {
  PLATFORM_CAPABILITY_PROVIDERS,
  PLATFORM_CAPABILITY_TOKENS,
  isKnownPlatformCapability,
} from '@objectstack/spec';

import stackConfig from '../objectstack.config.js';
import { dulyFlows } from '../src/flows/index.js';

/**
 * ⚠️ STOPGAP — delete this file when objectstack-ai/objectstack#14153 lands.
 *
 * Same convention as `test/flow-predicates.test.ts` and
 * `test/metadata-bindings.test.ts`: this is not a house rule that wants
 * maintaining forever, it is a repo-local guard over a platform author-time
 * gap. When `defineStack` refuses an undeclared trigger capability the way it
 * already refuses an undeclared hierarchy scope, the right move is to REMOVE
 * this file, not to keep two guards in step.
 *
 * ── What it guards, and what it cost to find (issue #68) ──────────────────
 * `requires: ['automation', 'hierarchy-security']` gave this app a flow
 * ENGINE and no TRIGGER. Every flow in the app was inert for five rounds:
 * #33's assignment fan-out never fanned out and #70's three reminder sweeps
 * never swept. Measured on `@objectstack/cli` 17.2.0, `PORT=3117 pnpm start`:
 *
 *   BEFORE (requires without 'triggers')
 *     Plugins: 35 loaded
 *     Flows:   4 flow(s) 0 bound to triggers
 *     ⚠ flow 'duly_assignment_fanout' declares a 'record_change' trigger but
 *       is NOT bound — no 'record_change' trigger is registered —
 *       add requires: ['triggers']
 *     …the same warning for all three reminder sweeps ('time_relative')
 *
 *   AFTER (this file's invariant holding)
 *     Plugins: 39 loaded  … RecordChangeTriggerPlugin, ScheduleTriggerPlugin,
 *                            TimeRelativeTriggerPlugin, ApiTriggerPlugin
 *     Flows:   4 flow(s) 4 bound to triggers
 *              (record_change, schedule, time_relative, api)
 *
 * `validate`, `typecheck`, `test` and `build` all exited **0** on the BEFORE
 * state, and `validate` printed `Logic: 4 Flows` and said nothing further.
 * Four gates, five rounds, zero signal. That is the whole reason this file
 * exists: the defect has to stop being invisible to `pnpm test`.
 *
 * ── Why this is a STATIC check and not the boot audit #68 suggested ───────
 * #68 proposed asserting `getTriggerBindingAudit()` — the engine probe the
 * startup banner reads. Measured, that is not reachable from vitest: a kernel
 * built the way `test/dispatch-wiring.test.ts` builds one
 * (`createStandaloneStack` + `AppPlugin` + `bootstrap()`) mounts NO capability
 * plugins at all. Its own boot log says so —
 *
 *   INFO Info: Optional service not present: automation
 *
 * — so `kernel.getService('automation')` yields nothing and there is no audit
 * to read. `requires` is resolved by the CLI's `serve` command, which is the
 * host, not by the kernel. Mounting the trigger plugins by hand inside the
 * test would assert the TEST's wiring rather than the config's — precisely the
 * test-side-bind false green that `test/dispatch-wiring.test.ts` was written
 * to avoid. So the assertion is made where the fact actually lives: the
 * declaration that the host reads.
 *
 * ── Why one token is the whole answer ────────────────────────────────────
 * `triggers` is the ONLY trigger entry in the platform vocabulary, and the
 * CLI's capability map keys it to `@objectstack/trigger-record-change` plus
 * three `extras` — `ScheduleTriggerPlugin` and `TimeRelativeTriggerPlugin`
 * (from `@objectstack/trigger-schedule`) and `ApiTriggerPlugin` (from
 * `@objectstack/trigger-api`). `record_change`, `schedule`, `time_relative`
 * and `api` therefore all arrive from this single entry; there is no second
 * declaration to make. The last describe block below re-derives that from the
 * platform's own tables every run, so if the vocabulary is ever split the
 * suite says so instead of this comment quietly going stale.
 */

/** The one platform token that mounts every concrete trigger. */
const TRIGGERS_TOKEN = 'triggers';

/** The engine the triggers hand a fired flow to. Inert without it too. */
const AUTOMATION_TOKEN = 'automation';

/**
 * Flow `type` members that are launched by something other than a trigger.
 *
 * Stated as the COMPLEMENT deliberately: every other member of the enum —
 * including one added after this file was written — counts as trigger-launched
 * and demands the capability. An unknown flow type failing loudly is the safe
 * direction; being waved through is the #68 failure all over again.
 */
const NON_TRIGGER_FLOW_TYPES: ReadonlySet<string> = new Set(['screen', 'autolaunched']);

/** Flow `type` members that are trigger-launched, as of protocol 17. */
const TRIGGER_FLOW_TYPES: ReadonlySet<string> = new Set(['record_change', 'schedule', 'api']);

/**
 * Start-node config keys that declare a trigger binding on their own. Mirrors
 * the engine's routing chain (and `@objectstack/lint`'s own `isAutoTriggered`
 * predicate): a flow reaches a trigger via its `type` OR via these keys.
 */
const TRIGGER_START_CONFIG_KEYS = ['triggerType', 'timeRelative', 'schedule'] as const;

interface AuthoredFlow {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly nodes?: unknown;
}

const nameOf = (flow: AuthoredFlow): string =>
  typeof flow.name === 'string' ? flow.name : '(unnamed flow)';

function startConfigOf(flow: AuthoredFlow): Record<string, unknown> {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const start = nodes.find(
    (n): n is { config?: unknown } =>
      !!n && typeof n === 'object' && (n as { type?: unknown }).type === 'start',
  );
  const config = start?.config;
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
}

/** True when this flow will never run unless a trigger is registered for it. */
function declaresTrigger(flow: AuthoredFlow): boolean {
  const type = typeof flow.type === 'string' ? flow.type : undefined;
  if (type !== undefined && !NON_TRIGGER_FLOW_TYPES.has(type)) return true;
  const config = startConfigOf(flow);
  return TRIGGER_START_CONFIG_KEYS.some((key) => config[key] != null);
}

const requires: readonly string[] = Array.isArray(
  (stackConfig as { requires?: unknown }).requires,
)
  ? ((stackConfig as { requires: readonly string[] }).requires)
  : [];

const flows = dulyFlows as readonly AuthoredFlow[];
const triggerLaunched = flows.filter(declaresTrigger);

describe('#68 — a flow that declares a trigger has the capability that fires it', () => {
  it('is not passing vacuously: flows exist and at least one declares a trigger', () => {
    // A guard that can pass because it found nothing to check is the same
    // class of silence #68 was. Pin both halves.
    expect(flows.length, 'dulyFlows is empty — this guard would pass vacuously').toBeGreaterThan(0);
    expect(
      triggerLaunched.map(nameOf),
      'no flow was detected as trigger-launched — either every flow really is ' +
        'screen/autolaunched, or `declaresTrigger` has stopped matching how ' +
        'flows are authored here. Check the second before trusting this suite.',
    ).not.toHaveLength(0);
  });

  it(`declares '${TRIGGERS_TOKEN}' in requires`, () => {
    expect(
      requires,
      `${triggerLaunched.length} flow(s) declare a trigger — ` +
        `${triggerLaunched.map(nameOf).join(', ')} — but objectstack.config.ts ` +
        `does not declare '${TRIGGERS_TOKEN}' in \`requires\`. ` +
        'The flow engine loads, every gate stays green, and NOT ONE OF THOSE ' +
        'FLOWS EVER FIRES. The only channel that says so is the CLI startup ' +
        "banner: `Flows: N flow(s) 0 bound to triggers`. Add " +
        `'${TRIGGERS_TOKEN}' back to \`requires\` — see issue #68.`,
    ).toContain(TRIGGERS_TOKEN);
  });

  it(`declares '${AUTOMATION_TOKEN}' in requires`, () => {
    expect(
      requires,
      `${triggerLaunched.length} flow(s) declare a trigger, but ` +
        `'${AUTOMATION_TOKEN}' is not in \`requires\`. Triggers fire INTO the ` +
        'automation engine; without it the boot summary reports the flows as ' +
        'declared and disabled, and nothing runs. Same silence as #68, one ' +
        'layer down.',
    ).toContain(AUTOMATION_TOKEN);
  });
});

describe('#68 — the platform facts this guard rests on', () => {
  it(`'${TRIGGERS_TOKEN}' is the platform's own spelling, not ours`, () => {
    expect(
      isKnownPlatformCapability(TRIGGERS_TOKEN),
      `'${TRIGGERS_TOKEN}' is no longer a platform capability token. The ` +
        'vocabulary moved; re-derive what mounts the triggers before editing ' +
        'this file. (`defineStack` rejects an unknown token outright, so a ' +
        'stale spelling here would take the whole app down at load.)',
    ).toBe(true);
    expect(PLATFORM_CAPABILITY_TOKENS).toContain(TRIGGERS_TOKEN);
  });

  it('one token still covers every trigger kind — no second declaration to make', () => {
    const triggerTokens = PLATFORM_CAPABILITY_TOKENS.filter((token) => /trigger/i.test(token));
    expect(
      triggerTokens,
      'the platform capability vocabulary now carries more than one ' +
        `trigger token (${triggerTokens.join(', ')}). #68 established that ` +
        "record_change / schedule / time_relative / api ALL arrive from the " +
        "single 'triggers' entry. If that has been split, this app's " +
        '`requires` needs the new token(s) too — and the flows that depend on ' +
        'them are inert until it gets them.',
    ).toEqual([TRIGGERS_TOKEN]);

    const provider = PLATFORM_CAPABILITY_PROVIDERS[TRIGGERS_TOKEN];
    expect(provider?.package, 'no provider package for the triggers token').toBeTruthy();
    expect(
      provider?.edition,
      `the triggers capability is now a '${provider?.edition}' capability. ` +
        'It was `open` (provided by @objectstack/trigger-record-change, pulled ' +
        'in transitively), which is why declaring it needs no install here. A ' +
        'non-open edition means this app must add the package explicitly or ' +
        'its flows go dark again.',
    ).toBe('open');
  });

  it('the flow `type` vocabulary has not grown a member this file cannot classify', () => {
    const options = (FlowSchema as unknown as { shape: { type: { options: readonly string[] } } })
      .shape.type.options;
    const unclassified = options.filter(
      (option) => !NON_TRIGGER_FLOW_TYPES.has(option) && !TRIGGER_FLOW_TYPES.has(option),
    );
    expect(
      unclassified,
      `the flow \`type\` enum has gained ${unclassified.join(', ')}. Classify ` +
        'each new member in this file: trigger-launched (needs the `triggers` ' +
        'capability) or not. Until then `declaresTrigger` treats it as ' +
        'trigger-launched, which is the safe direction but not an answer.',
    ).toEqual([]);
  });
});
