// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import type { ObjectAccessScope } from '@objectstack/spec/security';

import {
  AdminPermissionSet,
  AdminPosition,
  DULY_CATALOG_APPLY,
  DULY_CATALOG_SYNC,
  DULY_TASK_UPDATE_STATUS,
  HIERARCHY_SCOPES_DEFERRED,
  ManagerPermissionSet,
  ManagerPosition,
  MemberPermissionSet,
  MemberPosition,
  dulyPermissionSets,
  dulyPositions,
  dulySharingRules,
} from '../src/security/index.js';
import { dulyActions } from '../src/actions/index.js';
import { CatalogItem, Duty, LogEntry, Task, Assignment } from '../src/objects/index.js';

/**
 * These assert the AUTHORED metadata, never the resolved rows.
 *
 * That is not a convenience — it is the only thing that can be asserted here.
 * This checkout runs the open edition, where `@objectstack/security-enterprise`
 * is absent and the ADR-0057 depth scopes cannot resolve; a test that drove a
 * kernel and counted rows would measure the edition, not the declaration, and
 * would pass for the wrong reason on the day someone deleted a scope.
 *
 * What a permission set IS, is its declaration. So these walk it.
 */

const ALL_SETS = [MemberPermissionSet, ManagerPermissionSet, AdminPermissionSet];
const SCOPE_WIDTH: Record<ObjectAccessScope, number> = {
  own: 0,
  own_and_reports: 1,
  unit: 2,
  unit_and_below: 3,
  org: 4,
};

/** Depth is three-valued at the authoring layer; unset means the `own` baseline. */
function scopeOf(value: string | undefined): ObjectAccessScope {
  return (value ?? 'own') as ObjectAccessScope;
}

describe('positions', () => {
  it('ships exactly the three flat positions the model names', () => {
    expect(dulyPositions.map((p) => p.name)).toEqual([
      'duly_member',
      'duly_manager',
      'duly_admin',
    ]);
  });

  it('is flat — ADR-0090 D3 admits no position tree', () => {
    for (const position of dulyPositions) {
      // The schema has no `parent` key at all, so this is a guard against a
      // future author reaching for one and being told by a strict-parse error
      // rather than by a reviewer.
      expect(Object.keys(position)).not.toContain('parent');
    }
  });

  it('no position is self-service delegatable — ADR-0091 D3 for the admin one', () => {
    for (const position of dulyPositions) {
      expect(position.delegatable, `${position.name} must not be delegatable`).toBe(false);
    }
    // Stated separately because this one is the reason the rule exists: a
    // delegatable position must never distribute an adminScope-carrying set,
    // and the runtime refuses the delegation rather than the authoring.
    expect(AdminPosition.delegatable).toBe(false);
    expect([MemberPosition.name, ManagerPosition.name]).toEqual(['duly_member', 'duly_manager']);
  });
});

describe('permission sets — declared scopes, object by object', () => {
  it('ships exactly the three sets, named for the positions that carry them', () => {
    expect(dulyPermissionSets.map((s) => s.name)).toEqual([
      'duly_member',
      'duly_manager',
      'duly_admin',
    ]);
  });

  /**
   * The acceptance table. Every object entry of every set, both axes, written
   * out — so a change to any grant has to be made here too, deliberately,
   * rather than passing because the assertion was vague.
   */
  const EXPECTED: Record<string, Record<string, { read: ObjectAccessScope; write: ObjectAccessScope }>> = {
    duly_member: {
      duly_task: { read: 'own', write: 'own' },
      duly_duty: { read: 'own', write: 'own' },
      duly_log_entry: { read: 'own', write: 'own' },
      // public_read: depth is not consulted on either axis for reads, and the
      // member set grants no write bit, so both fall to the baseline.
      duly_catalog_item: { read: 'own', write: 'own' },
      duly_assignment: { read: 'own', write: 'own' },
    },
    duly_manager: {
      // ⛔ `duly_task` / `duly_duty` read SHOULD be 'unit_and_below'. It is not
      // authorable on protocol 17.2.0 — see HIERARCHY_SCOPES_DEFERRED and the
      // dedicated block below, which pins the deferral itself.
      duly_task: { read: 'own', write: 'own' },
      duly_duty: { read: 'own', write: 'own' },
      duly_log_entry: { read: 'own', write: 'own' },
      duly_catalog_item: { read: 'own', write: 'own' },
      duly_assignment: { read: 'own', write: 'own' },
    },
    duly_admin: {
      duly_task: { read: 'own', write: 'own' },
      // Org-wide READ of duties; the write axis stays at the baseline.
      duly_duty: { read: 'org', write: 'own' },
      duly_log_entry: { read: 'own', write: 'own' },
      // 'full control' of the catalog needs an org WRITE depth: public_read is
      // read-open but write-owned, so without it an administrator could only
      // edit catalog items they personally created.
      duly_catalog_item: { read: 'own', write: 'org' },
      duly_assignment: { read: 'own', write: 'own' },
    },
  };

  for (const set of ALL_SETS) {
    const expected = EXPECTED[set.name];

    it(`${set.name} grants exactly the five duly objects`, () => {
      expect(Object.keys(set.objects).sort()).toEqual(Object.keys(expected).sort());
      // No wildcard grant anywhere. `'*'` plus a super-user bit is a
      // package-authored superuser (ADR-0066), and `'*'` alone is a blank
      // cheque on every object the platform ships.
      expect(Object.keys(set.objects)).not.toContain('*');
    });

    for (const [objectName, want] of Object.entries(expected)) {
      it(`${set.name} · ${objectName} declares readScope=${want.read} writeScope=${want.write}`, () => {
        const grant = set.objects[objectName];
        expect(grant, `${set.name} must grant ${objectName}`).toBeDefined();
        expect(scopeOf(grant.readScope)).toBe(want.read);
        expect(scopeOf(grant.writeScope)).toBe(want.write);
      });
    }
  }

  it('no set carries a View All / Modify All bit on any object', () => {
    for (const set of ALL_SETS) {
      for (const [objectName, grant] of Object.entries(set.objects)) {
        expect(grant.viewAllRecords, `${set.name}.${objectName}.viewAllRecords`).not.toBe(true);
        expect(grant.modifyAllRecords, `${set.name}.${objectName}.modifyAllRecords`).not.toBe(true);
      }
    }
  });
});

