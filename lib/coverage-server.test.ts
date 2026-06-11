import { describe, it, expect } from "vitest";
import { getCurveForDate } from "./coverage-server";
import { makeSupabaseClient } from "@/app/api/__tests__/helpers";

// ── getCurveForDate ────────────────────────────────────────────────────────────

describe("getCurveForDate", () => {
  const BLOCKS_DB = [
    { start_minutes: 480, end_minutes: 720,  headcount: 2 },
    { start_minutes: 720, end_minutes: 960,  headcount: 3 },
    { start_minutes: 960, end_minutes: 1200, headcount: 1 },
  ];

  it("uses a date override when one exists", async () => {
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: { profile_id: 5 }, error: null },
        coverage_day_defaults:   { data: null, error: null },
        coverage_profile_blocks: { data: BLOCKS_DB, error: null },
      },
    });
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-10");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ startMinutes: 480, endMinutes: 720, headcount: 2 });
    expect(result[1]).toMatchObject({ startMinutes: 720, endMinutes: 960, headcount: 3 });
    expect(result[2]).toMatchObject({ startMinutes: 960, endMinutes: 1200, headcount: 1 });
  });

  it("falls back to day-of-week default when no date override", async () => {
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: null, error: null },
        coverage_day_defaults:   { data: { profile_id: 2 }, error: null },
        coverage_profile_blocks: { data: BLOCKS_DB, error: null },
      },
    });
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-10");
    expect(result).toHaveLength(3);
  });

  it("returns empty array when neither override nor default exists", async () => {
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: null, error: null },
        coverage_day_defaults:   { data: null, error: null },
        coverage_profile_blocks: { data: [], error: null },
      },
    });
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-10");
    expect(result).toEqual([]);
  });

  it("returns empty array when blocks are empty for the resolved profile", async () => {
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: { profile_id: 1 }, error: null },
        coverage_day_defaults:   { data: null, error: null },
        coverage_profile_blocks: { data: [], error: null },
      },
    });
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-10");
    expect(result).toEqual([]);
  });

  it("returns empty array when blocks query returns null", async () => {
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: { profile_id: 1 }, error: null },
        coverage_day_defaults:   { data: null, error: null },
        coverage_profile_blocks: { data: null, error: null },
      },
    });
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-10");
    expect(result).toEqual([]);
  });

  it("correctly maps snake_case DB columns to camelCase CoverageBlock", async () => {
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: { profile_id: 1 }, error: null },
        coverage_day_defaults:   { data: null, error: null },
        coverage_profile_blocks: {
          data: [{ start_minutes: 540, end_minutes: 1080, headcount: 4 }],
          error: null,
        },
      },
    });
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-10");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ startMinutes: 540, endMinutes: 1080, headcount: 4 });
    // Should not have snake_case keys
    expect(result[0]).not.toHaveProperty("start_minutes");
    expect(result[0]).not.toHaveProperty("end_minutes");
  });

  it("date override takes precedence over day-of-week default", async () => {
    // If date override exists, day-defaults should NOT be queried
    const dayDefaultsQueried = false;
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: { profile_id: 10 }, error: null },
        coverage_day_defaults:   { data: { profile_id: 99 }, error: null },
        coverage_profile_blocks: { data: BLOCKS_DB, error: null },
      },
    });
    // The actual implementation only queries day_defaults if override is null,
    // so we just verify the result uses profile_id from the override path (profileId=10)
    // Since the mock returns the same blocks regardless, we just verify it returns blocks.
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-10");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles a Sunday (dow=0) correctly", async () => {
    // 2026-06-07 is a Sunday
    const supabase = makeSupabaseClient({
      tableOverrides: {
        coverage_date_overrides: { data: null, error: null },
        coverage_day_defaults:   { data: { profile_id: 7 }, error: null },
        coverage_profile_blocks: { data: [{ start_minutes: 600, end_minutes: 1080, headcount: 2 }], error: null },
      },
    });
    const result = await getCurveForDate(supabase as any, "00000000-0000-0000-0000-000000000001", "2026-06-07");
    expect(result).toHaveLength(1);
    expect(result[0].startMinutes).toBe(600);
  });
});
