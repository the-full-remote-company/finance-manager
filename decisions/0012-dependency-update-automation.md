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

What was observed, and what was not: on 2026-10-30 the dependency-graph SBOM
endpoint for this repository returned 404, which is consistent with GitHub
having built no dependency graph from the lockfile. The repository also reports
0 Dependabot alerts, but that was read after the advisories had been cleared, so
it proves nothing by itself. Whether alerts would have fired during the weeks
this repository carried about 30 advisories was never measured. Treat the
documented limitation, plus the 404, as the evidence, and re-check after the
lockfile format changes (001 T164).

Consequences:

- **`pnpm audit` is the only vulnerability scanner that works.** That is why it
  is a required gate and why it also runs on a schedule. The scheduled job is
  not a duplicate of GitHub's alerts; it replaces them.
- Version updates, which are what this ADR adds, are unaffected. They will still
  propose the bumps that fix advisories, just without being labelled as
  security updates.

**A tested remedy exists and was deliberately not applied here.** On a scratch
copy of the repository: removing the first document by hand and setting
`pmOnFail: ignore` in `pnpm-workspace.yaml` gave a single-document lockfile
that `pnpm install --frozen-lockfile` accepted, that later lockfile updates kept
single-document, and that was byte-identical to the project half of the current
file (no version changes). `pmOnFail: ignore` alone does nothing to an existing
lockfile. The cost is that pnpm stops switching contributors to the pinned
version, so a contributor on a different pnpm could write a differently-shaped
lockfile. That changes everyone's toolchain, so it is recorded as a separate
task (001 T164), not folded into this one.

**Other things Dependabot does not cover:**

- The pnpm `overrides` in `pnpm-workspace.yaml`. The scheduled audit flags one
  that has become vulnerable; nothing flags one that has become dead because its
  parent moved on. That needs a person at each audit.
- Image tags in the CI workflow's `services:` blocks (`postgres`, `mailpit`).
  Only `docker-compose.yml` is scanned, so the same image is tracked in one
  place and can drift in the other.
- The Node version in `.nvmrc`.

**Operational limits of the scheduled audit.** GitHub disables scheduled
workflows after 60 days without repository activity, and a failed run notifies
the person who last edited the schedule, not a team.

## Not verified at the time of writing

Dependabot reads its configuration from the default branch only, so none of the
following could be observed before merge:

- that it discovers `apps/web` and `packages/*` from the root manifest through
  `pnpm-workspace.yaml`. **This is the assumption to check first.** The first
  batch of pull requests should include a dependency declared in
  `apps/web/package.json` or a `packages/*` manifest. If it does not, replace
  `directory: /` with `directories` listing the workspace packages and group by
  dependency name, so one dependency is one pull request across directories;
- that its pull requests keep `pnpm-lock.yaml` consistent, so that
  `pnpm install --frozen-lockfile` in CI passes on them.

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
