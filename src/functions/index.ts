// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Named callables the platform resolves BY NAME at run time — a `script` flow
// node's function, and a `defineJob`'s `handler`. Both are read from the same
// place: `collectBundleFunctions(bundle)` over `defineStack({ functions })`.
// Add yours to this map — the map itself is already wired into
// objectstack.config.ts, so no feature branch needs to touch the config.
//
// A flow-node function is PURE: it takes `input` and RETURNS a value, and a
// later declarative node persists it. A function that legitimately writes
// DECLARES it (`{ handler, effect: 'writes' }`) so a run reports
// `unmeasuredEffect` rather than claiming it wrote nothing.

import {
  DUTY_TIMEZONE_GUARD_HANDLER,
  dulyValidateDutyTimezone,
} from '../hooks/duty.hook.js';
import { DISPATCH_HANDLER_NAME, dulyDispatch } from '../jobs/dispatch.job.js';

export const dulyFunctions = {
  // The dispatch job's handler. Declared `writes` because it does: it inserts
  // `duly_task` rows directly rather than returning a value for a declarative
  // node to persist. That is the honest declaration for a JOB handler, which
  // has no flow graph around it to do the writing — see the note on data reach
  // in `src/jobs/dispatch.job.ts`.
  [DISPATCH_HANDLER_NAME]: { handler: dulyDispatch, effect: 'writes' as const },

  // `duly_duty_timezone_guard`'s handler. A hook resolves a STRING handler
  // against this map (`resolveHandler` -> `opts.functions[name]`), which is the
  // whole reason the guard can use `Intl`: the alternative spelling — an inline
  // handler — is lowered by `objectstack build` into a QuickJS `body`, where
  // `Intl` does not exist. Registered in the bare form, which IS the
  // declaration `effect: 'pure'`: it inspects the payload and either returns or
  // throws, and writes nothing.
  [DUTY_TIMEZONE_GUARD_HANDLER]: dulyValidateDutyTimezone,
};
