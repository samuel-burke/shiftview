import { describe, expect, it } from "vitest";
import { cleanPunchNote, parsePunchNote, PUNCH_NOTE_MAX_LENGTH } from "./punch-note";

describe("cleanPunchNote", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanPunchNote("  covering   for\tSam \n")).toBe("covering for Sam");
  });

  it("turns control characters into spaces", () => {
    expect(cleanPunchNote("a\u0000b\u0007c\u001Bd\u007Fe\u0085f")).toBe("a b c d e f");
  });

  it("removes zero-width, bidi override and byte-order-mark characters", () => {
    expect(cleanPunchNote("\uFEFFlate\u200Bbus")).toBe("late bus");
    // U+202E reverses the text after it when displayed.
    expect(cleanPunchNote("ok\u202Eevil\u202C")).toBe("ok evil");
    expect(cleanPunchNote("x\u2066y\u2069z")).toBe("x y z");
    expect(cleanPunchNote("line\u2028break")).toBe("line break");
  });

  it("is null for a blank note or one that is only unsafe characters", () => {
    expect(cleanPunchNote("")).toBeNull();
    expect(cleanPunchNote("   ")).toBeNull();
    expect(cleanPunchNote("\u200B\u0000\n")).toBeNull();
  });

  it("keeps ordinary punctuation, accents and emoji", () => {
    expect(cleanPunchNote("Café — register #2 down 👍")).toBe("Café — register #2 down 👍");
  });

  it("leaves formula-looking text alone (CSV exports defuse it, lib/csv.ts)", () => {
    expect(cleanPunchNote("=HYPERLINK(\"x\")")).toBe("=HYPERLINK(\"x\")");
  });
});

describe("parsePunchNote", () => {
  it("treats a missing note as none", () => {
    expect(parsePunchNote(undefined)).toEqual({ ok: true, note: null });
    expect(parsePunchNote(null)).toEqual({ ok: true, note: null });
    expect(parsePunchNote("  ")).toEqual({ ok: true, note: null });
  });

  it("refuses anything but a string", () => {
    for (const v of [42, true, {}, ["a"]]) expect(parsePunchNote(v).ok).toBe(false);
  });

  it(`allows exactly ${PUNCH_NOTE_MAX_LENGTH} characters and refuses one more`, () => {
    expect(parsePunchNote("a".repeat(PUNCH_NOTE_MAX_LENGTH))).toEqual({ ok: true, note: "a".repeat(PUNCH_NOTE_MAX_LENGTH) });
    expect(parsePunchNote("a".repeat(PUNCH_NOTE_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it("counts the length after cleaning", () => {
    const padded = `   ${"a".repeat(PUNCH_NOTE_MAX_LENGTH)}   \u200B`;
    expect(parsePunchNote(padded)).toEqual({ ok: true, note: "a".repeat(PUNCH_NOTE_MAX_LENGTH) });
  });

  it("counts an emoji as one character, as the database does", () => {
    const note = "👍".repeat(PUNCH_NOTE_MAX_LENGTH);
    expect(parsePunchNote(note)).toEqual({ ok: true, note });
    expect(parsePunchNote(note + "👍").ok).toBe(false);
  });
});
