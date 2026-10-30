import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

/**
 * The application pool. Connects as the non-owner, non-superuser `app` role,
 * because row level security does not apply to a table owner or a superuser
 * (Article I). Using the owner URL here would disable tenancy silently, which
 * is why the two URLs are separate variables with separate roles.
 */
export type Database = NodePgDatabase<typeof schema>;

/** Re-exported so consumers need not depend on `pg` directly. */
export type Pool = pg.Pool;

export interface PoolOptions {
  readonly connectionString?: string;
  readonly max?: number;
}

export function createPool(options: PoolOptions = {}): pg.Pool {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set: the application must connect as the non-owner `app` role",
    );
  }
  return new pg.Pool({ connectionString, max: options.max ?? 10 });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
