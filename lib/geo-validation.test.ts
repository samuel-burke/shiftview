import { describe, it, expect } from "vitest";
import {
  isValidLatitude,
  isValidLongitude,
  parseGeofenceConfig,
  parsePunchCoordinates,
} from "./geo-validation";

describe("isValidLatitude / isValidLongitude", () => {
  it("accepts in-range finite numbers, including the bounds", () => {
    for (const v of [-90, -45.5, 0, 40.7128, 90]) expect(isValidLatitude(v)).toBe(true);
    for (const v of [-180, -74.006, 0, 151.2, 180]) expect(isValidLongitude(v)).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, 90.0001, -90.0001, 1000])("rejects latitude %s", (v) => {
    expect(isValidLatitude(v)).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, 180.0001, -180.0001, 1000])("rejects longitude %s", (v) => {
    expect(isValidLongitude(v)).toBe(false);
  });

  it.each(["40.7", "", null, undefined, true, {}, [], [40]])("rejects non-number %j", (v) => {
    expect(isValidLatitude(v)).toBe(false);
    expect(isValidLongitude(v)).toBe(false);
  });
});

describe("parsePunchCoordinates", () => {
  it("treats both missing (undefined or null) as no location", () => {
    expect(parsePunchCoordinates(undefined, undefined)).toEqual({ ok: true, lat: null, lng: null });
    expect(parsePunchCoordinates(null, null)).toEqual({ ok: true, lat: null, lng: null });
    expect(parsePunchCoordinates(null, undefined)).toEqual({ ok: true, lat: null, lng: null });
  });

  it("returns a valid pair unchanged", () => {
    expect(parsePunchCoordinates(40.7128, -74.006)).toEqual({ ok: true, lat: 40.7128, lng: -74.006 });
  });

  it.each([
    [40.7, undefined],
    [undefined, -74],
    [40.7, null],
    [null, -74],
  ])("rejects half a pair (%s, %s)", (lat, lng) => {
    const r = parsePunchCoordinates(lat, lng);
    expect(r.ok).toBe(false);
  });

  it.each([
    [NaN, 0],
    [Infinity, 0],
    [-Infinity, 0],
    [91, 0],
    [-91, 0],
    ["40.7", -74],
    ["abc", -74],
  ])("rejects bad latitude %s", (lat, lng) => {
    const r = parsePunchCoordinates(lat, lng);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("lat") });
  });

  it.each([
    [0, NaN],
    [0, Infinity],
    [0, -Infinity],
    [0, 181],
    [0, -181],
    [40.7, "-74"],
  ])("rejects bad longitude (%s, %s)", (lat, lng) => {
    const r = parsePunchCoordinates(lat, lng);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("lng") });
  });
});

describe("parseGeofenceConfig", () => {
  it("is unset when no centre is stored", () => {
    expect(parseGeofenceConfig(undefined, undefined, undefined)).toEqual({ status: "unset" });
    expect(parseGeofenceConfig("", "", "100")).toEqual({ status: "unset" });
  });

  it("parses a valid centre and radius, defaulting the radius to 100m", () => {
    expect(parseGeofenceConfig("40.7128", "-74.006", "250")).toEqual({
      status: "ok", lat: 40.7128, lng: -74.006, radius: 250,
    });
    expect(parseGeofenceConfig("40.7128", "-74.006", undefined)).toMatchObject({ status: "ok", radius: 100 });
  });

  it.each([
    ["40.7", "", "100"],
    ["", "-74", "100"],
    ["NaN", "-74", "100"],
    ["Infinity", "-74", "100"],
    ["1e999", "-74", "100"],
    ["91", "-74", "100"],
    ["40.7", "-181", "100"],
    ["40.7abc", "-74", "100"],
    ["40.7", "-74", "abc"],
    ["40.7", "-74", "0"],
    ["40.7", "-74", "-5"],
    ["40.7", "-74", "Infinity"],
  ])("is invalid for lat=%j lng=%j radius=%j", (lat, lng, radius) => {
    expect(parseGeofenceConfig(lat, lng, radius)).toEqual({ status: "invalid" });
  });
});
