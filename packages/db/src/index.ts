// Public entry point for @finance/db.
//
// `sql` is re-exported so that consumers (@finance/auth, @finance/api) express
// database work through this package rather than importing drizzle-orm
// directly. The ORM surface stays owned by the package the boundary table says
// owns it, and swapping it later is one package's problem.
export { sql } from "drizzle-orm";
export * as schema from "./schema/index.js";
export { createDatabase, createPool, type Database, type PoolOptions } from "./client.js";
export { currentWorkspaceId, withWorkspace } from "./rls.js";
