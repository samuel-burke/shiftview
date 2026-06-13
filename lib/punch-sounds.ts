import type { PunchType } from "@/data/types";

// Punch sounds are short WAV clips served from /public/sounds. We keep one
// preloaded Audio element per clip and rewind it before each play so rapid
// punches still trigger the sound.
let inAudio: HTMLAudioElement | null = null;
let outAudio: HTMLAudioElement | null = null;

function getAudio(kind: "in" | "out"): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (kind === "in") {
    if (!inAudio) {
      inAudio = new Audio("/sounds/punch-in.wav");
      inAudio.preload = "auto";
    }
    return inAudio;
  }
  if (!outAudio) {
    outAudio = new Audio("/sounds/punch-out.wav");
    outAudio.preload = "auto";
  }
  return outAudio;
}

// clock_in / break_end resume work, so they play the "in" chime;
// clock_out / break_start stop work, so they play the "out" chime.
export function playPunchSound(punchType: PunchType): void {
  const kind = punchType === "clock_in" || punchType === "break_end" ? "in" : "out";
  const audio = getAudio(kind);
  if (!audio) return;
  try {
    audio.currentTime = 0;
    void audio.play();
  } catch {}
}
