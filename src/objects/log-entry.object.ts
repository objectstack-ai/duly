// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `duly_log_entry` — the personal work log. The calendar, not the checklist.
 *
 * ── Why this is a separate object and not a flag on `duly_task` ──────────
 * The first design put self-logged work in the task list behind a "private"
 * toggle and a handful of rules about what counted. That patches the problem;
 * it does not remove it. As long as one list holds both governed duties and
 * voluntary notes, somebody notices that a fuller list looks better, everybody
 * pads, and the count starts measuring reporting enthusiasm instead of work.
 * The people with the least time to log are the ones doing the most.
 *
 * Two objects make that impossible rather than merely disallowed. Log entries
 * have no due date, no completion, no on-time rate, and no rollup into any
 * comparison — there is nothing here to game. They exist so that at review time
 * a person can produce a year of real record instead of reconstructing it from
 * memory.
 *
 * A good design makes the bad thing impossible. A good rule only makes it
 * against the rules.
 */
export const LogEntry = ObjectSchema.create({
  name: 'duly_log_entry',
  label: 'Log entry',
  pluralLabel: 'Work log',
  icon: 'notebook-pen',
  description: 'Personal record of work done. Never scored, never ranked, never compared.',

  sharingModel: 'private',

  fields: {
    subject: Field.text({ label: 'What you did', required: true, searchable: true, maxLength: 255 }),
    detail: Field.textarea({ label: 'Detail' }),

    owner: Field.user({ label: 'Owner', required: true, defaultValue: 'current_user' }),

    logged_on: Field.date({ label: 'Date', required: true, defaultValue: 'NOW()' }),

    category: Field.select({
      label: 'Category',
      options: [
        { label: 'Cross-team coordination', value: 'coordination' },
        { label: 'Drafting / writing', value: 'drafting' },
        { label: 'Incident / unplanned', value: 'incident' },
        { label: 'Meeting', value: 'meeting' },
        { label: 'Support to others', value: 'support' },
        { label: 'Other', value: 'other', default: true },
      ],
    }),

    visibility: Field.select({
      label: 'Visible to',
      required: true,
      options: [
        { label: 'Only me', value: 'private', color: '#576B73', default: true },
        { label: 'My manager', value: 'manager', color: '#2E7C8E' },
      ],
      description: 'Defaults to private. A log people are afraid of is a log nobody keeps.',
    }),

    related_task: Field.lookup('duly_task', {
      label: 'Related task',
      description: 'Optional. Ties a note to a governed duty without making the note part of its score.',
    }),
  },

  enable: { trackHistory: false, searchable: true, apiEnabled: true, files: true },

  indexes: [{ fields: ['owner', 'logged_on'] }],

  nameField: 'subject',
  highlightFields: ['subject', 'logged_on', 'category', 'visibility'],
});
