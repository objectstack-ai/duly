#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `pnpm demo` — start Duly with the demo organisation loaded, in ONE command
// and ONE boot, on a clean checkout.
//
// ── Why this is a script and not `objectstack dev` with a flag ─────────────
//
// It nearly is. The demo dataset is opt-in and off by default (see
// src/data/index.ts for the product reasoning), and turning it on is one
// environment variable. This file exists to set the THREE variables a demo
// boot needs, in one place, and to refuse the one combination of them that
// would boot a demo you cannot use. Everything after that is a single
// `objectstack dev --compile` spawn.
//
// ── Why one boot is enough now (#131) ──────────────────────────────────────
//
// Until `@objectstack/*` 18.2 this script booted twice: once with the demo off
// so `@objectstack/plugin-auth` could mint the dev admin on an empty database,
// then again with it on. The admin is minted at `kernel:ready`, and the app's
// declarative seed used to run BEFORE that, so on a single boot the seed's
// name-only admin row landed first and the minted admin became a SECOND row:
// sign-in worked, and every duty, task and log entry the demo gives you
// belonged to a ghost nobody could sign in as (measured on 17.3.0, #131).
//
// 18.2 orders it in the platform (objectstack#25830). The app declares its
// demo people with `defineStack({ demoStaff })` (src/data/demo-staff.ts), and
// a stack that declares them has its inline seed deferred to
// `kernel:bootstrapped`, after the admin and the twelve demo accounts exist.
// The seed's `sys_user` rows then land on those live accounts by name. The
// declaration is gated on `DULY_DEMO_SEED`, the same variable as the seed, and
// it is read off the config when the server starts, so this boot's environment
// is what switches both on.
//
// ── The language the demo is written in, and the admin's name ─────────────
//
// `DULY_DEMO_LOCALE` (unset = English, `zh-CN` = Chinese) chooses the fixture's
// language, and `pnpm demo:zh` is `pnpm demo` with it set. The fixture names
// the account you sign in as `Dev Admin` in English and `演示管理员` in
// Chinese, and the seed finds that account BY NAME. plugin-auth mints it under
// `OS_SEED_ADMIN_NAME` (default `Dev Admin`), so this script sets that variable
// to the fixture's name for the locale. Measured on 18.2.0 for #131: a
// `zh-CN` boot without it signs in as `Dev Admin`, and the seed inserts a
// second, credential-less `演示管理员` who owns all of the demo account's work
// (14 users instead of 13). With it, one row, 13 users, and the account you
// sign in as owns its tasks, duties, assignment and log. That replaces the
// rename the old priming boot did over REST.
//
// ── Why the boot passes `--compile` ────────────────────────────────────────
//
// The seed is baked into `dist/objectstack.json` at compile time, and `os dev`
// reuses an existing artifact rather than recompiling it (`--compile` defaults
// to false; it auto-compiles only when the artifact is MISSING). Without
// `--compile`, a `pnpm demo` after a `pnpm dev` would serve the artifact that
// `pnpm dev` built, the one with no seed, and show an empty app. `pnpm dev`
// passes it for the mirror-image reason.
//
// ── Why this switches scheduled work on ───────────────────────────────────
//
// Duly IS scheduled work: the nightly `duly_dispatch` job and the three
// reminder sweeps are the product. From `@objectstack/*` 18 the platform arms
// package-authored scheduled work only when
// `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` is truthy, and it is off by default,
// so a demo booted without it has a dispatcher that never runs and reminders
// that are never sent, and says so only as one line in the startup summary.
// It is set here, and ONLY when the caller has not set it: an explicit value,
// `false` included, is the caller's decision and wins. Set it in the shell
// rather than in `.env`: `os dev` loads `.env` without overriding a variable
// that is already set, so a `.env` value loses to this default. `pnpm dev`
// arms it the same way, with an inline default; `pnpm start` does not,
// because on a deployment whether clock-driven work runs is the deployer's
// call.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';
const DEMO_LOCALE_ENV_VAR = 'DULY_DEMO_LOCALE';
const ADMIN_NAME_ENV_VAR = 'OS_SEED_ADMIN_NAME';
const SCHEDULED_WORK_ENV_VAR = 'OS_AUTOMATION_SCHEDULED_WORK_ENABLED';

if (process.env[SCHEDULED_WORK_ENV_VAR] === undefined) process.env[SCHEDULED_WORK_ENV_VAR] = 'true';

