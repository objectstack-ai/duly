// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { JobServicePlugin } from '@objectstack/service-job';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { TimeRelativeTriggerPlugin } from '@objectstack/trigger-schedule';

import stack from '../objectstack.config.js';
import { dulyEmailTemplates } from '../src/email-templates/index.js';
import { dulyFlows } from '../src/flows/index.js';

/**
 * The reminder sweeps' notification text, as `sys_email_template` bundles.
 *
 * Two things are pinned here and nothing else in the toolchain pins either:
 *
 *  - **The cross-reference.** A notify node's `template` is read RAW and is a
 *    metadata cross-reference nothing resolves at author time. `pnpm validate`
 *    parses the bundles (measured: an unknown key inside one takes validate to
 *    exit 1 naming the key) but never checks that the NAME on a notify node
 *    matches one, so a typo is caught by no gate. At runtime the inbox channel
 *    classifies `TEMPLATE_NOT_FOUND` as PERMANENT — the delivery dead-letters
 *    while the flow run still reports success. That is strictly worse than the
 *    inline English this card replaced, and it is invisible.
 *
 *  - **That the notification still arrives, with the right words in it.** The
 *    end-to-end leg below boots a real kernel with the real automation, job,
 *    messaging and email services, drives the REAL `TimeRelativeTrigger`
 *    sweep, and reads the row the inbox channel wrote. The assertion is on the
 *    resolved BODY, not on "a notification was emitted": a template that
 *    resolves to nothing emits a notification too.
 *
 * ── Why the plugin packages are devDependencies of this app ──────────────
 * `email`, `messaging` and `job` are in `PLATFORM_ALWAYS_ON_CAPABILITIES` and
 * `triggers` is declared in `objectstack.config.ts`, so `objectstack dev`
 * mounts all five of these for real — but it is the CLI that owns that list,
 * and `createStandaloneStack()` returns only the datasource/metadata/ObjectQL
 * base. Mounting them here is what makes this suite exercise the delivery path
 * the app actually runs on. They are dev-only: nothing in `src/` imports them.
 */

type AnyRec = Record<string, unknown>;
interface NodeLike { id: string; type: string; config?: AnyRec }
interface FlowLike { name: string; nodes: NodeLike[] }

const notifyNodes = (): { flow: string; node: NodeLike }[] =>
  (dulyFlows as unknown as FlowLike[]).flatMap((f) =>
    f.nodes.filter((n) => n.type === 'notify').map((node) => ({ flow: f.name, node })),
  );

/** Every `(name, locale)` row in the barrel, keyed by name. */
const rowsByName = (): Map<string, AnyRec[]> => {
  const out = new Map<string, AnyRec[]>();
  for (const row of dulyEmailTemplates as unknown as AnyRec[]) {
    const name = String(row.name);
    out.set(name, [...(out.get(name) ?? []), row]);
  }
  return out;
};

// A subject with an apostrophe, on purpose — see the escaping test.
const TASK_SUBJECT = "File the operator's emissions return";
const OWNER = 'user_alice';

const utcDay = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

let kernel: any;
let data: any;
let email: any;
let job: any;

