# Design system promotion candidates

Required by Article V. `@tfrc/product` is consumed, never forked; components it
does not ship are built locally in `packages/ui` on its published tokens.

**The rule**: a component is promoted upstream on its **third identical use**,
never earlier, and the local duplicates are deleted in the same upstream release
cycle. React implementations stay in this repository; only CSS and tokens
graduate.

**Why three**: promoting on first duplication produces wrong abstractions that
cost quarters to unwind. Two uses is a coincidence; three is a pattern.

This file MUST be updated in the same commit that makes it stale. A stale
tracking file is worse than none, because the next contributor will trust it.

## Candidates

| Component | Uses | Where | Promote at | Notes |
|---|---|---|---|---|
| `Table` | 0 | — | 3 | Not shipped by `@tfrc/product`. Needed for the amount history panel. |
| `DatePicker` | 0 | — | 3 | Not shipped. Needed for start date, contract end date, notice deadline, amount effective-from. Day precision; the projection reduces it to a month. |
| `Select` | 0 | — | 3 | Not shipped. Needed for category, account and rhythm selection. |
| `Modal` | 0 | — | 3 | Not shipped. Needed for the `STILL_REFERENCED` refusal and the delete-account confirmation. |

Counts are 0 until the components are built and used. Nothing here is a
promotion candidate yet, and nothing may be promoted before its third use.

## Consumed from `@tfrc/product@1.1.0`

17 classes, asserted by `packages/ui/tests/design-system-contract.test.ts` so an
upstream rename fails our build rather than a screen:

`.btn` `.btn--primary` `.btn--secondary` `.btn--ghost` `.btn--block` `.field`
`.list` `.row` `.amt` `.amt--gain` `.amt--loss` `.balance` `.pill`
`.pill--gain` `.pill--loss` `.seg` `.tabs`

`--color-gain` and `--color-loss` are reserved by the package for literal market
direction. In this product, income and expense direction is literal money
direction, so `.amt--gain` and `.amt--loss` are correct consumers. The
reserve-versus-expense distinction and the offline staleness indicator are
*status*, not direction, and use neither.

## Open gate: `tfrc-verify`

Article V requires `npx tfrc-verify` to pass in CI. **No such package is
published** — verified 2026-09-15 against the registry, which carries exactly
`@tfrc/foundation`, `@tfrc/marketing` and `@tfrc/product` at 1.1.0, none with a
`bin`.

`scripts/verify-design-system.mjs` performs the checks the constitution
attributes to the tool: exact pins on every `@tfrc/*` dependency, absence of
`@tfrc/marketing`, nothing vendored, and the consumed classes present in the
installed package. The CI job runs the real tool as soon as it exists.

This is a stop-gap and is recorded here rather than resolved silently, because
Article IX forbids weakening a gate and forbids asserting an unverifiable claim.
If it outlives the first release it needs an ADR.