/**
 * ⛔ The invariant this whole card exists to hold.
 *
 * Not "the log entries are private today" — that is a consequence. What is
 * pinned is that NOTHING in the authored security model can reach another
 * person's work log: no depth scope, no super-user bit, and no sharing rule
 * naming a group. A log people believe their skip-level can read is a log
 * nobody keeps.
 */
describe('duly_log_entry must not leak', () => {
  it('every set — admin included — reads own and only own', () => {
    for (const set of ALL_SETS) {
      const grant = set.objects.duly_log_entry;
      expect(grant, `${set.name} must declare duly_log_entry`).toBeDefined();
      expect(scopeOf(grant.readScope), `${set.name} widened the work log`).toBe('own');
      expect(scopeOf(grant.writeScope), `${set.name} widened work-log writes`).toBe('own');
      expect(grant.viewAllRecords).not.toBe(true);
      expect(grant.modifyAllRecords).not.toBe(true);
    }
  });

  it('the object itself stays private, so the scope above is the whole story', () => {
    // A widened OWD would make every assertion above decorative: depth only
    // narrows within `private`.
    expect(LogEntry.sharingModel).toBe('private');
  });

  it('no sharing rule targets the work log', () => {
    // Deliberately empty today. The one widening the product allows — a
    // record's own `visibility: 'manager'`, reaching that person's manager and
    // nobody else — needs a record-relative recipient the platform cannot
    // name (objectstack#14103). The recipient it CAN name,
    // `position: 'duly_manager'`, would share every marked entry with every
    // manager in the tenant, which is the disclosure this suite exists to
    // prevent. See src/security/sharing-rules.ts.
    for (const rule of dulySharingRules) {
      expect(rule.object, 'a work-log sharing rule needs re-reading, not extending').not.toBe(
        'duly_log_entry',
      );
    }
  });

  it('the manager-visibility option still exists on the object, unenforced but honest', () => {
    // If this ever disappears, the upstream gap stopped mattering and
    // sharing-rules.ts is stale — or the field was removed, which is a
    // product decision, not a cleanup.
    const values = (LogEntry.fields.visibility.options ?? []).map((o) => o.value);
    expect(values).toContain('manager');
  });
});

/**
 * A manager reads everything below them and writes none of it. Assigning is
 * their only write — and this is where that stops being a design intention.
 */
describe('no write scope on duly_task / duly_duty is wider than own', () => {
  for (const set of ALL_SETS) {
    for (const objectName of ['duly_task', 'duly_duty']) {
      it(`${set.name} · ${objectName}`, () => {
        const grant = set.objects[objectName];
        expect(SCOPE_WIDTH[scopeOf(grant.writeScope)]).toBe(SCOPE_WIDTH.own);
      });
    }
  }

  it('a manager’s only write bit anywhere below them is on duly_assignment', () => {
    // Everything the manager set can create or edit, over and above what the
    // member set already could.
    const memberWrites = new Set(
      Object.entries(MemberPermissionSet.objects)
        .filter(([, g]) => g.allowCreate === true || g.allowEdit === true || g.allowDelete === true)
        .map(([name]) => name),
    );
    const managerWrites = Object.entries(ManagerPermissionSet.objects)
      .filter(([, g]) => g.allowCreate === true || g.allowEdit === true || g.allowDelete === true)
      .map(([name]) => name)
      .filter((name) => !memberWrites.has(name));
    expect(managerWrites).toEqual(['duly_assignment']);
  });

  it('both objects are private, so the write depth is the enforced boundary', () => {
    expect(Task.sharingModel).toBe('private');
    expect(Duty.sharingModel).toBe('private');
  });
});

