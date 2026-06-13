let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay = 0) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + delay);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + delay + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.01);
  } catch {}
}

export function playMove() {
  tone(523, 0.1, "sine", 0.3);
  tone(659, 0.08, "sine", 0.15);
}

export function playCapture() {
  tone(784, 0.06, "sine", 0.28);
  tone(988, 0.1, "sine", 0.32);
  tone(1319, 0.07, "sine", 0.15, 0.03);
}

export function playCastle() {
  tone(330, 0.14, "sine", 0.32);
  tone(415, 0.1, "sine", 0.2, 0.02);
  tone(494, 0.08, "sine", 0.12, 0.05);
}

export function playCheck() {
  tone(1047, 0.18, "sine", 0.38);
  tone(1319, 0.12, "sine", 0.2, 0.04);
}

export function playWin() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, "sine", 0.3, i * 0.13));
}

export function playLose() {
  [523, 466, 440, 349].forEach((f, i) => tone(f, 0.3, "sine", 0.25, i * 0.15));
}

export function playDraw() {
  tone(523, 0.2, "sine", 0.25);
  tone(523, 0.2, "sine", 0.2, 0.25);
}
