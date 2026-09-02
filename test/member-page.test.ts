// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

// The member page's own SOURCE TEXT, comments included — see the grep below
// for why the text and not the parsed object. `?raw` is Vite's text import,
// which vitest resolves natively; `test/raw-import.d.ts` declares it for tsc.
import PAGE_SOURCE from '../src/pages/member.page.ts?raw';

import { MemberPage } from '../src/pages/member.page.js';
import { dulyPages } from '../src/pages/index.js';
import { dulyApps } from '../src/apps/index.js';
import { Assignment, Duty, Task } from '../src/objects/index.js';
import { ManagerPermissionSet, MemberPermissionSet, AdminPermissionSet } from '../src/security/index.js';

/**
 * `duly_member` — the member detail page.
 *
 * ── These assert the AUTHORED page, never resolved rows ──────────────────
 * Same reason `test/security.test.ts` gives, and it is not a convenience: every
 * list on this page reads `duly_task` / `duly_duty`, both `sharingModel:
 * 'private'`, both granted to managers at `readScope: 'unit_and_below'`. This
 * checkout runs the OPEN edition — `@objectstack/security-enterprise` is absent
 * — so those depths fall back to owner-only and every one of these lists is
 * empty for anyone but themselves. A test that booted a kernel and counted rows
 * would be measuring the edition, and it would keep passing on the day somebody
 * deleted a filter. What a page IS, is its declaration; so this walks it.
 *
 * ── What each group is actually pinning ──────────────────────────────────
 * The four "not on this page" rules from the card are product invariants, and
 * each fails SILENTLY if broken: a log-entry count reads as a helpful number, a
 * "+ New" button reads as a feature, a peer comparison reads as a dashboard.
 * None of them turns anything red on its own. That is what this file is for.
 */

type Rec = Record<string, unknown>;

const page = MemberPage as unknown as Rec;
const regions = page.regions as Array<{ name: string; components: Rec[] }>;
const components: Rec[] = regions.flatMap((region) => region.components);
const props = (component: Rec): Rec => (component.properties ?? {}) as Rec;
const byId = (id: string): Rec => {
  const found = components.find((component) => component.id === id);
  if (!found) throw new Error(`no component with id ${id} on duly_member`);
  return found;
};
/** Every `record:related_list` on the page, in reading order. */
const relatedLists = components.filter((component) => component.type === 'record:related_list');
/** A filter rule's value, by field, on one related list. */
const ruleFor = (component: Rec, field: string): Rec | undefined =>
  ((props(component).filter as Rec[] | undefined) ?? []).find((rule) => rule.field === field);

// ─── It is wired, and it is the shape that carries record context ────────

describe('duly_member — wiring', () => {
  it('is in the pages barrel', () => {
    // A page not in its own barrel is dead metadata: it type-checks, it reads
    // as wired, and the runtime never loads it (AGENTS.md rule 2).
    expect(dulyPages).toContain(MemberPage);
  });

  it('is a record page bound to sys_user', () => {
    // The binding is the whole design. `record:related_list` is the only
    // authorable component that scopes itself to the record in context, and it
    // only has a context on a `type: 'record'` page.
    expect(page.type).toBe('record');
    expect(page.object).toBe('sys_user');
  });

  it('is `full`, not `slotted` — the synthesizer would add the work log', () => {
    // Not a style preference. A slotted page falls through to
    // `buildDefaultPageSchema`, whose `tabs` synthesizer emits one related list
    // per object holding an FK to `sys_user` — which on this stack includes
    // `duly_log_entry.owner`. The one object this page must never show is the
    // one the default layout adds for free.
    expect(page.kind).toBe('full');
    expect(page.slots).toBeUndefined();
    expect(regions.length).toBeGreaterThan(0);
  });

  it('does not claim to be the default page for sys_user', () => {
    // `@objectstack/platform-objects` ships `sys_user_detail` with
    // `isDefault: true` for this same object, and `usePageAssignment` breaks
    // the tie on a `priority` key `PageSchema` does not declare — so an author
    // cannot write the tiebreaker the renderer reads. Two pages both claiming
    // the default would make the flag a lie on whichever one loses; this one
    // does not claim it. See the page's gap §5.
    expect(page.isDefault).toBe(false);
  });

  it('is reachable from the Team nav group', () => {
    const app = (dulyApps as Rec[])[0] as { navigation: Array<Rec & { children?: Rec[] }> };
    const team = app.navigation.find((group) => group.id === 'group_team');
    expect(team, 'the Team nav group').toBeDefined();
    const people = (team!.children ?? []).find((item) => item.id === 'nav_people');
    expect(people, 'the People entry that opens a person').toBeDefined();
    // A record page is reached by opening a RECORD, so the entry is the people
    // list. `requiresObject` is what lets nav name a runtime-provided object at
    // all — without it `defineStack` refuses the whole stack, because the
    // cross-reference check resolves `objectName` against `config.objects` only.
    expect(people!.type).toBe('object');
    expect(people!.objectName).toBe('sys_user');
    expect(people!.requiresObject).toBe('sys_user');
  });

  it('every component carries a stable id', () => {
    // Bundle keys are `pages.duly_member.components.<id>.title`. A component
    // without an id is addressed by nothing, so its title can never be
    // translated — and the i18n gate cannot see the hole, because a key that
    // was never derived is not a key that went missing.
    expect(components.filter((component) => typeof component.id !== 'string')).toEqual([]);
    const ids = components.map((component) => component.id);
    expect(new Set(ids).size, 'two components share an id').toBe(ids.length);
  });
});