/**
 * "Inherit rather than restate" — asserted structurally, not by eyeballing the
 * source. Every entry the model does not deliberately widen must be the SAME
 * OBJECT the member set declared, which is only true if the manager and admin
 * maps were built by spreading it.
 */
describe('manager and admin inherit rather than restate', () => {
  const MANAGER_OVERRIDES = ['duly_assignment'];
  const ADMIN_OVERRIDES = ['duly_catalog_item', 'duly_duty'];

  it('every non-overridden manager entry is the member entry itself', () => {
    for (const [name, grant] of Object.entries(ManagerPermissionSet.objects)) {
      if (MANAGER_OVERRIDES.includes(name)) continue;
      expect(grant, `${name} was restated instead of inherited`).toEqual(
        MemberPermissionSet.objects[name],
      );
    }
  });

  it('every non-overridden admin entry is the manager entry itself', () => {
    for (const [name, grant] of Object.entries(AdminPermissionSet.objects)) {
      if (ADMIN_OVERRIDES.includes(name)) continue;
      expect(grant, `${name} was restated instead of inherited`).toEqual(
        ManagerPermissionSet.objects[name],
      );
    }
  });

  it('an override keeps every base key it does not change', () => {
    // The failure this catches: rewriting an entry from scratch and dropping
    // `writeScope: 'own'` on the way, which widens by omission.
    const base = ManagerPermissionSet.objects.duly_duty;
    const override = AdminPermissionSet.objects.duly_duty;
    const CHANGED = ['readScope', 'allowEdit']; // the two deliberate widenings
    for (const key of Object.keys(base) as Array<keyof typeof base>) {
      if (CHANGED.includes(key)) continue;
      expect(override[key], `admin.duly_duty dropped ${String(key)}`).toEqual(base[key]);
    }
    expect(override.allowEdit, 'admin edits duties for corrections').toBe(true);
    expect(base.allowEdit, 'a manager does not edit duties').not.toBe(true);
    // The one that must survive both widenings.
    expect(override.writeScope, 'admin.duly_duty write depth must stay own').toBe('own');
  });

  it('no set is narrower than the one it inherits from, on any object bit', () => {
    const bits = ['allowCreate', 'allowRead', 'allowEdit', 'allowDelete'] as const;
    const chain: Array<[typeof MemberPermissionSet, typeof ManagerPermissionSet]> = [
      [MemberPermissionSet, ManagerPermissionSet],
      [ManagerPermissionSet, AdminPermissionSet],
    ];
    for (const [base, derived] of chain) {
      for (const [name, baseGrant] of Object.entries(base.objects)) {
        for (const bit of bits) {
          if (baseGrant[bit] !== true) continue;
          expect(
            derived.objects[name]?.[bit],
            `${derived.name} lost ${bit} on ${name} that ${base.name} grants`,
          ).toBe(true);
        }
      }
    }
  });
});

/**
 * #30 and #40 — the invoke-time capability gate.
 *
 * All five actions run their handlers against `ctx.engine`, the trusted facade
 * that bypasses RLS and FLS by design, so object permissions never see those
 * writes. `requiredPermissions` is the only boundary there is, and these
 * assertions are what keep it from becoming a string that nothing grants.
 */
