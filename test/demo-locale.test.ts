// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';

import { DEMO_LOCALE_ENV_VAR, demoLocale, requestedSourceStrings } from '../src/data/demo-locale.js';
import { ZH_CN, ZH_PEOPLE } from '../src/data/demo-zh.js';

// Importing the barrel evaluates every fixture module, which is what puts the
// fixture's whole demand for translations into `requestedSourceStrings()`.
// Named as a side-effecting import so nobody "cleans it up".
import '../src/data/index.js';

/**
 * The demo fixture's locale switch, and the dictionary behind it.
 *
 * `test/seed-locale.test.ts` boots the app in each language and reads the rows
 * back — that is the suite that proves a Chinese demo works. This one is about
 * the mechanism itself, and it runs in ENGLISH, which is the interesting part:
 * two of the three failures a translated fixture can have are visible without
 * ever compiling the Chinese one.
 */

// ───────────────────────────────────────────────────────────────────────────
describe('DULY_DEMO_LOCALE', () => {
  const localeFor = (value: string | undefined): (() => string) => {
    vi.stubEnv(DEMO_LOCALE_ENV_VAR, value ?? '');
    return () => demoLocale();
  };

  it.each([
    ['', 'en'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['ZH-cn', 'zh-CN'],
    ['  zh-CN  ', 'zh-CN'],
  ])('%j asks for %s', (value, expected) => {
    expect(localeFor(value)()).toBe(expected);
    vi.unstubAllEnvs();
  });

  it.each(['zh_CN', 'zh-Hans', 'chinese', 'cn', 'de'])(
    '%j is refused rather than quietly answered in English',
    (value) => {
      // The reason this is a throw and not a fallback: a typo that falls back
      // brings the demo up in English, working perfectly, and nobody finds out
      // until it is on a screen in front of a customer. The message has to name
      // what it does accept, because the person reading it has just typed a
      // spelling that looked right.
      expect(localeFor(value)).toThrow(new RegExp(`${DEMO_LOCALE_ENV_VAR}.*is not a demo locale`));
      expect(localeFor(value)).toThrow(/zh-cn/);
      vi.unstubAllEnvs();
    },
  );

  it('is unset by default, and unset means English', () => {
    // The default matters as much as the switch: `pnpm dev` and `pnpm demo`
    // pass nothing, and an English demo is what they have always produced.
    expect(demoLocale()).toBe('en');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the dictionary covers the fixture exactly', () => {
  /**
   * Both directions of one set comparison, and each direction catches a
   * different real defect:
   *
   *  - **A string with no entry** is a fixture line somebody forgot to
   *    translate. In a zh-CN compile it throws — see `t()` — so this test is
   *    how it is found from an ordinary English run, before anyone builds the
   *    Chinese demo.
   *  - **An entry nothing asks for** is a translation for a row that no longer
   *    exists, or, far more often, an English line that has been REWORDED
   *    since it was translated. That second reading is what pins the English
   *    fixture: #117 says this card must not quietly change the English demo,
   *    and a reworded description orphans its entry and lands here.
   */
  const requested = new Set(requestedSourceStrings());
  const supplied = new Set(Object.keys(ZH_CN));

  it('every string the fixture asks for has a zh-CN translation', () => {
    const missing = [...requested].filter((source) => !supplied.has(source)).sort();
    expect(missing, 'fixture strings with no entry in src/data/demo-zh.ts').toEqual([]);
  });

  it('and every translation is asked for by the fixture', () => {
    const dead = [...supplied].filter((source) => !requested.has(source)).sort();
    expect(dead, 'entries in src/data/demo-zh.ts that nothing asks for').toEqual([]);
  });

  it('over a real fixture, so neither direction passes vacuously', () => {
    // Units, people, positions, 20 catalog items with their descriptions and
    // references, 31 duties, the notes, the assignments and the work log.
    expect(requested.size).toBeGreaterThan(120);
    expect(supplied.size).toBe(requested.size);
  });

  it('translates every one of them into something actually Chinese', () => {
    // A dictionary entry that repeats its English key would satisfy both
    // directions above and translate nothing.
    const HAN = /[㐀-䶿一-鿿豈-﫿]/u;
    const untranslated = Object.entries(ZH_CN)
      .filter(([, value]) => !HAN.test(value))
      .map(([source]) => source);
    expect(untranslated).toEqual([]);
  });

  it('and gives every one of the twelve people a distinct name and mailbox', () => {
    const people = Object.values(ZH_PEOPLE);
    expect(people.length).toBe(12);
    // `sys_user.name` is the natural key every `owner` reference resolves
    // against, matched with `limit: 1`. Two people sharing a name would not
    // error — one person's tasks would attach to the other, permanently.
    expect(new Set(people.map((person) => person.name)).size).toBe(12);
    expect(new Set(people.map((person) => person.mailbox)).size).toBe(12);
    for (const person of people) {
      expect(person.mailbox, `${person.name}'s mailbox`).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });
});
