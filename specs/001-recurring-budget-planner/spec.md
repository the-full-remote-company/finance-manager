# Feature Specification: Recurring Budget Planner

**Feature Branch**: `001-recurring-budget-planner`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Replace the spreadsheet I use to plan my monthly fixed incomes and expenses. Each entry has a category, a source account, a payment rhythm, a contract end date and a description. The main view is a dashboard showing all incomes and expenses summed per category per month. It must also show which money has to be transferred from one account to another in a given month."

## Clarifications

### Session 2026-09-01

- Q: When you try to delete a category or an account that commitments still point at, what should happen? (FR-009) → A: Block the deletion, showing how many commitments reference it; renaming remains freely available.
- Q: If a commitment starts on 15 March, does March count as a month it applies to, or does it begin in April? (FR-026) → A: Whole months, inclusive at both ends. Any date falling within a month makes that whole month count, and amounts are never prorated.
- Q: A quarterly insurance of 300 € is charged in January but the contract ends in February — what should the smoothed view show? (FR-027, FR-028) → A: Smooth across the full period, then display only the active months. January 100 €, February 100 €, March's share dropped. Smoothing is a presentation aid, never a restatement of what is owed.
- Q: When several commitments with share percentages are added up for a transfer, where should the cents be rounded? (FR-039) → A: Round each commitment's share to whole cents as it is computed, then sum. Every displayed line is a transferable amount and the total is the sum of the lines.
- Q: When you open the app on your phone with no signal, what should you be able to do? (Story 3) → A: Read-only cache. Previously viewed months remain readable and are marked as possibly stale; saving requires a connection. No offline editing and no sync queue.

## User Scenarios & Testing *(mandatory)*

The user currently maintains a spreadsheet with roughly 120 expense entries across 13
categories, 8 income entries and 4 source accounts, plus a set of savings destinations.
This feature replaces that spreadsheet. It is a **forward-looking planner**: it models
standing commitments and projects them onto a calendar. It does not record what was
actually spent.

### User Story 1 - A private, isolated workspace (Priority: P1)

A person signs up, and everything they enter belongs to their workspace and is visible
to no one else. The workspace exists as a first-class container from the first entry,
even though only one person uses it today.

**Why this priority**: The data is household financial information — salaries, rent,
insurance policies. Isolation is the precondition for storing any of it, and it cannot
be added later without touching every record. Nothing else in this specification may be
built before this holds.

**Independent Test**: Create two workspaces with data in each. Verify from each session
that no record belonging to the other workspace is readable, writable or deletable
through any route, including by direct identifier.

**Acceptance Scenarios**:

1. **Given** no account exists, **When** a person registers, **Then** a workspace is
   created for them and they are its only member.
2. **Given** two workspaces each containing commitments, **When** a member of workspace A
   requests a commitment belonging to workspace B by its identifier, **Then** the system
   responds as if the record does not exist, and no data from workspace B is disclosed.
3. **Given** a signed-in member, **When** the session expires or is revoked, **Then** no
   workspace data is reachable until they sign in again.
4. **Given** repeated failed sign-in attempts, **When** a threshold is exceeded, **Then**
   further attempts are throttled.

---

### User Story 2 - Capture what I am committed to paying and receiving (Priority: P2)

The user records each standing income and expense: a name, the category it belongs to,
the account it is charged to or paid into, how much, and how often.

**Why this priority**: Nothing can be displayed before the data exists. This is the
entry point for every other story.

**Independent Test**: Enter one income and one expense, reopen the list, and confirm both
persist with every field intact.

**Acceptance Scenarios**:

1. **Given** an empty workspace, **When** the user creates an account named
   "Girokonto" and a category named "Wohnen", **Then** both are available for
   selection when creating a commitment.
2. **Given** a category referenced by commitments, **When** the user attempts to delete
   it, **Then** the deletion is refused and the number of referencing commitments is
   shown; renaming the same category succeeds.
3. **Given** a category and an account exist, **When** the user creates an expense
   "Miete" of 950,00 € charged monthly to that account, **Then** it appears in the
   commitment list under that category.
4. **Given** an existing commitment, **When** the user edits its amount, category,
   account or description, **Then** the change is reflected everywhere it appears.
