// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { App } from '@objectstack/spec/ui';

/**
 * The Duly app.
 *
 * Navigation is ordered by who uses it, not by the data model: an individual
 * contributor never needs to scroll past a manager's screens to reach their own
 * week, and a manager's section contains exactly one write action (assign).
 */
export const DulyApp = App.create({
  name: 'duly_app',
  label: 'Duly',
  icon: 'clipboard-check',
  branding: {
    primaryColor: '#16515F',
  },

  navigation: [
    {
      id: 'group_me',
      type: 'group',
      label: 'My work',
      icon: 'user-check',
      children: [
        { id: 'nav_my_week', type: 'object', objectName: 'duly_task', viewName: 'my_week', label: 'My week', icon: 'calendar-check' },
        { id: 'nav_my_duties', type: 'object', objectName: 'duly_duty', viewName: 'mine', label: 'My duties', icon: 'clipboard-list' },
        // Directly under "My duties", because it is the same list filtered to
        // the rows that are waiting on this person — to confirm, or to correct
        // and send back up. An unconfirmed duty dispatches nothing, so this is
        // the one entry in the group whose emptiness is the goal.
        { id: 'nav_to_confirm', type: 'object', objectName: 'duly_duty', viewName: 'to_confirm', label: 'To confirm', icon: 'clipboard-check' },
        { id: 'nav_standing', type: 'object', objectName: 'duly_duty', viewName: 'standing', label: 'Standing duties', icon: 'anchor' },
        { id: 'nav_log', type: 'object', objectName: 'duly_log_entry', label: 'Work log', icon: 'notebook-pen' },
        // The board lives HERE, not under Team, and that placement is a
        // product rule rather than taste: dragging a card writes `status`, and
        // managers do not enter status — assigning is their only write. A
        // drag-to-done surface in the manager's section would invite exactly
        // the write the model refuses them.
        { id: 'nav_board', type: 'object', objectName: 'duly_task', viewName: 'board', label: 'Board', icon: 'kanban' },
      ],
    },
    {
      id: 'group_team',
      type: 'group',
      label: 'Team',
      icon: 'users',
      children: [
        // First in the group, and the only non-list entry in it: this is the
        // screen a manager opens to be told what to look at, and every entry
        // below it is a list they go to once it has told them. A `dashboard`
        // nav item carries `dashboardName` (resolved against the dashboards
        // barrel), never an `objectName` — nothing on it is entered.
        { id: 'nav_duty_health', type: 'dashboard', dashboardName: 'duly_duty_health', label: 'Duty health', icon: 'activity' },
        // The way into `duly_member` (`src/pages/member.page.ts`) — "点开任何
        // 一个人看全貌". A record page is reached by opening a RECORD, so the
        // nav entry is the people list, not the page: a `type: 'page'` item
        // routes through objectui's `PageView`, which mounts no
        // `RecordContextProvider`, and every `record:related_list` on that page
        // would then have a null parent and render nothing. Placed directly
        // under the dashboard because the dashboard names who to look at and
        // this is where you go to look at them.
        //
        // `requiresObject` is load-bearing twice over. It is the platform's own
        // idiom for pointing nav at a RUNTIME-provided object, and without it
        // `defineStack` refuses the stack outright: the cross-reference check
        // resolves `objectName` against `config.objects` only, and exempts an
        // entry that declares the dependency. It is also the right runtime
        // behaviour — the entry hides instead of 404-ing where `sys_user` is
        // not registered.
        //
        // `viewName` is load-bearing in the same way, and leaving it off was a
        // real defect (#118). A nav entry with no `viewName` lands on the
        // object's DEFAULT view, and `sys_user`'s default is `me` — "My
        // Profile", filtered `id == {current_user_id}` with `pageSize: 1`. So
        // the manager who followed the dashboard here to look at OTHER PEOPLE
        // saw exactly one row: themselves. `all_users` is the platform's own
        // unfiltered lens (`@objectstack/platform-objects`,
        // `sys_user.listViews.all_users`) — named here rather than redeclared,
        // because the views of a runtime-provided object are not ours to
        // author, and a local copy would drift from the one the platform
        // maintains.
        {
          id: 'nav_people',
          type: 'object',
          objectName: 'sys_user',
          requiresObject: 'sys_user',
          viewName: 'all_users',
          label: 'People',
          icon: 'users-round',
        },
        // A reviewer's queue, and the only entry in this group that is a
        // WRITE surface. It sits with the manager's screens rather than under
        // "My work" for the same reason the board does not: the rows in it
        // belong to other people.
        { id: 'nav_to_review', type: 'object', objectName: 'duly_duty', viewName: 'to_review', label: 'To review', icon: 'clipboard-pen' },
        { id: 'nav_late', type: 'object', objectName: 'duly_task', viewName: 'late', label: 'Late', icon: 'alert-circle' },
        { id: 'nav_stalled', type: 'object', objectName: 'duly_task', viewName: 'stalled', label: 'Not moving', icon: 'pause-circle' },
        { id: 'nav_assignments', type: 'object', objectName: 'duly_assignment', viewName: 'sent_by_me', label: 'Assignments', icon: 'send' },
        { id: 'nav_schedule', type: 'object', objectName: 'duly_task', viewName: 'schedule', label: 'Schedule', icon: 'gantt-chart' },
        { id: 'nav_recent', type: 'object', objectName: 'duly_task', viewName: 'recent', label: 'Recent activity', icon: 'history' },
        { id: 'nav_by_unit', type: 'object', objectName: 'duly_task', viewName: 'by_unit', label: 'By business unit', icon: 'building-2' },
      ],
    },
    {
      id: 'group_setup',
      type: 'group',
      label: 'Setup',
      icon: 'settings',
      children: [
        { id: 'nav_catalog', type: 'object', objectName: 'duly_catalog_item', label: 'Role catalog', icon: 'list-checks' },
        { id: 'nav_all_duties', type: 'object', objectName: 'duly_duty', label: 'All duties', icon: 'library' },
        { id: 'nav_catalog_tree', type: 'object', objectName: 'duly_duty', viewName: 'catalog_tree', label: 'What each team owes', icon: 'folder-tree' },
      ],
    },
  ],
});
