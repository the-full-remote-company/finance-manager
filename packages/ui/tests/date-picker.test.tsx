import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DatePicker } from "../src/DatePicker.js";

describe("DatePicker", () => {
  it("renders a native date input associated with its label", () => {
    const html = renderToStaticMarkup(
      <DatePicker
        id="start-date"
        label="Startdatum"
        value="2026-01-01"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('type="date"');
    expect(html).toContain('for="start-date"');
    expect(html).toContain('value="2026-01-01"');
    expect(html).not.toContain("aria-invalid");
  });

  it("wires aria-invalid and the error message when present", () => {
    const html = renderToStaticMarkup(
      <DatePicker
        id="start-date"
        label="Startdatum"
        value=""
        onChange={() => undefined}
        errorMessage="Pflichtfeld"
      />,
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="start-date-error"');
    expect(html).toContain("Pflichtfeld");
  });
});
