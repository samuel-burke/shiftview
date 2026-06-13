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

// Filtered noise burst — models the transient "click" of wood on wood
function woodClick(gainAmt: number, duration: number, lpFreq: number, delay = 0) {
  try {
    const c = getCtx();
    const bufSize = Math.ceil(c.sampleRate * (duration + delay));
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    const startSample = Math.ceil(delay * c.sampleRate);
    for (let i = startSample; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buf;

    // High-pass to remove rumble, low-pass to shape the "wood" colour
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;

    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lpFreq;
    lp.Q.value = 1.2;

    const g = c.createGain();
    g.gain.setValueAtTime(gainAmt, c.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(c.destination);
    src.start(c.currentTime);
    src.stop(c.currentTime + delay + duration + 0.01);
  } catch {}
}

// Short body resonance — the low "thump" under a piece placement
function thump(freq: number, gain: number, duration: number, delay = 0) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 2, c.currentTime + delay);
    osc.frequency.exponentialRampToValueAtTime(freq, c.currentTime + delay + 0.04);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.01);
  } catch {}
}

// Crisp wooden click ~0.29s
export function playMove() {
  woodClick(0.55, 0.29, 2800);
  thump(180, 0.35, 0.12);
}

// Heavier thud ~0.52s — louder, more low-end, longer decay
export function playCapture() {
  woodClick(0.9, 0.52, 2200);
  thump(130, 0.6, 0.22);
}

// Castle = double-click cadence
export function playCastle() {
  woodClick(0.55, 0.29, 2800);
  thump(180, 0.35, 0.12);
  woodClick(0.45, 0.22, 2800, 0.12);
  thump(180, 0.28, 0.1, 0.12);
}

// Bell-ping alert ~0.27s
export function playCheck() {
  tone(1480, 0.27, "sine", 0.4);
  tone(2220, 0.14, "sine", 0.18, 0.01);
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
