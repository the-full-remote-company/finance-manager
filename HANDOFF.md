# Session handoff: `001-recurring-budget-planner`

Working notes for continuing development, not a spec artifact. The task list
(`specs/001-recurring-budget-planner/tasks.md`) is the source of truth for
what's done — every completed task there has an `[x]`. This file is the
"how do I pick this back up" note that doesn't belong in that list.

**Last updated**: end of the session that finished User Story 2 (commit
`b8f0a90`).

---

## Status

**86 of 162 tasks done.** Setup, Foundational, User Story 1 (auth), and User
Story 2 (accounts/categories/commitments capture) are complete and verified
end-to-end in a real browser against a real PostgreSQL container — not just
unit-tested.

**Next task: T087**, the first task of User Story 3 (the month dashboard).
Read `specs/001-recurring-budget-planner/tasks.md` starting at the "Phase 5:
User Story 3" heading. Rough shape of what's ahead: `packages/core`'s
activity-window and aggregation functions (T087–T088), the `dashboard.month`
procedure (T089+), then the dashboard screen itself.

## What actually works right now

Register → sign in → sign out. Create/rename/reorder/delete accounts and
categories (refused with a count while referenced). Create a commitment with
any rhythm, full validation (anchor month, transfer≠source, contract dates,
direction-matches-category). Cross-workspace isolation, RLS and composite
FKs, all independently tested. No dashboard yet — `apps/web/app/page.tsx` is
still the scaffold placeholder.

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

Then register a real account through the UI at `/register` and click
through `/settings/accounts`, `/settings/categories`, `/commitments`,
`/commitments/new` — all functional.

## Verifying the current state

```bash
pnpm typecheck && pnpm lint && pnpm format
pnpm test:unit && pnpm test:integration && pnpm test:isolation   # 282 tests
pnpm test:e2e                                                    # 13 tests (+1 intentionally skipped)
```

All of the above are green as of `b8f0a90`. `pnpm test:e2e` builds and boots
the app itself (see `playwright.config.ts`'s `webServer`), so the dev server
above doesn't need to be running for it — but the Postgres container does.

`pnpm openapi:check` will show a diff until the next commit; that's normal
immediately after a router change and resolves once committed. It is not a
sign of drift right now — it was clean at `b8f0a90`.

## Two bugs found and fixed this session, worth knowing about

Both were **completely invisible to `pnpm build`'s exit code**. They were
only found by actually driving the built app in a real browser. If a future
session adds a new page and it "does nothing" when clicked, this is the first
thing to suspect.

1. **Every page was statically prerendered, so `proxy.ts`'s per-request CSP
   nonce never matched.** A static page's HTML — including Next's own
   bootstrap `<script>` tags — is written once at build time; a nonce minted
   fresh per request can never appear in it. Fixed by reading `headers()` in
   `apps/web/app/layout.tsx`, which forces dynamic rendering. **Any new route
   added under `apps/web/app/` needs to end up dynamically rendered too** —
   it will be, automatically, as long as it's a descendant of the root
   layout (which it always is) and nothing changes that. If a future change
   makes a subtree exempt from the root layout somehow, re-check this.

2. **`next dev` was separately, completely broken** even after the fix
   above: webpack's development devtool wraps every module in `eval(...)`,
   which the strict CSP blocked outright. Fixed by adding `'unsafe-eval'` to
   `script-src` only when `NODE_ENV === "development"` (see `proxy.ts`). The
   production build is unaffected and stays exactly as strict.

**How this class of bug was caught**: build succeeding and `curl` returning
200 prove nothing about client-side interactivity. Whenever UI work is
"done," actually open a real browser (or run the Playwright e2e suite) and
click through it before calling it finished. `pnpm test:e2e` now covers the
screens that exist; it will not catch a *new* page's regressions until a
spec is written for that page too.

## Other pre-existing things discovered, not yet fixed (not blocking)

- **`apps/web` builds on webpack, not Turbopack** (`next build --webpack` /
  `next dev --webpack`, already wired into `package.json`'s scripts). Every
  package in this monorepo writes NodeNext-style relative imports (a sibling
  import writes `./router.js` even though only `router.ts` exists), which
  `tsc` and Vitest's esbuild transform both resolve correctly but Turbopack
  does not, as of Next 16. `next.config.ts`'s `webpack()` hook adds the
  `resolve.extensionAlias` webpack needs for this; there's no Turbopack
  equivalent yet. If Turbopack ever adds one, this could be revisited, but
  there's no pressure to.
- **`next start` warns about `output: "standalone"`** and CI's
  self-hosted-build-proof job (`.github/workflows/ci.yml`) uses
  `pnpm --filter @finance/web start` rather than the standalone server
  (`node .next/standalone/server.js`). It still boots and answers
  `health.ping` correctly, so the CI gate isn't lying, but it isn't
  exercising the actual container path either. No `Dockerfile` exists yet.
  Worth a proper fix whenever the container packaging itself gets built —
  not a US3 concern.

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
  match, as several migrations here already do), then RLS
  (`ENABLE`/`FORCE`/policy with both `USING` and `WITH CHECK`) by hand —
  `drizzle-kit generate` does not know about tenancy. A new tenant-scoped
  table needs its own leak test in `packages/db/tests/isolation/` before it
  can merge (Article I).
- New user-facing strings go in `apps/web/messages/de.json` only — a literal
  string in a `.tsx` under `apps/web` or `packages/ui` is a lint error by
  design.
- `packages/core` stays pure — no imports from anywhere else in this repo,
  enforced by dependency-cruiser. Domain arithmetic (month/activity-window/
  aggregation logic for US3) belongs there, test-first.
