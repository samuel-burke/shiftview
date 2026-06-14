import { describe, it, expect } from "vitest";
import {
  validateBlocks,
  targetAt,
  curveHours,
  resolveProfileId,
  curveForDate,
  coverageScoreFromCurves,
  findUnderstaffedFromCurves,
  liveCoverageStatus,
  dayCoverageStatusFromCurve,
  SLOT_MINUTES,
  MAX_BLOCKS,
  MAX_HEADCOUNT,
  type CoverageBlock,
  type CoverageProfile,
} from "./coverage";

// ── validateBlocks ─────────────────────────────────────────────────────────────

describe("validateBlocks", () => {
  it("accepts an empty array", () => {
    expect(validateBlocks([])).toBeNull();
  });

  it("rejects non-array input (string)", () => {
    expect(validateBlocks("not an array")).toBe("blocks must be an array");
  });

  it("rejects non-array input (null)", () => {
    expect(validateBlocks(null)).toBe("blocks must be an array");
  });

  it("rejects non-array input (number)", () => {
    expect(validateBlocks(42)).toBe("blocks must be an array");
  });

  it("rejects non-array input (object)", () => {
    expect(validateBlocks({})).toBe("blocks must be an array");
  });

  it("accepts a valid single block", () => {
    expect(validateBlocks([{ startMinutes: 480, endMinutes: 960, headcount: 3 }])).toBeNull();
  });

  it("accepts multiple valid non-overlapping blocks", () => {
    expect(validateBlocks([
      { startMinutes: 480, endMinutes: 720, headcount: 2 },
      { startMinutes: 720, endMinutes: 960, headcount: 3 },
    ])).toBeNull();
  });

  it("rejects block with non-integer startMinutes", () => {
    const err = validateBlocks([{ startMinutes: 480.5, endMinutes: 960, headcount: 2 }]);
    expect(err).toMatch(/integer/);
  });

  it("rejects block with non-integer endMinutes", () => {
    const err = validateBlocks([{ startMinutes: 480, endMinutes: 960.5, headcount: 2 }]);
    expect(err).toMatch(/integer/);
  });

  it("rejects block with non-integer headcount", () => {
    const err = validateBlocks([{ startMinutes: 480, endMinutes: 960, headcount: 2.5 }]);
    expect(err).toMatch(/integer/);
  });

  it("rejects non-object block (string element)", () => {
    expect(validateBlocks(["not a block"])).toBe("each block must be an object");
  });

  it("rejects null block element", () => {
    expect(validateBlocks([null])).toBe("each block must be an object");
  });

  it("rejects startMinutes out of range (negative)", () => {
    const err = validateBlocks([{ startMinutes: -15, endMinutes: 60, headcount: 1 }]);
    expect(err).toMatch(/startMinutes out of range/);
  });

  it("rejects startMinutes out of range (>=1440)", () => {
    const err = validateBlocks([{ startMinutes: 1440, endMinutes: 1440, headcount: 1 }]);
    // startMinutes >= 1440 triggers start out of range before end check
    expect(err).toMatch(/startMinutes out of range/);
  });

  it("rejects endMinutes out of range (0 or negative)", () => {
    const err = validateBlocks([{ startMinutes: 0, endMinutes: 0, headcount: 1 }]);
    expect(err).toMatch(/endMinutes out of range/);
  });

  it("rejects endMinutes out of range (>1440)", () => {
    const err = validateBlocks([{ startMinutes: 0, endMinutes: 1441, headcount: 1 }]);
    expect(err).toMatch(/endMinutes out of range/);
  });

  it("accepts endMinutes exactly 1440", () => {
    expect(validateBlocks([{ startMinutes: 1425, endMinutes: 1440, headcount: 1 }])).toBeNull();
  });

  it("accepts startMinutes exactly 0", () => {
    expect(validateBlocks([{ startMinutes: 0, endMinutes: 15, headcount: 1 }])).toBeNull();
  });

  it("rejects start not aligned to 15 minutes", () => {
    const err = validateBlocks([{ startMinutes: 481, endMinutes: 960, headcount: 1 }]);
    expect(err).toMatch(/15/);
  });

  it("rejects end not aligned to 15 minutes", () => {
    const err = validateBlocks([{ startMinutes: 480, endMinutes: 961, headcount: 1 }]);
    expect(err).toMatch(/15/);
  });

  it("rejects start >= end", () => {
    const err = validateBlocks([{ startMinutes: 960, endMinutes: 480, headcount: 1 }]);
    expect(err).toMatch(/start must be before end/);
  });

  it("rejects start equal to end", () => {
    const err = validateBlocks([{ startMinutes: 480, endMinutes: 480, headcount: 1 }]);
    expect(err).toMatch(/start must be before end/);
  });

  it("rejects headcount below 0", () => {
    const err = validateBlocks([{ startMinutes: 480, endMinutes: 960, headcount: -1 }]);
    expect(err).toMatch(/headcount/);
  });

  it("accepts headcount of 0", () => {
    expect(validateBlocks([{ startMinutes: 480, endMinutes: 960, headcount: 0 }])).toBeNull();
  });

  it("accepts headcount of MAX_HEADCOUNT (99)", () => {
    expect(validateBlocks([{ startMinutes: 480, endMinutes: 960, headcount: MAX_HEADCOUNT }])).toBeNull();
  });

  it("rejects headcount above MAX_HEADCOUNT (100)", () => {
    const err = validateBlocks([{ startMinutes: 480, endMinutes: 960, headcount: 100 }]);
    expect(err).toMatch(/headcount/);
  });

  it("rejects overlapping blocks (second starts before first ends)", () => {
    const err = validateBlocks([
      { startMinutes: 480, endMinutes: 720, headcount: 2 },
      { startMinutes: 600, endMinutes: 900, headcount: 3 },
    ]);
    expect(err).toMatch(/overlap/);
  });

  it("accepts adjacent blocks (end of first = start of second)", () => {
    expect(validateBlocks([
      { startMinutes: 480, endMinutes: 720, headcount: 2 },
      { startMinutes: 720, endMinutes: 960, headcount: 3 },
    ])).toBeNull();
  });

  it("rejects blocks when length exceeds MAX_BLOCKS (96)", () => {
    const blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({
      startMinutes: i * SLOT_MINUTES,
      endMinutes: (i + 1) * SLOT_MINUTES,
      headcount: 1,
    }));
    const err = validateBlocks(blocks);
    expect(err).toMatch(/96/);
  });

  it("accepts exactly MAX_BLOCKS (96) blocks", () => {
    const blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => ({
      startMinutes: i * SLOT_MINUTES,
      endMinutes: (i + 1) * SLOT_MINUTES,
      headcount: 1,
    }));
    expect(validateBlocks(blocks)).toBeNull();
  });

  it("detects overlap regardless of input order", () => {
    // Input unsorted — validator should still detect overlap after sorting
    const err = validateBlocks([
      { startMinutes: 600, endMinutes: 900, headcount: 3 },
      { startMinutes: 480, endMinutes: 720, headcount: 2 },
    ]);
    expect(err).toMatch(/overlap/);
  });
});

