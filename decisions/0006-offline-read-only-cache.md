# ADR 0006 — Offline support is a read-only cache with no write path

**Status**: Accepted

**Date**: 2026-09-15

**Feature**: `001-recurring-budget-planner`

**Constitution**: "Approved stack" (PWA with offline support), Article IV
(accessibility of the staleness signal), Article VIII (cached personal data must
be erasable); required by "Decision records" — adds a package and an
architectural pattern.

## Context

The spec resolved offline behaviour in its clarification session: read-only
cache, previously viewed months readable and marked possibly stale, saving
requires a connection, no offline editing and no sync queue (FR-035a–FR-035e,
SC-009, SC-011).

An offline write queue would introduce divergent copies, conflict resolution and
a class of silent data loss, all of which the spec places out of scope. The
architecture must make that impossible rather than merely unimplemented.

## Decision

Use Serwist to generate the service worker for `apps/web`.

- **Reads**: tRPC query traffic is issued as HTTP `GET` and cached
  stale-while-revalidate. Each cached response is stored with an `x-cached-at`
  header written at cache time; the UI reads it to state when the data was
  retrieved, per FR-035b.
- **Writes**: mutation traffic is HTTP `POST` and is never cached, never
  queued and never retried by the service worker. When the client is offline a
  mutation fails immediately with a typed `OFFLINE_READ_ONLY` error that the UI
  renders as a refusal, per FR-035c. There is no outbox, so there is nothing for
  a later feature to accidentally start draining.
- **Never-fetched months**: a cache miss while offline is surfaced as a distinct
  `not available offline` state, never as an empty or zeroed month, per
  FR-035d. The UI therefore distinguishes three states: data, no data, not
  available.
- **Form input on connection loss**: the refusal leaves the user's typed input
  in the form. Nothing is cleared on failure.
- **Purge**: sign-out and account deletion delete every `caches` entry for the
  origin and clear any persisted query store, per FR-035e and SC-009.
- **App shell**: precached so the application launches with no network, per
  FR-035a.
- **Staleness indicator**: text plus icon, never colour alone, and not built
  from `--color-gain` or `--color-loss`, which `@tfrc/product` reserves for
  literal market direction.

The tRPC client's transport is pinned explicitly so that queries are `GET`
rather than relying on the default, and a test asserts it. A query whose input
grows past the URL budget would silently become an uncacheable `POST`; the
inputs in this feature are a month key and a presentation flag, and the pinned
configuration plus the test keep it that way.

## Consequences

- FR-035a through FR-035e are satisfied with one cache strategy and no
  synchronisation machinery.
- Offline editing cannot be added by accident. Adding it requires its own spec,
  which is where the spec already places it.
- Cached financial data sits in the browser's Cache Storage, which is personal
  data under Article VIII. The sign-out purge is therefore a correctness
  requirement, tested end-to-end, not a nicety.
- A user offline on a month they have never opened sees an explicit state rather
  than figures. Correct, and better than plausible wrong numbers in a finance
  product.

## Alternatives rejected

- **Background sync with an outbox** — creates divergent copies and conflict
  resolution, both out of scope per the spec, and would make FR-035c
  unimplementable by design.
- **IndexedDB mirror of the commitment set with client-side projection** —
  would move domain arithmetic behind a cache, weakening Article VI's transport
  boundary, and makes the staleness question harder rather than easier because
  the projection would no longer carry a retrieval timestamp.
- **No offline support** — contradicts the "Approved stack" entry requiring a
  PWA with offline support, and FR-035a–FR-035e.
