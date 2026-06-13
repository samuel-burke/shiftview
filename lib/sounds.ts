import type { PunchType } from "@/data/types";
import { isSoundEnabled } from "./sound-preference";

// One shared AudioContext for every sound effect in the app. Browsers keep it
// suspended until a user gesture, so primeSounds() resumes it on the first
// interaction — otherwise the first sound after page load would be silently
// dropped by the autoplay policy.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    if (!ctx || ctx.state === "closed") ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  duration: number,
  gain: number,
  delay = 0,
  type: OscillatorType = "sine",
): void {
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = c.currentTime + delay;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch {}
}

// clock_in / break_end resume work → ascending two-note chime (C5 → E5).
// clock_out / break_start stop work → descending two-note chime (E5 → C5).
export function playPunchSound(punchType: PunchType): void {
  if (!isSoundEnabled()) return;
  if (punchType === "clock_in" || punchType === "break_end") {
    tone(523, 0.18, 0.22);          // C5
    tone(659, 0.22, 0.18, 0.14);    // E5
  } else {
    tone(659, 0.18, 0.22);          // E5
    tone(523, 0.22, 0.18, 0.14);    // C5
  }
}

// Subtle, quiet blips for an open chat thread: a soft rising pair when you
// send, a single softer note when a message arrives.
export function playMessageSent(): void {
  if (!isSoundEnabled()) return;
  tone(660, 0.09, 0.05);
  tone(880, 0.08, 0.04, 0.06);
}

export function playMessageReceived(): void {
  if (!isSoundEnabled()) return;
  tone(520, 0.1, 0.05);
}

export function playNotificationSound(): void {
  if (!isSoundEnabled()) return;
  tone(880, 0.18, 0.3);
  tone(1100, 0.14, 0.2, 0.12);
}

// Warm up the shared AudioContext on the first user gesture so it's running
// before any sound needs to play. Returns a cleanup function for the listeners.
export function primeSounds(): () => void {
  const prime = () => { getCtx(); };
  window.addEventListener("pointerdown", prime, { once: true });
  window.addEventListener("keydown", prime, { once: true });
  return () => {
    window.removeEventListener("pointerdown", prime);
    window.removeEventListener("keydown", prime);
  };
}