// ─── ⛔ The work log is not on this page, in any form ─────────────────────

describe('duly_member — `duly_log_entry` is absent', () => {
  it('is not named anywhere in the source', () => {
    // A GREP, deliberately, and not a walk of the parsed page. The rule is not
    // "no list is bound to it" — it is that a manager must not learn the log
    // exists. A count, a `visibleWhen` mentioning it, a comment promising to
    // add it later: all of them are how the next author decides it is fine.
    // `readScope: 'own'` on the object is the enforcement; this is the promise.
    expect(PAGE_SOURCE.includes('duly_log_entry')).toBe(false);
  });

  it('binds no component to it', () => {
    // The parsed half of the same rule, so a renamed object or a computed
    // string cannot slip past the grep above.
    const objects = components
      .map((component) => props(component).objectName)
      .filter((name): name is string => typeof name === 'string');
    expect(objects).not.toContain('duly_log_entry');
    // And positively: the page reads these three and nothing else.
    expect([...new Set(objects)].sort()).toEqual(['duly_duty', 'duly_task', 'sys_user_position']);
  });
});

// ─── ⛔ Nothing on the page is editable (the authorable half) ─────────────

describe('duly_member — read-only', () => {
  /**
   * The component types that write. `record:details` is on the list because its
   * `inlineEdit` defaults ON wherever the object itself is editable — declaring
   * the component is enough to make the page editable, no key required.
   */
  const WRITING_TYPES = [
    'record:details',
    'record:quick_actions',
    'element:form',
    'element:button',
    'element:text_input',
    'element:record_picker',
  ];

  it('declares no component type that writes', () => {
    const offenders = components
      .map((component) => String(component.type))
      .filter((type) => WRITING_TYPES.includes(type));
    expect(offenders).toEqual([]);
  });

  it('shuts the discussion panel rather than letting the host append one', () => {
    // `record:chatter` / `record:discussion` is NOT on the list above, and that
    // is the whole subtlety of gap §7. `RecordDetailView` appends a chatter
    // panel — comment box, reactions, threaded replies, all hard-coded on — to
    // every record page whose object does not set `enable.feeds: false`.
    // `sys_user` is a locked platform object so that switch is not ours, and
    // the renderer's own `disableDiscussion` opt-out is not a `PageSchema` key.
    // Declaring the component is the ONLY way to own its configuration, so the
    // page declares exactly one, with every write off. Removing this node does
    // not remove the panel — it hands it back to the host with the writes ON,
    // which is why this is pinned as a positive assertion and not an absence.
    const discussions = components.filter((component) =>
      component.type === 'record:discussion' || component.type === 'record:chatter');
    expect(discussions.length, 'exactly one, or the host appends its own').toBe(1);
    const feed = (props(discussions[0]!).feed ?? {}) as Rec;
    expect(feed.showCommentInput, 'a comment box on a person\'s record').toBe(false);
    expect(feed.enableReactions, 'a reaction is a write').toBe(false);
    expect(feed.enableThreading, 'a reply is a write').toBe(false);
  });

  it('offers no add-existing picker and no row actions', () => {
    // The two write affordances a related list CAN be told not to offer.
    for (const list of relatedLists) {
      expect(props(list).add, `${String(list.id)} declares an Add picker`).toBeUndefined();
      expect(props(list).actions, `${String(list.id)} declares row actions`).toBeUndefined();
    }
  });

  it('marks every highlight chip readonly', () => {
    // `readonly: true` is the enforced half: `HeaderHighlight` refuses inline
    // editing on a chip carrying it. A bare field name would be editable.
    const highlights = components.filter((component) => component.type === 'record:highlights');
    expect(highlights.length).toBe(1);
    const fields = props(highlights[0]!).fields as Array<Rec>;
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.readonly, `${String(field.name)} is an editable chip`).toBe(true);
    }
  });

  it('records the residue it cannot close — the host-resolved "+ New"', () => {
    // NOT a pass for the gap: a pin on the page's own account of it, so the
    // note cannot be deleted while the gap is open. A related list's create /
    // edit / delete affordances are resolved by the host from the CHILD
    // object's `userActions` and the principal's grant, and `duly_task` grants
    // `allowCreate` to every Duly position — so the page can be shown a "+ New"
    // it has no key to decline. When a page-level switch lands, this assertion
    // is what tells the next author to use it and delete the note.
    expect(MemberPermissionSet.objects?.duly_task?.allowCreate).toBe(true);
    expect(ManagerPermissionSet.objects?.duly_task?.allowCreate).toBe(true);
    expect(AdminPermissionSet.objects?.duly_task?.allowCreate).toBe(true);
    expect(PAGE_SOURCE).toContain('§3 — A page cannot declare its related lists read-only');
  });
});

