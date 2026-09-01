// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Hook, HookContext } from '@objectstack/spec/data';

import { isResolvableTimeZone } from '../functions/period.js';

/**
 * `duly_duty.timezone` must be a zone the host can actually resolve.
 *
 * Period boundaries and due dates are computed in the duty's own zone
 * (`src/functions/period.ts`). The engine deliberately REFUSES a zone it
 * cannot resolve rather than falling back to UTC, because a duty quietly
 * resolving "the 5th of the month" in the wrong zone is a wrong due date
 * nobody can see is wrong. That is the right call for the consumer — but
 * without this guard the author never hears about a typo until the nightly
 * dispatcher touches the record, where the throw is attributed to the job
 * rather than to the duty, and every other duty in the same run is collateral.
 *
 * ── Where the check belongs: WRITE time. Not author time, not dispatch ────
 * Three moments were available and only one of them is where the typo is:
 *
 *  - AUTHOR TIME (`pnpm validate`) sees METADATA. Duties are records, created
 *    by people in a form at run time, and the linter never sees one. The only
 *    zone literals in this repo's metadata are the field's own `defaultValue`
 *    and nothing else — so an author-time check would be a check on a
 *    population that does not contain the defect. (It is not needed as a
 *    second line either: a typo'd field default would be caught by this guard
 *    on the very first duty anyone creates, loudly and immediately.)
 *  - WRITE TIME is where a person types `Europe/Munich` and presses save. It
 *    covers the form, REST/OpenAPI/MCP, the catalog-apply action, and the seed
 *    path — `skipTriggers` suppresses record-change automation, not hooks.
 *  - DISPATCH TIME is where it fails today. Too late and mis-attributed.
 *
 * ── Why a hook rather than a `validation` on the object ───────────────────
 * A validation rule was the obvious home and it cannot express this. Rules are
 * CEL, and the whole stdlib in `@objectstack/formula` is `now today
 * daysFromNow daysAgo isBlank coalesce trim joinNonEmpty daysBetween addDays
 * addMonths date datetime abs round floor ceil min max upper lower contains
 * startsWith endsWith matches len isEmpty` — no zone oracle, and no way for an
 * application to register one. The only reachable spelling would be
 * `matches(record.timezone, '<regex>')`, which either checks shape only (and
 * `Europe/Munich` is perfectly well shaped) or freezes a tzdata snapshot into
 * metadata that disagrees with the host's. `@objectstack/spec` publishes the
 * right vocabulary for this — `valueDomain: 'iana_time_zone'` — but only on a
 * settings specifier; an object field has no equivalent. Filed upstream as
 * **objectstack-ai/objectstack#14168**; a lifecycle hook is what
 * `validation.zod.ts` itself prescribes in the meantime ("Custom handler → a
 * `beforeInsert` / `beforeUpdate` lifecycle hook, the typed, supported
 * extension point for arbitrary validation code").
 *
 * ── ⛔ Why `handler` is a STRING and must stay one ────────────────────────
 * This is the load-bearing line in the file. `objectstack build` lowers a
 * self-contained INLINE handler into a metadata `body`, which runs in the
 * QuickJS sandbox — and that sandbox has **no `Intl`** (measured on
 * quickjs-emscripten 0.32.0, the variant the runtime wires through
 * `QuickJSScriptRunner`: `typeof Intl` is `undefined`, while `Date` and `JSON`
 * are present). No `HookBodyCapability` grants it either. `resolveHandler`
 * prefers `body` over `handler` whenever both exist, so writing this as an
 * inline function would ship a hook that throws `ReferenceError: Intl is not
 * defined` on every duty write — and with `onError: 'abort'` that refuses
 * every write to `duly_duty`. All four gates stay GREEN while that is true,
 * because tests run the raw function in Node, where `Intl` exists.
 *
 * The string ref keeps the probe in Node: nothing inline for the extractor to
 * lower, so no `body` is emitted, and `resolveHandler` falls through to
 * `opts.functions[handler]` — the `defineStack({ functions })` map, the same
 * path the dispatch job's handler already takes. `hook.zod.ts` marks `handler`
 * deprecated in favour of `body`; following that here would break the check,
 * which is half of what #14168 asks the platform to reconcile.
 *
 * DO NOT "modernise" this into an inline handler or a `body`.
 * `test/duty-timezone.test.ts` pins the string form for that reason.
 *
 * ── Why no declarative `condition` ────────────────────────────────────────
 * A CEL `condition` of `!isBlank(record.timezone)` is the natural way to skip the
 * handler when there is nothing to check, and it silently reopens half the
 * defect: `isBlank('')` is TRUE, so an explicit empty string would be waved
 * through — and `''` is one of the values that fails at dispatch, since
 * `dispatch.plan.ts`'s `duty.timezone ?? DEFAULT_TIMEZONE` catches null and
 * undefined but not `''`. Presence is therefore decided in the handler, where
 * "key absent" and "key present and empty" are still distinguishable.
 */
