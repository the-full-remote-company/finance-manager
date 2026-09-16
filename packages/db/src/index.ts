// Public entry point for @finance/db.
//
// The query-builder operators consumers need are re-exported here so that
// @finance/api expresses database work through this package rather than
// importing drizzle-orm directly. The ORM surface stays owned by the package
// the boundary table says owns it, and swapping it later is one package's
// problem.
export { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
export * as schema from "./schema/index.js";
export {
  createDatabase,
  createPool,
  type Database,
  type Pool,
  type PoolOptions,
} from "./client.js";
export { currentWorkspaceId, withWorkspace } from "./rls.js";
