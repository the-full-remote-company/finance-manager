#!/usr/bin/env node
/**
 * Seeds two workspaces with overlapping data, per the quickstart.
 *
 * Two, not one, and deliberately: a single-workspace seed makes a tenancy bug
 * invisible during manual testing, because there is no other tenant's data to
 * accidentally see.
 *
 * The password hash is a placeholder string, not a real argon2id digest —
 * nothing verifies it yet (T054). Signing in with this seed is not possible by
 * design; it exists to give the dashboard something to render.
 */

import pg from "pg";

const url = process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance";

const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "db"].includes(host)) {
  console.error(`refusing to seed a non-local database: ${host}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query('TRUNCATE TABLE "workspaces" CASCADE');
await client.query('TRUNCATE TABLE "audit_events"');

for (const name of ["Haushalt A", "Haushalt B"]) {
  const workspace = await client.query(
    'INSERT INTO "workspaces" ("name") VALUES ($1) RETURNING "id"',
    [name],
  );
  const workspaceId = workspace.rows[0].id;

  await client.query(
    `INSERT INTO "users" ("workspace_id", "email", "display_name", "password_hash")
     VALUES ($1, $2, $3, $4)`,
    [
      workspaceId,
      `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
      name,
      "argon2id$placeholder$not-a-real-hash",
    ],
  );

  console.log(`seeded ${name} (${workspaceId})`);
}

await client.end();
console.log("two workspaces seeded; a tenancy bug is visible rather than hidden");
