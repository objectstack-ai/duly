// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Positions (flat capability distribution, ADR-0090 D3), permission sets, and
// record sharing rules. Three separate config keys, one barrel — push into the
// arrays below rather than editing objectstack.config.ts.
//
// The three axes are separate on purpose and it is worth keeping them straight
// while reading this directory:
//
//   positions      WHO gets grants   — flat, named distribution points
//   permissionSets WHAT the grants are — the only capability container
//   sharingRules   WHICH extra rows a principal reaches, on top of the OWD
//
// Depth ("my reports", "my unit and below", "the org") is none of the three:
// it is the ADR-0057 scope on a permission-set object entry, resolved against
// the business-unit tree and the manager chain.

import {
  AdminPosition,
  ManagerPosition,
  MemberPosition,
} from './positions.js';
import {
  AdminPermissionSet,
  ManagerPermissionSet,
  MemberPermissionSet,
} from './permission-sets.js';
import { dulySharingRuleDefinitions } from './sharing-rules.js';

export { AdminPosition, ManagerPosition, MemberPosition };
export { AdminPermissionSet, ManagerPermissionSet, MemberPermissionSet };
export {
  DULY_CATALOG_APPLY,
  DULY_CATALOG_SYNC,
  DULY_TASK_UPDATE_STATUS,
} from './permission-sets.js';

export const dulyPositions = [MemberPosition, ManagerPosition, AdminPosition];

export const dulyPermissionSets = [
  MemberPermissionSet,
  ManagerPermissionSet,
  AdminPermissionSet,
];

// Empty, and the emptiness is load-bearing — `sharing-rules.ts` carries the
// measurement and the upstream reference (objectstack#14103). Read it before
// adding anything here.
export const dulySharingRules = dulySharingRuleDefinitions;