// ── targetAt ──────────────────────────────────────────────────────────────────

describe("targetAt", () => {
  const blocks: CoverageBlock[] = [
    { startMinutes: 480, endMinutes: 720, headcount: 2 },
    { startMinutes: 720, endMinutes: 960, headcount: 3 },
  ];

  it("returns 0 when no blocks cover the minute (before first block)", () => {
    expect(targetAt(blocks, 479)).toBe(0);
  });

  it("returns 0 when no blocks cover the minute (after last block)", () => {
    expect(targetAt(blocks, 960)).toBe(0);
  });

  it("returns headcount at start of block (inclusive)", () => {
    expect(targetAt(blocks, 480)).toBe(2);
  });

  it("returns headcount inside first block", () => {
    expect(targetAt(blocks, 600)).toBe(2);
  });

  it("returns headcount at block boundary — end is exclusive, start is inclusive", () => {
    // minute 720 is end of first block (exclusive) and start of second (inclusive)
    expect(targetAt(blocks, 720)).toBe(3);
  });

  it("returns headcount inside second block", () => {
    expect(targetAt(blocks, 840)).toBe(3);
  });

  it("returns headcount at one before end (end exclusive, so 959 is in block)", () => {
    expect(targetAt(blocks, 959)).toBe(3);
  });

  it("returns 0 for empty blocks array", () => {
    expect(targetAt([], 480)).toBe(0);
  });

  it("handles a gap between blocks", () => {
    const gappedBlocks: CoverageBlock[] = [
      { startMinutes: 480, endMinutes: 600, headcount: 2 },
      { startMinutes: 720, endMinutes: 840, headcount: 3 },
    ];
    // minute 660 is in the gap
    expect(targetAt(gappedBlocks, 660)).toBe(0);
  });
});

