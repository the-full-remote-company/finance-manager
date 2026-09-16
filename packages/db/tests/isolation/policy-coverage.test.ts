import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closePools, ownerDatabase } from "../support/database.js";

/**
 * The structural half of Article I: not "does this table leak" but "does every
 * table have the machinery at all".
 *
 * A leak test can only be written for a table someone remembered to write one
 * for. This test needs no such memory: it reads the catalogue and fails when a
 * new table appears without a policy. That is what stops the next tenant-scoped
 * table from joining the exempt set silently.
 */

/**
 * The only tables permitted to have no policy, per data-model.md:
 *
 *  - auth_attempts is consulted before any workspace is known (FR-005)
 *  - fx_rates is a fact about the world, not about a household (Article II)
 *
 * Adding to this set is a deliberate act that must be argued for in review.
 */
const EXEMPT_FROM_RLS = ["auth_attempts", "fx_rates"] as const;

/** Drizzle's own bookkeeping, not part of the domain. */
const IGNORED = ["__drizzle_migrations"] as const;

describe("row level security coverage", () => {
  afterAll(async () => {
    await closePools();
  });

  it("has ENABLE and FORCE row level security on every non-exempt table", async () => {
    const db = ownerDatabase();
    const result = await db.execute<{
      tablename: string;
      rowsecurity: boolean;
      forcerowsecurity: boolean;
    }>(
      sql`select c.relname as tablename, c.relrowsecurity as rowsecurity, c.relforcerowsecurity as forcerowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
          order by c.relname`,
    );

    const tables = result.rows.filter(
      (row) => !IGNORED.includes(row.tablename as (typeof IGNORED)[number]),
    );
    expect(tables.length).toBeGreaterThan(0);

    const unprotected = tables
      .filter((row) => !EXEMPT_FROM_RLS.includes(row.tablename as (typeof EXEMPT_FROM_RLS)[number]))
      .filter((row) => !row.rowsecurity || !row.forcerowsecurity)
      .map(
        (row) =>
          `${row.tablename} (enabled=${String(row.rowsecurity)}, forced=${String(row.forcerowsecurity)})`,
      );

    expect(unprotected, "tables missing ENABLE/FORCE ROW LEVEL SECURITY").toEqual([]);
  });

  it("has exactly the documented set of tables without a policy", async () => {
    const db = ownerDatabase();
    const result = await db.execute<{ tablename: string }>(
      sql`select c.relname as tablename
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
          order by c.relname`,
    );

    const withoutPolicy = result.rows
      .map((row) => row.tablename)
      .filter((name) => !IGNORED.includes(name as (typeof IGNORED)[number]));

    // Asserted as an exact set, in both directions: a new unprotected table
    // fails here, and so does removing an exemption without updating this list.
    expect(withoutPolicy.sort()).toEqual([...EXEMPT_FROM_RLS].sort());
  });

  it("gives every tenant policy both USING and WITH CHECK", async () => {
    const db = ownerDatabase();
    const result = await db.execute<{
      tablename: string;
      polname: string;
      has_using: boolean;
      has_check: boolean;
    }>(
      sql`select c.relname as tablename,
                 p.polname,
                 p.polqual is not null as has_using,
                 p.polwithcheck is not null as has_check
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
          order by c.relname`,
    );

    expect(result.rows.length).toBeGreaterThan(0);

    // WITH CHECK is what stops an INSERT into another workspace. A policy with
    // USING alone reads as correct and is not.
    const incomplete = result.rows
      .filter((row) => !row.has_using || !row.has_check)
      .map((row) => `${row.tablename}.${row.polname}`);

    expect(incomplete, "policies missing USING or WITH CHECK").toEqual([]);
  });

  it("keeps audit_events append-only by grant", async () => {
    // Article VIII. Enforced by the database, not by remembering not to write
    // an UPDATE statement.
    const db = ownerDatabase();
    const result = await db.execute<{
      update: boolean;
      delete: boolean;
      insert: boolean;
      select: boolean;
    }>(
      sql`select has_table_privilege('app', 'audit_events', 'UPDATE') as update,
                 has_table_privilege('app', 'audit_events', 'DELETE') as delete,
                 has_table_privilege('app', 'audit_events', 'INSERT') as insert,
                 has_table_privilege('app', 'audit_events', 'SELECT') as select`,
    );

    const privileges = result.rows[0];
    expect(privileges?.update).toBe(false);
    expect(privileges?.delete).toBe(false);
    expect(privileges?.insert).toBe(true);
    expect(privileges?.select).toBe(true);
  });

  /**
   * ADR 0007 permits one narrow escape from RLS, so that authentication can
   * resolve a session token to a workspace before any workspace is in scope.
   * ADR 0008 extends the same argument, one step earlier, to sign-in: the
   * server cannot read a password hash under RLS before it knows which
   * workspace the email belongs to either. The set must stay exactly these
   * two, by name: a third such function is a third hole, and would otherwise
   * appear without anyone noticing.
   */
  const SECURITY_DEFINER_FUNCTIONS = ["app_authenticate", "app_resolve_session"] as const;

  it("has exactly the two documented SECURITY DEFINER functions, the auth bootstraps", async () => {
    const db = ownerDatabase();
    const result = await db.execute<{ proname: string }>(
      sql`select p.proname
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
          order by p.proname`,
    );

    expect(result.rows.map((row) => row.proname)).toEqual([...SECURITY_DEFINER_FUNCTIONS]);
  });

  it.each(SECURITY_DEFINER_FUNCTIONS)("pins the search_path of %s", async (proname) => {
    // An unpinned search_path is the standard way a SECURITY DEFINER function
    // is hijacked: the caller creates a schema shadowing a referenced object.
    const db = ownerDatabase();
    const result = await db.execute<{ proconfig: string[] | null }>(
      sql`select p.proconfig
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = ${proname}`,
    );

    expect(result.rows[0]?.proconfig?.join(",")).toMatch(/search_path=/);
  });

  it("returns nothing from app_authenticate beyond what sign-in needs", async () => {
    // Narrow on the same terms as app_resolve_session: no email column back,
    // no display name — only what a password check and a session issuance
    // require.
    const db = ownerDatabase();
    const result = await db.execute<{ column_name: string }>(
      sql`select unnest(p.proargnames) as column_name
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'app_authenticate'`,
    );

    const names = result.rows.map((row) => row.column_name);
    expect(names).not.toContain("email");
    expect(names).not.toContain("display_name");
  });

  it("does not expose the session token hash through the bootstrap function", async () => {
    // The function returns identifiers and lifetimes only. Returning the hash
    // would hand a leaked query result everything needed to impersonate.
    const db = ownerDatabase();
    const result = await db.execute<{ column_name: string }>(
      sql`select unnest(p.proargnames) as column_name
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'app_resolve_session'`,
    );

    const names = result.rows.map((row) => row.column_name);
    expect(names).not.toContain("token_hash");
    expect(names).not.toContain("password_hash");
  });

  it("does not let the application role own or create tables", async () => {
    const db = ownerDatabase();
    const owned = await db.execute<{ count: string }>(
      sql`select count(*)::text as count
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_roles r on r.oid = c.relowner
          where n.nspname = 'public' and c.relkind = 'r' and r.rolname = 'app'`,
    );
    expect(owned.rows[0]?.count).toBe("0");

    const canCreate = await db.execute<{ create: boolean }>(
      sql`select has_schema_privilege('app', 'public', 'CREATE') as create`,
    );
    expect(canCreate.rows[0]?.create).toBe(false);
  });
});
