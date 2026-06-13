import type { PunchType } from "@/data/types";
import { isSoundEnabled } from "./sound-preference";

// One shared AudioContext for every sound effect in the app. Browsers keep it
// suspended until a user gesture, so primeSounds() resumes it on the first
// interaction — otherwise the first banner or punch after page load would be
// silently dropped by the autoplay policy.
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

// Decoded WAV clips, keyed by URL. Decoding once and firing a fresh buffer
// source per play (rather than reusing a single <audio> element, which can
// drop a play() that lands before the file has loaded or while a prior play is
// still running) is what makes rapid, back-to-back punches reliably sound.
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return Promise.resolve(cached);
  const inFlight = loading.get(url);
  if (inFlight) return inFlight;
  const c = getCtx();
  if (!c) return Promise.resolve(null);
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((data) => c.decodeAudioData(data))
    .then((buf) => {
      buffers.set(url, buf);
      return buf;
    })
    .catch(() => null)
    .finally(() => loading.delete(url));
  loading.set(url, p);
  return p;
}

function playBuffer(url: string): void {
  const c = getCtx();
  if (!c) return;
  const start = (buf: AudioBuffer) => {
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start();
    } catch {}
  };
  const cached = buffers.get(url);
  if (cached) start(cached);
  else void loadBuffer(url).then((buf) => buf && start(buf));
}

function tone(freq: number, duration: number, gain: number, delay = 0): void {
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
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

const PUNCH_IN = "/sounds/punch-in.wav";
const PUNCH_OUT = "/sounds/punch-out.wav";

// clock_in / break_end resume work, so they play the "in" chime;
// clock_out / break_start stop work, so they play the "out" chime.
export function playPunchSound(punchType: PunchType): void {
  if (!isSoundEnabled()) return;
  playBuffer(punchType === "clock_in" || punchType === "break_end" ? PUNCH_IN : PUNCH_OUT);
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

// Warm up the shared context and preload the punch clips on the first user
// gesture, so the first sound after page load plays without a delay or drop.
// Returns a cleanup function for the listeners.
export function primeSounds(): () => void {
  const prime = () => {
    getCtx();
    void loadBuffer(PUNCH_IN);
    void loadBuffer(PUNCH_OUT);
  };
  window.addEventListener("pointerdown", prime, { once: true });
  window.addEventListener("keydown", prime, { once: true });
  return () => {
    window.removeEventListener("pointerdown", prime);
    window.removeEventListener("keydown", prime);
  };
}