5. **Given** an existing commitment, **When** the user deletes it, **Then** it no longer
   appears in any month, including past months in the horizon.
6. **Given** the user is creating a commitment, **When** they omit a required field,
   **Then** the system explains which field is missing and does not save.
7. **Given** amounts are entered, **When** they are displayed, **Then** they are formatted
   in German locale conventions with a euro symbol.

---

### User Story 3 - See a month summarised by category (Priority: P3)

The dashboard shows one month at a time: total income, each expense category with its
total, and each category's share of that month's income.

**Why this priority**: This is the view the user opens repeatedly and the reason the
spreadsheet exists. It is the product's core value.

**Independent Test**: With a known set of commitments, open a month and verify each
category total equals the sum of its commitments for that month, and that the
percentages match those totals divided by that month's income.

**Acceptance Scenarios**:

1. **Given** commitments exist across several categories, **When** the user opens the
   dashboard for a month, **Then** total income, each expense category's total, the
   overall expense total and the remaining amount are displayed.
2. **Given** a month's income is greater than zero, **When** category totals are shown,
   **Then** each category also shows its total as a percentage of that month's income.
3. **Given** a month's income is zero, **When** the dashboard is shown, **Then**
   percentages are suppressed rather than displayed as an error or as zero.
4. **Given** the dashboard is open on a month, **When** the user navigates to the
   previous or next month, **Then** the view updates to that month without losing the
   user's position in the page.
5. **Given** a category has no commitments active in the displayed month, **When** the
   dashboard is shown, **Then** that category is either omitted or shown as zero,
   consistently.
6. **Given** the dashboard is viewed on a phone, **When** the user reads it, **Then** all
   figures are legible without horizontal scrolling.
7. **Given** a month has been viewed before, **When** the device is offline and the user
   opens that month, **Then** the figures are shown together with an indication that
   they may be out of date and when they were retrieved.
8. **Given** the device is offline, **When** the user attempts to save any change,
   **Then** the change is refused with an explanation and is not queued.

---

### User Story 4 - Handle payments that are not monthly (Priority: P4)

Some commitments are charged quarterly, half-yearly or yearly. The user needs both a
smoothed monthly figure for comparing categories and the real cash figure for knowing
what leaves the account in a given month.

**Why this priority**: Around a sixth of the user's entries are non-monthly. Without
this, either the category comparison or the cash view is wrong.

**Independent Test**: Enter a quarterly commitment of 66,03 € anchored to January.
Verify the smoothed view shows 22,01 € in every month, the cash view shows 66,03 € in
January, April, July and October and nothing in the other months, and that both views
total 264,12 € over twelve months.

**Acceptance Scenarios**:

1. **Given** a commitment with a non-monthly rhythm, **When** the user saves it without
   specifying the month in which it is charged, **Then** the system refuses and explains
   that an anchor month is required.
2. **Given** a quarterly commitment anchored to January, **When** the cash view is shown,
   **Then** the full charge appears in January, April, July and October, and zero in all
   other months.
3. **Given** the same commitment, **When** the smoothed view is shown, **Then** one third
   of the charge appears in every month.
4. **Given** a charge amount that does not divide evenly across its period, **When** the
   smoothed view is shown, **Then** the smoothed amounts across one full period sum
   exactly to the charge amount, with no cent gained or lost.
5. **Given** a quarterly commitment of 240,00 € anchored to January that ends in
   February, **When** the smoothed view is shown, **Then** January and February each
   show 80,00 € and March shows nothing, and the cash view still shows the full
   240,00 € in January.
6. **Given** either view is selected, **When** the user navigates between months or
   returns to the dashboard later, **Then** the chosen view is retained.
7. **Given** a one-off commitment, **When** it is projected, **Then** it appears in its
   single specified month in the cash view and is not smoothed across other months.

---

### User Story 5 - Separate money set aside from money spent (Priority: P5)

Some entries are not consumption but accumulation — loan principal repayment, ETF
savings plans, reserves for holidays or purchases. The dashboard reports these
separately from expenses.

**Why this priority**: Without it the headline expense figure is materially overstated,
because savings sit inside categories that are otherwise expenses.

