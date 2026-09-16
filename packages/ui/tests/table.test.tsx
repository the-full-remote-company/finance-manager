import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Table } from "../src/Table.js";

interface Row {
  id: string;
  name: string;
  amount: string;
}

const columns = [
  { key: "name", header: "Name", render: (row: Row) => row.name },
  { key: "amount", header: "Betrag", render: (row: Row) => row.amount, align: "end" as const },
];

describe("Table", () => {
  it("renders a real table with scoped column headers and a caption", () => {
    const html = renderToStaticMarkup(
      <Table
        columns={columns}
        rows={[{ id: "1", name: "Miete", amount: "950,00 €" }]}
        getRowKey={(row) => row.id}
        caption="Verpflichtungen"
        emptyMessage="Keine Einträge"
      />,
    );

    expect(html).toContain("<table>");
    expect(html).toContain('scope="col"');
    expect(html).toContain("Verpflichtungen");
    expect(html).toContain("Miete");
    expect(html).toContain("950,00 €");
  });

  it("renders the empty message instead of an empty table when there are no rows", () => {
    const html = renderToStaticMarkup(
      <Table
        columns={columns}
        rows={[]}
        getRowKey={(row) => row.id}
        caption="Verpflichtungen"
        emptyMessage="Keine Einträge"
      />,
    );

    expect(html).not.toContain("<table>");
    expect(html).toContain("Keine Einträge");
  });
});
