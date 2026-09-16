import type { ReactNode } from "react";

export interface TableColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Right-aligns a numeric/money column without a raw colour or layout hack. */
  align?: "start" | "end";
}

export interface TableProps<Row> {
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row) => string;
  caption: string;
  emptyMessage: string;
}

/**
 * A data table, not shipped by `@tfrc/product@1.1.0` (research.md Part C).
 * Built locally on plain semantic `<table>` markup and logged in
 * `PROMOTE.md` at use count 1.
 *
 * Real `<table>`/`<caption>`/`<th scope="col">` rather than the package's
 * `.list`/`.row` flex pattern: that pattern has "no web equivalent" per its
 * own source comment and is built for a single-column list of rows, not
 * tabular data with named columns a screen reader must announce as such
 * (Article IV).
 */
export function Table<Row>({
  columns,
  rows,
  getRowKey,
  caption,
  emptyMessage,
}: TableProps<Row>): ReactNode {
  if (rows.length === 0) {
    return <p>{emptyMessage}</p>;
  }

  return (
    <table>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" style={{ textAlign: column.align ?? "start" }}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={getRowKey(row)}>
            {columns.map((column) => (
              <td key={column.key} style={{ textAlign: column.align ?? "start" }}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
