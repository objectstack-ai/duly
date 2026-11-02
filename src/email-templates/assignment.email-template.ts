// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineEmailTemplateDefinition } from '@objectstack/spec';
import { EMAIL_TEMPLATE_FLOOR_LOCALE } from '@objectstack/spec/system';

/**
 * The assigner-facing text of the fan-out failure handler
 * (`src/flows/assignment.flow.ts`, the `try_catch` catch region), as a
 * `sys_email_template` bundle.
 *
 * ── Why this bundle exists at all ────────────────────────────────────────
 * A fan-out that quietly drops one of five people is the failure #123 is
 * about, and "the run log records it" is not an answer: the run log is an
 * operator surface and the assigner never opens it. This is the sentence the
 * assigner actually reads, in their inbox, once per assignee who got no task.
 *
 * ── Why the words are here and not on the notify node ────────────────────
 * The same reason as `reminders.email-template.ts`: `NotifyConfigSchema`
 * makes inline `title`/`message` and `template` mutually exclusive, and the
 * inline path is the one its own `.describe()` calls "not localizable".
 * AGENTS.md §8 ("English is the source language … do not hard-code display
 * text in a hook or flow") is only satisfiable on the template path. Two rows
 * — English and `zh-CN`. The English row is tagged `en-US`, the resolver's
 * floor, not the app's own `en`: see `reminders.email-template.ts` for why a
 * bundle without that exact tag dead-letters every recipient locale it does
 * not carry (#145).
 *
 * ── `{{{…}}}` in `subject` / `bodyText`, `{{…}}` in `bodyHtml` ───────────
 * Measured and pinned by `test/email-templates.test.ts`: `renderTemplate`
 * HTML-escapes a `{{hole}}` and leaves a `{{{hole}}}` raw. The inbox channel
 * writes the rendered subject into `sys_inbox_message.title` and the rendered
 * TEXT into `body_md` — neither is an HTML document — so an assignment whose
 * subject carries an apostrophe would otherwise put `&#39;` on the assigner's
 * screen. `bodyHtml` IS markup and keeps the escaping form.
 *
 * ── Why only `subject` is a REQUIRED variable ────────────────────────────
 * `required: true` is enforced at render (`requireVars` → `MISSING_VARIABLES`,
 * which the inbox channel classifies as PERMANENT — a dead delivery, not a
 * retry). So it is declared only where the value is guaranteed:
 * `duly_assignment.subject` is `required: true` on the object.
 *
 * `assignee` is deliberately NOT required, and that is the whole point of this
 * notification rather than an oversight. The commonest bad row is an assignee
 * entry that is itself blank — the "missing owner" shape — and a hole declared
 * required would then dead-letter the one message whose job is to report it.
 * The reason line carries the diagnosis in that case, and the click-through
 * lands on the assignment where the assignee list can be read directly.
 *
 * ── Two more bundles: an account that is gone, an account that is banned ─
 * Since #148 the fan-out refuses an assignee whose account was removed or is
 * banned, by writing no owner. The engine's reason for that is "Owner is
 * required" — true, and no help to the assigner, who has to replace the name
 * or restore the account. So those two causes get their own bundles, whose
 * text names the cause and the remedy and carries no engine reason (#160).
 *
 * They are separate NAMES rather than a cause variable inside the bundle
 * above because, on @objectstack 18.2.0, the renderer has no conditional:
 * it fills `{{path}}` / `{{path | formatter}}` holes and nothing else, so a
 * row cannot print one sentence for one cause and another for the rest. The
 * flow picks the bundle instead (`src/flows/assignment.flow.ts`, #160). All
 * three are delivered under the one topic, `duly.assignment_fanout_failed`.
 *
 * The remedy ends in "save the assignment again" on purpose: restoring an
 * account or lifting a ban fires nothing, and it is the re-save that fans out
 * and creates exactly the missing task.
 */