const waitFor = async <T>(probe: () => Promise<T | undefined>, label: string, ms = 8_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = await probe();
    if (hit !== undefined) return hit;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Same reason as test/task-hook.test.ts: left to its default this resolves
    // `<cwd>/dist/objectstack.json`, and a local `pnpm build` would make the
    // suite report on the last BUILD instead of on `src/`.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.use(new JobServicePlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use(new MessagingServicePlugin());
  await kernel.use(new EmailServicePlugin());
  await kernel.use(new TimeRelativeTriggerPlugin());
  await kernel.bootstrap();
  data = kernel.getService('data');
  email = kernel.getService('email');
  job = kernel.getService('job');
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

// ── Wiring: the barrel, and the reference from the flows ──────────────────

describe('the email-template barrel', () => {
  it('reaches defineStack({ emailTemplates }) — the only place the runtime reads', () => {
    // Compared by `(name, locale)` and not by identity: `defineStack` stamps
    // provenance (`_packageId`, `_provenance`) onto each row, so what the stack
    // carries is a stamped COPY of the barrel, never the same array.
    const key = (r: AnyRec) => `${String(r.name)}@${String(r.locale)}`;
    const onStack = ((stack as AnyRec).emailTemplates ?? []) as AnyRec[];
    expect(onStack.map(key)).toEqual((dulyEmailTemplates as unknown as AnyRec[]).map(key));
    expect(onStack.length).toBe(6);
  });

  it('is a named ARRAY of rows that each carry a name', () => {
    // The barrel convention: `Object.values(barrel)` resolves against the keyed
    // branch of `MetadataCollectionInput`, which makes `name` optional. Every
    // row carrying one is the property that branch would have surrendered.
    expect(Array.isArray(dulyEmailTemplates)).toBe(true);
    expect(dulyEmailTemplates.length).toBeGreaterThan(0);
    for (const row of dulyEmailTemplates as unknown as AnyRec[]) {
      expect(typeof row.name, JSON.stringify(row.label)).toBe('string');
    }
  });

  it('every notify node names a template that EXISTS in the barrel', () => {
    // The silent failure this card introduces if it is got wrong: `template` is
    // read raw, resolved at delivery, and a miss dead-letters permanently while
    // the run reports success.
    const names = rowsByName();
    const seen: string[] = [];
    for (const { flow, node } of notifyNodes()) {
      const name = String(node.config?.template ?? '');
      expect(name, `flow '${flow}' notify '${node.id}' names no template`).not.toBe('');
      expect(
        names.has(name),
        `flow '${flow}' notify '${node.id}' names '${name}', which no row in dulyEmailTemplates declares`,
      ).toBe(true);
      seen.push(name);
    }
    expect(seen.length).toBe(3);
  });

  it('every referenced bundle has an `en` row — the source language (AGENTS.md §8)', () => {
    // Locale COVERAGE beyond this is #18's shape-discovering gate, not this
    // suite's. What is pinned here is the source-language anchor: without an
    // `en` row the app's own default locale resolves through the service's
    // en-US ladder to whatever sorts first.
    const names = rowsByName();
    for (const { node } of notifyNodes()) {
      const rows = names.get(String(node.config?.template)) ?? [];
      expect(rows.map((r) => r.locale)).toContain('en');
    }
  });

  it('no notify node authors inline display text any more', () => {
    // `NotifyConfigSchema.superRefine` already refuses `template` alongside
    // `title`/`message`, so this cannot regress quietly — it is pinned because
    // the §8 deviation it removes is what the card is about.
    for (const { flow, node } of notifyNodes()) {
      expect(Object.keys(node.config ?? {}), `flow '${flow}'`).not.toContain('title');
      expect(Object.keys(node.config ?? {}), `flow '${flow}'`).not.toContain('message');
    }
  });
});

// ── The bundles reached the store the delivery path reads ────────────────

describe('the declared bundles materialize into sys_email_template', () => {
  it('every authored row is a row in the table', async () => {
    for (const authored of dulyEmailTemplates as unknown as AnyRec[]) {
      const row = await data.findOne('sys_email_template', {
        where: { name: authored.name, locale: authored.locale },
      });
      expect(row, `${String(authored.name)} @ ${String(authored.locale)}`).toBeTruthy();
      expect(row.subject).toBe(authored.subject);
    }
  });
});

// ── End to end: the sweep still notifies, and with WHICH words ───────────

describe('the lead-time sweep delivers a RESOLVED body', () => {
  let taskId: string;

  beforeAll(async () => {
    const created = await data.insert('duly_task', {
      subject: TASK_SUBJECT,
      owner: OWNER,
      source: 'catalog',
      status: 'open',
      visible_from: utcDay(0),
      due_date: utcDay(7),
    });
    taskId = String(Array.isArray(created) ? created[0]?.id : created?.id);

    // Fire the sweep NOW instead of at 08:00 UTC. The job service owns the
    // cadence and nothing else: `trigger()` runs the same handler the cron
    // would, so the sweep, the window math, the dispatch claim, the flow run
    // and the notify node are all the real ones.
    await job.trigger('flow-time-relative:duly_task_lead_time_reminder');
  }, 120_000);

  it('wrote an inbox row for the owner', async () => {
    const row = await waitFor(async () => {
      const rows = await data.find('sys_inbox_message', {
        where: { user_id: OWNER, topic: 'duly.task_lead_time' },
        limit: 5,
      });
      return rows?.length ? rows[0] : undefined;
    }, 'the inbox row the lead-time sweep delivers');

    // The BODY, not "a notification happened": a template resolving to nothing
    // still emits a notification, and the inline path this replaced could not
    // fail this way.
    expect(row.title).toBe(TASK_SUBJECT);
    expect(row.body_md).toBe(`This is now on your list. Due ${utcDay(7)}.`);
    expect(row.severity).toBe('info');
    expect(String(row.body_md)).not.toContain('{{');
    // Budget above `waitFor`'s, so a missing delivery fails with the labelled
    // message rather than vitest's generic 5s timeout. Measured green in ~1s.
  }, 20_000);

  it('renders the SAME bundle in zh-CN — which is what this card bought', async () => {
    const rendered = await email.renderTemplate({
      template: 'duly.task_lead_time',
      locale: 'zh-CN',
      data: { subject: TASK_SUBJECT, due_date: utcDay(7) },
    });
    expect(rendered.subject).toBe(TASK_SUBJECT);
    expect(rendered.text).toBe(`这项任务已进入你的待办列表，截止日期 ${utcDay(7)}。`);
  });

  it('leaves the subject and the text body UNESCAPED, and escapes the html', async () => {
    // `renderTemplate` HTML-escapes a `{{hole}}`. The inbox writes the rendered
    // SUBJECT into `title` and the rendered TEXT into `body_md`; neither is an
    // HTML document, so an escaping hole there puts `&#39;` on the screen for
    // every subject with an apostrophe — which `title: '{record.subject}'`
    // never did. `bodyHtml` IS markup and keeps the escaping form.
    const rendered = await email.renderTemplate({
      template: 'duly.task_lead_time',
      locale: 'en',
      data: { subject: TASK_SUBJECT, due_date: utcDay(7) },
    });
    expect(rendered.subject).toBe(TASK_SUBJECT);
    expect(rendered.subject).not.toContain('&#39;');
    expect(rendered.text).not.toContain('&#39;');
    expect(rendered.html).toContain('This is now on your list.');
  });

  it('a name no row declares FAILS LOUDLY rather than rendering nothing', async () => {
    await expect(
      email.renderTemplate({ template: 'duly.task_lead_tim', locale: 'en', data: {} }),
    ).rejects.toThrow(/TEMPLATE_NOT_FOUND/);
  });
});
