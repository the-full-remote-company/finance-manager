/**
 * Article VI / ADR 0005: every public procedure must carry
 * `.meta({ openapi: ... })`, or it vanishes from the generated OpenAPI
 * document silently and does not exist to the planned native iOS client.
 *
 * There is already a test asserting this (openapi-coverage.test.ts). This rule
 * exists because the test fails after the fact, in a suite that needs a
 * database, while the rule fails in the editor at the moment the procedure is
 * written. Two layers, cheapest first.
 *
 * Detects `<something>Procedure...query(...)` / `.mutation(...)` chains and
 * checks for a `.meta(` call somewhere in the same chain.
 */

/** @type {import("eslint").Rule.RuleModule} */
export const requireOpenapiMeta = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require .meta({ openapi }) on every tRPC procedure so the generated document stays complete",
    },
    schema: [],
    messages: {
      missingMeta:
        "This procedure has no .meta({ openapi: ... }), so it will be absent from the generated OpenAPI document (Article VI, ADR 0005). A non-TypeScript client cannot see it.",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;

        const terminal = callee.property.name;
        if (terminal !== "query" && terminal !== "mutation" && terminal !== "subscription") return;

        // Walk back down the member chain collecting the calls that built it.
        let current = callee.object;
        let sawMeta = false;
        let rootName = null;

        while (current) {
          if (current.type === "CallExpression") {
            const inner = current.callee;
            if (inner.type === "MemberExpression" && inner.property.type === "Identifier") {
              if (inner.property.name === "meta") sawMeta = true;
              current = inner.object;
              continue;
            }
            current = inner;
            continue;
          }
          if (current.type === "MemberExpression") {
            current = current.object;
            continue;
          }
          if (current.type === "Identifier") {
            rootName = current.name;
          }
          break;
        }

        // Only applies to procedure builders. A router() call or an unrelated
        // .query() on some other object is not our business.
        if (rootName === null || !/[Pp]rocedure$/.test(rootName)) return;

        if (!sawMeta) {
          context.report({ node, messageId: "missingMeta" });
        }
      },
    };
  },
};

export default { rules: { "require-openapi-meta": requireOpenapiMeta } };
