# 10. Every resource the service worker caches declares its invalidation trigger in the same change

Date: 2026-10-20

## Status

Accepted.

## Context

[ADR 0006](./0006-offline-read-only-cache.md) made the service worker a
read-through cache with no write path. It says what is cached and that nothing
is queued. It does not say how a cached answer stops being served after a
mutation, and that gap has produced the same bug twice in feature 001:

1. **User Story 3.** The first matcher cached every `GET`. That included
   `accounts` and `categories`, so a screen that created a record and then
   re-listed it was answered from cache and did not show the record. The fix
   narrowed the matcher.
2. **User Story 5.** Editing a commitment and reopening the dashboard showed
   the pre-edit figures. The `dashboard-queries` cache is
   stale-while-revalidate, which by design answers from cache first, whether or
   not the device is online and however fresh the entry is. Nothing told it a
   mutation had happened elsewhere. The fix: `handleMutation` in `apps/web/sw.ts`
   deletes the whole `dashboard-queries` cache after any successful (online)
   mutation. That is deliberately coarse, because the worker cannot parse a
   tRPC payload to learn which month a mutation affected.

Both were found by end-to-end tests exercising read-after-write, after the
cache had already been written. A later user story that adds a cached read
(`transfers.month` in User Story 6 is the next candidate) would repeat the
pattern.

## Decision

A resource may be added to a service-worker cache only in a change that also
states, and tests, what invalidates it:

- the cache name and the matcher that fills it,
- the event that empties it (which mutations, online only or also on reconnect),
- an end-to-end test that performs a mutation and then reads through the cache.

If an entry cannot name its trigger, it is not cached.

If a third read-after-write failure appears, the response is not another point
patch. The cache is scoped far more narrowly, or that resource stops being
cached.

## Consequences

- The cost of caching a resource is paid when it is added, not when a user
  sees stale money figures.
- `handleMutation`'s blanket deletion of `dashboard-queries` stays valid until
  the worker can learn which month was touched; making it finer-grained would
  need the invalidation signal to carry that information.
- A new cached read in a later story needs a read-after-write e2e test in the
  same change, which is a larger change than adding a route to the matcher.
