// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Barrel for src/email-templates/.
//
// Every metadata directory is pre-created and already wired into
// objectstack.config.ts — including the empty ones — so a feature branch adds
// its entry HERE and never edits the config. The config is the one file every
// parallel task would otherwise collide on.
//
// The collection is a named array rather than `Object.values(barrel)`: on an
// empty namespace `Object.values` has nothing to infer from and TypeScript
// resolves it against the keyed branch of `MetadataCollectionInput`, which
// makes `name` optional and fails the assignment. A named array is `never[]`
// while empty and infers correctly the moment something is pushed into it.
//
// ── What a member of this collection is ─────────────────────────────────
// ONE `(name, locale)` ROW, not one template. A template "bundle" is the set
// of rows sharing a `name`: `IEmailService` resolves `(name, locale)` at
// delivery and renders the row it picks, so `duly.task_lead_time` appears
// here twice — once as `en`, once as `zh-CN`. Adding a locale is adding an
// entry to this array, never editing an existing one.

import {
  TaskDueSoonReminderEn,
  TaskDueSoonReminderZhCN,
  TaskLeadTimeReminderEn,
  TaskLeadTimeReminderZhCN,
  TaskOverdueEscalationEn,
  TaskOverdueEscalationZhCN,
  dulyReminderEmailTemplates,
} from './reminders.email-template.js';

export {
  TaskLeadTimeReminderEn,
  TaskLeadTimeReminderZhCN,
  TaskDueSoonReminderEn,
  TaskDueSoonReminderZhCN,
  TaskOverdueEscalationEn,
  TaskOverdueEscalationZhCN,
  dulyReminderEmailTemplates,
};

export const dulyEmailTemplates = [...dulyReminderEmailTemplates];