/**
 * `sys_user.name` the account you sign in as carries, per locale.
 *
 * ⚠️ This MIRRORS `ADMIN` in `src/data/demo-org.ts`, which is what the seed
 * matches on. They have to agree, and they cannot be one constant: this file
 * is plain `.mjs` that runs before anything is compiled, and that one is
 * TypeScript baked into the artifact. `test/demo-script.test.ts` reads this
 * file and holds the two together, because the failure when they drift is
 * silent: a second admin row that owns the demo account's work.
 *
 * The spellings are the ones `src/data/demo-locale.ts` accepts, normalised the
 * same way (trimmed, lowercased).
 */
const ADMIN_NAME_BY_LOCALE = new Map([
  ['', 'Dev Admin'],
  ['en', 'Dev Admin'],
  ['en-us', 'Dev Admin'],
  ['en-gb', 'Dev Admin'],
  ['zh', '演示管理员'],
  ['zh-cn', '演示管理员'],
]);

/**
 * What this run's fixture will call the admin.
 *
 * An unrecognised spelling falls back to the English name here and is REFUSED
 * a moment later by `src/data/demo-locale.ts` when the boot compiles, which is
 * the right division of labour: this script does not get a second opinion
 * about what a locale is.
 */
const ADMIN_NAME =
  ADMIN_NAME_BY_LOCALE.get((process.env[DEMO_LOCALE_ENV_VAR] ?? '').trim().toLowerCase()) ?? 'Dev Admin';

/** Where `os dev` keeps its database. Only used to say whether this run reuses one. */
const DATA_DIR = '.objectstack/data';

const fail = (headline, detail) => {
  console.error('');
  console.error(`❌  pnpm demo failed — ${headline}`);
  console.error('');
  for (const line of detail) console.error(`   ${line}`);
  console.error('');
  process.exit(1);
};

// An admin name the caller exported for something else would mint the account
// under a name the seed does not look for: the ghost-admin split above, with
// nothing printed. So a different value is refused before anything starts,
// rather than silently overridden or silently obeyed.
const callerAdminName = process.env[ADMIN_NAME_ENV_VAR]?.trim();
if (callerAdminName && callerAdminName !== ADMIN_NAME) {
  fail(`${ADMIN_NAME_ENV_VAR} is set to ${JSON.stringify(callerAdminName)}, and this demo needs ${JSON.stringify(ADMIN_NAME)}.`, [
    'The demo seed finds the account you sign in as by its name. Minted under any',
    'other name, the seed would create a second admin that owns all of the demo',
    "account's work, and My week, My duties and Work log would be empty.",
    '',
    `Unset it (\`unset ${ADMIN_NAME_ENV_VAR}\`) and run the demo again. Nothing was started.`,
  ]);
}

// Re-running a demo on its own database is fine: every dataset replays as a
// no-op and the accounts are found, not created. English on a database
// `pnpm dev` created is fine too, since that admin is already `Dev Admin`.
// What a reused database cannot do is RENAME an account it already holds, so
// a Chinese demo on a database `pnpm dev` or the English demo created would
// add a second admin. Said once, up front, with the way out.
const reusingUnderAnotherName = ADMIN_NAME !== 'Dev Admin' && existsSync(DATA_DIR);

/** Boot with the demo ON, in the foreground. This is the server you keep. */
const startDemo = () => {
  // Extra arguments are forwarded, so `pnpm demo -- --port 4000` works.
  const passthrough = process.argv.slice(2);
  const child = spawn('objectstack', ['dev', '--compile', ...passthrough], {
    // The seed gate and the admin's name are set for this boot; the locale is
    // inherited and stated explicitly beside them, so every variable the boot
    // depends on is visible at the one place that decides them.
    env: {
      ...process.env,
      [DEMO_SEED_ENV_VAR]: '1',
      [ADMIN_NAME_ENV_VAR]: ADMIN_NAME,
      ...(process.env[DEMO_LOCALE_ENV_VAR] === undefined
        ? {}
        : { [DEMO_LOCALE_ENV_VAR]: process.env[DEMO_LOCALE_ENV_VAR] }),
    },
    // Inherited, and NOT detached: the demo server shares this terminal's
    // process group so Ctrl+C reaches it the way it would `pnpm dev`.
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    fail('the demo server could not be started.', [error.message]);
  });
  child.once('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
};

console.log('');
console.log(`  Duly demo — starting with the demo organisation loaded. You sign in as ${ADMIN_NAME}.`);
if (reusingUnderAnotherName) {
  console.log(`  Reusing the database in ${DATA_DIR}. If \`pnpm dev\` or \`pnpm demo\` created it,`);
  console.log(`  its admin is still Dev Admin; start clean instead:  rm -rf ${DATA_DIR} && pnpm demo:zh`);
}
console.log('');
startDemo();
