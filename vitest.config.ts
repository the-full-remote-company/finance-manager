import { defineConfig } from "vitest/config";

/**
 * Article III coverage floors, enforced here so a drop fails the run rather
 * than a review: 90% lines and branches in packages/core, 70% lines repo-wide.
 *
 * Projects are split so the gates in package.json can address them separately:
 * `core`, `ui` and `auth-unit` need no database; `integration` and `isolation`
 * require the container PostgreSQL and are therefore never part of the fast
 * loop. The isolation project exists as its own gate because Article I forbids
 * merging a tenant-scoped table without its leak test, and a gate that cannot
 * be pointed at is a gate that gets folded into another one and lost.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/core/tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "auth-unit",
          include: ["packages/auth/tests/**/*.unit.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "ui",
          include: ["packages/ui/tests/**/*.test.ts", "packages/ui/tests/**/*.test.tsx"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: [
            "packages/api/tests/**/*.test.ts",
            "packages/auth/tests/**/*.integration.test.ts",
            "packages/db/tests/**/*.test.ts",
          ],
          exclude: ["packages/db/tests/isolation/**"],
          environment: "node",
          hookTimeout: 60_000,
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "isolation",
          include: ["packages/db/tests/isolation/**/*.test.ts"],
          environment: "node",
          hookTimeout: 60_000,
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // apps/web is deliberately absent for now. The V8 provider parses
      // never-executed files to report them as 0%, and it cannot parse JSX or
      // type-only imports without a transform configured for them — it emitted
      // PARSE_ERROR for layout.tsx and page.tsx and dropped them from the
      // calculation silently. A floor measured against a file set that quietly
      // loses members is not a floor.
      //
      // apps/web joins this list in T153, together with the component test
      // setup that gives it a transform. Until then the repo-wide floor is
      // honest about what it covers rather than approximately wrong.
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/index.ts"],
      thresholds: {
        // Article III, repo-wide floor.
        lines: 70,
        // Article III, packages/core floor. Expressed as a glob threshold
        // because Vitest applies coverage globally, not per project: a
        // `coverage` block inside a project entry is silently ignored, which
        // meant the 90% floor was configured but never enforced. Found by
        // reading the report, which listed apps/web files under the "core"
        // project run.
        "packages/core/src/**/*.ts": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
