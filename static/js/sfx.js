/**
 * Retro 8-bit arcade SFX via Web Audio API (no external files).
 * Square/triangle/noise synth with short arpeggios — classic cabinet feel.
 */

let ctx = null;
let master = null;
let muted = false;
let unlocked = false;

const MASTER_GAIN = 0.32;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;
  master.connect(ctx.destination);
  return ctx;
}

/** iOS / Chrome: must resume + play a silent buffer on a user gesture */
export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
  if (!unlocked) {
    try {
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    unlocked = true;
  }
}

export function setMuted(value) {
  muted = Boolean(value);
  if (master) {
    master.gain.cancelScheduledValues(master.context.currentTime);
    master.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, master.context.currentTime);
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

function ready() {
  if (muted) return null;
  const c = ensure();
  if (!c) return null;
  if (c.state === "suspended") c.resume().catch(() => {});
  return c;
}

/**
 * Single oscillator note with optional pitch sweep.
 */
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
}

/** Filtered noise (explosions, scrapes) */
function noiseBurst({
  duration = 0.12,
  gain = 0.22,
  delay = 0,
  filterFreq = 900,
  filterType = "bandpass",
}) {
  const c = ready();
  if (!c) return;

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
}

/** Quick arpeggio of absolute frequencies */
function arp(freqs, { step = 0.07, type = "square", gain = 0.18, duration = 0.09 } = {}) {
  freqs.forEach((f, i) => {
    tone({ type, freq: f, duration, gain, delay: i * step });
  });
}

/** Duty-cycle-ish dual square (thicker chip sound) */
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
  /** UI click */
  blip() {
    chip(660, { duration: 0.045, gain: 0.16 });
  },

  /** Soft UI select */
  select() {
    tone({ type: "square", freq: 400, duration: 0.04, gain: 0.12 });
    tone({ type: "square", freq: 600, duration: 0.05, gain: 0.14, delay: 0.04 });
  },

  /** Confirm / submit */
  confirm() {
    arp([523, 659, 784], { step: 0.06, gain: 0.16, duration: 0.07 });
  },

  /** Quiet tick (optional movement) */
  move() {
    tone({ type: "square", freq: 140, duration: 0.025, gain: 0.06 });
  },

  /** Snake eat food — classic coin-up */
  eat() {
    chip(520, { duration: 0.06, gain: 0.22 });
    tone({ type: "square", freq: 780, freqEnd: 1240, duration: 0.11, gain: 0.2, delay: 0.05 });
    tone({ type: "triangle", freq: 1040, duration: 0.08, gain: 0.1, delay: 0.1 });
  },

  /** Death / crash */
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

  /** Game start jingle */
  start() {
    arp([262, 330, 392, 523], { step: 0.075, type: "square", gain: 0.2, duration: 0.09 });
  },

  /** New high score fanfare */
  highScore() {
    arp([523, 659, 784, 1047, 784, 1047], {
      step: 0.075,
      type: "square",
      gain: 0.18,
      duration: 0.1,
    });
  },

  /** Win match */
  win() {
    arp([392, 494, 587, 784, 988], { step: 0.09, type: "square", gain: 0.2, duration: 0.12 });
    tone({ type: "triangle", freq: 1175, duration: 0.2, gain: 0.12, delay: 0.45 });
  },

  /** Pong paddle hit */
  paddle() {
    tone({ type: "square", freq: 180, freqEnd: 260, duration: 0.06, gain: 0.24 });
    noiseBurst({ duration: 0.04, gain: 0.08, filterFreq: 1200 });
  },

  /** Wall bounce */
  wall() {
    tone({ type: "square", freq: 110, duration: 0.045, gain: 0.14 });
    noiseBurst({ duration: 0.035, gain: 0.08, filterFreq: 500, filterType: "lowpass" });
  },

  /** Point scored */
  score() {
    tone({ type: "square", freq: 880, freqEnd: 440, duration: 0.16, gain: 0.22 });
    tone({ type: "square", freq: 660, duration: 0.08, gain: 0.12, delay: 0.1 });
  },

  /** Breakout brick smash */
  brick() {
    const base = 420 + Math.random() * 280;
    tone({ type: "square", freq: base, freqEnd: base * 0.55, duration: 0.08, gain: 0.22 });
    noiseBurst({ duration: 0.06, gain: 0.14, filterFreq: 1400 + Math.random() * 400 });
  },

  /** Ball launch */
  launch() {
    tone({ type: "square", freq: 220, freqEnd: 720, duration: 0.12, gain: 0.2 });
    tone({ type: "triangle", freq: 440, freqEnd: 880, duration: 0.1, gain: 0.1, delay: 0.03 });
  },

  /** Level clear */
  levelUp() {
    arp([330, 415, 523, 659, 831], { step: 0.07, type: "triangle", gain: 0.17, duration: 0.09 });
  },

  /** Life lost (breakout) */
  lifeLost() {
    tone({ type: "square", freq: 400, freqEnd: 120, duration: 0.22, gain: 0.2 });
    tone({ type: "sawtooth", freq: 200, freqEnd: 80, duration: 0.18, gain: 0.1, delay: 0.05 });
  },

  /** Mute toggle chirp */
  muteOn() {
    tone({ type: "square", freq: 500, freqEnd: 200, duration: 0.1, gain: 0.14 });
  },

  muteOff() {
    // play after unmute so user hears it
    tone({ type: "square", freq: 200, freqEnd: 500, duration: 0.1, gain: 0.16 });
  },

  /** Pad press feedback */
  pad() {
    tone({ type: "square", freq: 300, duration: 0.03, gain: 0.1 });
  },

  /** Coin / insert for modal success */
  coin() {
    tone({ type: "square", freq: 988, duration: 0.06, gain: 0.18 });
    tone({ type: "square", freq: 1319, duration: 0.12, gain: 0.16, delay: 0.06 });
  },
};
