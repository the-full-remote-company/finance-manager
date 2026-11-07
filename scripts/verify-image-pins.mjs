#!/usr/bin/env node
/**
 * Every container image is pinned, and an image used in more than one place is
 * pinned to the same tag in all of them.
 *
 * Why this exists: Mailpit was declared in docker-compose.yml and again in the
 * CI workflow. Dependabot bumped the first and could not see the second, so CI
 * tested against a different Mailpit than local development. The same
 * duplication exists for postgres. A drift check is cheaper than discovering it
 * through a test that behaves differently on CI (Article IX: no gate may depend
 * on luck).
 *
 * Checks, over docker-compose.yml and .github/workflows/*.yml:
 *   1. Every `image:` has an explicit tag, and the tag is not `latest`.
 *   2. An image repository that appears more than once carries one tag.
 *
 * Plain line matching on purpose: it needs no YAML parser, and `image:` is the
 * only key either file format uses for this.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = join(root, ".github", "workflows");

const files = [
  join(root, "docker-compose.yml"),
  ...readdirSync(workflows)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => join(workflows, name)),
];

/** @type {Map<string, { tag: string, where: string }[]>} */
const byRepository = new Map();
const failures = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const match = /^\s*image:\s*["']?([^\s"'#]+)["']?/.exec(line);
    if (!match) return;

    const reference = match[1];
    const where = `${relative(root, file)}:${String(index + 1)}`;
    // The tag is whatever follows the last colon that comes after the last slash,
    // so a registry port (host:5000/repo) is not mistaken for one.
    const lastSlash = reference.lastIndexOf("/");
    const colon = reference.indexOf(":", lastSlash + 1);
    const repository = colon === -1 ? reference : reference.slice(0, colon);
    const tag = colon === -1 ? "" : reference.slice(colon + 1);

    if (tag === "" || tag === "latest") {
      failures.push(`${where}: ${reference} is not pinned to a version`);
    }
    const seen = byRepository.get(repository) ?? [];
    seen.push({ tag, where });
    byRepository.set(repository, seen);
  });
}

for (const [repository, uses] of byRepository) {
  const tags = new Set(uses.map((use) => use.tag));
  if (tags.size > 1) {
    failures.push(
      `${repository} is pinned to different tags:\n` +
        uses.map((use) => `    ${use.tag || "(none)"}  at ${use.where}`).join("\n"),
    );
  }
}

if (failures.length > 0) {
  console.error("Container image pins are inconsistent:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nDeclare an image once where you can (CI starts compose services with " +
      "`docker compose up --wait`), and where it must appear twice keep the tags identical.",
  );
  process.exit(1);
}

const summary = [...byRepository]
  .map(([repository, uses]) => `${repository}:${uses[0]?.tag ?? ""} x${String(uses.length)}`)
  .join(", ");
console.log(`Image pins consistent: ${summary}`);