**Independent Test**: Mark one commitment inside an otherwise-expense category as a
reserve. Verify it is excluded from that category's expense total, included in the
reserves total, and that expenses plus reserves equals the previous combined total.

**Acceptance Scenarios**:

1. **Given** a commitment marked as a reserve, **When** the dashboard is shown, **Then**
   it contributes to the reserves total and not to the expense total.
2. **Given** a category containing both expense and reserve commitments, **When** the
   dashboard is shown, **Then** the category's expense total excludes the reserve items.
3. **Given** any month, **When** totals are shown, **Then** expenses plus reserves equals
   the sum of all outgoing commitments for that month.
4. **Given** a commitment's reserve flag is changed, **When** the dashboard is reopened,
   **Then** all affected totals reflect the change.

---

### User Story 6 - Know what to transfer between my accounts (Priority: P6)

Several commitments are charged to one account but are really funding another — a
savings pocket, a depot, a child's account. For a chosen month the user needs a list of
"move this amount to that account".

**Why this priority**: This is the task the spreadsheet performs worst and the main
reason the user opens it at month start. It is the strongest reason to replace the
spreadsheet rather than tidy it.

**Independent Test**: Create three commitments targeting the same destination account and
one targeting another. Verify the transfer view lists two destinations with correct sums
for the selected month.

**Acceptance Scenarios**:

1. **Given** commitments with a transfer destination, **When** the transfer view is shown
   for a month, **Then** each destination account appears once with the sum of amounts
   routed to it in that month.
2. **Given** a commitment with a share percentage below 100, **When** it is included in a
   transfer total, **Then** only that share of its amount is counted.
3. **Given** a commitment with no transfer destination, **When** the transfer view is
   shown, **Then** it does not appear there.
4. **Given** a commitment whose destination equals its source account, **When** the user
   attempts to save it, **Then** the system refuses and explains why.
5. **Given** a month in which no commitment routes anywhere, **When** the transfer view is
   shown, **Then** an explanatory empty state is displayed rather than a blank screen.
6. **Given** a commitment of 40,01 € at a 50% share, **When** the transfer view is
   shown, **Then** its line reads 20,01 € and the destination total includes exactly
   that figure.
7. **Given** several shared commitments contribute to one destination, **When** the
   transfer view is shown, **Then** the destination total equals the sum of the
   displayed lines with no reconciling difference.

---

### User Story 7 - Track when contracts start, end and must be cancelled (Priority: P7)

Each commitment can carry a start date, a contract end date and a cancellation notice
deadline, so projections stop when the contract does and the user is not surprised by an
automatic renewal.

**Why this priority**: Without start and end dates the projection is wrong for anything
that does not run forever; the notice deadline is the field that prevents money being
wasted.

**Independent Test**: Give a commitment an end date inside the horizon. Verify it is
included in months up to and including that date and absent from every month after it.

**Acceptance Scenarios**:

1. **Given** a commitment with a start date, **When** months before the month of that
   date are viewed, **Then** the commitment does not appear in them.
2. **Given** a commitment starting on 15 March, **When** March is viewed, **Then** the
   commitment appears with its full amount, not a part of it.
3. **Given** a commitment with a contract end date, **When** months after the month of
   that date are viewed, **Then** the commitment does not appear and totals exclude it.
4. **Given** a commitment with a notice deadline approaching, **When** the user views the
   commitment list, **Then** that deadline is visible without opening the record.
5. **Given** an end date earlier than the start date, **When** the user saves, **Then**
   the system refuses and explains why.
6. **Given** a commitment with a free-text description, **When** it is displayed, **Then**
   the description is available without leaving the list.

---

### User Story 8 - Record amounts that change over time (Priority: P8)

Amounts are not constant. Rent increases; loan interest and principal shift every single
month. The user records an amount as valid from a date, and can override a single month
where needed.

**Why this priority**: Without it, editing an amount silently rewrites history and past
months stop being truthful. The user's existing data already contains month-by-month
variation.

**Independent Test**: Give a commitment 900,00 € from January and 945,00 € from June.
Verify May shows 900,00 € and June shows 945,00 €. Then override March to 0,00 € and
verify only March changes.

**Acceptance Scenarios**:

1. **Given** a commitment with two amounts having different effective dates, **When**
   months on either side of the later date are viewed, **Then** each month shows the
   amount in force for that month.
