let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, gain: number, delay = 0) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + delay);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.01);
  } catch {}
}

export function playNotificationSound() {
  tone(880, 0.18, 0.3);
  tone(1100, 0.14, 0.2, 0.12);
}

// Browsers keep AudioContexts suspended until the page receives a user
// gesture, which would swallow the sound of any banner that arrives before
// the user first interacts. Create/resume the shared context on the first
// gesture so it's already running when a banner fires. Returns a cleanup
// function for the listeners.
export function primeNotificationSound(): () => void {
  const prime = () => {
    try { getCtx(); } catch {}
  };
  window.addEventListener("pointerdown", prime, { once: true });
  window.addEventListener("keydown", prime, { once: true });
  return () => {
    window.removeEventListener("pointerdown", prime);
    window.removeEventListener("keydown", prime);
  };
}
