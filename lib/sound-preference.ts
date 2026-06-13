// Device-local toggle for all in-app sound effects. Stored in localStorage so
// the choice is per-device (sounds are about what *this* device plays), and
// read live at play time so toggling it takes effect immediately.
const KEY = "soundEnabled";

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "false";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, enabled ? "true" : "false");
  } catch {}
}