// ── curveHours ────────────────────────────────────────────────────────────────

describe("curveHours", () => {
  it("returns 0 for empty blocks", () => {
    expect(curveHours([])).toBe(0);
  });

  it("calculates hours for a single block", () => {
    // 480 min duration at headcount 3 → 480/60 * 3 = 24 staff-hours
    const blocks: CoverageBlock[] = [{ startMinutes: 480, endMinutes: 960, headcount: 3 }];
    expect(curveHours(blocks)).toBe(24);
  });

  it("sums multiple blocks correctly", () => {
    const blocks: CoverageBlock[] = [
      { startMinutes: 480, endMinutes: 720, headcount: 2 },  // 240 min, 2 = 8 hrs
      { startMinutes: 720, endMinutes: 1080, headcount: 3 }, // 360 min, 3 = 18 hrs
    ];
    expect(curveHours(blocks)).toBe(26);
  });

  it("handles headcount 0 blocks (contributes 0)", () => {
    const blocks: CoverageBlock[] = [
      { startMinutes: 480, endMinutes: 960, headcount: 0 },
    ];
    expect(curveHours(blocks)).toBe(0);
  });

  it("returns fractional hours correctly", () => {
    // 15 min at headcount 1 → 0.25 staff-hours
    const blocks: CoverageBlock[] = [{ startMinutes: 480, endMinutes: 495, headcount: 1 }];
    expect(curveHours(blocks)).toBeCloseTo(0.25);
  });
});

// ── resolveProfileId ──────────────────────────────────────────────────────────

describe("resolveProfileId", () => {
  // 2026-06-10 is a Wednesday (dayOfWeek = 3)
  const date = "2026-06-10";
  const overrides = { "2026-06-10": 5, "2026-06-11": 6 };
  const defaults = { 3: 2, 4: 3 };

  it("returns override when date has an explicit override", () => {
    expect(resolveProfileId(date, overrides, defaults)).toBe(5);
  });

  it("returns day-of-week default when no override for the date", () => {
    // 2026-06-11 is Thursday (dow=4) — override exists but that date's override should be used
    // test a date with default but no override
    expect(resolveProfileId("2026-06-09", {}, { 2: 7 })).toBe(7); // Tuesday
  });

  it("override takes precedence over day-of-week default", () => {
    // Both override and default exist for Wednesday
    const result = resolveProfileId(date, { "2026-06-10": 99 }, { 3: 2 });
    expect(result).toBe(99);
  });

  it("returns null when neither override nor default matches", () => {
    expect(resolveProfileId("2026-06-10", {}, {})).toBeNull();
  });

  it("returns null when day-of-week default is null", () => {
    expect(resolveProfileId(date, {}, { 3: null })).toBeNull();
  });

  it("handles Sunday (dow=0)", () => {
    // 2026-06-07 is a Sunday
    expect(resolveProfileId("2026-06-07", {}, { 0: 10 })).toBe(10);
  });
});

// ── curveForDate ──────────────────────────────────────────────────────────────

describe("curveForDate", () => {
  const profiles: CoverageProfile[] = [
    {
      id: 1,
      name: "Weekday",
      blocks: [
        { startMinutes: 480, endMinutes: 960, headcount: 3 },
      ],
    },
    {
      id: 2,
      name: "Weekend",
      blocks: [
        { startMinutes: 600, endMinutes: 1080, headcount: 2 },
      ],
    },
  ];

  it("returns blocks for a date that has an override", () => {
    const result = curveForDate("2026-06-10", { "2026-06-10": 1 }, {}, profiles);
    expect(result).toEqual(profiles[0].blocks);
  });

  it("returns blocks for a date resolved by day-of-week default", () => {
    // 2026-06-10 is Wednesday (dow=3)
    const result = curveForDate("2026-06-10", {}, { 3: 2 }, profiles);
    expect(result).toEqual(profiles[1].blocks);
  });

  it("returns empty array when profile id is null (no override, no default)", () => {
    const result = curveForDate("2026-06-10", {}, {}, profiles);
    expect(result).toEqual([]);
  });

  it("returns empty array when profile id resolves but profile not found", () => {
    const result = curveForDate("2026-06-10", { "2026-06-10": 999 }, {}, profiles);
    expect(result).toEqual([]);
  });

  it("override takes precedence over day-of-week default", () => {
    // override → profile 1, default → profile 2
    const result = curveForDate("2026-06-10", { "2026-06-10": 1 }, { 3: 2 }, profiles);
    expect(result).toEqual(profiles[0].blocks);
  });
});

