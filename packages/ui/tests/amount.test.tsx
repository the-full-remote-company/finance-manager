import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Amount } from "../src/Amount.js";

describe("Amount", () => {
  it("marks income with the gain class and a leading plus sign", () => {
    const html = renderToStaticMarkup(
      <Amount
        value={{ minor: 95_000n, currency: "EUR" }}
        direction="income"
        directionLabel="Einnahme"
      />,
    );

    expect(html).toContain("amt--gain");
    expect(html).toContain("+950,00");
    expect(html).toContain("Einnahme");
  });

  it("marks expense with the loss class and a minus sign, never a bare hyphen", () => {
    const html = renderToStaticMarkup(
      <Amount
        value={{ minor: 95_000n, currency: "EUR" }}
        direction="expense"
        directionLabel="Ausgabe"
      />,
    );

    expect(html).toContain("amt--loss");
    expect(html).toMatch(/[-\u2212]950,00/);
  });

  it("uses the magnitude of a signed Money value, not its stored sign", () => {
    const html = renderToStaticMarkup(
      <Amount
        value={{ minor: -95_000n, currency: "EUR" }}
        direction="income"
        directionLabel="Einnahme"
      />,
    );

    expect(html).toContain("+950,00");
  });
});
