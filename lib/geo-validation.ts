// Coordinate validation for server-side geofence checks. Anything that reaches
// haversineMeters must pass these first: a NaN or Infinity input makes the
// distance NaN, and `NaN > radius` is false — the check would silently pass.

export function isValidLatitude(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLongitude(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;
}

export type PunchCoordinates =
  | { ok: true; lat: number; lng: number }
  | { ok: true; lat: null; lng: null }
  | { ok: false; error: string };

/**
 * Validates the optional { lat, lng } a client sends with a punch. Both must be
 * omitted/null together, or both be finite numbers in range. Strings, NaN,
 * Infinity, out-of-range values, and a lone lat or lng are rejected.
 */
export function parsePunchCoordinates(lat: unknown, lng: unknown): PunchCoordinates {
  const latMissing = lat === undefined || lat === null;
  const lngMissing = lng === undefined || lng === null;
  if (latMissing && lngMissing) return { ok: true, lat: null, lng: null };
  if (latMissing || lngMissing)
    return { ok: false, error: "lat and lng must be provided together" };
  if (!isValidLatitude(lat))
    return { ok: false, error: "lat must be a finite number between -90 and 90" };
  if (!isValidLongitude(lng))
    return { ok: false, error: "lng must be a finite number between -180 and 180" };
  return { ok: true, lat, lng };
}

export type GeofenceConfig =
  | { status: "unset" }
  | { status: "invalid" }
  | { status: "ok"; lat: number; lng: number; radius: number };

/**
 * Reads the geofence centre and radius from app_settings strings. "unset" means
 * no centre was ever saved; "invalid" means a centre or radius is stored but
 * unusable (unparseable, non-finite, out of range, or only half a coordinate),
 * which callers must treat as a failure rather than skipping the check.
 */
export function parseGeofenceConfig(
  rawLat: string | undefined,
  rawLng: string | undefined,
  rawRadius: string | undefined
): GeofenceConfig {
  const latBlank = !rawLat?.trim();
  const lngBlank = !rawLng?.trim();
  if (latBlank && lngBlank) return { status: "unset" };
  if (latBlank || lngBlank) return { status: "invalid" };

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const radius = rawRadius?.trim() ? Number(rawRadius) : 100;
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return { status: "invalid" };
  if (!Number.isFinite(radius) || radius <= 0) return { status: "invalid" };
  return { status: "ok", lat, lng, radius };
}