/** Declared render inputs. One place, so the two rows cannot drift. */
const FANOUT_FAILURE_VARIABLES = [
  {
    name: 'subject',
    type: 'string' as const,
    required: true,
    description: "The assignment's subject — duly_assignment.subject, required on the object.",
  },
  {
    name: 'assignee',
    type: 'string' as const,
    required: false,
    description:
      'The assignee handle the fan-out was iterating when it failed. Blank when the '
      + 'assignee entry itself is the defect, which is why this is not required.',
  },
  {
    name: 'reason',
    type: 'string' as const,
    required: false,
    description: "The engine's own failure sentence, naming the flow node that failed.",
  },
];

export const AssignmentFanoutFailedEn = defineEmailTemplateDefinition({
  name: 'duly.assignment_fanout_failed',
  label: 'Assignment fan-out could not reach one assignee',
  locale: EMAIL_TEMPLATE_FLOOR_LOCALE,
  subject: 'No task was created for one assignee: {{{subject}}}',
  bodyHtml:
    '<p>Everyone else on this assignment has their task. This one did not get created,'
    + ' so nobody is holding it.</p>'
    + '<p>Assignee: {{assignee}}<br />Reason: {{reason}}</p>',
  bodyText:
    'Everyone else on this assignment has their task. This one did not get created, so'
    + ' nobody is holding it.\nAssignee: {{{assignee}}}\nReason: {{{reason}}}',
  variables: FANOUT_FAILURE_VARIABLES,
  description:
    'Sent to the assigner, once per assignee the fan-out could not create a task for. '
    + 'The rest of the fan-out completed.',
});

export const AssignmentFanoutFailedZhCN = defineEmailTemplateDefinition({
  name: 'duly.assignment_fanout_failed',
  label: '指派分发未能覆盖某位成员',
  locale: 'zh-CN',
  subject: '有一位成员没有生成任务：{{{subject}}}',
  bodyHtml:
    '<p>这项指派中其他人的任务都已生成，只有这一条没有创建成功，因此目前无人承担。</p>'
    + '<p>成员：{{assignee}}<br />原因：{{reason}}</p>',
  bodyText:
    '这项指派中其他人的任务都已生成，只有这一条没有创建成功，因此目前无人承担。\n'
    + '成员：{{{assignee}}}\n原因：{{{reason}}}',
  variables: FANOUT_FAILURE_VARIABLES,
  description: '每有一位成员未能生成任务，就向指派人发送一次；分发的其余部分已正常完成。',
});

/**
 * Declared render inputs of the two account bundles: the generic bundle's
 * minus `reason`, which these rows never print. `assignee` stays optional for
 * the same reason as above — a hole declared required can dead-letter the one
 * message whose job is to report the row.
 */
const ACCOUNT_REFUSAL_VARIABLES = FANOUT_FAILURE_VARIABLES.filter((v) => v.name !== 'reason');

export const AssignmentFanoutAccountRemovedEn = defineEmailTemplateDefinition({
  name: 'duly.assignment_fanout_account_removed',
  label: "Assignment fan-out skipped an assignee whose account no longer exists",
  locale: EMAIL_TEMPLATE_FLOOR_LOCALE,
  subject: 'No task was created for one assignee: {{{subject}}}',
  bodyHtml:
    '<p>Everyone else on this assignment has their task. This one did not get created,'
    + ' so nobody is holding it.</p>'
    + '<p>Assignee: {{assignee}}<br />'
    + "Reason: this person's account no longer exists, so nobody could open a task assigned to it.</p>"
    + '<p>To fix it, replace them on the assignment or restore their account, then save the'
    + ' assignment again. Only the missing task is created.</p>',
  bodyText:
    'Everyone else on this assignment has their task. This one did not get created, so'
    + ' nobody is holding it.\nAssignee: {{{assignee}}}\n'
    + "Reason: this person's account no longer exists, so nobody could open a task assigned to it.\n"
    + 'To fix it, replace them on the assignment or restore their account, then save the'
    + ' assignment again. Only the missing task is created.',
  variables: ACCOUNT_REFUSAL_VARIABLES,
  description:
    'Sent to the assigner, once per assignee whose account no longer exists. '
    + 'The rest of the fan-out completed.',
});

