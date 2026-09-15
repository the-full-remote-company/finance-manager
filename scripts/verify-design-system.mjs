#!/usr/bin/env node
/**
 * Article V requires `npx tfrc-verify` to pass in CI.
 *
 * VERIFIED 2026-09-15: no such package is published. The registry carries
 * exactly three @tfrc packages — foundation, marketing, product (1.1.0 each) —
 * and none ships a `bin`. `npm view tfrc-verify` and `@tfrc/verify` both 404.
 *
 * Article IX forbids dropping a gate because the tool is missing, and forbids
 * asserting a claim that cannot be verified. So this script performs the checks
 * the constitution attributes to tfrc-verify, and the CI job runs the real tool
 * the moment it exists. This is a stop-gap, not a substitute: see the note in
 * PROMOTE.md and raise an ADR if it outlives the first release.
 *
 * Checks:
 *   1. Every @tfrc/* dependency is pinned exactly. Ranges are forbidden.
 *   2. @tfrc/marketing is not installed anywhere. One dialect only.
 *   3. The product package's CSS is not copied, vendored or forked into this
 *      repository.
 *   4. The classes this app consumes exist in the installed package.
 */

import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

/** The classes this app consumes. Kept in step with packages/ui/tests/design-system-contract.test.ts. */
const CONSUMED_CLASSES = [
  "btn",
  "btn--primary",
  "btn--secondary",
  "btn--ghost",
  "btn--block",
  "field",
  "list",
  "row",
  "amt",
  "amt--gain",
  "amt--loss",
  "balance",
  "pill",
  "pill--gain",
  "pill--loss",
  "seg",
  "tabs",
];

async function manifests(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await manifests(path, found);
    else if (entry.name === "package.json") found.push(path);
  }
  return found;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

for (const manifestPath of await manifests(root)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const relative = manifestPath.slice(root.length + 1);

  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith("@tfrc/")) continue;

      if (name === "@tfrc/marketing") {
        failures.push(
          `${relative}: @tfrc/marketing MUST NOT be installed in this repository. One dialect only (Article V).`,
        );
      }
      if (!EXACT_VERSION.test(range)) {
        failures.push(
          `${relative}: ${name}@${range} is a range. @tfrc/* MUST be pinned to exact versions (Article V).`,
        );
      }
    }
  }
}

// The design system is consumed, never forked: no copy of its CSS lives here.
const vendored = [
  "packages/ui/src/tokens.css",
  "packages/ui/src/components.css",
  "apps/web/app/tfrc.css",
];
for (const candidate of vendored) {
  if (existsSync(join(root, candidate))) {
    failures.push(
      `${candidate} looks like vendored design-system CSS. Import the package instead (Article V).`,
    );
  }
}

// The classes must exist in the installed package, not merely in our test list.
// pnpm isolates dependencies per package, so the product CSS lives under the
// consumer's node_modules rather than the workspace root.
const candidates = [
  "node_modules/@tfrc/product/src/components.css",
  "packages/ui/node_modules/@tfrc/product/src/components.css",
  "apps/web/node_modules/@tfrc/product/src/components.css",
].map((candidate) => join(root, candidate));

const installed = candidates.find((candidate) => existsSync(candidate));
if (!installed) {
  failures.push(
    "@tfrc/product is not installed; cannot verify the class contract. Run pnpm install.",
  );
} else {
  const css = readFileSync(installed, "utf8");
  for (const className of CONSUMED_CLASSES) {
    if (!new RegExp(`\\.${className.replace(/--/g, "--")}(?![\\w-])`).test(css)) {
      failures.push(
        `.${className} is consumed by this app but absent from @tfrc/product. An upstream rename must fail our build, not a screen (Article V).`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Design system verification failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Design system verification passed: ${CONSUMED_CLASSES.length} classes, exact pins, no marketing dialect, nothing vendored.`,
);
