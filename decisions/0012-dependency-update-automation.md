# 12. Dependency updates come from Dependabot, and vulnerability scanning runs on a schedule

Date: 2026-10-30

## Status

Accepted.

## Context

"Baseline security controls" requires "dependency vulnerability scanning and
automated update pull requests". The first half existed: a CI job runs
`pnpm audit --audit-level moderate` on every pull request. Two things were
missing:

1. **Automated update pull requests.** Until now every bump was done by hand,
   which is how the audit job ended up red for the whole life of a branch and
   needed one large catch-up (about 30 advisories across 11 packages).
2. **Scanning when nobody pushes.** The audit job runs on pushes and pull
   requests only, so an advisory published while the repository is idle is not
   seen until the next push.

Choosing an update tool is a decision about an external service, and the
constitution reserves those for an ADR (Article VII, "Decision records").

## Decision

1. **Dependabot, for version updates.** Configured in `.github/dependabot.yml`
   for `npm` (the pnpm workspace), `github-actions` and `docker-compose`.
   Updates arrive as ordinary pull requests and pass every gate in `ci.yml`;
   nothing auto-merges.
   - Minor and patch updates are grouped per ecosystem (production and
     development separately); major updates are never grouped, so each is its
     own pull request with its own changelog.
   - `@tfrc/*` is excluded from every group. The design system is a contract
     checked by `tfrc-verify` (Article V), so it always arrives alone.
   - `@types/node` major updates are ignored: they must not run ahead of the
     Node 22 runtime in `.nvmrc`. `postgres` major updates are ignored: a major
     version is a data migration, not a bump (ADR 0002).
   - `cooldown: 7 days`: a release is proposed only once a week old, which is
     when a malicious or broken release is most likely to have been pulled.
     Security updates are exempt.
2. **A scheduled audit.** `.github/workflows/dependency-audit.yml` runs the same
   `pnpm audit --audit-level moderate` on weekdays and on demand, so scanning
   does not depend on a push. It opens nothing: a red run is the signal.

## Why Dependabot, and what it costs

- It needs no credential and no application install. It is switched on by one
  file in the repository.
- **Renovate** was the alternative. It understands more (notably pnpm
  `overrides`, which Dependabot does not touch) and is not tied to one forge.
  But it runs either as a hosted app that must be installed by an organisation
  owner, or as a self-hosted job that needs a stored access token. Both add a
  new external dependency for a control that has to work unattended.
- **Lock-in is small.** The configuration is about 100 lines of YAML, the output
  is plain pull requests, and no data lives in the tool. Exit is deleting the
  file and adopting another tool's configuration; nothing in the code or the
  history depends on Dependabot. The one GitHub-specific part is that the
  configuration is only read from the default branch.

## Known gaps

**GitHub cannot read this repository's lockfile, so its own vulnerability
alerts do not work.** pnpm 12 writes `pnpm-lock.yaml` as two YAML documents
when the pnpm version is pinned: the first is pnpm's own lockfile (the pinned
`pnpm@12.4.2` and its platform binaries), the second is the project's. GitHub's
documentation states that for this format "the dependency graph does not detect
the dependencies in that file", and that Dependabot version updates still work
but Dependabot alerts and security updates are not created.

**Correction (2026-11-07).** An earlier version of this section read the 404 from
the dependency-graph SBOM endpoint as "consistent with" GitHub being unable to
parse the lockfile. That inference was wrong. The repository's **dependency graph
setting was simply off** (organisation default for new repositories: off), so
GitHub had parsed nothing, not even the plain `package.json` files. The lockfile
format was never the only thing in the way, and the 404 told us nothing about it.

Consequences:

- **`pnpm audit` is the required gate and runs on a schedule.** It is not made
  redundant by GitHub's alerts: it checks what is installed (overrides included),
  they check what is declared. Each caught something the other cannot.
- Version updates, which are what this ADR adds, are unaffected. They will still
  propose the bumps that fix advisories, just without being labelled as
  security updates.

**Remedy, applied on 2026-10-30 (001 T164): `pmOnFail: ignore`.** The boot
document is written whenever pnpm checks its own version against the
`packageManager` field. Tested on scratch copies, every setting that keeps the
check produces it, and only `ignore` does not:

| Setting | Boot document |
|---|---|
| `packageManager` pinned, `pmOnFail` default (`download`), `warn` or `error` | yes |
| `devEngines.packageManager` with `onFail` `download`, `warn` or `error` | yes |
| `pmOnFail: ignore`, or `devEngines.packageManager` with `onFail: ignore` | no |

So `devEngines`, which can pin a version range, is not a way round it: a
single-document lockfile and pnpm enforcing a pinned version are mutually
exclusive. `pnpm-workspace.yaml` now sets `pmOnFail: ignore`, and the lockfile's
first document was removed once, because the setting alone does not change an
existing lockfile. The `packageManager` field stays: CI still reads it through
`pnpm/action-setup`, and tooling that looks for the version still finds it.

What was checked: the project half of the lockfile is byte-identical to before
(no dependency changed); `pnpm install --frozen-lockfile` accepts it; a full
re-resolution leaves it unchanged. The cost scenario was tested directly: pnpm
12.9.1 (the repository pins 12.4.2) accepts the lockfile, runs a frozen install,
does not rewrite it and keeps it single-document, whereas the same version
without the setting switches pnpm versions and brings the boot document back.
Not tested: a different pnpm *major*. A lockfile that another pnpm writes
differently fails `--frozen-lockfile` in CI, which is where drift is caught.

