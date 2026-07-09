/**
 * Star Blaster — bottom ship, dodge + shoot falling invaders.
 */

import { sfx } from "../sfx.js";
import { createParticlePool, loadHigh, saveHigh, clamp } from "./shared.js";

const HIGH_KEY = "shooterHighScore";

export const shooterGame = {
  id: "shooter",
  name: "Star Blaster",
  controls: "Drag left/right · tap to fire · Pause / Restart",
  leaderboard: true,

  create(api) {
    const { canvas, ctx, hud } = api;
    const W = canvas.width;
    const H = canvas.height;
    const particles = createParticlePool(100);

    const ship = {
      x: W / 2,
      y: H - 36,
      w: 28,
      h: 16,
      speed: 5.2,
    };

    let bullets = [];
    let enemies = [];
    let stars = [];
    let score = 0;
    let high = loadHigh(HIGH_KEY);
    let lives = 3;
    let paused = false;
    let gameOver = false;
    let active = false;
    let spawnTimer = 0;
    let fireCooldown = 0;
    let flash = 0;
    let wave = 1;
    let keys = { left: false, right: false };
    let pointerX = null;

    // starfield
    for (let i = 0; i < 40; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        s: 0.5 + Math.random() * 1.5,
        sp: 0.4 + Math.random() * 1.2,
      });
    }

    function fire() {
      if (!active || paused || gameOver) return;
      if (fireCooldown > 0) return;
      bullets.push({
        x: ship.x,
        y: ship.y - ship.h / 2,
        vy: -8,
        r: 3,
      });
      fireCooldown = 180;
      sfx.launch();
    }

    function spawnEnemy() {
      const size = 16 + Math.random() * 10;
      enemies.push({
        x: 20 + Math.random() * (W - 40),
        y: -20,
        w: size,
        h: size,
        vy: 1.1 + Math.random() * 0.9 + wave * 0.12,
        vx: (Math.random() - 0.5) * 1.4,
        hp: 1 + (wave > 3 && Math.random() < 0.25 ? 1 : 0),
        hue: Math.random() < 0.5 ? "#ff2bd6" : "#00e5ff",
      });
    }

    function hitShip() {
      lives -= 1;
      flash = 0.5;
      sfx.lifeLost();
      particles.burst(ship.x, ship.y, 20, "#ff4d6d");
      // clear nearby enemies
      enemies = enemies.filter((e) => Math.hypot(e.x - ship.x, e.y - ship.y) > 80);
      if (lives <= 0) endGame();
    }

    function endGame() {
      if (gameOver) return;
      gameOver = true;
      sfx.die();
      particles.burst(ship.x, ship.y, 40, "#ff4d6d");
      if (score > high) {
        high = score;
        saveHigh(HIGH_KEY, high);
        hud.setHigh(high);
        sfx.highScore();
      }
      hud.onGameOver(score, { leaderboard: true });
    }

    function draw() {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);

      // stars
      for (const s of stars) {
        ctx.fillStyle = `rgba(200,255,240,${0.3 + s.s * 0.2})`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }

      if (flash > 0) {
        ctx.fillStyle = `rgba(255,40,80,${flash * 0.28})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.fillStyle = "#00ff9f";
      for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const e of enemies) {
        ctx.fillStyle = e.hue;
        ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(e.x - e.w / 2 + 2, e.y - e.h / 2 + 2, e.w * 0.35, e.h * 0.35);
        if (e.hp > 1) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.strokeRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
        }
      }

      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.fillStyle = "#00ff9f";
      ctx.beginPath();
      ctx.moveTo(0, -ship.h);
      ctx.lineTo(ship.w / 2, ship.h / 2);
      ctx.lineTo(0, ship.h / 4);
      ctx.lineTo(-ship.w / 2, ship.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(-2, -4, 4, 6);
      // thruster
      ctx.fillStyle = "#ff2bd6";
      ctx.fillRect(-3, ship.h / 3, 6, 6 + Math.random() * 4);
      ctx.restore();

      // lives / wave
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "12px Share Tech Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`LIVES ${"▲".repeat(Math.max(0, lives))}`, 10, 18);
      ctx.textAlign = "right";
      ctx.fillText(`WAVE ${wave}`, W - 10, 18);

      if (!gameOver && !paused && bullets.length === 0 && enemies.length === 0 && score === 0) {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,255,159,0.7)";
        ctx.font = "12px Orbitron, monospace";
        ctx.fillText("MOVE + FIRE", W / 2, H / 2);
      }

      particles.draw(ctx);
    }

    function update(dt) {
      if (!active) return;
      const dts = Math.min(dt, 32) / 16.67;

      if (flash > 0) flash = Math.max(0, flash - dt * 0.002);
      if (fireCooldown > 0) fireCooldown -= dt;
      particles.update(dts);

      // stars scroll
      for (const s of stars) {
        s.y += s.sp * dts;
        if (s.y > H) {
          s.y = 0;
          s.x = Math.random() * W;
        }
      }

      if (paused || gameOver) {
        draw();
        return;
      }

      // ship move
      if (keys.left) ship.x -= ship.speed * dts;
      if (keys.right) ship.x += ship.speed * dts;
      if (pointerX != null) {
        ship.x += (pointerX - ship.x) * 0.35;
      }
      ship.x = clamp(ship.x, ship.w / 2 + 4, W - ship.w / 2 - 4);

      // spawn
      spawnTimer += dt;
      const spawnEvery = Math.max(420, 900 - wave * 40);
      if (spawnTimer >= spawnEvery) {
        spawnTimer = 0;
        spawnEnemy();
        if (wave > 2 && Math.random() < 0.3) spawnEnemy();
      }

      // wave from score
      wave = 1 + Math.floor(score / 150);

      // bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.y += b.vy * dts;
        if (b.y < -10) {
          bullets.splice(i, 1);
          continue;
        }
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (
            Math.abs(b.x - e.x) < e.w / 2 + b.r &&
            Math.abs(b.y - e.y) < e.h / 2 + b.r
          ) {
            e.hp -= 1;
            bullets.splice(i, 1);
            particles.burst(e.x, e.y, 8, e.hue);
            if (e.hp <= 0) {
              enemies.splice(j, 1);
              score += 10 + wave * 2;
              hud.setScore(score);
              sfx.brick();
              if (score > high) {
                high = score;
                saveHigh(HIGH_KEY, high);
                hud.setHigh(high);
              }
            } else {
              sfx.blip();
            }
            break;
          }
        }
      }

      // enemies
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.y += e.vy * dts;
        e.x += e.vx * dts;
        if (e.x < e.w / 2 || e.x > W - e.w / 2) e.vx *= -1;

        // hit ship
        if (
          Math.abs(e.x - ship.x) < (e.w + ship.w) * 0.4 &&
          Math.abs(e.y - ship.y) < (e.h + ship.h) * 0.45
        ) {
          enemies.splice(i, 1);
          hitShip();
          continue;
        }

        // passed bottom
        if (e.y - e.h / 2 > H) {
          enemies.splice(i, 1);
          hitShip();
        }
      }

      draw();
    }

    function reset() {
      score = 0;
      lives = 3;
      wave = 1;
      gameOver = false;
      paused = false;
      bullets = [];
      enemies = [];
      ship.x = W / 2;
      spawnTimer = 0;
      fireCooldown = 0;
      flash = 0;
      particles.clear();
      hud.setScore(0);
      hud.setHigh(high);
      hud.hideOverlay();
      sfx.start();
    }

    function pause() {
      if (gameOver || paused) return;
      paused = true;
      sfx.pause();
      hud.showOverlay("PAUSED", score);
    }

    function resume() {
      if (gameOver || !paused) return;
      paused = false;
      sfx.resume();
      hud.hideOverlay();
    }

    function togglePause() {
      if (gameOver) return;
      if (paused) resume();
      else pause();
    }

    function onKey(e) {
      if (!active) return false;
      if (e.key === " ") {
        if (gameOver) reset();
        else fire();
        return true;
      }
      if (e.key === "p" || e.key === "P") {
        togglePause();
        return true;
      }
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        keys.left = e.type !== "keyup";
        return true;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        keys.right = e.type !== "keyup";
        return true;
      }
      return false;
    }

    function control(action, pressed = true) {
      if (!active) return;
      switch (action) {
        case "left":
          keys.left = pressed;
          if (pressed) keys.right = false;
          break;
        case "right":
          keys.right = pressed;
          if (pressed) keys.left = false;
          break;
        case "action":
          if (!pressed) break;
          if (gameOver) reset();
          else fire();
          break;
        default:
          break;
      }
    }

    let onKeyUp = null;
    let onPointerMove = null;
    let onPointerDown = null;
    let onPointerUp = null;

    function bind() {
      onKeyUp = (e) => {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
      };
      onPointerMove = (e) => {
        if (!active) return;
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX ?? e.touches?.[0]?.clientX;
        if (clientX == null) return;
        const scale = canvas.width / rect.width;
        pointerX = (clientX - rect.left) * scale;
      };
      onPointerDown = (e) => {
        if (!active) return;
        e.preventDefault();
        onPointerMove(e);
        // tap upper half or double-purpose: fire on tap
        fire();
        if (e.pointerId != null && canvas.setPointerCapture) {
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
      };
      onPointerUp = () => {
        pointerX = null;
      };

      window.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("pointermove", onPointerMove, { passive: false });
      canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
    }

    function unbind() {
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      keys.left = keys.right = false;
    }

    return {
      start() {
        active = true;
        bind();
        reset();
      },
      stop() {
        active = false;
        unbind();
      },
      reset,
      pause,
      resume,
      togglePause,
      update,
      onKey,
      control,
      getScore: () => score,
      isGameOver: () => gameOver,
      isPaused: () => paused,
    };
  },
};
