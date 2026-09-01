// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { dulyFunctions } from '../src/functions/index.js';
import { isResolvableTimeZone, periodKeyFor } from '../src/functions/period.js';
import { DutyTimezoneGuard, dulyHooks } from '../src/hooks/index.js';

/**
 * #24 — `duly_duty.timezone` accepted any string, and the typo surfaced at
 * dispatch.
 *
 * The defect was never "the engine is too strict". `period.ts` refusing an
 * unresolvable zone is correct: a duty quietly resolving "the 5th of the
 * month" in the wrong zone is a wrong due date nobody can see is wrong. What
 * was missing is that the refusal reached the author days late, inside a batch
 * job, attributed to the job rather than to the record.
 *
 * So the property under test is not "bad zones are rejected" on its own. It is
 * **the guard and the period engine admit exactly the same set** — a guard
 * that were merely strict-ish would trade a late failure for a wrong one.
 * `admits the same zones the period engine does` below is the assertion that
 * matters; the rest pin the places where it could rot.
 */

type AnyRow = Record<string, unknown>;

let kernel: { getService(name: string): unknown; shutdown?(): Promise<void> } | undefined;
let data: {
  findOne(o: string, q?: AnyRow, x?: AnyRow): Promise<AnyRow | undefined>;
  insert(o: string, d: AnyRow, x?: AnyRow): Promise<AnyRow>;
  update(o: string, d: AnyRow, x?: AnyRow): Promise<unknown>;
};

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // See task-hook.test.ts for why this must not resolve to a real path: a
    // local `pnpm build` would make the suite report on the last BUILD instead
    // of on `src/`, and the registration pins below would pass on dead code.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  const k = new ObjectKernel();
  for (const plugin of plugins) await k.use(plugin);
  await k.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await k.bootstrap();
  kernel = k as unknown as typeof kernel;
  data = k.getService('data') as typeof data;
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

/** Assert a refusal by its ENVELOPE (ADR-0112), never by the bare fact that it threw. */
async function refusal(promise: Promise<unknown>): Promise<{ code: unknown; message: string }> {
  try {
    await promise;
  } catch (error: any) {
    return { code: error?.code, message: String(error?.message ?? '') };
  }
  throw new Error('expected the write to be refused, but it resolved');
}

let seq = 0;

const insertDuty = async (over: AnyRow = {}): Promise<AnyRow> => {
  const created = await data.insert('duly_duty', {
    name: `Duty ${++seq}`,
    owner: `user_${seq}`,
    source: 'self',
    status: 'active',
    ...over,
  });
  return Array.isArray(created) ? created[0] : created;
};

/**
 * Zones the host resolves. Deliberately not all `Europe/X` lookalikes: `GMT`,
 * `US/Eastern` and `america/new_york` are the ones an enumerated-list oracle
 * would wrongly refuse, and `UTC` is the field's own declared default.
 */
const RESOLVABLE = ['UTC', 'Europe/Berlin', 'Asia/Shanghai', 'Asia/Kolkata', 'GMT', 'US/Eastern', 'america/new_york', 'Pacific/Auckland'];

/** Every one of these reached dispatch and threw there before this guard. */
const UNRESOLVABLE = ['Europe/Munich', 'CET+1', 'Asia/Shanghai ', '', '   ', 'utc/utc'];

describe('the membership oracle', () => {
  it('admits the same zones the period engine does', () => {
    // The whole point. If these two ever disagree, one of two bugs is live:
    // the guard refuses a duty that would have dispatched perfectly well, or
    // it passes one that still throws on dispatch night — the defect #24 is
    // about, reintroduced behind a check that looks like it is working.
    const instant = new Date('2026-08-21T12:00:00Z');
    const engineAccepts = (zone: string): boolean => {
      try {
        periodKeyFor('daily', instant, zone);
        return true;
      } catch {
        return false;
      }
    };

    for (const zone of [...RESOLVABLE, ...UNRESOLVABLE]) {
      expect(isResolvableTimeZone(zone), `guard verdict for ${JSON.stringify(zone)}`)
        .toBe(engineAccepts(zone));
    }

    // …and the two halves are not both trivially true.
    expect(RESOLVABLE.every((z) => isResolvableTimeZone(z))).toBe(true);
    expect(UNRESOLVABLE.some((z) => isResolvableTimeZone(z))).toBe(false);
  });

  it('is the Intl probe, not Intl.supportedValuesOf', () => {
    // Kept as an executable footnote to the comment in `period.ts`: the
    // enumerated list is the tempting oracle and it omits `UTC`, which is
    // `duly_duty.timezone`'s own `defaultValue`. Building the guard on it
    // would refuse every duty created with the default.
    //
    // If a future ICU adds these to the list, delete this pin — never the
    // probe. The list being right about UTC would not make it right about
    // `US/Eastern`, `GMT` or `Asia/Kolkata`.
    const enumerated = new Set(Intl.supportedValuesOf('timeZone'));
    const acceptedButNotEnumerated = RESOLVABLE.filter((z) => !enumerated.has(z));

    expect(enumerated.has('UTC')).toBe(false);
    expect(isResolvableTimeZone('UTC')).toBe(true);
    expect(acceptedButNotEnumerated.length).toBeGreaterThan(0);
  });
});

