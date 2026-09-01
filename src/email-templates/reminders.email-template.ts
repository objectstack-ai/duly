// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineEmailTemplateDefinition } from '@objectstack/spec';

/**
 * The notification text of the three owner-facing reminder sweeps
 * (`src/flows/reminders.flow.ts`), as `sys_email_template` bundles.
 *
 * ── Why the text lives here and not on the notify node ───────────────────
 * A `notify` node has exactly two content paths and `NotifyConfigSchema`'s
 * `superRefine` makes them mutually exclusive:
 *
 *  - inline `title` + `message` — sent to every recipient verbatim. The
 *    schema's own `.describe()` calls this "not localizable".
 *  - `template` — names a bundle here; the delivery path resolves
 *    `(name, locale)` per delivery and renders subject/body from the row it
 *    picks.
 *
 * AGENTS.md §8 ("English is the source language … do not hard-code display
 * text in a hook or flow") is only satisfiable on the second path, so the
 * three sweeps' strings live here. Each name carries TWO rows — `en` and
 * `zh-CN` — which is what a template "bundle" is: same `name`, one row per
 * locale, exactly the two locales `objectstack.config.ts` declares in
 * `i18n.supportedLocales`.
 *
 * ── Why `{{{…}}}` in `subject` / `bodyText` and `{{…}}` in `bodyHtml` ────
 * `renderTemplate` HTML-escapes a `{{hole}}` and leaves a `{{{hole}}}` raw
 * (`template-engine.ts`). Measured on `@objectstack/plugin-email` 17.2.0 with
 * `subject: "Owner's monthly return"`:
 *
 *     subject: '{{subject}}'    →  Owner&#39;s monthly return
 *     subject: '{{{subject}}}'  →  Owner's monthly return
 *
 * The inbox channel writes the rendered SUBJECT into `sys_inbox_message.title`
 * and the rendered TEXT into `body_md` — neither is an HTML document — so the
 * escaping form would put entities on the screen for any duty whose subject
 * contains an apostrophe or an `&`, which the inline `title: '{record.subject}'`
 * it replaces never did. `bodyHtml` IS markup and keeps the escaping form.
 * `test/email-templates.test.ts` pins both halves.
 *
 * ── `bodyText` is authored, not derived ──────────────────────────────────
 * With `bodyText` omitted the service derives the text alternative by
 * stripping tags from `bodyHtml`. The inbox body is the DERIVED string, so
 * leaving it out would make the in-app notification a side effect of the HTML
 * markup. It is authored so the body the owner reads is the string written
 * here — the same sentence the inline `message` sent before this card.
 *
 * ── `variables` ─────────────────────────────────────────────────────────
 * `required: true` is enforced at render (`requireVars` → `MISSING_VARIABLES`,
 * which the inbox channel classifies as PERMANENT — a dead delivery, not a
 * retry). So it is declared only where the object itself already guarantees
 * the value: `duly_task.subject` is `required: true`. `due_date` is NOT
 * required on the object, and a reminder that says "Due ." is worth more to
 * its owner than a reminder that was never delivered — which is exactly what
 * a required-but-absent hole would produce.
 */

/** Shared by all three: the task's own subject line, rendered unescaped. */
const SUBJECT_LINE = '{{{subject}}}';

/** Declared render inputs. Kept in one place so the six rows cannot drift. */
const REMINDER_VARIABLES = [
  {
    name: 'subject',
    type: 'string' as const,
    required: true,
    description: "The task's subject — duly_task.subject, required on the object.",
  },
  {
    name: 'due_date',
    type: 'date' as const,
    required: false,
    description: 'The task due date as stored (ISO-8601). Optional on duly_task.',
  },
];

// ─── 1 · Lead-time reminder ──────────────────────────────────────────────

export const TaskLeadTimeReminderEn = defineEmailTemplateDefinition({
  name: 'duly.task_lead_time',
  label: 'Task lead-time reminder',
  category: 'notification',
  locale: 'en',
  subject: SUBJECT_LINE,
  bodyHtml: '<p>This is now on your list. Due {{due_date}}.</p>',
  bodyText: 'This is now on your list. Due {{{due_date}}}.',
  variables: REMINDER_VARIABLES,
  description: "Sent once, on the day a task crosses visible_from, to the task's owner.",
});

export const TaskLeadTimeReminderZhCN = defineEmailTemplateDefinition({
  name: 'duly.task_lead_time',
  label: '任务提前提醒',
  category: 'notification',
  locale: 'zh-CN',
  subject: SUBJECT_LINE,
  bodyHtml: '<p>这项任务已进入你的待办列表，截止日期 {{due_date}}。</p>',
  bodyText: '这项任务已进入你的待办列表，截止日期 {{{due_date}}}。',
  variables: REMINDER_VARIABLES,
  description: '任务到达 visible_from 当天，向负责人发送一次。',
});

// ─── 2 · Due-soon reminder ───────────────────────────────────────────────

export const TaskDueSoonReminderEn = defineEmailTemplateDefinition({
  name: 'duly.task_due_soon',
  label: 'Task due-soon reminder',
  category: 'notification',
  locale: 'en',
  subject: SUBJECT_LINE,
  bodyHtml: '<p>Due in 2 days, on {{due_date}}.</p>',
  bodyText: 'Due in 2 days, on {{{due_date}}}.',
  variables: REMINDER_VARIABLES,
  description: "Sent once, two days before a task is due, to the task's owner.",
});

export const TaskDueSoonReminderZhCN = defineEmailTemplateDefinition({
  name: 'duly.task_due_soon',
  label: '任务即将到期提醒',
  category: 'notification',
  locale: 'zh-CN',
  subject: SUBJECT_LINE,
  bodyHtml: '<p>还有 2 天到期，截止日期 {{due_date}}。</p>',
  bodyText: '还有 2 天到期，截止日期 {{{due_date}}}。',
  variables: REMINDER_VARIABLES,
  description: '任务到期前两天，向负责人发送一次。',
});

// ─── 3 · Overdue escalation, stage one ───────────────────────────────────

export const TaskOverdueEscalationEn = defineEmailTemplateDefinition({
  name: 'duly.task_overdue',
  label: 'Task overdue escalation — owner',
  category: 'notification',
  locale: 'en',
  subject: SUBJECT_LINE,
  bodyHtml: '<p>Past due since {{due_date}}.</p>',
  bodyText: 'Past due since {{{due_date}}}.',
  variables: REMINDER_VARIABLES,
  description:
    "Sent once, on the first day a task is past due_date plus the duty's grace, to the task's owner.",
});

export const TaskOverdueEscalationZhCN = defineEmailTemplateDefinition({
  name: 'duly.task_overdue',
  label: '任务逾期升级提醒 — 负责人',
  category: 'notification',
  locale: 'zh-CN',
  subject: SUBJECT_LINE,
  bodyHtml: '<p>自 {{due_date}} 起已逾期。</p>',
  bodyText: '自 {{{due_date}}} 起已逾期。',
  variables: REMINDER_VARIABLES,
  description: '任务超过截止日期加宽限期的第一天，向负责人发送一次。',
});

/**
 * Everything in this file, in the same order as `dulyReminderFlows`, so the
 * barrel spreads one name and the pairing with `reminders.flow.ts` stays
 * readable: one flow, one template name, two locale rows.
 */
export const dulyReminderEmailTemplates = [
  TaskLeadTimeReminderEn,
  TaskLeadTimeReminderZhCN,
  TaskDueSoonReminderEn,
  TaskDueSoonReminderZhCN,
  TaskOverdueEscalationEn,
  TaskOverdueEscalationZhCN,
];
