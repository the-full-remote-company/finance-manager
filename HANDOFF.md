# Session handoff: `001-recurring-budget-planner`

Working notes for continuing development, not a spec artifact. The task list
(`specs/001-recurring-budget-planner/tasks.md`) is the source of truth for
what's done — every completed task there has an `[x]`. This file is the
"how do I pick this back up" note that doesn't belong in that list.

**Last updated**: end of the session that finished User Story 4 and User
Story 5 (uncommitted at write time; diff against `36c3f4c`).

---

## Status

**118 of 162 tasks done.** Setup, Foundational, and User Stories 1–5 are
complete: auth, accounts/categories/commitments capture, the month
dashboard (online and offline), non-monthly rhythms in both cash and
smoothed presentations, and reserves reported separately from expenses.

**Next task: T119**, the first task of User Story 6 (transfers between
accounts). Read `specs/001-recurring-budget-planner/tasks.md` starting at
"Phase 8: User Story 6". Shape of what's ahead: `packages/core/src/transfers/
month.ts` on top of `applyShare` (already built, T023 — this is its first
real caller), `transfers.month` as a new, separate router (not an extension
of `dashboard.month`: no `presentation` parameter, cash view only, per OQ-2),
and a new `/transfers` screen reusing the month navigator from T096 rather
than rebuilding it.

## What actually works right now

Everything from the previous handoff, plus:

- **Non-monthly rhythms**, correctly, in both presentations. A quarterly
  (or half-yearly, yearly, one-off) commitment shows its full charge in cash
  view only in its due month; in smoothed view, an equal per-month share in
  every active month, split across the whole period and never re-divided
  over however many of those months happen to be active (so a contract
  ending mid-period has a smoothed total *less* than the charge — intended,
  FR-028b). `one_off` is identical in both views (never smoothed).
- **A commitment edit screen** (`/commitments/[id]/`) — genuinely new this
  session; it did not exist before (see "A real gap found" below).
- **Reserves**: the commitment form now has an expense/reserve control
  (shown only for expense-direction commitments), and the dashboard has a
  `Rücklagen` section with a `.pill`-labelled line for each, distinguished
  from the expense colour story rather than borrowing it.

## A real gap found and fixed this session: there was no commitment edit screen

`T085` ("Build the commitment list and the create/edit form") was marked
done after User Story 2, but only the *create* form (`/commitments/new`)
was ever built — `commitments.update` existed server-side with no caller.
This went unnoticed until User Story 5's own independent test ("flip a
commitment's kind, reopen the dashboard") needed to flip a field after
creation and there was nowhere to do it. Built this session:
`apps/web/app/(app)/commitments/[id]/page.tsx`, plus an "Aktionen" column
with an edit link on the commitments list. **T140 (User Story 8) extends
this same route with the amount-history panel and override editor** — it
is not a new screen, it is this one gaining more fields.

## Two more real bugs found by the new e2e specs, both fixed

1. **A Playwright click on the new "Bearbeiten" link failed on the mobile
   viewport**: `<span class="amt amt--loss">` from the amount column was
   intercepting pointer events meant for the actions column in the next
   cell over. The commitments table has six columns now (it had five before
   this session's "Aktionen" column); at 375px that is wider than the
   viewport, and an unconstrained `<table>` doesn't wrap — it just lets
   columns visually collide. Fixed by wrapping `packages/ui/src/Table.tsx`'s
   `<table>` in a `overflow-x: auto` div, the standard responsive-table
   pattern. **Any future table with enough columns to not fit a phone
   screen now scrolls horizontally within itself rather than silently
   breaking tap targets** — found by an interaction test, not a visual
   regression tool, because the overlap was pixel-perfect enough that
   nothing *looked* wrong in a screenshot.

2. **Editing a commitment and immediately reopening the dashboard showed
   the pre-edit figures.** The service worker's `dashboard-queries` cache
   (`sw.ts`, stale-while-revalidate) doesn't know a mutation happened
   elsewhere — `StaleWhileRevalidate` always answers from cache first by
   design, regardless of how fresh the cache is or whether the device is
   online. Fixed by having `handleMutation` delete the entire
   `dashboard-queries` cache after any *successful* (online) mutation —
   deliberately coarse, since the worker has no way to parse a tRPC payload
   and learn which month was actually affected. **This is the second time
   the SW's caching has broken an otherwise-correct read-after-write
   expectation this feature area relies on everywhere else** (the first was
   US3's "every GET" matcher breaking accounts/categories — see below); if
   a third surfaces, the pattern is probably "scope the cache far more
   narrowly, or don't cache that resource at all" rather than another
   point patch.

## Resuming the environment

```bash
docker ps --filter name=finance-db          # should already be "healthy"
# if not:
docker compose up -d db

cd finance-manager
pnpm install
pnpm db:reset                                # drops, recreates, migrates

# apps/web/.env.local is a symlink to the repo root's .env.local, already
# created. If it's missing:
ln -s ../../.env.local apps/web/.env.local

pnpm dev             # or: pnpm --filter @finance/web dev
```

## Verifying the current state

```bash
pnpm typecheck && pnpm lint && pnpm format
pnpm test:unit && pnpm test:integration && pnpm test:isolation   # 324 tests
pnpm test:e2e                                                    # 44 tests (+2 intentionally skipped)
```

All green as of this session's end, confirmed with `--workers=1` (see below).
`pnpm openapi:check` is clean — this session touched no router's input or
output shape, only `packages/core` and the UI.

**Local-machine-only e2e flakiness, still true this session, same root
cause as last time**: Playwright's default worker count on this particular
dev machine runs enough parallel Chromium instances against one shared
`next start` + Postgres pool to occasionally time out or detach a page.
`pnpm exec playwright test --workers=1` was clean, twice, across the full
46-test suite. Not a regression; not changed in `playwright.config.ts` for
the same Article IX reason as last time (CI's runners aren't this machine).

## Conventions reinforced or added this session

- **A commitment-domain concept that is really about projection (due
  months, rhythm periods, smoothing) now lives in its own
  `packages/core/src/projection/` module**, not folded into
  `commitment/schedule.ts`. `schedule.ts` is down to just `amountInForce`
  now — the amount-history lookup, the one thing in it that was never a
  projection concern. If User Story 6's `transfers/` needs due-month or
  period logic, import it from `projection/`, don't re-derive it.
- **`allocate()` (Article II, T021) is the one function that may split a
  total into parts without losing a minor unit** — `smoothing.ts` calls it
  rather than re-deriving a division; `transfers/month.ts` (next session)
  must do the same for its rounding, per T123's own instruction.
- **A service worker's cache invalidation story needs to be designed
  up front for anything new it caches, not discovered by the first bug
  report.** Both SW bugs this project has had so far (US3's and this
  session's) were "a stale-while-revalidate cache didn't know a mutation
  happened." If `transfers.month` or anything else ever gets a cache entry,
  decide its invalidation trigger in the same change, not after an e2e test
  finds the gap.
- New user-facing strings go in `apps/web/messages/de.json` only.
- `pnpm --filter @finance/api openapi:generate` after any router/schema
  change.
- The service worker (`apps/web/sw.ts`) has its own `tsconfig.worker.json`
  and its own ESLint override block in the root `eslint.config.js` (`lib:
  ["WebWorker"]` conflicts with the app's `"DOM"` lib if combined into one
  program) — needed again for any second worker file, should one ever exist.