// ─── ⛔ No comparison to other people ─────────────────────────────────────

describe('duly_member — no comparison to peers', () => {
  it('renders no aggregate element at all', () => {
    // `element:number` is the only component that renders a computed figure,
    // and it cannot be scoped to the record anyway (gap §1) — so one here would
    // be counting the whole org beside this person's name, which is the
    // comparison the card forbids, arrived at by accident.
    const aggregates = components.filter((component) =>
      String(component.type).startsWith('element:number')
      || String(component.type) === 'object-metric');
    expect(aggregates).toEqual([]);
  });

  it('binds nothing to another person', () => {
    // Every data-bearing component is scoped to THIS record through
    // `relationshipField`, and none carries a filter naming a user — no
    // `{current_user_id}` (that is the VIEWER, not the person being read), no
    // hard-coded owner, no unit-wide slice to rank this person inside.
    for (const list of relatedLists) {
      expect(props(list).relationshipField, `${String(list.id)} is unbound`).toBeTruthy();
      const rules = (props(list).filter as Rec[] | undefined) ?? [];
      for (const rule of rules) {
        expect(
          JSON.stringify(rule.value).includes('current_user_id'),
          `${String(list.id)} filters on the viewer, not the record`,
        ).toBe(false);
      }
    }
  });
});

// ─── The six sections, in reading order ──────────────────────────────────

