// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one Node API a test in this repo reads, typed narrowly.
 *
 * `@types/node` is deliberately NOT a dependency here — `src/data/index.ts`
 * states the reason and sets the precedent, declaring the single `process.env`
 * property its gate needs rather than pulling the whole Node type surface into
 * a metadata package. `test/import-samples.test.ts` needs exactly one function,
 * to read the shipped `samples/*.csv` off disk, so it gets the same treatment.
 *
 * This has to live in a `.d.ts`: an ambient `declare module` inside a file that
 * is itself a module is read as an AUGMENTATION, and augmenting a module that
 * does not resolve is an error rather than a declaration.
 *
 * Widen it only for something a test actually calls. The value of the narrow
 * form is that it cannot silently license a second, larger Node dependency.
 */
declare module 'node:fs' {
  /** Read a whole file as text. `URL` so the caller can resolve against `import.meta.url`. */
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
