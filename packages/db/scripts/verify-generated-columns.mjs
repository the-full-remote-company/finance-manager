#!/usr/bin/env node
/**
 * VQ-1 runner. Executes verify-generated-columns.sql against the container
 * database and fails loudly if PostgreSQL rejects the generated-column
 * expression, so the answer is recorded by the build rather than remembered.
 *
 * Result on 2026-09-15, PostgreSQL 17-alpine: PASS. EXTRACT is accepted inside
 * GENERATED ALWAYS AS ... STORED, the values are correct across a year
 * boundary, NULL propagates from a nullable date, and the column is indexable
 * (which FR-024's unique constraint on (commitment_id, effective_month) needs).
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = join(here, "verify-generated-columns.sql");

try {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "owner",
      "-d",
      "finance",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "/dev/stdin",
    ],
    {
      cwd: join(here, "../../.."),
      input: (await import("node:fs")).readFileSync(sql),
      encoding: "utf8",
    },
  );
  process.stdout.write(output);
  if (!output.includes("VQ-1 PASS")) {
    console.error(
      "VQ-1 did not report PASS. Use the plain-integer-plus-CHECK fallback from data-model.md.",
    );
    process.exit(1);
  }
} catch (error) {
  console.error("VQ-1 FAILED. PostgreSQL rejected the generated-column expression.");
  console.error(
    "Fallback, per data-model.md: a plain `integer not null` column derived in packages/core,",
  );
  console.error(
    "plus CHECK (start_month = <expression>). The schema shape and constraints are unchanged.",
  );
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