export const AssignmentFanoutAccountRemovedZhCN = defineEmailTemplateDefinition({
  name: 'duly.assignment_fanout_account_removed',
  label: '指派分发跳过了账号已不存在的成员',
  locale: 'zh-CN',
  subject: '有一位成员没有生成任务：{{{subject}}}',
  bodyHtml:
    '<p>这项指派中其他人的任务都已生成，只有这一条没有创建成功，因此目前无人承担。</p>'
    + '<p>成员：{{assignee}}<br />原因：该成员的账号已不存在，分配给这个账号的任务没有人能打开。</p>'
    + '<p>处理办法：在指派中换成其他成员，或恢复该账号，然后重新保存指派。只会补建缺少的那一条任务。</p>',
  bodyText:
    '这项指派中其他人的任务都已生成，只有这一条没有创建成功，因此目前无人承担。\n'
    + '成员：{{{assignee}}}\n原因：该成员的账号已不存在，分配给这个账号的任务没有人能打开。\n'
    + '处理办法：在指派中换成其他成员，或恢复该账号，然后重新保存指派。只会补建缺少的那一条任务。',
  variables: ACCOUNT_REFUSAL_VARIABLES,
  description: '每有一位成员因账号已不存在而未能生成任务，就向指派人发送一次；分发的其余部分已正常完成。',
});

export const AssignmentFanoutAccountBannedEn = defineEmailTemplateDefinition({
  name: 'duly.assignment_fanout_account_banned',
  label: 'Assignment fan-out skipped an assignee whose account is banned',
  locale: EMAIL_TEMPLATE_FLOOR_LOCALE,
  subject: 'No task was created for one assignee: {{{subject}}}',
  bodyHtml:
    '<p>Everyone else on this assignment has their task. This one did not get created,'
    + ' so nobody is holding it.</p>'
    + '<p>Assignee: {{assignee}}<br />'
    + "Reason: this person's account is banned, so they cannot sign in to open a task.</p>"
    + '<p>To fix it, replace them on the assignment or restore their account by lifting the ban,'
    + ' then save the assignment again. Only the missing task is created.</p>',
  bodyText:
    'Everyone else on this assignment has their task. This one did not get created, so'
    + ' nobody is holding it.\nAssignee: {{{assignee}}}\n'
    + "Reason: this person's account is banned, so they cannot sign in to open a task.\n"
    + 'To fix it, replace them on the assignment or restore their account by lifting the ban,'
    + ' then save the assignment again. Only the missing task is created.',
  variables: ACCOUNT_REFUSAL_VARIABLES,
  description:
    'Sent to the assigner, once per assignee whose account is banned. '
    + 'The rest of the fan-out completed.',
});

export const AssignmentFanoutAccountBannedZhCN = defineEmailTemplateDefinition({
  name: 'duly.assignment_fanout_account_banned',
  label: '指派分发跳过了账号被封禁的成员',
  locale: 'zh-CN',
  subject: '有一位成员没有生成任务：{{{subject}}}',
  bodyHtml:
    '<p>这项指派中其他人的任务都已生成，只有这一条没有创建成功，因此目前无人承担。</p>'
    + '<p>成员：{{assignee}}<br />原因：该成员的账号已被封禁，无法登录打开任务。</p>'
    + '<p>处理办法：在指派中换成其他成员，或解除封禁以恢复该账号，然后重新保存指派。只会补建缺少的那一条任务。</p>',
  bodyText:
    '这项指派中其他人的任务都已生成，只有这一条没有创建成功，因此目前无人承担。\n'
    + '成员：{{{assignee}}}\n原因：该成员的账号已被封禁，无法登录打开任务。\n'
    + '处理办法：在指派中换成其他成员，或解除封禁以恢复该账号，然后重新保存指派。只会补建缺少的那一条任务。',
  variables: ACCOUNT_REFUSAL_VARIABLES,
  description: '每有一位成员因账号被封禁而未能生成任务，就向指派人发送一次；分发的其余部分已正常完成。',
});

export const dulyAssignmentEmailTemplates = [
  AssignmentFanoutFailedEn,
  AssignmentFanoutFailedZhCN,
  AssignmentFanoutAccountRemovedEn,
  AssignmentFanoutAccountRemovedZhCN,
  AssignmentFanoutAccountBannedEn,
  AssignmentFanoutAccountBannedZhCN,
];