2. **Given** a commitment with an override for a specific month, **When** that month is
   viewed, **Then** the override is used instead of the effective amount.
3. **Given** an override exists for a month, **When** the override is removed, **Then**
   the month reverts to the effective amount.
4. **Given** an override is entered for a month in which the commitment is not active,
   **Then** the system refuses and explains why.
5. **Given** the user changes a current amount, **When** earlier months are viewed,
   **Then** those months are unchanged.

---

### User Story 9 - Take my data out, or remove it entirely (Priority: P9)

The user can export everything the system holds about them in a machine-readable form,
and can delete their account such that the data is genuinely gone.

**Why this priority**: Legally required, and cheap to build now versus expensive and
usually incomplete when retrofitted.

**Independent Test**: Populate a workspace, export it, and verify every entity and field
is present. Then delete the account and verify no data remains reachable in any store.

**Acceptance Scenarios**:

1. **Given** a populated workspace, **When** the user requests an export, **Then** they
   receive a machine-readable file containing all accounts, categories, commitments,
   amounts, overrides and workspace metadata.
2. **Given** a signed-in user, **When** they request account deletion and confirm it,
   **Then** all their data is removed and they are signed out.
3. **Given** an account has been deleted, **When** any previously valid identifier is
   requested, **Then** no data is returned.
4. **Given** a deletion or export is performed, **When** the audit log is inspected,
   **Then** the event is recorded.

---

### Edge Cases

- A non-monthly commitment is saved without an anchor month → rejected with an
  explanation (FR-014).
- A charge amount does not divide evenly by its period, e.g. 100,00 € quarterly →
  smoothed months must sum to exactly 100,00 € per period, never 99,99 € or 100,02 €.
- A commitment ends part-way through a rhythm period → the cash view shows the charge
  only if the due month falls within the active months; the smoothed view shows the
  unchanged per-month share for the active months and simply omits the rest, so the
  smoothed total for that period is less than the charge.
- A commitment starts part-way through a rhythm period, after the due month → the cash
  view shows nothing for that period, while the smoothed view still shows the share for
  the active months. The two views legitimately disagree here.
- A commitment's start date falls after its anchor month → the first due month is the
  first occurrence on or after the start month.
- A commitment starts and ends within the same month → that single month counts in full.
- Two amounts have effective dates on different days of the same month → rejected, since
  both would be in force from the same month and the outcome would be undefined.
- A category is deleted while commitments reference it → deletion is refused and the
  number of referencing commitments is shown; the user renames or edits instead.
- An account is deleted while referenced as a source or as a transfer destination → same
  treatment as categories; both reference kinds count toward the reported total.
- The last remaining category or account is deleted while unreferenced → permitted; the
  commitment form must then explain that a category or account has to be created first.
- A transfer destination equals the source account → rejected.
- A share percentage of 0 → the commitment contributes nothing to transfers but still
  appears in category totals; this must be deliberate and consistent.
- A share percentage produces exactly half a minor unit, e.g. 50% of 40,01 € → rounded
  half-up to 20,01 €, and the same input always produces the same output.
- Rounded shares of several commitments to one destination each gain a cent → the
  destination total is the sum of those rounded lines and may exceed the exact
  mathematical total; this is accepted, because every line must be transferable.
- Total income for a month is zero → percentage of income is suppressed, not divided by
  zero.
- A month at the very edge of the 24-month horizon → navigation stops at the boundary
  with a clear indication rather than an empty screen.
- A commitment amount of zero → permitted, so that a paused contract can be represented
  without deletion.
- A negative amount is entered → rejected; direction is determined by whether the entry
  is an income or an expense, not by sign.
- Two amount records for the same commitment with the same effective date → rejected.
- The same month is overridden twice → the later write replaces the earlier one; no
  duplicate overrides may exist.
- A very long commitment or category name on a narrow screen → truncated with the full
  value still reachable, never overlapping other figures.
- The user's device is offline and opens a previously viewed month → the cached figures
  are shown, marked as possibly out of date with the time they were retrieved.
- The user's device is offline and opens a month never viewed before → an explicit "not
  available offline" state is shown, distinct from a month that genuinely has no data.
