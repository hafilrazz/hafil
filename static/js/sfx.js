/**
 * Retro 8-bit arcade SFX via Web Audio API.
 * AudioContext is created ONLY after a user gesture (browser autoplay policy).
 * Before unlock, all sfx calls are silent no-ops — no console spam.
 */

let ctx = null;
let master = null;
let muted = false;
/** True only after a trusted user gesture unlocked audio */
let unlocked = false;
let hooksInstalled = false;

const MASTER_GAIN = 0.32;

function ensure() {
  // Never construct AudioContext until unlocked — constructing it suspended
  // and calling start() floods Chrome with autoplay warnings.
  if (!unlocked) return null;
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
    return null;
  }
  return ctx;
}

/**
 * Call from any click/tap/key. Safe to call many times.
 * Creates + resumes AudioContext under a user gesture.
 */
export function unlockAudio() {
  unlocked = true;
  const c = ensure();
  if (!c) return Promise.resolve(false);

  const finish = () => {
    try {
      // Silent blip so iOS keeps the context "warm"
      const buf = c.createBuffer(1, 1, c.sampleRate || 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(master || c.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    return c.state === "running";
  };

  if (c.state === "suspended") {
    return c
      .resume()
      .then(() => finish())
      .catch(() => false);
  }
  return Promise.resolve(finish());
}

/** Install once: first pointer/key on the page unlocks audio globally */
export function installAudioUnlockHooks() {
  if (hooksInstalled || typeof window === "undefined") return;
  hooksInstalled = true;

  const onGesture = () => {
    unlockAudio();
  };

  // capture phase so we unlock even if something stops propagation
  window.addEventListener("pointerdown", onGesture, { capture: true, once: true, passive: true });
  window.addEventListener("touchstart", onGesture, { capture: true, once: true, passive: true });
  window.addEventListener("keydown", onGesture, { capture: true, once: true });
}

// Auto-install when module loads
installAudioUnlockHooks();

export function setMuted(value) {
  muted = Boolean(value);
  if (master && ctx) {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.setItem("arcadeMuted", muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isMuted() {
  return muted;
}

export function isAudioUnlocked() {
  return unlocked && ctx && ctx.state === "running";
}

export function loadMutePreference() {
  try {
    if (localStorage.getItem("arcadeMuted") === "1") {
      muted = true;
    }
  } catch {
    /* ignore */
  }
  return muted;
}

/**
 * Returns a running AudioContext or null.
 * Never throws / never warns when blocked by autoplay policy.
 */
function ready() {
  if (muted || !unlocked) return null;
  const c = ensure();
  if (!c || !master) return null;
  // Only play when fully running — avoids "not allowed to start" spam
  if (c.state !== "running") {
    // Best-effort resume without throwing; still skip this frame of audio
    if (c.state === "suspended") {
      c.resume().catch(() => {});
    }
    return null;
  }
  return c;
}

function tone({
  type = "square",
  freq = 440,
  freqEnd = null,
  duration = 0.08,
  gain = 0.28,
  delay = 0,
  attack = 0.004,
  detune = 0,
}) {
  const c = ready();
  if (!c) return;

  try {
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(40, freqEnd),
        t0 + Math.max(0.02, duration)
      );
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.015, duration));
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  } catch {
    /* autoplay / closed context — ignore */
  }
}

function noiseBurst({
  duration = 0.12,
  gain = 0.22,
  delay = 0,
  filterFreq = 900,
  filterType = "bandpass",
}) {
  const c = ready();
  if (!c) return;

  try {
    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, len, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  } catch {
    /* ignore */
  }
}

function arp(freqs, { step = 0.07, type = "square", gain = 0.18, duration = 0.09 } = {}) {
  freqs.forEach((f, i) => {
    tone({ type, freq: f, duration, gain, delay: i * step });
  });
}

function chip(freq, opts = {}) {
  tone({ type: "square", freq, ...opts });
  tone({
    type: "square",
    freq: freq * 2,
    gain: (opts.gain ?? 0.22) * 0.35,
    duration: (opts.duration ?? 0.08) * 0.85,
    delay: opts.delay ?? 0,
  });
}

/* ================================================================== */
/* Public SFX library                                                   */
/* ================================================================== */

export const sfx = {
  blip() {
    chip(660, { duration: 0.045, gain: 0.16 });
  },
  select() {
    tone({ type: "square", freq: 400, duration: 0.04, gain: 0.12 });
    tone({ type: "square", freq: 600, duration: 0.05, gain: 0.14, delay: 0.04 });
  },
  confirm() {
    arp([523, 659, 784], { step: 0.06, gain: 0.16, duration: 0.07 });
  },
  move() {
    // Only when unlocked — otherwise silent (no warnings)
    tone({ type: "square", freq: 140, duration: 0.025, gain: 0.06 });
  },
  eat() {
    chip(520, { duration: 0.06, gain: 0.22 });
    tone({ type: "square", freq: 780, freqEnd: 1240, duration: 0.11, gain: 0.2, delay: 0.05 });
    tone({ type: "triangle", freq: 1040, duration: 0.08, gain: 0.1, delay: 0.1 });
  },
  die() {
    tone({ type: "sawtooth", freq: 280, freqEnd: 55, duration: 0.38, gain: 0.26 });
    tone({ type: "square", freq: 180, freqEnd: 40, duration: 0.32, gain: 0.14, delay: 0.04 });
    noiseBurst({ duration: 0.28, gain: 0.22, filterFreq: 700, delay: 0.02 });
  },
  pause() {
    tone({ type: "triangle", freq: 360, duration: 0.07, gain: 0.16 });
    tone({ type: "triangle", freq: 240, duration: 0.09, gain: 0.14, delay: 0.08 });
  },
  resume() {
    tone({ type: "triangle", freq: 240, duration: 0.07, gain: 0.14 });
    tone({ type: "triangle", freq: 360, duration: 0.09, gain: 0.16, delay: 0.07 });
  },
  start() {
    arp([262, 330, 392, 523], { step: 0.075, type: "square", gain: 0.2, duration: 0.09 });
  },
  highScore() {
    arp([523, 659, 784, 1047, 784, 1047], {
      step: 0.075,
      type: "square",
      gain: 0.18,
      duration: 0.1,
    });
  },
  win() {
    arp([392, 494, 587, 784, 988], { step: 0.09, type: "square", gain: 0.2, duration: 0.12 });
    tone({ type: "triangle", freq: 1175, duration: 0.2, gain: 0.12, delay: 0.45 });
  },
  paddle() {
    tone({ type: "square", freq: 180, freqEnd: 260, duration: 0.06, gain: 0.24 });
    noiseBurst({ duration: 0.04, gain: 0.08, filterFreq: 1200 });
  },
  wall() {
    tone({ type: "square", freq: 110, duration: 0.045, gain: 0.14 });
    noiseBurst({ duration: 0.035, gain: 0.08, filterFreq: 500, filterType: "lowpass" });
  },
  score() {
    tone({ type: "square", freq: 880, freqEnd: 440, duration: 0.16, gain: 0.22 });
    tone({ type: "square", freq: 660, duration: 0.08, gain: 0.12, delay: 0.1 });
  },
  brick() {
    const base = 420 + Math.random() * 280;
    tone({ type: "square", freq: base, freqEnd: base * 0.55, duration: 0.08, gain: 0.22 });
    noiseBurst({ duration: 0.06, gain: 0.14, filterFreq: 1400 + Math.random() * 400 });
  },
  launch() {
    tone({ type: "square", freq: 220, freqEnd: 720, duration: 0.12, gain: 0.2 });
    tone({ type: "triangle", freq: 440, freqEnd: 880, duration: 0.1, gain: 0.1, delay: 0.03 });
  },
  levelUp() {
    arp([330, 415, 523, 659, 831], { step: 0.07, type: "triangle", gain: 0.17, duration: 0.09 });
  },
  lifeLost() {
    tone({ type: "square", freq: 400, freqEnd: 120, duration: 0.22, gain: 0.2 });
    tone({ type: "sawtooth", freq: 200, freqEnd: 80, duration: 0.18, gain: 0.1, delay: 0.05 });
  },
  muteOn() {
    tone({ type: "square", freq: 500, freqEnd: 200, duration: 0.1, gain: 0.14 });
  },
  muteOff() {
    tone({ type: "square", freq: 200, freqEnd: 500, duration: 0.1, gain: 0.16 });
  },
  pad() {
    tone({ type: "square", freq: 300, duration: 0.03, gain: 0.1 });
  },
  coin() {
    tone({ type: "square", freq: 988, duration: 0.06, gain: 0.18 });
    tone({ type: "square", freq: 1319, duration: 0.12, gain: 0.16, delay: 0.06 });
  },
};
