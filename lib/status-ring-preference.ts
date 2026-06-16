// Device-local toggle for the ambient clock-status ring (the soft glow around
// the screen edge that signals clocked-in / on-break at a glance). Stored in
// localStorage so the choice is per-device, and read live so toggling it takes
// effect immediately. A custom event lets the ring component react to changes
// made elsewhere (e.g. the Settings screen) without a reload.
const KEY = "statusRingEnabled";
export const STATUS_RING_EVENT = "sv:statusring";

export function isStatusRingEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "false";
  } catch {
    return true;
  }
}

export function setStatusRingEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, enabled ? "true" : "false");
  } catch {}
  // Notify live listeners (the ring lives in a different part of the tree).
  window.dispatchEvent(new CustomEvent(STATUS_RING_EVENT, { detail: enabled }));
}