- The user's device is offline and attempts to save → the change is refused with an
  explanation, and is neither queued nor silently retried.
- The user signs out on a shared or lost device → all cached workspace data is discarded.
- Connectivity is lost mid-edit → the same refusal applies; the user's typed input
  remains on screen so nothing has to be retyped once the connection returns.

## Requirements *(mandatory)*

### Functional Requirements

**Workspace and access**

- **FR-001**: System MUST create exactly one workspace for a person when they register,
  with that person as its only member.
- **FR-002**: System MUST scope every account, category, commitment, amount and override
  to exactly one workspace.
- **FR-003**: System MUST prevent any read, write or delete of a record belonging to a
  workspace the requester is not a member of, and MUST NOT disclose the record's
  existence.
- **FR-004**: System MUST require authentication for every route that reads or writes
  workspace data.
- **FR-005**: System MUST throttle repeated failed authentication attempts.
- **FR-006**: System MUST record authentication, export and deletion events in an
  append-only audit log.

**Reference data**

- **FR-007**: Users MUST be able to create, rename, reorder and delete accounts. An
  account has a name and an optional note. It has no balance and no bank identifier.
- **FR-008**: Users MUST be able to create, rename, reorder and delete categories. A
  category has a name and belongs to either income or expense.
- **FR-009**: System MUST refuse deletion of a category or account that is still
  referenced by any commitment, and MUST tell the user how many commitments reference
  it. Reassignment flows are not provided; the user edits the commitments first.
- **FR-009a**: System MUST allow a category or account to be renamed at any time,
  including while referenced, without affecting the commitments that reference it.

**Commitments**

- **FR-010**: Users MUST be able to create, edit and delete commitments. A commitment
  represents a standing income or expense, not an individual payment.
- **FR-011**: A commitment MUST have: a name, a direction (income or expense), a
  category, a source account, a rhythm, a start date, and at least one amount.
- **FR-012**: A commitment MAY have: a contract end date, a cancellation notice deadline,
  a free-text description, a transfer destination account, and a share percentage.
- **FR-013**: System MUST support the rhythms monthly, quarterly, half-yearly, yearly and
  one-off.
- **FR-014**: System MUST require an anchor month for any rhythm other than monthly, and
  MUST reject the commitment if it is absent.
- **FR-015**: System MUST default the share percentage to 100 and MUST accept values from
  0 to 100.
- **FR-016**: System MUST reject a commitment whose transfer destination equals its
  source account.
- **FR-017**: System MUST reject a contract end date earlier than the start date.
- **FR-018**: System MUST classify each commitment as either an expense or a reserve, and
  MUST allow this to differ between commitments in the same category.
- **FR-019**: System MUST store monetary amounts as whole minor units with an explicit
  currency and MUST NOT use floating-point representation at any point.
- **FR-020**: System MUST reject negative amounts.

**Amounts over time**

- **FR-021**: Users MUST be able to record multiple amounts for a commitment, each valid
  from a given date, and the system MUST apply the amount in force for the month being
  displayed.
- **FR-022**: Users MUST be able to override the amount for a single specific month, and
  that override MUST take precedence over the effective amount.
- **FR-023**: System MUST allow an override to be removed, restoring the effective
  amount.
- **FR-024**: System MUST reject an override for a month in which the commitment is not
  active, and MUST reject a second amount with an effective date that already exists.

**Projection**

- **FR-025**: System MUST project commitments across a rolling horizon of 24 months, and
  MUST allow the user to navigate freely to any month within it.
- **FR-026**: System MUST include a commitment in a month if that month contains or
  follows the month of its start date, and contains or precedes the month of its
  contract end date where one is present. Comparison is at whole-month granularity: a
  date anywhere within a month makes that entire month count at both ends.
- **FR-026a**: System MUST NOT prorate any amount by day count. A commitment active for
  part of a month contributes its full amount for that month.
- **FR-026b**: System MUST apply the same whole-month rule to the effective date of an
  amount: an amount effective from any day in a month is in force from that whole month
  onward.
- **FR-027**: System MUST offer two presentations of the same data: a smoothed view, in
  which a non-monthly charge is divided evenly across the months of its period, and a
  cash view, in which the full charge appears only in the months it is actually due.
