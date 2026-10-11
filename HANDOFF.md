# Session handoff: `001-recurring-budget-planner`

Working notes for continuing development, not a spec artifact. The task list
(`specs/001-recurring-budget-planner/tasks.md`) is the source of truth for
what's done — every completed task there has an `[x]`. This file is the
"how do I pick this back up" note that doesn't belong in that list.

**Last updated**: end of the session that finished User Story 3 (uncommitted
at write time; diff against `0967095`).

---

## Status

**102 of 162 tasks done.** Setup, Foundational, User Story 1 (auth), User
Story 2 (accounts/categories/commitments capture), and User Story 3 (the
month dashboard, online and offline) are complete and verified end-to-end in
a real browser against a real PostgreSQL container.

**Next task: T103**, the first task of User Story 4 (non-monthly rhythms:
smoothed vs. cash presentation). Read `specs/001-recurring-budget-planner/tasks.md`
starting at "Phase 6: User Story 4". Shape of what's ahead: `packages/core`'s
`projection/` module (due-months, period-window, smoothing, exactness —
T103–T106), then `packages/core/src/dashboard/aggregate.ts` gets genuinely
extended for the first of four times (T111) to route each commitment through
the smoothed or cash path per the requested presentation — **right now it
does not**; see "Known shortcut taken in US3" below, it matters here.

## What actually works right now

Register → sign in → sign out (with a visible "Abmelden" control on the
dashboard, new this session). Create/rename/reorder/delete accounts and
categories. Create a commitment with any rhythm. Cross-workspace isolation.
**The month dashboard**: income list and total, expense categories with
totals and percentages, overall expense total, remaining (signed, FR-043
compliant), a month navigator that stops at the 24-month horizon boundary, a
cash/smoothed presentation toggle (persisted in `localStorage`, though
"smoothed" is not yet mathematically different from "cash" — see below).
Offline: a previously viewed month renders from cache within 2 s with its
retrieval time shown; a never-visited month says so, distinctly from a
visited-but-empty month; any mutation attempted offline fails immediately
with a kept-input error, nothing queued; sign-out clears every Cache Storage
entry. All four independently e2e-tested (`us3-dashboard.spec.ts`,
`us3-offline.spec.ts`).

## Known shortcut taken in US3, on purpose — read before touching `aggregate.ts`

`packages/core/src/dashboard/aggregate.ts`'s `presentation` parameter is
accepted and threaded through the payload, but **`smoothed` computes
identically to `cash`** right now. This is not a bug to silently work around;
it is explicitly what T093 was scoped to and T111 (US4) is scoped to fix. It
was invisible to every US3 test because every US3 fixture used `monthly`
commitments, whose period is one month — smoothing a one-month period is the
identity function, so cash and smoothed are mathematically identical for
every commitment US3 ever constructed. **The first US4 task that creates a
quarterly or yearly commitment and checks the smoothed view will immediately
show this.** The fix is T111: route `expenseResolved`/`reserveResolved`'s
per-commitment amount through the smoothing math from T105 when
`presentation === "smoothed"`, instead of the cash-only `isDueMonth` gate
currently used unconditionally.

## Resuming the environment

```bash
docker ps --filter name=finance-db          # should already be "healthy"
# if not:
docker compose up -d db

cd finance-manager
pnpm install
pnpm db:reset                                # drops, recreates, migrates

# apps/web/.env.local is a symlink to the repo root's .env.local, already
# created — Next.js only auto-loads .env.local from the app's OWN directory,
# not the monorepo root, and nothing works without it. If it's missing:
ln -s ../../.env.local apps/web/.env.local

pnpm dev             # or: pnpm --filter @finance/web dev
```

Register through the UI at `/register`; sign-in now lands on `/dashboard`
rather than the old placeholder `/`. `/dashboard`, `/commitments`,
`/commitments/new`, `/settings/accounts`, `/settings/categories` are all
functional.

## Verifying the current state

```bash
pnpm typecheck && pnpm lint && pnpm format
pnpm test:unit && pnpm test:integration && pnpm test:isolation   # 301 tests
pnpm test:e2e                                                    # 32 tests (+2 intentionally skipped)
```

