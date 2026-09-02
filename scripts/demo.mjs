#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `pnpm demo` — start Duly with the demo organisation loaded, in ONE command,
// on a clean checkout.
//
// ── Why this is a script and not `objectstack dev` with a flag ─────────────
//
// The demo dataset is opt-in and off by default (see src/data/index.ts for the
// product reasoning). Turning it on is one environment variable, and on a
// database that already has an account that is genuinely all it takes.
//
// On a BRAND-NEW database it is not. `@objectstack/plugin-auth` mints the dev
// admin on a zero-user database from the `kernel:ready` hook, which fires
// after the declarative seed has already run — so a first boot that carries
// the demo's thirteen `sys_user` rows is never zero-user by the time that
// check runs, the admin is never created, and because the check is "any human
// row exists" it is never created on a later boot either. The result looks
// like a working app with no way into it.
//
// So this sequences the two boots the evaluator would otherwise have to know
// about: once with the demo OFF, which leaves the database zero-user long
// enough for the admin to be minted, then again with it ON. The first boot is
// quiet. The handover between them is VERIFIED — a real sign-in against the
// priming server — because the failure this guards against is a seeded
// database with no login, which is worse than the bug it replaces: it looks
// like it worked.
//
// Filed upstream as objectstack-ai/objectstack#14157. When that lands, the
// priming boot below is deleted and this file becomes one spawn.
//
// ── The language the demo is written in ────────────────────────────────────
//
// `DULY_DEMO_LOCALE` (unset = English, `zh-CN` = Chinese) chooses the fixture's
// language, and `pnpm demo:zh` is `pnpm demo` with it set. It reaches BOTH
// boots below — the priming one because it decides the admin account's name
// (see `renameAdminAccount`) and because an unspellable value should be
// refused before anything is written, and the demo one because the fixture is
// baked into the artifact that boot compiles.
//
// ── Why both boots pass `--compile` ────────────────────────────────────────
//
// The seed is baked into `dist/objectstack.json` at compile time, and `os dev`
// reuses an existing artifact rather than recompiling it (`--compile` defaults
// to false; it auto-compiles only when the artifact is MISSING). Without
// `--compile` the second boot here would serve the artifact the priming boot
// just built — the one with no seed — and `pnpm demo` would print success and
// show an empty app. `pnpm dev` passes it for the mirror-image reason.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';
const DEMO_LOCALE_ENV_VAR = 'DULY_DEMO_LOCALE';

/**
 * `sys_user.name` the account you log in as carries, per locale.
 *
 * ⚠️ This MIRRORS `ADMIN` in `src/data/demo-org.ts`, which is what the seed
 * matches on. They have to agree, and they cannot be one constant: this file
 * is plain `.mjs` that runs before anything is compiled, and that one is
 * TypeScript baked into the artifact. `test/demo-script.test.ts` reads this
 * file and holds the two together, because the failure when they drift is
 * silent — see `renameAdminAccount` below for what it looks like.
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
 * a moment later by `src/data/demo-locale.ts`, which is the right division of
 * labour: this script does not get a second opinion about what a locale is.
 */
const ADMIN_NAME =
  ADMIN_NAME_BY_LOCALE.get((process.env[DEMO_LOCALE_ENV_VAR] ?? '').trim().toLowerCase()) ?? 'Dev Admin';

// The same credentials and the same env overrides `@objectstack/plugin-auth`
// itself reads, so an operator who has changed them is not silently probing
// for an account that was never going to exist.
const ADMIN_EMAIL = process.env.OS_SEED_ADMIN_EMAIL?.trim() || 'admin@objectos.ai';
const ADMIN_PASSWORD = process.env.OS_SEED_ADMIN_PASSWORD?.trim() || 'admin123';

/** How long the priming boot gets to come up and mint the admin. */
const PRIMING_TIMEOUT_MS = 180_000;
/** How long a SIGTERM gets to bring the priming boot down before SIGKILL. */
const SHUTDOWN_GRACE_MS = 10_000;
/** Tail of the priming boot's output kept for the failure path. */
const LOG_TAIL_LINES = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A port the priming server can have to itself.
 *
 * The priming boot must not land on the port the user is about to run the demo
 * on, and it must not collide with whatever else is already listening — so it
 * asks the OS for a free one rather than guessing. `os dev` auto-shifts off a
 * busy port, which would leave the sign-in probe below talking to nothing.
 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/**
 * The handover check: can you actually log in yet?
 *
 * Not "did the server start" and not "did a line appear in the log" — the
 * whole point of the priming boot is a loginable account, so that is what is
 * asserted. `localhost` (not `127.0.0.1`) with a matching `Origin`: dev trusts
 * `http://localhost:*`, and better-auth rejects anything else with 403
 * INVALID_ORIGIN.
 *
 * Returns the signed-in session — id, display name and session cookie — or
 * `null` if the account is not loginable yet. The extra detail is what the
 * rename below needs; the probe itself is unchanged.
 */
