/**
 * Neon Breakout — paddle, ball, glowing bricks.
 */

import { sfx } from "../sfx.js";
import { createParticlePool, loadHigh, saveHigh, clamp } from "./shared.js";

const HIGH_KEY = "breakoutHighScore";

export const breakoutGame = {
  id: "breakout",
  name: "Brick Breaker",
  controls: "Drag finger left/right · tap board to launch · Pause / Restart",
  leaderboard: true,

  create(api) {
    const { canvas, ctx, hud } = api;
    const W = canvas.width;
    const H = canvas.height;
    const particles = createParticlePool(120);

    const paddle = { w: 80, h: 12, x: W / 2 - 40, y: H - 36 };
    const ball = { x: W / 2, y: H - 50, vx: 0, vy: 0, r: 6, launched: false };
    let bricks = [];
    let score = 0;
    let high = loadHigh(HIGH_KEY);
    let lives = 3;
    let paused = false;
    let gameOver = false;
    let active = false;
    let keys = { left: false, right: false };
    let pointerX = null;
    let flash = 0;
    let level = 1;

    const COLORS = ["#ff2bd6", "#00e5ff", "#00ff9f", "#ffd166", "#9b5de5"];

    function buildBricks() {
      bricks = [];
      const rows = 4 + Math.min(3, level - 1);
      const cols = 8;
      const gap = 4;
      const top = 48;
      const bw = (W - gap * (cols + 1)) / cols;
      const bh = 16;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          bricks.push({
            x: gap + c * (bw + gap),
            y: top + r * (bh + gap),
            w: bw,
            h: bh,
            hp: 1 + ((r + level) % 2 === 0 ? 0 : Math.min(1, (level / 2) | 0)),
            color: COLORS[r % COLORS.length],
            alive: true,
          });
        }
      }
    }

    function launch() {
      if (ball.launched || gameOver) return;
      const angle = -Math.PI / 2 + (Math.random() * 0.6 - 0.3);
      const speed = 4.4 + level * 0.25;
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      ball.launched = true;
      sfx.launch();
    }

    function stickBall() {
      ball.launched = false;
      ball.vx = 0;
      ball.vy = 0;
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 2;
    }

    function endGame() {
      gameOver = true;
      sfx.die();
      if (score > high) {
        high = score;
        saveHigh(HIGH_KEY, high);
        hud.setHigh(high);
        sfx.highScore();
      }
      hud.onGameOver(score, { leaderboard: true });
    }

    function nextLevel() {
      level += 1;
      sfx.levelUp();
      buildBricks();
      stickBall();
      flash = 0.5;
    }

    function draw() {
      ctx.fillStyle = "#070a0a";
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = "rgba(0,255,159,0.1)";
      ctx.strokeRect(3, 3, W - 6, H - 6);

      if (flash > 0) {
        ctx.fillStyle = `rgba(0,255,159,${flash * 0.18})`;
        ctx.fillRect(0, 0, W, H);
      }

      // bricks
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        if (!b.alive) continue;
        ctx.fillStyle = b.color;
        ctx.globalAlpha = b.hp > 1 ? 1 : 0.85;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillRect(b.x, b.y, b.w, 3);
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = "#00ff9f";
      ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);

      ctx.fillStyle = "#ff2bd6";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();

      // lives
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px Share Tech Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`LIVES ${"❤".repeat(lives)}`, 12, 22);
      ctx.textAlign = "right";
      ctx.fillText(`LVL ${level}`, W - 12, 22);

      if (!ball.launched && !gameOver && !paused) {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,255,159,0.7)";
        ctx.font = "12px Orbitron, monospace";
        ctx.fillText("SPACE / TAP TO LAUNCH", W / 2, H / 2);
      }

      particles.draw(ctx);
    }

    function update(dt) {
      if (!active) return;
      const dts = Math.min(dt, 32) / 16.67;

      if (flash > 0) flash = Math.max(0, flash - dt * 0.0018);
      particles.update(dts);

      if (paused || gameOver) {
        draw();
        return;
      }

      // paddle
      const spd = 6.5 * dts;
      if (keys.left) paddle.x -= spd;
      if (keys.right) paddle.x += spd;
      if (pointerX != null) {
        paddle.x += pointerX - paddle.w / 2 - paddle.x;
      }
      paddle.x = clamp(paddle.x, 6, W - paddle.w - 6);

      if (!ball.launched) {
        ball.x = paddle.x + paddle.w / 2;
        ball.y = paddle.y - ball.r - 2;
        draw();
        return;
      }

      ball.x += ball.vx * dts;
      ball.y += ball.vy * dts;

      // walls
      if (ball.x - ball.r < 4) {
        ball.x = 4 + ball.r;
        ball.vx *= -1;
        sfx.wall();
      } else if (ball.x + ball.r > W - 4) {
        ball.x = W - 4 - ball.r;
        ball.vx *= -1;
        sfx.wall();
      }
      if (ball.y - ball.r < 4) {
        ball.y = 4 + ball.r;
        ball.vy *= -1;
        sfx.wall();
      }

      // bottom
      if (ball.y - ball.r > H) {
        lives -= 1;
        sfx.lifeLost();
        particles.burst(ball.x, H - 10, 16, "#ff4d6d");
        if (lives <= 0) endGame();
        else stickBall();
        draw();
        return;
      }

      // paddle collision
      if (
        ball.vy > 0 &&
        ball.y + ball.r >= paddle.y &&
        ball.y - ball.r <= paddle.y + paddle.h &&
        ball.x >= paddle.x &&
        ball.x <= paddle.x + paddle.w
      ) {
        ball.y = paddle.y - ball.r;
        const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        const speed = Math.hypot(ball.vx, ball.vy) * 1.02;
        const angle = -Math.PI / 2 + hit * 1.1;
        ball.vx = Math.cos(angle) * speed;
        ball.vy = Math.sin(angle) * speed;
        if (ball.vy > -1.5) ball.vy = -2.2;
        sfx.paddle();
        particles.burst(ball.x, ball.y, 6, "#00ff9f");
      }

      // bricks
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        if (!b.alive) continue;
        if (
          ball.x + ball.r > b.x &&
          ball.x - ball.r < b.x + b.w &&
          ball.y + ball.r > b.y &&
          ball.y - ball.r < b.y + b.h
        ) {
          // resolve side
          const overlapL = ball.x + ball.r - b.x;
          const overlapR = b.x + b.w - (ball.x - ball.r);
          const overlapT = ball.y + ball.r - b.y;
          const overlapB = b.y + b.h - (ball.y - ball.r);
          const minX = Math.min(overlapL, overlapR);
          const minY = Math.min(overlapT, overlapB);
          if (minX < minY) ball.vx *= -1;
          else ball.vy *= -1;

          b.hp -= 1;
          if (b.hp <= 0) {
            b.alive = false;
            score += 10 * level;
            hud.setScore(score);
            particles.burst(b.x + b.w / 2, b.y + b.h / 2, 12, b.color);
            sfx.brick();
          } else {
            sfx.blip();
          }
          flash = 0.15;
          break;
        }
      }

      const remaining = bricks.some((b) => b.alive);
      if (!remaining) nextLevel();

      if (score > high) {
        high = score;
        saveHigh(HIGH_KEY, high);
        hud.setHigh(high);
      }

      // speed cap
      const sp = Math.hypot(ball.vx, ball.vy);
      const maxSp = 10;
      if (sp > maxSp) {
        ball.vx = (ball.vx / sp) * maxSp;
        ball.vy = (ball.vy / sp) * maxSp;
      }

      draw();
    }

    function reset() {
      score = 0;
      lives = 3;
      level = 1;
      gameOver = false;
      paused = false;
      particles.clear();
      flash = 0;
      paddle.x = W / 2 - paddle.w / 2;
      buildBricks();
      stickBall();
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
        else if (!ball.launched) launch();
        else togglePause();
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

    let onKeyUp = null;
    let onPointerMove = null;
    let onDown = null;
    let onUp = null;

    function clientToCanvasX(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const scale = canvas.width / rect.width;
      return (clientX - rect.left) * scale;
    }

    function bind() {
      onKeyUp = (e) => {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
      };
      onPointerMove = (e) => {
        if (!active) return;
        pointerX = clientToCanvasX(e);
      };
      onUp = () => {
        pointerX = null;
      };
      onDown = (e) => {
        if (!active) return;
        e.preventDefault();
        pointerX = clientToCanvasX(e);
        if (e.pointerId != null && canvas.setPointerCapture) {
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
        if (!ball.launched && !gameOver && !paused) launch();
      };

      window.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("pointermove", onPointerMove, { passive: false });
      canvas.addEventListener("pointerdown", onDown, { passive: false });
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
    }

    function unbind() {
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      keys.left = keys.right = false;
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
          else if (!ball.launched) launch();
          else togglePause();
          break;
        default:
          break;
      }
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