describe('the write path', () => {
  it.each(UNRESOLVABLE)('refuses an insert carrying %j', async (zone) => {
    const { code, message } = await refusal(insertDuty({ timezone: zone }));
    expect(code).toBe('VALIDATION_FAILED');
    // The value is quoted in the message because that is the only way a
    // trailing space or an empty string is visible to the person who typed it.
    expect(message).toContain(JSON.stringify(zone));
    expect(message).toContain('IANA');
  });

  it.each(RESOLVABLE)('accepts %s and stores it verbatim', async (zone) => {
    const created = await insertDuty({ timezone: zone });
    const stored = await data.findOne('duly_duty', { where: { id: created.id } });
    // Verbatim: the guard validates, it does not canonicalise. Rewriting
    // `america/new_york` to `America/New_York` on the way in would be changing
    // the author's data, and the period engine resolves both identically.
    expect(stored?.timezone).toBe(zone);
  });

  it('refuses an update that introduces a bad zone', async () => {
    const created = await insertDuty({ timezone: 'Europe/Berlin' });

    const { code, message } = await refusal(
      data.update('duly_duty', { id: created.id, timezone: 'Europe/Munich' }),
    );
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toContain('"Europe/Munich"');

    const stored = await data.findOne('duly_duty', { where: { id: created.id } });
    expect(stored?.timezone).toBe('Europe/Berlin');
  });

  it('leaves a write that does not touch the timezone alone', async () => {
    // The guard judges VALUES, never their absence — an unrelated edit must
    // not be refused, and on insert the field default is what supplies the
    // zone. Where a duty's zone should COME from is a separate, still-open
    // question (#26); nothing here settles it, and in particular this guard is
    // not a back-door `required: true`.
    const created = await insertDuty();
    expect(created.timezone).toBe('UTC');

    await data.update('duly_duty', { id: created.id, name: 'Renamed, zone untouched' });
    const stored = await data.findOne('duly_duty', { where: { id: created.id } });
    expect(stored?.name).toBe('Renamed, zone untouched');
    expect(stored?.timezone).toBe('UTC');
  });
});

describe('the guard is wired the one way that works', () => {
  it('is reachable from the hooks barrel', () => {
    // A `*.hook.ts` missing from `dulyHooks` type-checks, reads as wired, and
    // never runs.
    expect(dulyHooks).toContain(DutyTimezoneGuard);
    expect(DutyTimezoneGuard.object).toBe('duly_duty');
    expect(DutyTimezoneGuard.events).toEqual(['beforeInsert', 'beforeUpdate']);
    expect(DutyTimezoneGuard.onError).toBe('abort');
  });

  it('declares a STRING handler and no body', () => {
    // ⛔ The tripwire for the trap described at length in `duty.hook.ts`.
    //
    // `objectstack build` lowers a self-contained INLINE handler into a
    // metadata `body`, which runs in the QuickJS sandbox — and that sandbox
    // has no `Intl` (measured: `typeof Intl === 'undefined'` on
    // quickjs-emscripten 0.32.0, the variant the runtime wires up). Since
    // `resolveHandler` prefers `body` over `handler`, "modernising" this hook
    // into an inline function ships a guard that throws
    // `ReferenceError: Intl is not defined` on every duty write and, with
    // `onError: 'abort'`, refuses all of them — while all four gates stay
    // green, because tests run the raw function in Node.
    //
    // This assertion is the only thing standing between that change and
    // production. Filed upstream as objectstack-ai/objectstack#14168.
    expect(typeof DutyTimezoneGuard.handler).toBe('string');
    expect(DutyTimezoneGuard.body).toBeUndefined();
  });

  it('resolves that handler name against the functions map', () => {
    // A string handler absent from `defineStack({ functions })` is not an
    // error: `bindHooksToEngine` logs "skipping hook with unresolved handler"
    // and moves on, leaving the guard dead and every gate green. The refusal
    // tests above would catch it too — this one names the reason.
    const name = DutyTimezoneGuard.handler as string;
    const entry = (dulyFunctions as Record<string, unknown>)[name];
    const handler = typeof entry === 'function' ? entry : (entry as { handler?: unknown })?.handler;
    expect(typeof handler).toBe('function');
  });
});
