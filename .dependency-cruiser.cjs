/**
 * Mechanical enforcement of the constitution's "Package boundaries" table.
 * "These boundaries MUST be enforced mechanically, not by convention."
 *
 * | Package          | May depend on              | MUST NOT depend on                          |
 * |------------------|----------------------------|---------------------------------------------|
 * | packages/core    | nothing in this repo       | React, Next.js, tRPC, ORM, HTTP, DB clients |
 * | packages/db      | core                       | React, Next.js, ui                          |
 * | packages/api     | core, db, auth             | React, Next.js, ui                          |
 * | packages/ui      | core types, @tfrc/product  | db, api, auth                               |
 * | apps/web         | all packages               | —                                           |
 */

const FORBIDDEN_IN_CORE = [
  "^react",
  "^react-dom",
  "^next",
  "^@trpc/",
  "^trpc-",
  "^drizzle-",
  "^pg$",
  "^postgres$",
  "^node:http",
  "^node:https",
  "^axios$",
  "^undici$",
  "^@node-rs/",
];

module.exports = {
  forbidden: [
    {
      name: "core-is-standalone",
      comment:
        "Article VI: packages/core receives plain data and returns plain data. It imports nothing in this repo.",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { path: "^(packages/(db|api|auth|ui)|apps)/" },
    },
    {
      name: "core-has-no-transport",
      comment:
        "Article VI: packages/core MUST NOT import React, Next.js, tRPC, the ORM, or any HTTP or database client.",
      severity: "error",
      from: { path: "^packages/core/src" },
      // No dependencyTypes filter: an import of a package core does not depend
      // on resolves to nothing, which dependency-cruiser types as "unknown".
      // Filtering on npm types let exactly the violation we care about through.
      // Found by probing the rule with `import { drizzle } from "drizzle-orm"`.
      to: { path: FORBIDDEN_IN_CORE },
    },
    {
      name: "not-to-unresolvable",
      comment:
        "An unresolvable import is either a typo or a dependency that was never declared. In packages/core it is also how a forbidden import evades the rule above.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "db-boundaries",
      severity: "error",
      from: { path: "^packages/db/src" },
      to: { path: "^(packages/(api|auth|ui)|apps)/" },
    },
    {
      name: "db-has-no-view-layer",
      severity: "error",
      from: { path: "^packages/db/src" },
      to: { dependencyTypes: ["npm"], path: ["^react", "^next"] },
    },
    {
      name: "api-boundaries",
      severity: "error",
      from: { path: "^packages/api/src" },
      to: { path: "^(packages/ui|apps)/" },
    },
    {
      name: "api-has-no-view-layer",
      severity: "error",
      from: { path: "^packages/api/src" },
      to: { dependencyTypes: ["npm"], path: ["^react", "^next"] },
    },
    {
      name: "ui-boundaries",
      comment:
        "Article V: packages/ui consumes core types and @tfrc/product. Data access is not its business.",
      severity: "error",
      from: { path: "^packages/ui/src" },
      to: { path: "^(packages/(db|api|auth)|apps)/" },
    },
    {
      name: "no-tfrc-marketing",
      comment:
        "Article V: @tfrc/marketing MUST NOT be installed in this repository. One dialect only.",
      severity: "error",
      from: {},
      to: { path: "^@tfrc/marketing" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "(^|/)(eslint|vitest|playwright|next|drizzle|postcss|tailwind)\\.config\\.[cm]?[jt]s$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(\\.test\\.[cm]?[jt]sx?$|/tests/)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
