import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script with no type declarations
import { linkedIssues } from "./close-linked-issues.mjs";

const repo = "samuel-burke/shiftview";

describe("linkedIssues", () => {
  it("finds every closing keyword, in any case", () => {
    const body = "Closes #1\nfixes #2, Resolved #3\nFIX #4 and close: #5";
    expect(linkedIssues(body, repo)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ignores mentions without a closing keyword", () => {
    expect(linkedIssues("Stacked on #140. See #12 and refs #13.", repo)).toEqual([]);
  });

  it("ignores words that only contain a keyword", () => {
    expect(linkedIssues("prefix #7, unresolved #8, disclosed #9", repo)).toEqual([]);
  });

  it("closes this repository's issues named in full, not another's", () => {
    const body = "Closes samuel-burke/shiftview#20\nCloses someone/else#21\nCloses Samuel-Burke/ShiftView#22";
    expect(linkedIssues(body, repo)).toEqual([20, 22]);
  });

  it("lists an issue once", () => {
    expect(linkedIssues("Closes #5. Also fixes #5.", repo)).toEqual([5]);
  });

  it("handles an empty or missing body", () => {
    expect(linkedIssues("", repo)).toEqual([]);
    expect(linkedIssues(undefined, repo)).toEqual([]);
  });
});