export const DUTY_TIMEZONE_GUARD_HANDLER = 'dulyValidateDutyTimezone';

/**
 * A payload that carries no `timezone` key is NOT this guard's business.
 *
 * On insert the field default supplies `'UTC'`; on update, an untouched zone
 * belongs to the write that set it, and refusing an unrelated edit because of
 * a pre-existing bad value would punish the wrong person. Where the value
 * comes from in the first place is a different, still-open question — a duty
 * has no source to resolve a zone from, which is duly#26 and deliberately not
 * settled here. This guard judges values, never their absence.
 */
export const dulyValidateDutyTimezone = (ctx: HookContext): void => {
  // `input.<field>` IS the record field on a declarative code handler; the
  // `input.data.<field>` envelope spelling belongs to the raw
  // `engine.registerHook` form and is not what this receives.
  const input = ctx.input as Record<string, unknown>;

  if (!('timezone' in input)) return;

  const value = input.timezone;
  if (value === null || value === undefined) return;

  if (typeof value === 'string' && isResolvableTimeZone(value)) return;

  // Quote the value: the failures worth naming here are invisible otherwise —
  // `"Asia/Shanghai "` with a trailing space and `""` both read as blank in an
  // unquoted message.
  const message =
    `Timezone ${JSON.stringify(value)} is not a time zone this system can resolve. `
    + 'Use an IANA name such as Europe/Berlin, Asia/Shanghai or UTC. '
    + 'Period boundaries and due dates are computed in this zone, so an '
    + 'unresolvable one would fail later, inside the nightly dispatch, '
    + 'instead of here.';

  // The ADR-0112 refusal envelope, shaped to match the engine's own
  // `ValidationError` (name / `code` / `fields`) so a caller cannot tell this
  // refusal apart from the object's declared validation rules. It is built by
  // hand rather than imported because `ValidationError` is internal to
  // `@objectstack/objectql`, which this app does not depend on directly.
  // `status` is deliberately not set: the platform's own ValidationError
  // carries none, and inventing one here would override the boundary's mapping.
  const error = new Error(message) as Error & { code: string; fields: unknown[] };
  error.name = 'ValidationError';
  error.code = 'VALIDATION_FAILED';
  error.fields = [{ field: 'timezone', code: 'INVALID_VALUE', message }];
  throw error;
};

export const DutyTimezoneGuard: Hook = {
  name: 'duly_duty_timezone_guard',
  label: 'Duty timezone is a real IANA zone',
  object: 'duly_duty',
  events: ['beforeInsert', 'beforeUpdate'],
  description:
    'Refuses a duly_duty write whose timezone is not a zone this host can resolve, using the '
    + 'same Intl probe the period engine uses — so a typo is caught on the record that has it, '
    + 'instead of throwing inside the nightly dispatch job days later.',
  // A guard that fails open is not a guard. If the probe itself throws, the
  // write must be refused rather than committed unchecked.
  onError: 'abort',
  // ⛔ A STRING, not the function. See the note above — an inline handler is
  // lowered into the Intl-less QuickJS sandbox and would refuse every write.
  handler: DUTY_TIMEZONE_GUARD_HANDLER,
};