- **FR-028**: System MUST ensure that smoothed amounts across one complete rhythm period
  sum exactly to the charge amount, with no minor unit lost or created.
- **FR-028a**: System MUST smooth a charge across every month of its rhythm period, then
  display only those months in which the commitment is active. A period that is cut
  short by a start or end date MUST NOT be re-smoothed across the remaining months, and
  MUST NOT be suppressed.
- **FR-028b**: System MUST NOT claim that the smoothed and cash views produce equal
  totals over an arbitrary range. They are equal only over ranges in which every rhythm
  period is fully covered by the commitment's active months.
- **FR-029**: System MUST determine due months from the anchor month and the rhythm, and
  MUST NOT place a due month before the start date.
- **FR-030**: System MUST retain the user's chosen presentation across month navigation
  and between sessions.

**Dashboard**

- **FR-031**: System MUST display, for a selected month: total income, each expense
  category with its total, the overall expense total, the reserves total, the combined
  total, and the remaining amount after both.
- **FR-032**: System MUST exclude reserve commitments from expense category totals and
  include them in the reserves total.
- **FR-033**: System MUST display each category total as a percentage of that month's
  total income, and MUST suppress the percentage when income for that month is zero.
- **FR-034**: System MUST display incomes for the selected month as a list with a total.
- **FR-035**: System MUST present the dashboard legibly on a small screen without
  horizontal scrolling.

**Offline behaviour**

- **FR-035a**: System MUST be installable on a phone and MUST launch without a network
  connection.
- **FR-035b**: System MUST keep previously viewed months readable while offline, and MUST
  mark them as possibly out of date, stating when they were last retrieved.
- **FR-035c**: System MUST refuse any create, edit or delete while offline, and MUST
  explain that a connection is required. It MUST NOT queue the change, retry it silently,
  or appear to have saved it.
- **FR-035d**: System MUST NOT present a month that has never been retrieved as empty
  while offline; it MUST distinguish "no data" from "not available offline".
- **FR-035e**: System MUST discard all cached workspace data on sign-out and on account
  deletion, leaving no financial data readable on the device afterwards.

**Transfers**

- **FR-036**: System MUST display, for a selected month, each transfer destination
  account together with the total amount routed to it.
- **FR-037**: System MUST apply the share percentage when computing transfer amounts.
- **FR-038**: System MUST exclude commitments without a transfer destination from the
  transfer view.
- **FR-039**: System MUST round each commitment's share to whole minor units at the point
  the share is applied, and MUST compute the destination total as the sum of those
  already-rounded amounts. It MUST NOT carry fractional minor units into the total.
- **FR-039a**: System MUST use half-up rounding, and MUST apply it identically wherever a
  share is computed, so that the same commitment always yields the same amount.
- **FR-039b**: System MUST ensure the displayed total for a destination account equals
  the sum of the displayed lines contributing to it, exactly, with no reconciling
  difference.

**Data rights**

- **FR-040**: Users MUST be able to export all of their workspace data in a
  machine-readable format.
- **FR-041**: Users MUST be able to delete their account, resulting in genuine erasure of
  their data rather than a hidden flag.

**Presentation**

- **FR-042**: System MUST format all monetary values and dates according to German
  locale conventions, and MUST NOT hard-code user-facing text in a way that prevents
  later translation.
- **FR-043**: System MUST convey direction and sign of every amount by more than colour
  alone.
- **FR-044**: System MUST meet WCAG 2.2 Level AA on every screen in this feature.

### Key Entities

- **Workspace**: The isolation boundary. Owns all other records. Has exactly one member
  in this release.
- **User**: A person who can sign in. Belongs to one workspace.
- **Account**: A named place money sits or moves through — a current account, a savings
  pocket, a depot. Name and optional note only. No balance, no bank identifier.
- **Category**: A named grouping for commitments, flagged as income or expense, with a
  user-defined display order. Single level; no nesting.
- **Commitment**: A standing income or expense. Carries name, direction, category, source
  account, rhythm, anchor month, start date, optional contract end date, optional notice
  deadline, optional description, optional transfer destination, share percentage, and
  the expense-or-reserve classification.
- **CommitmentAmount**: An amount for a commitment, valid from a date. A commitment has
  one or more, forming a history. The amount is the charge actually made, not a smoothed
  figure.