describe('duly_member — content', () => {
  it('reads in the order the card asks for', () => {
    // Reading order IS the design: a manager scans down and stops when they
    // have what they came for. Pinned as the sequence of data-bearing and
    // heading components, so a reordering is a deliberate edit rather than a
    // diff nobody notices.
    const spine = components
      .filter((component) => component.type !== 'element:divider')
      .map((component) => String(component.id));
    expect(spine).toEqual([
      // 1. Header — who this is
      'member_identity',
      'member_position',
      // 2. Right now
      'heading_right_now',
      'right_now_note',
      'right_now_open',
      'right_now_late',
      'right_now_stalled',
      // 3. This period
      'heading_this_period',
      'this_period_note',
      'this_period_duties',
      // 4. Standing duties
      'heading_standing',
      'standing_note',
      'standing_duties',
      // 5. Recent activity
      'heading_recent',
      'recent_activity',
      // 6. Assigned to them
      'heading_assigned',
      'assigned_tasks',
      // Not a section — the shut discussion panel (gap §7).
      'member_history',
    ]);
  });

  it('heads the page with the person, not with their numbers', () => {
    const identity = byId('member_identity');
    expect(identity.type).toBe('record:highlights');
    expect((props(identity).fields as Rec[]).map((field) => field.name))
      .toEqual(['name', 'primary_business_unit_id', 'manager_id']);
    // Position is the fourth thing the header owes and is NOT a column on
    // `sys_user`: it is assigned through the `sys_user_position` junction,
    // whose `position` holds `sys_position.name`. A junction is a related list
    // or it is nothing.
    const position = byId('member_position');
    expect(props(position).objectName).toBe('sys_user_position');
    expect(props(position).relationshipField).toBe('user_id');
  });

  it('asks `status` and dates directly, never a stored flag', () => {
    // AGENTS.md rule 5. There is no `is_late` / `is_open` to filter on, and a
    // filter naming a formula field silently matches nothing — so the three
    // "Right now" lenses have to be built out of stored, indexed columns.
    const stored = new Set(Object.keys(Task.fields));
    for (const list of relatedLists.filter((l) => props(l).objectName === 'duly_task')) {
      for (const rule of ((props(list).filter as Rec[] | undefined) ?? [])) {
        expect(stored.has(String(rule.field)), `${String(rule.field)} is not a stored column`).toBe(true);
      }
    }
  });

  it('measures "late" against the grace the duty granted, like the `late` view', () => {
    // One person must not be late on this page and on time on the Late list.
    // Both read `late_after` — `due_date + duty.grace_days` stamped once at
    // dispatch — which is what #48 settled.
    const late = byId('right_now_late');
    expect(ruleFor(late, 'late_after')).toEqual({
      field: 'late_after',
      operator: 'less_than',
      value: '{today}',
    });
    expect(ruleFor(late, 'status')?.value).toEqual(['open', 'in_progress']);
    // And it SHOWS the column it judged on: a list that will not tell you why
    // it thinks a task is late is the complaint #48 was about.
    expect(props(late).columns).toContain('late_after');
  });

  it('calls stagnation the same fortnight the `stalled` view does', () => {
    const stalled = byId('right_now_stalled');
    expect(ruleFor(stalled, 'last_update_at')).toEqual({
      field: 'last_update_at',
      operator: 'less_than',
      value: '{14_days_ago}',
    });
    expect(ruleFor(stalled, 'status')?.value).toEqual(['open', 'in_progress']);
  });

  it('emphasises the third number, which is the one that fires early', () => {
    // "Not moving" is the only one of the three that warns before a deadline
    // exists, so it is the one the card asks to be emphasised. ADR-0065 scoped
    // styles, because an authored Tailwind `className` produces no CSS on a
    // metadata page — the build-time Tailwind never scans runtime metadata.
    const stalled = byId('right_now_stalled');
    expect(stalled.responsiveStyles, 'the emphasis was dropped').toBeTruthy();
    expect(byId('right_now_open').responsiveStyles).toBeUndefined();
    expect(byId('right_now_late').responsiveStyles).toBeUndefined();
  });

  it('counts only GOVERNED duties for the period, never self-declared ones', () => {
    // `source` is the caliber column, and `self` is the person's own
    // record-keeping — surfaced to them, never scored or read up the line.
    const period = byId('this_period_duties');
    expect(props(period).objectName).toBe('duly_duty');
    expect(props(period).relationshipField).toBe('owner');
    expect(ruleFor(period, 'source')?.value).toEqual(['catalog', 'assigned']);
    expect(ruleFor(period, 'form')?.value).toBe('recurring');
    // Frequency leads and sorts, which is as close to "grouped by frequency" as
    // `record:related_list` gets — it has no `groupBy` (gap §2). If that ever
    // becomes authorable, this is the assertion that should change.
    expect((props(period).columns as string[])[0]).toBe('frequency');
    expect((props(period).sort as Rec[])[0]).toEqual({ field: 'frequency', order: 'asc' });
  });

  it('lists standing duties from `form`, not through tasks, and offers no tick', () => {
    const standing = byId('standing_duties');
    expect(props(standing).objectName).toBe('duly_duty');
    expect(ruleFor(standing, 'form')).toEqual({ field: 'form', operator: 'equals', value: 'standing' });
    // A standing duty generates no task BY CONSTRUCTION, so a task-side query
    // would return nothing and read as "this person holds none".
    expect(props(standing).objectName).not.toBe('duly_task');
    // `standing` is a real option on the object — a filter naming a value the
    // select does not carry matches nothing, silently.
    const forms = (Duty.fields.form as unknown as { options: Array<{ value: string }> }).options;
    expect(forms.map((option) => option.value)).toContain('standing');
    // No completion affordance anywhere near them, and no `status` column
    // either: `duly_duty.status` is active/paused/retired — lifecycle, not
    // completion — and putting it beside these rows invites reading a state
    // machine into work that has none.
    expect(props(standing).columns).not.toContain('status');
    expect(props(standing).add).toBeUndefined();
    expect(props(standing).actions).toBeUndefined();
  });

  it('shows the last 20 task events by `last_update_at`', () => {
    const recent = byId('recent_activity');
    expect(props(recent).objectName).toBe('duly_task');
    expect(props(recent).limit).toBe(20);
    expect(props(recent).sort).toEqual([{ field: 'last_update_at', order: 'desc' }]);
    // No status filter: "what has moved" includes what moved into done,
    // skipped and cancelled, which is what a manager is looking for.
    expect(props(recent).filter).toBeUndefined();
  });

  it('shows assigned work AND who assigned it', () => {
    const tasks = byId('assigned_tasks');
    expect(ruleFor(tasks, 'source')).toEqual({ field: 'source', operator: 'equals', value: 'assigned' });
    // `assigned` is a real option on `duly_task.source`.
    const sources = (Task.fields.source as unknown as { options: Array<{ value: string }> }).options;
    expect(sources.map((option) => option.value)).toContain('assigned');

    // …and the `assignment` column, which is as close to "who assigned each"
    // as this page can get. Both routes to `duly_assignment.assigner` are
    // closed: a related-list column cannot cross a lookup (gap §4), and a
    // related list bound on `assignees` is refused by the driver, because
    // `RelatedList` builds its parent filter as bare equality and `assignees`
    // is `multiple: true` (gap §6 — measured, 400 INVALID_FILTER).
    expect(props(tasks).columns).toContain('assignment');
    expect(Object.keys(Assignment.fields)).toContain('assigner');
    expect((Assignment.fields.assignees as unknown as { multiple?: boolean }).multiple).toBe(true);
    // The pin on the gap: no list on this page binds a multi-value field, and
    // the page says why. Delete this when a membership binding lands.
    for (const list of relatedLists) {
      expect(props(list).relationshipField, 'a related list bound to a multi-value field')
        .not.toBe('assignees');
    }
    expect(PAGE_SOURCE).toContain('§6 — `record:related_list` cannot bind to a multi-value field');
  });
});