const signIn = async (port) => {
  const origin = `http://localhost:${port}`;
  try {
    const response = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 200) return null;
    const raw = response.headers.getSetCookie?.()?.[0] ?? response.headers.get('set-cookie') ?? '';
    const body = await response.json().catch(() => ({}));
    const user = body?.user ?? {};
    return {
      port,
      origin,
      // Just the `name=value` pair; the attributes are the browser's business.
      cookie: String(raw).split(';')[0],
      id: typeof user.id === 'string' ? user.id : null,
      name: typeof user.name === 'string' ? user.name : null,
    };
  } catch {
    // Not up yet, or up and not answering. Either way: not ready.
    return null;
  }
};

/**
 * Give the account you log in as a name in the demo's own language.
 *
 * ── Why this is here and not in the seed ─────────────────────────────────
 * `@objectstack/plugin-auth` mints the dev admin and its `sys_user.name` is
 * not configurable — only `OS_SEED_ADMIN_EMAIL` / `OS_SEED_ADMIN_PASSWORD`
 * exist. The seed cannot write it either: the `sys_user` row for the admin
 * carries its natural key and NOTHING else on purpose, because anything more
 * would turn the loader's no-op skip into an UPDATE against a live
 * credential-bearing account (see `src/data/demo-org.ts`). So the only place
 * the rename can happen is here — in the priming step, against a database
 * that holds exactly one user, BEFORE the seed runs and has to match it.
 *
 * ── What goes wrong if it silently does not happen ───────────────────────
 * The seed's `sys_user` dataset is keyed on `name`. With the fixture in
 * Chinese it declares `演示管理员`; if the live account is still `Dev Admin`,
 * the loader matches nothing, INSERTS a fourteenth user, and hands every one
 * of the demo account's duties, tasks, assignment and log entries to a person
 * nobody can log in as. The app comes up, the seed reports success, and My
 * week, My duties, Sent by me and Work log are all empty on the screen the
 * evaluator lands on. That is why this fails loudly rather than warning.
 *
 * Measured on `@objectstack/*` 17.2.0 (2026-09-02): the PATCH returns 200,
 * signing in with the same credentials afterwards returns 200 and reports the
 * new name, and the seed then replays as a no-op against the renamed row.
 * Idempotent — a second `pnpm demo:zh` on the same database finds the name
 * already right and does nothing.
 */
const renameAdminAccount = async (session) => {
  if (session.name === ADMIN_NAME) return { ok: true };
  if (!session.id) {
    return {
      ok: false,
      headline: 'the admin account could not be identified, so it was not renamed.',
      detail: ['Signing in succeeded but returned no user id, so nothing was seeded.'],
    };
  }

  const response = await fetch(`${session.origin}/api/v1/data/sys_user/${session.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      origin: session.origin,
      cookie: session.cookie,
    },
    body: JSON.stringify({ name: ADMIN_NAME }),
    signal: AbortSignal.timeout(15_000),
  }).catch((error) => ({ ok: false, status: 0, error }));

  if (!response.ok) {
    return {
      ok: false,
      headline: `the admin account could not be renamed to ${JSON.stringify(ADMIN_NAME)}, so the demo was NOT loaded.`,
      detail: [
        `PATCH /api/v1/data/sys_user/${session.id} answered ${response.status || 'no response'}.`,
        '',
        `The ${DEMO_LOCALE_ENV_VAR} fixture expects the account you log in as to be`,
        `named ${JSON.stringify(ADMIN_NAME)}. Seeding it against an account still named`,
        `${JSON.stringify(session.name)} would create a second user and leave every`,
        '"my own work" screen empty, so nothing was seeded — the database is as it was.',
        '',
        'Run `pnpm demo` for the English demo instead.',
      ],
    };
  }

  // The same discipline as the probe above: assert the handover rather than
  // assume it. A rename that broke the login would be the worst outcome
  // available here — a seeded database nobody can get into — and it is
  // exactly the kind of thing that is fine until an auth provider starts
  // treating `name` as part of the credential.
  const after = await signIn(session.port);
  if (!after || after.name !== ADMIN_NAME) {
    return {
      ok: false,
      headline: 'the admin account could not sign in after being renamed, so the demo was NOT loaded.',
      detail: [
        after
          ? `Signed in, but the account is named ${JSON.stringify(after.name)} rather than ${JSON.stringify(ADMIN_NAME)}.`
          : `\`${ADMIN_EMAIL}\` no longer signs in after the rename.`,
        '',
        'Nothing was seeded by this run — the database is exactly as it was.',
      ],
    };
  }
  return { ok: true, renamed: true };
};

const fail = (headline, detail, log) => {
  console.error('');
  console.error(`❌  pnpm demo failed — ${headline}`);
  console.error('');
  for (const line of detail) console.error(`   ${line}`);
  if (log.length) {
    console.error('');
    console.error(`   Last ${Math.min(log.length, LOG_TAIL_LINES)} lines of the priming boot:`);
    console.error('');
    for (const line of log.slice(-LOG_TAIL_LINES)) console.error(`   | ${line}`);
  }
  console.error('');
  process.exit(1);
};

