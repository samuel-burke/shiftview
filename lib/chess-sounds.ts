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

function noise(duration: number, gain: number, delay = 0) {
  try {
    const c = getCtx();
    const bufSize = c.sampleRate * duration;
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    filter.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(c.destination);
    src.start(c.currentTime + delay);
    src.stop(c.currentTime + delay + duration);
  } catch {}
}

export function playMove() {
  noise(0.06, 0.4);
  tone(900, 0.05, "square", 0.08);
}

export function playCapture() {
  noise(0.12, 0.7);
  tone(400, 0.1, "sawtooth", 0.15);
}

export function playCastle() {
  noise(0.06, 0.4);
  tone(900, 0.05, "square", 0.08);
  noise(0.06, 0.35, 0.07);
}

export function playCheck() {
  tone(880, 0.15, "sine", 0.35);
  tone(1100, 0.12, "sine", 0.2, 0.1);
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
