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
 */
const canSignIn = async (port) => {
  const origin = `http://localhost:${port}`;
  try {
    const response = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(5_000),
    });
    return response.status === 200;
  } catch {
    // Not up yet, or up and not answering. Either way: not ready.
    return false;
  }
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
 */
const primeAdminAccount = async () => {
  const port = await freePort();

  // Deleted rather than set to a falsy string: this must be off regardless of
  // how the gate spells "off", and regardless of what the operator exported.
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
    if (await canSignIn(port)) {
      await stop();
      return;
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
    env: { ...process.env, [DEMO_SEED_ENV_VAR]: '1' },
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
await primeAdminAccount();
console.log('  1/2  done — admin account ready.');
console.log('  2/2  starting Duly with the demo organisation loaded…');
console.log('');
startDemo();