// ─── Every binding names something real ──────────────────────────────────

describe('duly_member — no dangling binding', () => {
  const DECLARED: Record<string, ReadonlySet<string>> = {
    duly_task: new Set(Object.keys(Task.fields)),
    duly_duty: new Set(Object.keys(Duty.fields)),
    duly_assignment: new Set(Object.keys(Assignment.fields)),
  };

  it('every column, filter field and sort key resolves on its own object', () => {
    // The page half of what `test/metadata-bindings.test.ts` does for views and
    // nav. Field paths are resolved at author time NOWHERE in the UI layer, so
    // `pnpm validate` and `pnpm build` both exit 0 on a misspelt related-list
    // column — it renders an empty column and reports success.
    //
    // `sys_user_position` is a PLATFORM object: nothing on disk carries its
    // field set, so its bindings are a boundary rather than a resolution and
    // are deliberately not judged here (the same narrowing `metadata-bindings`
    // states for a hop into `sys_user`).
    const findings: string[] = [];
    for (const list of relatedLists) {
      const object = String(props(list).objectName);
      const fields = DECLARED[object];
      if (!fields) continue;
      const referenced: string[] = [
        ...((props(list).columns as string[] | undefined) ?? []),
        ...((props(list).filter as Rec[] | undefined) ?? []).map((rule) => String(rule.field)),
        ...((props(list).sort as Rec[] | undefined) ?? []).map((rule) => String(rule.field)),
        String(props(list).relationshipField),
      ];
      for (const field of referenced) {
        if (!fields.has(field)) findings.push(`${String(list.id)} · ${object}.${field}`);
      }
    }
    expect(findings, 'a related-list binding that names no declared field').toEqual([]);
  });
});
