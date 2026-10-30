# 9. The confirmation link carries the workspace id, so confirmation needs no privileged lookup

Date: 2026-10-19

## Status

Accepted.

## Context

`auth.confirm` (feature 002) is called by someone with no session, holding only
the token from an emailed link. `confirmation_tokens` is tenant-scoped and under
forced row-level security, so a lookup by token hash returns zero rows until
`app.workspace_id` is set, and the workspace is what the row would tell us.
This is the same bootstrap circularity ADRs 0007 and 0008 met for session
tokens and for sign-in.

The first implementation of `auth.confirm` queried the table with no workspace
set. Against the real database every link was rejected as `TOKEN_INVALID`, so
confirmation could never succeed. Mocked tests would not have found it; a test
against the application role did.

ADRs 0007 and 0008 solved the circularity with `SECURITY DEFINER` functions,
and `policy-coverage.test.ts` pins the set to exactly those two.

## Decision

The link carries `<workspaceId>.<secret>`. `auth.confirm` parses it, opens a
transaction scoped to that workspace, and looks the token up under ordinary
row-level security. No third `SECURITY DEFINER` function is added and the
guard test is unchanged.

`auth.resendConfirmation` needs a user lookup by email before a workspace is
known. It reuses `app_authenticate` (ADR 0008), which already returns
`user_id`, `workspace_id` and `confirmed`.

## Why this and not a third definer function

- A `SECURITY DEFINER` function runs as the table owner and bypasses RLS. It
  is the highest-risk construct in the schema: a mistake in one is a
  cross-tenant read. Article I's surface should not grow when it can be avoided.
- The workspace id is not a secret. It travels only in the email to the
  account's owner, who is the person the link is for. The 128-bit secret is
  still required, and only its SHA-256 hash is stored or compared.
- A wrong or foreign workspace id fails exactly like an unknown token: the
  rows are invisible. A test asserts that another workspace's id on a real
  secret is refused and consumes nothing.

## Consequences

- Links are 37 characters longer (`<uuid>.`) and URL-safe without encoding.
- Tokens issued before this change do not exist: the feature had not shipped.
- `parseConfirmToken` accepts only a lower-case UUID, one dot, and a non-empty
  base64url string. Anything else is treated as an unknown token.
- A failed confirmation is audited with no workspace and no user, because
  nothing about the caller's identity was proven.
