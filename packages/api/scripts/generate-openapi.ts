#!/usr/bin/env node
/**
 * Generates the OpenAPI document from the annotated tRPC procedures.
 *
 * Article VI: the document is generated from the same procedures and MUST NOT
 * be hand-maintained. `pnpm openapi:check` regenerates and diffs it, so a
 * procedure added without regenerating fails the build rather than shipping a
 * document that lies (ADR 0005).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { appRouter } from "../src/router.js";

const document = generateOpenApiDocument(appRouter, {
  title: "Finance Manager API",
  description:
    "Generated from the tRPC procedures. Never hand-edited: regenerate with `pnpm openapi:generate`. " +
    "Money is a decimal string of minor units with an explicit ISO 4217 currency; a month is YYYY-MM.",
  version: "0.0.0",
  baseUrl: "/api",
  docsUrl: "https://github.com/the-full-remote-company/finance-manager",
});

const out = join(dirname(fileURLToPath(import.meta.url)), "../openapi/openapi.json");
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, "utf8");

console.log(`wrote ${out}`);