**Observed (2026-11-07), after the dependency graph was switched on:** GitHub
detected 10 manifests including `pnpm-lock.yaml` (parseable), the SBOM endpoint
answers 200 with 662 packages, and it records exact lockfile resolutions that a
`package.json` range cannot give: `glob` 14.0.4 and `minimatch` 11.0.5 (our
overrides), `next` 16.4.3, `typescript` 6.0.3. So the single-document lockfile is
read correctly.

**Not established:** whether the old two-document lockfile would also have been
read now that the graph is on. GitHub's documentation says it would not; it was
not tested, because the graph only builds from the default branch and the old
file would have to be restored there. The single-document form costs little (see
above) and is confirmed to work, so it stays.

**Alerts work, and found something `pnpm audit` could not.** Two high-severity
alerts opened at once: `zod` below 4.6.6, declared as an exact `4.6.5` in
`apps/web/package.json` and `packages/api/package.json`. `pnpm audit` reported
nothing because pnpm overrides rewrite *direct* declarations in the lockfile too:
an override added for a transitive `zod` had silently pinned our own dependency to
4.6.7 there, while the manifests kept the stale version. The installed code was
safe; the declarations were not, and removing the override would have reinstated
4.6.5 unnoticed. Fixed by declaring 4.6.7 in both manifests (the override stays,
since `@serwist/next` still pins `zod` 4.6.5 transitively). Lesson: an override
fixes what is installed, not what is declared; `pnpm audit` reads the former and
GitHub's alerts read the latter, so they are complementary, not redundant.

**Security updates: enabled (2026-11-07, 001 T165).** The repository setting
"Dependabot security updates" is on; "grouped security updates" is deliberately
left off. This is a repository setting, not a file, so it is not version-controlled
and is recorded here instead. Verify it with
`gh api repos/{owner}/{repo}/automated-security-fixes` (`enabled: true`); undo it
with `gh api -X DELETE` on the same path.

Why on: the version updates in `dependabot.yml` run weekly behind a 7-day cooldown,
so a fix released today can take up to about two weeks to reach a pull request.
Security updates are exempt from the cooldown and, per GitHub's documentation, do
not read the `ignore` entries in `dependabot.yml`. They turn a red audit run, which
only tells someone something is wrong (the scheduled workflow notifies only the
last person to edit its schedule), into a ready pull request that runs every gate.
Nothing auto-merges.

Why grouped is off: a security fix should be small and reviewable alone, one bad
bump should not block the others, and alerts are rare now that dependencies are
current (two so far, both `zod`). Turn grouping on if three or more arrive at once.

Auto-triage rules: one is enabled, which is almost certainly GitHub's preset that
auto-dismisses low-impact alerts on npm development dependencies (on by default
for public repositories; the rule itself is only readable in the UI, so this is an
inference). It is left alone: it hides only low-impact alerts in dev tooling, and
the required `pnpm audit --audit-level moderate` gate catches those independently.
Custom rules exist for public repositories and can choose which alerts get fix pull
requests; not used, because they add more configuration that lives only in the UI.

Limits, so nobody expects more than it does: it cannot fix a transitive package
whose parent pins the vulnerable version (Dependabot reports an error on the
alert; the `overrides` in `pnpm-workspace.yaml` remain a person's job, as with
`glob`, `minimatch` and `zod`), and it opens one pull request per alert, each
touching the shared lockfile, so Dependabot will rebase them against each other.

**Not yet observed:** a real security-update pull request. No alert has been open
since the setting was enabled, so only the setting itself is confirmed. Record the
first one here when it happens.

**Other things Dependabot does not cover:**

- The pnpm `overrides` in `pnpm-workspace.yaml`. The scheduled audit flags one
  that has become vulnerable; nothing flags one that has become dead because its
  parent moved on. That needs a person at each audit.
- Image tags in the CI workflow's `services:` blocks. Only `docker-compose.yml`
  is scanned, so an image declared in both places drifts: Mailpit did, within
  hours of the first Dependabot pull request (CI on 1.31.6, local on 1.32.0).
  Mitigated since: CI starts Mailpit from `docker-compose.yml` (one declaration),
  and `scripts/verify-image-pins.mjs` fails the build if any image is unpinned
  or pinned to different tags in different files. `postgres:17-alpine` is still
  declared in the compose file and in three CI jobs, kept equal by that check;
  because only a major version is pinned and Dependabot ignores majors, nothing
  proposes a bump there at all.
- The Node version in `.nvmrc`.

**Operational limits of the scheduled audit.** GitHub disables scheduled
workflows after 60 days without repository activity, and a failed run notifies
the person who last edited the schedule, not a team.

## Not verified at the time of writing

Dependabot reads its configuration from the default branch only, so none of the
following could be observed before merge. **Both were observed afterwards
(2026-10-30):**

- that it discovers `apps/web` and `packages/*` from the root manifest through
  `pnpm-workspace.yaml`: yes. Its first grouped pull requests (#8, #9) changed
  `apps/web/package.json` and every `packages/*` manifest together with the
  shared lockfile, so `directory: /` is enough and the `directories` fallback
  was not needed;
- that its pull requests keep `pnpm-lock.yaml` consistent: yes.
  `pnpm install --frozen-lockfile` passed in CI on all eight of its first pull
  requests.

What was checked beforehand: the configuration against the SchemaStore
`dependabot-2.0` schema (which also rejects a deliberately broken copy), the
workflows with `actionlint`, and formatting.

## Consequences

- A week's updates arrive as a handful of pull requests, so reviewing them is a
  routine task, not a quarterly project.
- A red scheduled audit means a dependency needs attention before the next
  deploy, not at the next push.
- Reviewers should read major-version pull requests and any `@tfrc/*` pull
  request: the gates catch breakage, not intent.
- If the overrides in `pnpm-workspace.yaml` start to rot, that is the moment to
  revisit Renovate.
