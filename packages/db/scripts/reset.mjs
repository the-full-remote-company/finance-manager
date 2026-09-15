#!/usr/bin/env node
/**
 * Drops and recreates the schema, then re-applies every migration.
 *
 * Runs as the owner. Deliberately refuses to run against anything that does
 * not look like a local container: this drops every table, and a reset script
 * that can reach a real database is a loaded weapon left on the table.
 */

import { execFileSync } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance";

const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "db"].includes(host)) {
  console.error(`refusing to reset a non-local database: ${host}`);
  console.error("db:reset drops every table. Point DATABASE_URL_OWNER at the container.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

// The app role holds grants on the tables being dropped; DROP SCHEMA CASCADE
// removes both. init-roles.sql created the role itself, which survives.
await client.query("DROP SCHEMA public CASCADE");
await client.query("CREATE SCHEMA public");

// drizzle-kit records applied migrations in its own `drizzle` schema, outside
// `public`. Dropping only `public` leaves that bookkeeping intact, so the next
// `migrate` reports "applied successfully" and creates nothing — a reset that
// silently produces an empty database. Found by running it.
await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
await client.query("GRANT USAGE ON SCHEMA public TO app");
await client.query("REVOKE CREATE ON SCHEMA public FROM app");
await client.end();

console.log("schema dropped and recreated; applying migrations");
execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "inherit",
  env: process.env,
});
