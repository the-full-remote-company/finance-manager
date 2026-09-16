import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal } from "../src/Modal.js";

describe("Modal", () => {
  it("renders a native dialog labelled by its title, with an accessible close button", () => {
    const html = renderToStaticMarkup(
      <Modal
        open
        onClose={() => undefined}
        titleId="edit-title"
        title="Bearbeiten"
        closeLabel="Schließen"
      >
        <p>Inhalt</p>
      </Modal>,
    );

    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="edit-title"');
    expect(html).toContain('id="edit-title"');
    expect(html).toContain("Bearbeiten");
    expect(html).toContain('aria-label="Schließen"');
    expect(html).toContain("Inhalt");
  });
});
