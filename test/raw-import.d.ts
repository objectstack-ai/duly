// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Vite's `?raw` import suffix, declared for `tsc`.
 *
 * Vitest runs on Vite, which resolves `import x from './f.ts?raw'` to the
 * file's TEXT. TypeScript has no idea, so without this the import is an
 * unresolved module and `pnpm typecheck` fails while `pnpm test` passes — the
 * two-gates-disagree shape.
 *
 * Why a raw import rather than `node:fs`: this repo ships no `@types/node`
 * (nothing in `src/` needs it, and `tsconfig.json` names no `types`), so
 * `readFileSync` does not type-check here. Adding the dependency to read one
 * file in one test is a wider change than the test is worth, and
 * `package.json` is a file the parallel batch also touches.
 *
 * Used by `test/member-page.test.ts`, which greps the member page's SOURCE —
 * comments included — for an object name that must never appear in it.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
