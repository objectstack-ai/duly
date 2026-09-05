// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineEmailTemplateDefinition } from '@objectstack/spec';

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
 * — `en` and `zh-CN` — which is exactly the pair `objectstack.config.ts`
 * declares in `i18n.supportedLocales`.
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
  category: 'notification',
  locale: 'en',
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
  category: 'notification',
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

export const dulyAssignmentEmailTemplates = [
  AssignmentFanoutFailedEn,
  AssignmentFanoutFailedZhCN,
];
