import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Article V: this app consumes @tfrc/product, never forks it. An upstream
 * rename of a class we depend on must fail this test — and therefore the
 * build — rather than silently vanish from a screen.
 *
 * Kept in step with scripts/verify-design-system.mjs, which runs the same
 * check as part of `pnpm verify:design-system` (the tfrc-verify stop-gap).
 * The two lists are declared separately, on purpose: a shared import would
 * let one file's edit silently update both, which is the exact drift this
 * duplication is here to catch.
 */
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * pnpm isolates dependencies per package, so the installed copy of
 * @tfrc/product's source CSS is found under whichever package's
 * node_modules resolved it — not necessarily the workspace root.
 */
function findInstalledProductCss(): string {
  const candidates = [
    "node_modules/@tfrc/product/src/components.css",
    "packages/ui/node_modules/@tfrc/product/src/components.css",
    "apps/web/node_modules/@tfrc/product/src/components.css",
  ].map((candidate) => join(root, candidate));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("@tfrc/product is not installed; run pnpm install before this test.");
  }
  return readFileSync(found, "utf8");
}

describe("design system class contract", () => {
  it.each(CONSUMED_CLASSES)("@tfrc/product still ships .%s", (className) => {
    const css = findInstalledProductCss();
    const pattern = new RegExp(`\\.${className.replace(/--/g, "--")}(?![\\w-])`);
    expect(pattern.test(css), `.${className} is missing from @tfrc/product`).toBe(true);
  });

  it("consumes exactly the 17 classes this app has committed to", () => {
    expect(CONSUMED_CLASSES).toHaveLength(17);
  });
});
