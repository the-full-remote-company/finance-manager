# ADR 0005 — OpenAPI document generated from tRPC procedures with `trpc-to-openapi`

**Status**: Accepted

**Date**: 2026-09-15

**Feature**: `001-recurring-budget-planner`

**Constitution**: Article VI (transport-agnostic domain, generated OpenAPI);
required by "Decision records" — adds a package and concerns the API transport.

## Context

Article VI fixes the API layer as tRPC for the web client with an OpenAPI
document generated from the same procedures for non-TypeScript clients, requires
procedures to stay annotated so the document remains complete, and states the
document MUST NOT be hand-maintained. The stated reason is a planned native iOS
client that cannot consume tRPC.

A generated document that nobody regenerates is a hand-maintained document with
extra steps, so the mechanism matters less than the staleness gate.

## Decision

Use `trpc-to-openapi`.

- Every procedure intended for external consumption carries
  `.meta({ openapi: { method, path, tags, summary, protect } })`.
- The document is generated at build time into `packages/api/openapi.json` and
  committed.
- CI regenerates it and fails if the committed file differs. A procedure change
  that is not reflected in the document is a build failure, not a review
  finding.
- A contract test asserts every procedure reachable in the router appears in the
  generated document, so adding a procedure without the meta annotation fails
  rather than silently producing an incomplete document.
- The REST handler is mounted but not consumed by `apps/web`, which uses tRPC
  directly. It exists so the iOS client is an addition rather than a rewrite.

## Consequences

- The document cannot drift, because drift is red CI.
- Zod schemas serve as the single description of the request and response
  surface, so validation and documentation cannot disagree.
- `trpc-to-openapi` does not support batched calls on its REST handler, and its
  path and method annotations are manual. Accepted: the annotation burden is
  what the contract test polices.
- Subscriptions and non-JSON payloads are outside what the generator expresses.
  Neither appears in this feature; a future feature needing them writes its own
  ADR.

## Alternatives rejected

- **Hand-written OpenAPI specification** — explicitly forbidden by Article VI.
- **Generating types for iOS from the tRPC router directly** — would couple a
  Swift client to a TypeScript-only protocol, which is the exact coupling
  Article VI's rationale exists to prevent.
- **A parallel REST layer written by hand** — two descriptions of one surface,
  guaranteed to diverge, and double the validation code.
