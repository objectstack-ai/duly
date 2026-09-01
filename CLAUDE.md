# CLAUDE.md

**[AGENTS.md](./AGENTS.md) is the source of truth for working in this repo — read it.**

Three rules are inlined here because missing any one of them corrupts other
agents' work or ships a silently broken build:

1. **Worktree-first.** `git worktree add ../duly-issue-<n> -b claude/issue-<n>-<slug> main`
   before your first edit. A feature branch on the shared checkout is not enough —
   its HEAD gets switched under you.
2. **Never `git stash`.** The stash stack lives in the common `.git` dir and is
   shared across every worktree; your `pop` takes another agent's work and
   reports success.
3. **`pnpm validate` before you call anything done.** ObjectStack metadata fails
   silently at runtime, not at edit time.

See AGENTS.md for the full playbook, the naming rules, and the product
invariants that must not be refactored away.