All green as of this session's end. `pnpm test:e2e` builds and boots the app
itself (`playwright.config.ts`'s `webServer`), so the dev server doesn't need
to be running — the Postgres container does.

**Local-machine-only flakiness, not a real defect**: on a high-core-count
dev machine, Playwright's default worker count (one per core) can run 5+
heavy Chromium instances against a *single* shared `next start` process and
Postgres pool, and under that contention a request occasionally times out or
a page occasionally detaches. Confirmed by re-running the identical failing
spec with `--workers=2`: zero failures, every time, across several runs this
session. If a future session sees an isolated, non-reproducing e2e failure
locally, try `pnpm exec playwright test --workers=2` before assuming a
regression. Not changed in `playwright.config.ts` itself — CI's runners have
far fewer cores than this workstation, so the default is almost certainly
fine there, and Article IX forbids weakening a gate to paper over a purely
local resource ceiling.

`pnpm openapi:check` will show a diff until the next commit; that's normal
immediately after a router change (this session added `dashboard.horizon`
and `dashboard.month`) and resolves once committed.

## New this session: the service worker (`apps/web/sw.ts`)

Built on Serwist (`@serwist/next` in `next.config.ts`, `disable` outside
production — `next dev` never runs one). Four runtime-caching rules, in this
order, each worth knowing about before adding a fifth:

1. **`/_next/static/*` → CacheFirst.** Content-hashed and immutable. Not
   covered by `globPublicPatterns` (which only scans `apps/web/public`), and
   the cached navigation document below is otherwise a shell with nothing to
   execute.
2. **Navigation requests (`request.mode === "navigate"`) → NetworkFirst,
   3 s timeout.** `apps/web/app/layout.tsx` reads `headers()` for its CSP
   nonce, which forces every route to render dynamically — there is no
   static HTML to precache at build time, so "the app launches offline"
   (FR-035a, Story 3 scenario 7) is only true for a route visited at least
   once online. **A genuinely never-visited route cannot open offline; this
   is inherent to the nonce-per-request design, not a gap to close.**
3. **`GET /api/trpc/dashboard.*` → StaleWhileRevalidate**, with a plugin
   stamping `x-cached-at` on write. **Deliberately scoped to `dashboard.*`
   only, not every query in the app.** Every other list screen (accounts,
   categories, commitments) does a plain mutate-then-reload with zero
   cache-invalidation awareness; a cache hit there made a freshly created row
   briefly invisible immediately after its own creation. Found by the very
   first e2e run with a naive repo-wide matcher — don't broaden this without
   also teaching those screens to invalidate the cache they'd then be
   reading from.
4. **`POST /api/trpc/*` → tries the network; on failure, synthesises
   `OFFLINE_READ_ONLY`'s exact wire shape by hand** (confirmed against a real
   server error response via `curl`, documented inline in `sw.ts`) rather
   than importing anything from `packages/api`, to keep the worker bundle
   free of the server's dependency graph.

`health.ping` is excluded from caching twice over, defensively: it's outside
the `dashboard.*` prefix already, and there's an explicit `NetworkOnly` rule
for it besides — a cached success would report a live server to an offline
client.

**A second, real bug this surfaced and fixed**: `apps/web/lib/use-require-session.ts`
used to redirect to `/sign-in` on *any* rejection from `auth.session`,
including a pure offline network failure — which made every cached dashboard
answer unreachable the instant the device went offline, since the page
redirected away before ever rendering. Fixed by checking `navigator.onLine`
in the `.catch()`: offline, let the page render (trusting the cookie);
online, a rejection still means "really not signed in". **Any future
`use*Session`-style guard needs the same distinction, or it will silently
defeat whatever offline support it gates.**

**Sign-out now exists** (it didn't before this session — no UI called
`auth.signOut` at all). It lives on `/dashboard` for now, purges every Cache
Storage entry (`caches.keys()` + `caches.delete` each), and redirects to
`/sign-in`. T102 (US3) asked for "the persisted tRPC client store" to be
purged too; there isn't one — `@tanstack/react-query` is an installed
dependency but nothing in `apps/web` uses it yet, so there is nothing there
to purge until that changes.

## Local build-artifact traps, specific to this session (read if `pnpm lint` fails mysteriously)

