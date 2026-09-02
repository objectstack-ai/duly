// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The demo fixture's LANGUAGE switch — `DULY_DEMO_LOCALE`.
 *
 * The Chinese UI has been done for a while: nav, columns, statuses, progress
 * phrases and form help all render in zh-CN. Every *record* underneath it was
 * still English, so a Chinese evaluator saw a Chinese frame around English
 * content — which reads as "not localised" however good the chrome is. This
 * switch is what makes the records follow.
 *
 * ── Two variables, two different questions ────────────────────────────────
 * `DULY_DEMO_SEED` (src/data/index.ts) decides WHETHER there is a demo at all.
 * This one decides WHICH LANGUAGE that demo is written in. They are read the
 * same way and at the same moment — see the compile-time note below — but they
 * are independent: `DULY_DEMO_LOCALE=zh-CN pnpm dev` is a perfectly coherent
 * request for an empty app, and it seeds nothing.
 *
 * ── Read at COMPILE time, exactly like the seed gate ──────────────────────
 * The seed is baked into `dist/objectstack.json`, so both variables are
 * evaluated when the artifact is compiled rather than when the server starts,
 * and `os dev` reuses an existing artifact rather than recompiling it. That is
 * why `pnpm dev`, `pnpm demo` and `pnpm demo:zh` all pass `--compile`: every
 * boot's artifact matches the variables that boot was started with. Without
 * it, `pnpm demo` followed by `pnpm demo:zh` would serve the English artifact
 * the previous run built and the switch would look broken.
 *
 * ── An unrecognised value is a HARD ERROR, not a fallback to English ──────
 * `DULY_DEMO_LOCALE=zh_CN` (underscore) or `zh-cn-hans` is a typo, and the
 * failure mode of a silent fallback is the worst one available here: the demo
 * comes up in English, everything works, and nobody finds out until it is on a
 * screen in front of a customer. So the spellings below are accepted, and
 * anything else stops the compile with a message naming what it takes. Unset
 * is not a typo — that is the default, and the default is English.
 */

import { ZH_CN } from './demo-zh.js';

/** The environment variable that chooses the demo fixture's language. */
export const DEMO_LOCALE_ENV_VAR = 'DULY_DEMO_LOCALE';

export type DemoLocale = 'en' | 'zh-CN';

// The one Node global this app reads. `@types/node` is deliberately not a
// dependency of a metadata package, so the single property the switch needs is
// declared narrowly and locally rather than pulling the whole Node type
// surface in for it. Module-scoped, so it shadows nothing globally. Same
// idiom, and the same reason, as the seed gate in `index.ts`.
declare const process: { env: Record<string, string | undefined> };

/**
 * The spellings each locale answers to.
 *
 * Case is normalised before the lookup, so `ZH-CN` and `zh-CN` are the same
 * request. Everything else is refused rather than guessed at.
 */
const SPELLINGS = new Map<string, DemoLocale>([
  ['', 'en'],
  ['en', 'en'],
  ['en-us', 'en'],
  ['en-gb', 'en'],
  ['zh', 'zh-CN'],
  ['zh-cn', 'zh-CN'],
]);

/** Which language this compile was asked for. Unset means English. */
export const demoLocale = (): DemoLocale => {
  const raw = (process.env[DEMO_LOCALE_ENV_VAR] ?? '').trim();
  // A Map rather than an object literal: a plain object would answer
  // `DULY_DEMO_LOCALE=constructor` with something off `Object.prototype`, and
  // the whole point of this function is that only the listed spellings pass.
  const locale = SPELLINGS.get(raw.toLowerCase());
  if (locale === undefined) {
    throw new Error(
      `${DEMO_LOCALE_ENV_VAR}=${JSON.stringify(raw)} is not a demo locale. ` +
        `Use one of: ${[...SPELLINGS.keys()].filter(Boolean).join(', ')} — or leave it unset for English.`,
    );
  }
  return locale;
};

/**
 * The language this module graph was compiled for.
 *
 * Read ONCE, here, so every fixture module agrees. A second read elsewhere
 * would be a second answer the day the environment changed under a long-lived
 * process, and the fixture's whole determinism argument rests on one clock and
 * one language per compile.
 */
export const DEMO_LOCALE: DemoLocale = demoLocale();

// ─────────────────────────────────────────────────────────────────────────
// Translating a fixture string
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every English string the fixture has asked for, in the order it asked.
 *
 * Recorded in BOTH locales — including English, where {@link t} does no
 * lookup at all — because it is what lets `test/seed-locale.test.ts` compare
 * the fixture's demand against {@link ZH_CN}'s supply in one set operation,
 * from an ordinary English test run. The two directions catch different
 * things: a string with no entry is a line somebody forgot to translate; an
 * entry nothing asks for is an English line that has been reworded since it
 * was translated (or a translation for a row that no longer exists).
 */
const REQUESTED = new Set<string>();

/**
 * {@link ZH_CN} as a Map, for the same reason {@link SPELLINGS} is one: a
 * plain-object lookup answers `'constructor'` and `'toString'` off
 * `Object.prototype`, and a lookup that can return a function where a string
 * is expected is not a lookup that can be trusted to say "missing".
 */
const ZH_BY_SOURCE = new Map(Object.entries(ZH_CN));

/** The English strings {@link t} has been given, sorted. */
export const requestedSourceStrings = (): readonly string[] => [...REQUESTED].sort();

/**
 * The fixture's one translation point: hand it the English string, get the
 * string this compile's locale wants.
 *
 * ── A missing translation THROWS, and that is the design ─────────────────
 * The tempting alternative is to fall back to the English string, and it is
 * the wrong one for exactly the reason this card exists: the fallback renders
 * one English row in an otherwise Chinese demo, which is invisible in a test
 * that only counts rows and is embarrassing on a screen. Worse, half of these
 * strings are NATURAL KEYS — `duly_task.duty` resolves against
 * `duly_duty.name`, `owner` against `sys_user.name` — so a fallback would not
 * merely look wrong, it would silently split one obligation into two rows that
 * nothing downstream could tell were meant to be the same.
 *
 * So an untranslated string stops the compile, in the locale that needs it,
 * naming the string. In English there is nothing to look up and nothing to
 * fail: `t` is the identity function, which is what keeps the English fixture
 * byte-for-byte unchanged by this whole mechanism.
 */
export const t = (english: string): string => {
  REQUESTED.add(english);
  if (DEMO_LOCALE === 'en') return english;
  const translated = ZH_BY_SOURCE.get(english);
  if (translated === undefined) {
    throw new Error(
      `demo fixture: no ${DEMO_LOCALE} translation for ${JSON.stringify(english)} — ` +
        'add it to src/data/demo-zh.ts (every human-readable fixture string needs one).',
    );
  }
  return translated;
};