- **AmountOverride**: An amount replacing the effective amount for one specific month of
  one commitment.
- **AuditEvent**: An append-only record of a security-relevant action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The user reproduces their current spreadsheet in the system, and for every
  one of the 13 categories in a chosen month, the category total matches the spreadsheet
  to the cent.
- **SC-002**: Smoothed amounts for every non-monthly commitment sum, across a rhythm
  period fully covered by the commitment's active months, to exactly the charge amount,
  verified for at least one thousand generated amount and period combinations. For
  periods only partially covered, the smoothed total equals the per-month share times
  the number of active months in that period.
- **SC-003**: The transfer list for a chosen month matches the amounts the user currently
  transfers by hand, to the cent, for every destination that does not depend on a second
  person's share and whose current figure is not deliberately rounded up to whole euros
  by the user's existing practice.
- **SC-004**: A person with data in one workspace can reach zero records belonging to
  another workspace, demonstrated by an automated test covering every workspace-scoped
  entity.
- **SC-005**: A user can add a new commitment on a phone in under 60 seconds, including
  selecting category and account.
- **SC-006**: The dashboard for a month becomes readable within 2 seconds on a mid-range
  phone over a typical mobile connection, and switching months takes under 1 second.
- **SC-007**: Automated accessibility checks report zero violations at serious or
  critical severity on every screen in this feature.
- **SC-008**: An export contains every field of every record the workspace holds,
  verified by comparing a populated workspace against its export, field by field.
- **SC-009**: After account deletion, zero records associated with that user remain
  reachable in any store, including any cache held on the device.
- **SC-011**: With the device offline, a previously viewed month renders within 2 seconds
  and is visibly marked as possibly out of date; a month never viewed shows an explicit
  offline state rather than zeroes.
- **SC-010**: The user completes one full month of planning without opening the
  spreadsheet.

## Assumptions

- The system is used by one person in this release. Workspaces exist as a first-class
  concept from the outset so that shared households require no data migration later.
- Data is planned, not actual. There is no reconciliation against real bank activity, and
  no notion of a payment having occurred.
- Existing spreadsheet data is entered by hand. No import is built; the volume is roughly
  130 records and hand entry is a one-off cost.
- All amounts are in euro. Currency is stored explicitly on every amount so that
  additional currencies can be added later without a schema migration, but no conversion,
  rate handling or multi-currency display exists in this release.
- Accounts are labels. The system holds no balances, no IBANs and no connection to any
  bank, and therefore stores no bank identifiers requiring special protection.
- Planning granularity is the whole month. Dates are captured with day precision so that
  a cancellation notice deadline remains meaningful, but every projection comparison is
  made at month level and no amount is ever prorated.
- The 24-month horizon is rolling relative to the current month. Months outside it are
  not reachable.
- Loan schedules are entered as values by the user. The system does not compute interest
  or amortisation schedules from a rate and principal.
- Offline support is read-only. There is no synchronisation, no local write queue and no
  conflict resolution in this release, and therefore no possibility of divergent copies.
- The primary interaction is reading the dashboard on a phone. Editing is less frequent
  and may use a plainer, more form-like presentation.
- Visual presentation is built on the organisation's published design system, consumed as
  released packages and themed for this product.

### Out of Scope

The following are explicitly excluded from this feature and require their own
specification:

- Recording actual transactions, reconciliation, or any comparison of planned to actual.
- Shared households: inviting a partner, roles, permissions, and the split of a shared
  account between two people beyond the per-commitment share percentage.
- Account balances, projected balances, and balance-after-transfer figures.
- Bank connectivity, statement import, and any file-based import including CSV.
- Multi-factor authentication and passkeys.
- Attachments, receipts, tags, split entries, and net worth tracking.
- Interest and loan schedule calculation.
- Notifications and reminders, including for cancellation deadlines. The deadline is
  displayed; nothing is sent.
- Offline editing, background synchronisation and conflict resolution.
- Rounding a transfer up to the next whole euro as a deliberate buffer, which the user's
  spreadsheet currently does for one shared account.
- The user's other spreadsheet tabs: holiday planning, purchase wish list, pocket money,
  pension projection, and the monthly income-and-expenditure sheet.
