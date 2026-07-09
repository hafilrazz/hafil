/**
 * Shared helpers for canvas mini-games.
 */

export function pad(n, w = 3) {
  return String(n).padStart(w, "0");
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Simple object pool for particles */
export function createParticlePool(max = 32) {
  const pool = [];
  const active = [];

  function spawn(x, y, opts = {}) {
    const p = pool.pop() || {};
    p.x = x;
    p.y = y;
    p.vx = opts.vx ?? (Math.random() - 0.5) * 6;
    p.vy = opts.vy ?? (Math.random() - 0.5) * 6;
    p.life = opts.life ?? 20 + Math.random() * 15;
    p.maxLife = p.life;
    p.color = opts.color ?? "#00ff9f";
    p.size = opts.size ?? 2 + Math.random() * 3;
    active.push(p);
    if (active.length > max) {
      pool.push(active.shift());
    }
  }

  function burst(x, y, count = 12, color = "#00ff9f") {
    for (let i = 0; i < count; i++) spawn(x, y, { color });
  }

  function update(dtScale = 1) {
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dtScale;
      if (p.life <= 0) {
        pool.push(active[i]);
        active.splice(i, 1);
      }
    }
  }

  function draw(ctx) {
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      const s = p.size;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    while (active.length) pool.push(active.pop());
  }

  return { spawn, burst, update, draw, clear, get count() { return active.length; } };
}

export function loadHigh(key) {
  return Number(localStorage.getItem(key)) || 0;
}

export function saveHigh(key, value) {
  localStorage.setItem(key, String(value));
}

/** Offscreen grid cache for neon boards */
export function makeGridCache(width, height, cell, color = "rgba(0,255,159,0.12)") {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  g.strokeStyle = color;
  g.lineWidth = 1;
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  for (let i = 0; i <= cols; i++) {
    g.beginPath();
    g.moveTo(i * cell + 0.5, 0);
    g.lineTo(i * cell + 0.5, height);
    g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    g.beginPath();
    g.moveTo(0, j * cell + 0.5);
    g.lineTo(width, j * cell + 0.5);
    g.stroke();
  }
  return c;
}
