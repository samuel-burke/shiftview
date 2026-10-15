import { describe, it, expect } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvRow(["Ann", "2026-06-08", 8.5, "8.50", null, undefined])).toBe("Ann,2026-06-08,8.5,8.50,,");
  });

  it("quotes delimiters, quotes and line breaks", () => {
    expect(csvCell("Smith, Ann")).toBe('"Smith, Ann"');
    expect(csvCell('said "hi"')).toBe('"said ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("cr\rhere")).toBe('"cr\rhere"');
  });

  it.each(["=1+1", "+1", "-2+3", "@SUM(A1)", "\tx", '=HYPERLINK("http://x","y")'])(
    "defuses a formula-looking note: %j",
    (note) => {
      const cell = csvCell(note);
      const unquoted = cell.startsWith('"') ? cell.slice(1) : cell;
      expect(unquoted.startsWith("'")).toBe(true);
    },
  );

  it("does not touch negative numbers passed as numbers", () => {
    expect(csvCell(-1.5)).toBe("-1.5");
  });
});