// ── coverageScoreFromCurves ───────────────────────────────────────────────────

describe("coverageScoreFromCurves", () => {
  const date = "2026-06-10";

  it("returns null when no dates have target blocks", () => {
    const result = coverageScoreFromCurves([], [date], { [date]: [] });
    expect(result).toBeNull();
  });

  it("returns null when curves map has no entry for the date", () => {
    const result = coverageScoreFromCurves([], [date], {});
    expect(result).toBeNull();
  });

  it("returns null when all blocks have headcount 0", () => {
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 960, headcount: 0 }] };
    const result = coverageScoreFromCurves([], [date], curves);
    expect(result).toBeNull();
  });

  it("returns 100 when all slots are fully staffed", () => {
    const shifts = [{ date, startMinutes: 480, endMinutes: 960 }];
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 960, headcount: 1 }] };
    const result = coverageScoreFromCurves(shifts, [date], curves);
    expect(result).toBe(100);
  });

  it("returns 0 when no shifts scheduled but target exists", () => {
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 960, headcount: 3 }] };
    const result = coverageScoreFromCurves([], [date], curves);
    expect(result).toBe(0);
  });

  it("counts 15-minute slots correctly", () => {
    // Block: 480–540 = 4 slots at headcount 1
    // 2 shifts covering 480–510 (2 slots), leaving 510–540 (2 slots) uncovered
    const shifts = [
      { date, startMinutes: 480, endMinutes: 510 },
      { date, startMinutes: 480, endMinutes: 510 },
    ];
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 540, headcount: 1 }] };
    // Slots: 480 (2>=1 ✓), 495 (2>=1 ✓), 510 (0<1 ✗), 525 (0<1 ✗) — wait, endMinutes: 510 means shift ends at 510
    // At t=480: headcountAt = 2 (both shifts are 480-510, 480 >= 480 and 480 < 510) → covered
    // At t=495: headcountAt = 2 → covered
    // At t=510: both shifts end at 510, 510 < 510 is false → not covered
    // At t=525: not covered
    // covered=2, total=4 → 50%
    const result = coverageScoreFromCurves(shifts, [date], curves);
    expect(result).toBe(50);
  });

  it("skips blocks with headcount <= 0 in slot counting", () => {
    const curves = {
      [date]: [
        { startMinutes: 480, endMinutes: 960, headcount: 0 }, // skipped
        { startMinutes: 960, endMinutes: 1080, headcount: 1 },
      ],
    };
    const shifts = [{ date, startMinutes: 960, endMinutes: 1080 }];
    // Only the non-zero block counts: 4 slots, all covered → 100
    const result = coverageScoreFromCurves(shifts, [date], curves);
    expect(result).toBe(100);
  });

  it("aggregates across multiple dates", () => {
    const date2 = "2026-06-11";
    const curves = {
      [date]: [{ startMinutes: 480, endMinutes: 540, headcount: 1 }], // 4 slots
      [date2]: [{ startMinutes: 480, endMinutes: 540, headcount: 1 }], // 4 slots
    };
    // Cover all 4 slots on date, none on date2
    const shifts = [{ date, startMinutes: 480, endMinutes: 540 }];
    // 4 covered of 8 total = 50%
    const result = coverageScoreFromCurves(shifts, [date, date2], curves);
    expect(result).toBe(50);
  });

  it("returns rounded integer percentage", () => {
    // 1 covered of 3 slots → 33.33% → rounds to 33
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 525, headcount: 1 }] }; // 3 slots
    const shifts = [{ date, startMinutes: 480, endMinutes: 495 }]; // covers 1 slot
    const result = coverageScoreFromCurves(shifts, [date], curves);
    expect(result).toBe(33);
  });
});

// ── findUnderstaffedFromCurves ────────────────────────────────────────────────

