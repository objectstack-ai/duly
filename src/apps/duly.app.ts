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
