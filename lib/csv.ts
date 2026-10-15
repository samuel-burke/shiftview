// One CSV cell. Quotes values that contain a delimiter, quote or line break,
// and defuses spreadsheet formulas: a text cell starting with = + - @ (or a
// tab / carriage return) is run as a formula by Excel and Sheets, so an
// employee's note like "=HYPERLINK(...)" would execute on a manager's machine.
// Those cells get a leading apostrophe, which spreadsheets show as plain text.
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}