describe("findUnderstaffedFromCurves", () => {
  const date = "2026-06-10";

  it("returns empty array when no curves", () => {
    const result = findUnderstaffedFromCurves([], [date], {});
    expect(result).toEqual([]);
  });

  it("returns empty array when blocks is empty for the date", () => {
    const result = findUnderstaffedFromCurves([], [date], { [date]: [] });
    expect(result).toEqual([]);
  });

  it("returns empty array when fully staffed", () => {
    const shifts = [{ date, startMinutes: 480, endMinutes: 960 }];
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 960, headcount: 1 }] };
    expect(findUnderstaffedFromCurves(shifts, [date], curves)).toEqual([]);
  });

  it("returns a single range when entire block is understaffed", () => {
    // 0 scheduled, target 2
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 600, headcount: 2 }] };
    const result = findUnderstaffedFromCurves([], [date], curves);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date,
      startMinutes: 480,
      endMinutes: 600,
      shortfall: 2,
    });
  });

  it("computes shortfall as worst gap in range", () => {
    // One shift covers part: at 480 headcount=1 gap=1, at 495 headcount=0 gap=2
    const shifts = [{ date, startMinutes: 480, endMinutes: 495 }];
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 540, headcount: 2 }] };
    const result = findUnderstaffedFromCurves(shifts, [date], curves);
    expect(result).toHaveLength(1);
    // At 480: headcount=1, gap=1; at 495: headcount=0, gap=2; at 510: headcount=0, gap=2; at 525: headcount=0, gap=2
    // worst = 2
    expect(result[0].shortfall).toBe(2);
  });

  it("merges contiguous understaffed slots into a single range", () => {
    // Entire block understaffed → one range, not many
    const curves = {
      [date]: [
        { startMinutes: 480, endMinutes: 540, headcount: 1 },
        { startMinutes: 540, endMinutes: 600, headcount: 1 },
      ],
    };
    const result = findUnderstaffedFromCurves([], [date], curves);
    expect(result).toHaveLength(1);
    expect(result[0].startMinutes).toBe(480);
    expect(result[0].endMinutes).toBe(600);
  });

  it("creates separate ranges when adequately-staffed slots break the understaffing", () => {
    // 480–510 understaffed, 510–540 ok (shift covers it), 540–570 understaffed
    const shifts = [{ date, startMinutes: 510, endMinutes: 540 }];
    const curves = {
      [date]: [
        { startMinutes: 480, endMinutes: 570, headcount: 1 },
      ],
    };
    const result = findUnderstaffedFromCurves(shifts, [date], curves);
    // Should have 2 understaffed ranges
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ startMinutes: 480, endMinutes: 510 });
    expect(result[1]).toMatchObject({ startMinutes: 540, endMinutes: 570 });
  });

  it("range end does not exceed curve end (last block end)", () => {
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 540, headcount: 2 }] };
    const result = findUnderstaffedFromCurves([], [date], curves);
    expect(result[0].endMinutes).toBe(540);
  });

  it("handles multiple dates independently", () => {
    const date2 = "2026-06-11";
    const curves = {
      [date]: [{ startMinutes: 480, endMinutes: 540, headcount: 1 }],
      [date2]: [{ startMinutes: 480, endMinutes: 540, headcount: 1 }],
    };
    // Staffed on date1, not on date2
    const shifts = [{ date, startMinutes: 480, endMinutes: 540 }];
    const result = findUnderstaffedFromCurves(shifts, [date, date2], curves);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe(date2);
  });

  it("ignores slots where target is 0 (no understaffing)", () => {
    // Block with headcount 0 should not produce alerts even with no staff
    const curves = { [date]: [{ startMinutes: 480, endMinutes: 540, headcount: 0 }] };
    const result = findUnderstaffedFromCurves([], [date], curves);
    expect(result).toEqual([]);
  });
});

// ── liveCoverageStatus ────────────────────────────────────────────────────────

