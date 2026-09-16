import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "../src/Select.js";

describe("Select", () => {
  it("associates the label, renders every option, and reports no error by default", () => {
    const html = renderToStaticMarkup(
      <Select
        id="category"
        label="Kategorie"
        options={[
          { value: "housing", label: "Wohnen" },
          { value: "groceries", label: "Lebensmittel" },
        ]}
        value="housing"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('for="category"');
    expect(html).toContain('id="category"');
    expect(html).toContain("Wohnen");
    expect(html).toContain("Lebensmittel");
    expect(html).not.toContain("aria-invalid");
  });

  it("wires aria-invalid and aria-describedby to the error message when present", () => {
    const html = renderToStaticMarkup(
      <Select
        id="category"
        label="Kategorie"
        options={[{ value: "housing", label: "Wohnen" }]}
        value="housing"
        onChange={() => undefined}
        errorMessage="Pflichtfeld"
      />,
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="category-error"');
    expect(html).toContain('id="category-error"');
    expect(html).toContain("Pflichtfeld");
  });
});