/**
 * Boot once with the demo OFF, wait until the dev admin can sign in, stop.
 *
 * Idempotent: on a database that already has an account this boot mints
 * nothing, the first probe succeeds, and it costs one short boot.
 *
 * Returns whether it had to rename the account for this run's locale, which is
 * the one thing worth saying out loud in the output.
 */
const primeAdminAccount = async () => {
  const port = await freePort();

  // Deleted rather than set to a falsy string: this must be off regardless of
  // how the gate spells "off", and regardless of what the operator exported.
  //
  // ⚠️ ONLY the seed gate is deleted. `DULY_DEMO_LOCALE` is passed straight
  // through, and both halves of that matter. It reaches the compile, so an
  // unspellable locale is refused HERE — in the quiet boot, before anything
  // has been written — rather than after the priming step has reported
  // success. And it must not be deleted "for symmetry": this boot is what
  // decides the admin account's name for the run, so a priming step that could
  // not see the locale would rename the account for a language it did not know
  // it was preparing.
  const env = { ...process.env };
  delete env[DEMO_SEED_ENV_VAR];

  const child = spawn('objectstack', ['dev', '--compile', '--port', String(port)], {
    env,
    // Quiet, but kept: nothing is printed unless the sequence fails, and then
    // all of it is.
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so the whole tree goes down with it. `os dev`
    // spawns a `serve` child; signalling only the parent orphans the server
    // and leaves it holding the port and the database.
    detached: true,
  });

  const log = [];
  const collect = (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) log.push(line.trimEnd());
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let exited = null;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.once('error', (error) => {
    exited = { code: null, signal: null, error };
  });

  const stop = async () => {
    if (exited) return;
    const down = new Promise((resolve) => child.once('exit', resolve));
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    let settled = false;
    await Promise.race([down.then(() => { settled = true; }), sleep(SHUTDOWN_GRACE_MS)]);
    if (settled) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    await Promise.race([down, sleep(2_000)]);
  };

  const deadline = Date.now() + PRIMING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) {
      fail(
        'the preparation step exited before an admin account existed.',
        [
          exited.error
            ? `Could not start \`objectstack dev\`: ${exited.error.message}`
            : `\`objectstack dev\` exited with ${exited.signal ? `signal ${exited.signal}` : `code ${exited.code}`}.`,
          'Nothing was seeded. Fix the error above and run `pnpm demo` again.',
        ],
        log,
      );
    }
    const session = await signIn(port);
    if (session) {
      // Still inside the priming boot, and deliberately so: the rename has to
      // land BEFORE the seed's `sys_user` dataset tries to match on the name.
      const rename = await renameAdminAccount(session);
      // Stop the priming server FIRST either way: it is detached and holding
      // the database, so exiting around it would orphan a server nobody can
      // see and leave the port and the database locked.
      await stop();
      if (!rename.ok) fail(rename.headline, rename.detail, log);
      return rename.renamed === true;
    }
    await sleep(1_000);
  }

  await stop();
  fail(
    `no account could sign in after ${PRIMING_TIMEOUT_MS / 1000}s, so the demo was NOT loaded.`,
    [
      `Expected \`${ADMIN_EMAIL}\` to be loginable after the preparation boot.`,
      '',
      'The most likely cause is a database that already holds accounts from an',
      'earlier run, which stops a fresh dev admin from being created. Start over:',
      '',
      '    rm -rf .objectstack/data && pnpm demo',
      '',
      'Nothing was seeded by this run — the database is exactly as it was.',
    ],
    log,
  );
};

/** Boot with the demo ON, in the foreground. This is the server you keep. */
const startDemo = () => {
  // Extra arguments are forwarded, so `pnpm demo -- --port 4000` works.
  const passthrough = process.argv.slice(2);
  const child = spawn('objectstack', ['dev', '--compile', ...passthrough], {
    // The seed gate is turned ON for this boot; the locale is inherited and
    // stated explicitly beside it, so the two variables the compiled artifact
    // depends on are both visible at the one place that decides them. Both
    // boots pass `--compile`, so this artifact is built for this locale — see
    // the header for why reusing the previous one is the bug that costs.
    env: {
      ...process.env,
      [DEMO_SEED_ENV_VAR]: '1',
      ...(process.env[DEMO_LOCALE_ENV_VAR] === undefined
        ? {}
        : { [DEMO_LOCALE_ENV_VAR]: process.env[DEMO_LOCALE_ENV_VAR] }),
    },
    // Inherited, and NOT detached: the demo server shares this terminal's
    // process group so Ctrl+C reaches it the way it would `pnpm dev`.
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    fail('the demo server could not be started.', [error.message], []);
  });
  child.once('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
};

console.log('');
console.log('  Duly demo — two steps, then the server is yours.');
console.log('');
console.log('  1/2  preparing an admin account (quiet, a few seconds)…');
const renamed = await primeAdminAccount();
console.log(
  renamed
    ? `  1/2  done — admin account ready, renamed to ${ADMIN_NAME} for this locale.`
    : '  1/2  done — admin account ready.',
);
console.log('  2/2  starting Duly with the demo organisation loaded…');
console.log('');
startDemo();