describe("liveCoverageStatus", () => {
  it("returns optimal when target <= 0 (no requirement)", () => {
    expect(liveCoverageStatus(0, 0)).toBe("optimal");
    expect(liveCoverageStatus(5, 0)).toBe("optimal");
    expect(liveCoverageStatus(0, -1)).toBe("optimal");
  });

  it("returns optimal when hereCount >= target", () => {
    expect(liveCoverageStatus(3, 3)).toBe("optimal");
    expect(liveCoverageStatus(5, 3)).toBe("optimal");
  });

  it("returns low when hereCount >= ceil(target/2) but < target", () => {
    // target=3, ceil(3/2)=2 → low at 2
    expect(liveCoverageStatus(2, 3)).toBe("low");
    // target=4, ceil(4/2)=2 → low at 2 or 3
    expect(liveCoverageStatus(2, 4)).toBe("low");
    expect(liveCoverageStatus(3, 4)).toBe("low");
  });

  it("returns critical when hereCount < ceil(target/2)", () => {
    // target=3, ceil(3/2)=2 → critical at 0 or 1
    expect(liveCoverageStatus(1, 3)).toBe("critical");
    expect(liveCoverageStatus(0, 3)).toBe("critical");
  });

  it("boundary: target=2, hereCount=1 → exactly ceil(2/2)=1 → low", () => {
    expect(liveCoverageStatus(1, 2)).toBe("low");
  });

  it("boundary: target=2, hereCount=0 → critical", () => {
    expect(liveCoverageStatus(0, 2)).toBe("critical");
  });

  it("boundary: target=1, hereCount=0 → critical (0 < ceil(0.5)=1)", () => {
    expect(liveCoverageStatus(0, 1)).toBe("critical");
  });

  it("boundary: target=1, hereCount=1 → optimal", () => {
    expect(liveCoverageStatus(1, 1)).toBe("optimal");
  });

  it("large values: returns optimal when well staffed", () => {
    expect(liveCoverageStatus(20, 10)).toBe("optimal");
  });
});

// ── dayCoverageStatusFromCurve ────────────────────────────────────────────────

describe("dayCoverageStatusFromCurve", () => {
  const date = "2026-06-10";

  it("returns null when blocks is empty", () => {
    expect(dayCoverageStatusFromCurve([], date, [])).toBeNull();
  });

  it("returns optimal when all slots meet target", () => {
    const shifts = [{ date, startMinutes: 480, endMinutes: 960 }];
    const blocks: CoverageBlock[] = [{ startMinutes: 480, endMinutes: 960, headcount: 1 }];
    expect(dayCoverageStatusFromCurve(shifts, date, blocks)).toBe("optimal");
  });

  it("returns optimal when all blocks have headcount 0 (nothing required)", () => {
    const blocks: CoverageBlock[] = [{ startMinutes: 480, endMinutes: 960, headcount: 0 }];
    expect(dayCoverageStatusFromCurve([], date, blocks)).toBe("optimal");
  });

  it("returns critical when any slot is critical (early-exit)", () => {
    const blocks: CoverageBlock[] = [{ startMinutes: 480, endMinutes: 540, headcount: 3 }];
    // 0 staff → critical for all slots
    expect(dayCoverageStatusFromCurve([], date, blocks)).toBe("critical");
  });

  it("returns low when worst slot is low, none critical", () => {
    // target=2, we have 1 → low (since ceil(2/2)=1 ≤ 1 < 2)
    const shifts = [{ date, startMinutes: 480, endMinutes: 960 }];
    const blocks: CoverageBlock[] = [{ startMinutes: 480, endMinutes: 960, headcount: 2 }];
    expect(dayCoverageStatusFromCurve(shifts, date, blocks)).toBe("low");
  });

  it("returns worst slot across multiple blocks", () => {
    // block 1: fully covered; block 2: critical (0 staff, target 3)
    const shifts = [{ date, startMinutes: 480, endMinutes: 600 }];
    const blocks: CoverageBlock[] = [
      { startMinutes: 480, endMinutes: 600, headcount: 1 }, // fully covered
      { startMinutes: 720, endMinutes: 840, headcount: 3 }, // critical
    ];
    expect(dayCoverageStatusFromCurve(shifts, date, blocks)).toBe("critical");
  });

  it("skips blocks with headcount 0 in evaluation", () => {
    // zero-headcount block mixed with fully-covered block
    const shifts = [{ date, startMinutes: 480, endMinutes: 960 }];
    const blocks: CoverageBlock[] = [
      { startMinutes: 0, endMinutes: 480, headcount: 0 }, // skipped
      { startMinutes: 480, endMinutes: 960, headcount: 1 }, // covered
    ];
    expect(dayCoverageStatusFromCurve(shifts, date, blocks)).toBe("optimal");
  });
});