- **A stray `next dev` process left running across tool invocations will
  keep regenerating `apps/web/.next/` and `apps/web/next-env.d.ts`, which
  then fail `pnpm lint:boundaries`** (`not-to-unresolvable` against
  `next-env.d.ts`'s hard-coded `.next/dev/types/*` imports) — but only once
  those files exist; on a clean checkout, `next-env.d.ts` is itself
  `.gitignore`d and absent, so depcruise never sees it and CI is unaffected.
  If this gate fails locally for a reason that makes no sense, check
  `ps aux | grep next` and `rm -rf apps/web/.next apps/web/next-env.d.ts`
  before assuming a real regression.
- `apps/web/public/sw.js` (Serwist's build output) is now `.gitignore`d —
  content-hashed per build, so a committed copy is always stale relative to
  whatever actually shipped. If it shows up in `git status`, that's a leftover
  from a local `next build`, not something to commit.

## Two bugs found and fixed in the session before this one, still relevant

Both were **completely invisible to `pnpm build`'s exit code**. Only found by
actually driving the built app in a real browser.

1. **Every page was statically prerendered, so `proxy.ts`'s per-request CSP
   nonce never matched.** Fixed by reading `headers()` in
   `apps/web/app/layout.tsx`, which forces dynamic rendering. Any new route
   under `apps/web/app/` inherits this automatically as long as it stays a
   descendant of the root layout.
2. **`next dev` was separately broken**: webpack's dev `eval(...)` devtool
   tripped the strict CSP. Fixed with `'unsafe-eval'` in `script-src`, dev
   only (`proxy.ts`).

**How this class of bug is caught**: build succeeding and `curl` returning
200 prove nothing about client-side interactivity, and (this session's
addition) prove nothing about service-worker behaviour either — the SW's own
runtime-caching logic has no equivalent of a type error to catch a wrong
matcher or a wrong cache scope. `pnpm test:e2e` now covers everything it's
been pointed at; it will not catch a *new* screen's regressions until a spec
exists for that screen too.

## Other pre-existing things discovered, not yet fixed (not blocking)

- **`apps/web` builds on webpack, not Turbopack** — unchanged, see
  `next.config.ts`'s comment.
- **`next start` warns about `output: "standalone"`**, and CI's
  self-hosted-build-proof job doesn't exercise the actual standalone server
  path. No `Dockerfile` exists yet. Not a US3/US4 concern.
- **No PWA icons beyond one hand-written SVG** (`apps/web/public/icon.svg`,
  referenced from `manifest.webmanifest`). Sufficient for installability in
  evergreen browsers (`"sizes": "any"`, `purpose: "any maskable"`), but a
  real icon set (multiple raster sizes) would be worth it before this ships
  anywhere real.

## Conventions to keep following (already established, don't reinvent)

- Every router lives in `packages/api/src/routers/`, mounted in `router.ts`.
  `protectedProcedure`'s `ctx.db` is already inside the request's
  workspace-scoped transaction — don't re-open one, don't re-filter by
  `workspace_id` on reads (RLS does it); do supply
  `ctx.session.workspaceId` explicitly on inserts (`WITH CHECK` needs it).
- `pnpm --filter @finance/api openapi:generate` after any router/schema
  change, or `openapi:check` fails in CI.
- New tables: Drizzle schema in `packages/db/src/schema/`, then
  `pnpm --filter @finance/db generate` (or hand-write the migration SQL to
  match), then RLS (`ENABLE`/`FORCE`/policy with both `USING` and
  `WITH CHECK`) by hand. A new tenant-scoped table needs its own leak test in
  `packages/db/tests/isolation/` before it can merge (Article I).
- New user-facing strings go in `apps/web/messages/de.json` only — a literal
  string in a `.tsx` under `apps/web` or `packages/ui` is a lint error by
  design.
- `packages/core` stays pure — no imports from anywhere else in this repo,
  enforced by dependency-cruiser. A time-domain concept (activity window)
  lives in `packages/core/src/time/`; a commitment-specific one (due months,
  rhythm) lives in `packages/core/src/commitment/`; cross-cutting
  aggregation lives in its own `packages/core/src/dashboard/` — this
  session's precedent for where US4's `packages/core/src/projection/` should
  probably also sit as its own module, not folded into an existing one.
- The service worker (`apps/web/sw.ts`) has its **own** `tsconfig.worker.json`
  (`lib: ["WebWorker"]`, conflicts with the app's `"DOM"` lib if combined)
  and its own ESLint override block in the root `eslint.config.js` — both
  needed again for any second worker file, should one ever exist.
