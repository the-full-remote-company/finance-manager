import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { appRouter } from "../src/router.js";

/**
 * Article VI: "Procedures MUST remain annotated such that the OpenAPI document
 * stays complete and generated — it MUST NOT be hand-maintained."
 *
 * ADR 0005 records the risk this test exists to contain: trpc-to-openapi only
 * exposes procedures carrying `.meta({ openapi })`, so a procedure without it
 * vanishes from the document silently. A native iOS client is planned and
 * cannot consume tRPC; a procedure missing from the document does not exist to
 * it.
 */

/** Flattens the router into `namespace.procedure` paths with their definitions. */
function proceduresOf(
  router: typeof appRouter,
): { path: string; hasOpenApiMeta: boolean; type: string }[] {
  const entries: { path: string; hasOpenApiMeta: boolean; type: string }[] = [];

  for (const [path, procedure] of Object.entries(router._def.procedures)) {
    const definition = (
      procedure as unknown as { _def: { meta?: { openapi?: unknown }; type: string } }
    )._def;
    entries.push({
      path,
      hasOpenApiMeta: definition.meta?.openapi !== undefined,
      type: definition.type,
    });
  }

  return entries;
}

const document = generateOpenApiDocument(appRouter, {
  title: "test",
  version: "0.0.0",
  baseUrl: "/api",
});

describe("OpenAPI document", () => {
  it("annotates every procedure in the router", () => {
    const missing = proceduresOf(appRouter)
      .filter((procedure) => !procedure.hasOpenApiMeta)
      .map((procedure) => procedure.path);

    expect(
      missing,
      "procedures without .meta({ openapi }) are absent from the generated document",
    ).toEqual([]);
  });

  it("covers every procedure with an operation", () => {
    const operationIds = new Set<string>();
    for (const methods of Object.values(document.paths ?? {})) {
      for (const operation of Object.values(methods)) {
        const id = (operation as { operationId?: string }).operationId;
        if (id) operationIds.add(id);
      }
    }

    // trpc-to-openapi derives `health-ping` from `health.ping`.
    const expected = proceduresOf(appRouter).map((procedure) => procedure.path.replace(/\./g, "-"));

    for (const id of expected) {
      expect(operationIds, `${id} is missing from the generated document`).toContain(id);
    }
  });

  it("maps queries to GET and mutations to POST", () => {
    // ADR 0006 depends on queries being cacheable by the service worker, and a
    // query that degrades to POST would break FR-035b.
    for (const [path, methods] of Object.entries(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods)) {
        const id = (operation as { operationId?: string }).operationId ?? "";
        const procedure = proceduresOf(appRouter).find(
          (entry) => entry.path.replace(/\./g, "-") === id,
        );
        if (!procedure) continue;

        if (procedure.type === "query") {
          expect(method, `${path} is a query and must be GET`).toBe("get");
        }
        if (procedure.type === "mutation") {
          expect(method, `${path} is a mutation and must be POST`).toBe("post");
        }
      }
    }
  });

  it("matches the committed document exactly", () => {
    // The diff check that makes staleness a build failure. `pnpm openapi:check`
    // runs the same comparison in CI against git; this catches it locally, at
    // the point the procedure changes, with a message that says what to do.
    const committed = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../openapi/openapi.json"),
      "utf8",
    );

    const regenerated = generateOpenApiDocument(appRouter, {
      title: "Finance Manager API",
      description:
        "Generated from the tRPC procedures. Never hand-edited: regenerate with `pnpm openapi:generate`. " +
        "Money is a decimal string of minor units with an explicit ISO 4217 currency; a month is YYYY-MM.",
      version: "0.0.0",
      baseUrl: "/api",
      docsUrl: "https://github.com/the-full-remote-company/finance-manager",
    });

    expect(
      JSON.parse(committed),
      "the committed OpenAPI document is stale — run `pnpm --filter @finance/api openapi:generate`",
    ).toEqual(JSON.parse(JSON.stringify(regenerated)));
  });
});
