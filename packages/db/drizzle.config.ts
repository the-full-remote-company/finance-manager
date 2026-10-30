import { defineConfig } from "drizzle-kit";

/**
 * Migrations run as the OWNER role. The application never does: row level
 * security does not apply to a table owner or a superuser (Article I), which
 * is why DATABASE_URL_OWNER and DATABASE_URL are separate variables pointing
 * at separate roles.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance",
  },
  strict: true,
  verbose: true,
});