describe('action capability gates', () => {
  const byName = new Map(dulyActions.map((a) => [a.name, a]));
  const GATES: Record<string, string> = {
    duly_catalog_apply: DULY_CATALOG_APPLY,
    duly_catalog_sync: DULY_CATALOG_SYNC,
    duly_task_complete: DULY_TASK_UPDATE_STATUS,
    duly_task_undo: DULY_TASK_UPDATE_STATUS,
    duly_task_skip: DULY_TASK_UPDATE_STATUS,
  };

  it('every action this app ships declares a gate — none left open', () => {
    // Written over `dulyActions` rather than over the five known names, so a
    // SIXTH action added later fails here instead of shipping ungated.
    for (const action of dulyActions) {
      expect(
        action.requiredPermissions?.length,
        `${action.name} declares no requiredPermissions — its handler runs on the RLS-bypassing facade`,
      ).toBeGreaterThan(0);
    }
  });

  for (const [actionName, capability] of Object.entries(GATES)) {
    it(`${actionName} requires ${capability}`, () => {
      expect(byName.get(actionName)?.requiredPermissions).toEqual([capability]);
    });
  }

  it('every capability an action requires is granted by a set in this package', () => {
    // The link the action files cannot carry themselves: their file surface is
    // the `requiredPermissions` key, so they hard-code the string rather than
    // importing it. This is what turns a typo into a red test instead of a
    // button nobody can press.
    const granted = new Set(dulyPermissionSets.flatMap((s) => s.systemPermissions ?? []));
    for (const action of dulyActions) {
      for (const capability of action.requiredPermissions ?? []) {
        expect(
          granted,
          `${action.name} requires "${capability}", which no permission set grants`,
        ).toContain(capability);
      }
    }
  });

  it('the catalog capabilities are held by duly_admin and by nobody weaker', () => {
    for (const capability of [DULY_CATALOG_APPLY, DULY_CATALOG_SYNC]) {
      expect(AdminPermissionSet.systemPermissions).toContain(capability);
      expect(MemberPermissionSet.systemPermissions ?? []).not.toContain(capability);
      expect(ManagerPermissionSet.systemPermissions ?? []).not.toContain(capability);
    }
  });

  it('apply and sync are separable — syncing rewrites cadence org-wide', () => {
    expect(DULY_CATALOG_APPLY).not.toBe(DULY_CATALOG_SYNC);
  });

  it('status entry is a member capability, so every set inherits it', () => {
    for (const set of ALL_SETS) {
      expect(set.systemPermissions).toContain(DULY_TASK_UPDATE_STATUS);
    }
  });
});

/**
 * ⛔ STOPGAP — delete this block together with `HIERARCHY_SCOPES_DEFERRED`.
 *
 * It pins the compromise in both directions so it cannot rot: widen a grant
 * without deleting its row and the "authored" assertion fails; delete a row
 * without widening the grant and the coverage assertion fails. See duly#46.
 */
describe('deferred hierarchy scopes (stopgap — see #46)', () => {
  const setsByName = new Map(dulyPermissionSets.map((s) => [s.name, s]));

  for (const [key, record] of Object.entries(HIERARCHY_SCOPES_DEFERRED)) {
    const [setName, objectName, axis] = key.split('.');

    it(`${key} is authored '${record.authored}', not the intended '${record.intended}'`, () => {
      const grant = setsByName.get(setName)?.objects[objectName];
      expect(grant, `${setName} must grant ${objectName}`).toBeDefined();
      expect(scopeOf(grant?.[axis as 'readScope' | 'writeScope'])).toBe(record.authored);

      // The intent must still be a scope `validateHierarchyScopeCapability`
      // rejects. If it stops being one, the deferral has no reason to exist.
      expect(['own_and_reports', 'unit', 'unit_and_below']).toContain(record.intended);
      // And it must be a WIDENING — a deferral that narrows is a mistake.
      expect(SCOPE_WIDTH[record.intended]).toBeGreaterThan(SCOPE_WIDTH[record.authored]);
    });
  }

  it('records every grant the card asked to widen, and no others', () => {
    expect(Object.keys(HIERARCHY_SCOPES_DEFERRED).sort()).toEqual([
      'duly_admin.duly_task.readScope',
      'duly_manager.duly_duty.readScope',
      'duly_manager.duly_task.readScope',
    ]);
  });

  it('never defers a WRITE axis — that one is an invariant, not a compromise', () => {
    for (const key of Object.keys(HIERARCHY_SCOPES_DEFERRED)) {
      expect(key.endsWith('.readScope'), `${key} must not defer a write scope`).toBe(true);
    }
  });
});

describe('objects the sets grant are the objects this app ships', () => {
  it('grants nothing outside the duly namespace', () => {
    const shipped = new Set([Task, Duty, LogEntry, CatalogItem, Assignment].map((o) => o.name));
    for (const set of ALL_SETS) {
      for (const objectName of Object.keys(set.objects)) {
        expect(shipped, `${set.name} grants "${objectName}", which this app does not ship`).toContain(
          objectName,
        );
      }
    }
  });

  it('every shipped object is reachable by someone', () => {
    // A private object with no grant in any set is invisible to every
    // non-admin caller — the object-level 403 that reads as "the tab is empty".
    const granted = new Set(ALL_SETS.flatMap((s) => Object.keys(s.objects)));
    for (const object of [Task, Duty, LogEntry, CatalogItem, Assignment]) {
      expect(granted, `${object.name} is granted by no permission set`).toContain(object.name);
    }
  });
});
