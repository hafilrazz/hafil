/**
 * Retro Pong — player vs CPU.
 */

import { sfx } from "../sfx.js";
import { createParticlePool, loadHigh, saveHigh, clamp } from "./shared.js";

const HIGH_KEY = "pongHighScore";

export const pongGame = {
  id: "pong",
  name: "Cyber Pong",
  controls: "Drag on canvas · Up/Down pad · Action to pause",
  mobileLayout: "vertical",
  leaderboard: true,

  create(api) {
    const { canvas, ctx, hud } = api;
    const W = canvas.width;
    const H = canvas.height;
    const particles = createParticlePool(60);

    const paddleH = 70;
    const paddleW = 10;
    let playerY = H / 2 - paddleH / 2;
    let cpuY = H / 2 - paddleH / 2;
    let ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 7 };
    let score = 0;
    let cpuScore = 0;
    let high = loadHigh(HIGH_KEY);
    let paused = false;
    let gameOver = false;
    let active = false;
    let serveTimer = 0;
    let keys = { up: false, down: false };
    let pointerY = null;
    let flash = 0;

    let onKeyDown = null;
    let onKeyUp = null;
    let onPointerMove = null;
    let onPointerDown = null;
    let onPointerUp = null;

    function serve(toPlayer = false) {
      const dir = toPlayer ? -1 : 1;
      const angle = (Math.random() * 0.7 - 0.35) * Math.PI;
      const speed = 4.2;
      ball.x = W / 2;
      ball.y = H / 2;
      ball.vx = Math.cos(angle) * speed * dir;
      ball.vy = Math.sin(angle) * speed;
      if (Math.abs(ball.vy) < 1.2) ball.vy = 1.2 * (Math.random() < 0.5 ? 1 : -1);
      serveTimer = 0.55;
      sfx.launch();
    }

    function resetRound(toPlayer) {
      serve(toPlayer);
    }

    function endMatch() {
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

    function drawNet() {
      ctx.fillStyle = "rgba(0,255,159,0.25)";
      for (let y = 8; y < H; y += 18) {
        ctx.fillRect(W / 2 - 1, y, 2, 10);
      }
    }

    function draw() {
      ctx.fillStyle = "#070a0a";
      ctx.fillRect(0, 0, W, H);

      // subtle court
      ctx.strokeStyle = "rgba(0,255,159,0.12)";
      ctx.strokeRect(4, 4, W - 8, H - 8);
      drawNet();

      if (flash > 0) {
        ctx.fillStyle = `rgba(0,255,159,${flash * 0.2})`;
        ctx.fillRect(0, 0, W, H);
      }

      // paddles
      ctx.shadowColor = "#00ff9f";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#00ff9f";
      ctx.fillRect(18, playerY, paddleW, paddleH);
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(W - 18 - paddleW, cpuY, paddleW, paddleH);
      ctx.shadowBlur = 0;

      // ball
      ctx.shadowColor = "#ff2bd6";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#ff2bd6";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // scores on court
      ctx.font = "600 28px Orbitron, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.textAlign = "center";
      ctx.fillText(String(score), W * 0.28, 48);
      ctx.fillText(String(cpuScore), W * 0.72, 48);

      particles.draw(ctx);
    }

    function update(dt) {
      if (!active) return;
      const dts = Math.min(dt, 32) / 16.67; // ~frames at 60fps

      if (flash > 0) flash = Math.max(0, flash - dt * 0.002);
      particles.update(dts * 0.9);

      if (paused || gameOver) {
        draw();
        return;
      }

      // player
      const speed = 5.5 * dts;
      if (keys.up) playerY -= speed;
      if (keys.down) playerY += speed;
      if (pointerY != null) {
        playerY += (pointerY - paddleH / 2 - playerY) * 0.25;
      }
      playerY = clamp(playerY, 6, H - paddleH - 6);

      // cpu AI
      const cpuCenter = cpuY + paddleH / 2;
      const target = ball.y + (Math.random() - 0.5) * 8;
      const cpuSpeed = 3.6 * dts + Math.min(1.5, score * 0.05);
      if (cpuCenter < target - 6) cpuY += cpuSpeed;
      else if (cpuCenter > target + 6) cpuY -= cpuSpeed;
      cpuY = clamp(cpuY, 6, H - paddleH - 6);

      if (serveTimer > 0) {
        serveTimer -= dt / 1000;
        draw();
        return;
      }

      ball.x += ball.vx * dts;
      ball.y += ball.vy * dts;

      // walls
      if (ball.y - ball.r < 4) {
        ball.y = 4 + ball.r;
        ball.vy *= -1;
        sfx.wall();
      } else if (ball.y + ball.r > H - 4) {
        ball.y = H - 4 - ball.r;
        ball.vy *= -1;
        sfx.wall();
      }

      // player paddle
      if (
        ball.vx < 0 &&
        ball.x - ball.r < 18 + paddleW &&
        ball.x - ball.r > 12 &&
        ball.y > playerY &&
        ball.y < playerY + paddleH
      ) {
        ball.x = 18 + paddleW + ball.r;
        const hit = (ball.y - (playerY + paddleH / 2)) / (paddleH / 2);
        ball.vx = Math.abs(ball.vx) * 1.05;
        ball.vy = hit * 4.5;
        sfx.paddle();
        particles.burst(ball.x, ball.y, 8, "#00ff9f");
        flash = 0.2;
      }

      // cpu paddle
      if (
        ball.vx > 0 &&
        ball.x + ball.r > W - 18 - paddleW &&
        ball.x + ball.r < W - 12 &&
        ball.y > cpuY &&
        ball.y < cpuY + paddleH
      ) {
        ball.x = W - 18 - paddleW - ball.r;
        const hit = (ball.y - (cpuY + paddleH / 2)) / (paddleH / 2);
        ball.vx = -Math.abs(ball.vx) * 1.05;
        ball.vy = hit * 4.5;
        sfx.paddle();
        particles.burst(ball.x, ball.y, 8, "#00e5ff");
      }

      // score
      if (ball.x < -20) {
        cpuScore += 1;
        sfx.score();
        if (cpuScore >= 7) endMatch();
        else resetRound(false);
      } else if (ball.x > W + 20) {
        score += 1;
        hud.setScore(score);
        sfx.score();
        particles.burst(W / 2, H / 2, 18, "#ff2bd6");
        if (score > high) {
          high = score;
          saveHigh(HIGH_KEY, high);
          hud.setHigh(high);
        }
        if (score >= 7) {
          gameOver = true;
          sfx.win();
          if (score > high) {
            high = score;
            saveHigh(HIGH_KEY, high);
            hud.setHigh(high);
          }
          hud.onGameOver(score, { leaderboard: true, win: true });
        } else {
          resetRound(true);
        }
      }

      // cap ball speed
      const maxSp = 9;
      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp > maxSp) {
        ball.vx = (ball.vx / sp) * maxSp;
        ball.vy = (ball.vy / sp) * maxSp;
      }

      draw();
    }

    function reset() {
      score = 0;
      cpuScore = 0;
      gameOver = false;
      paused = false;
      playerY = H / 2 - paddleH / 2;
      cpuY = H / 2 - paddleH / 2;
      particles.clear();
      flash = 0;
      hud.setScore(0);
      hud.setHigh(high);
      hud.hideOverlay();
      serve(false);
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
        else togglePause();
        return true;
      }
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        keys.up = e.type !== "keyup";
        return true;
      }
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        keys.down = e.type !== "keyup";
        return true;
      }
      return false;
    }

    function clientToCanvasY(e) {
      const rect = canvas.getBoundingClientRect();
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const scale = canvas.height / rect.height;
      return (clientY - rect.top) * scale;
    }

    function bind() {
      onKeyUp = (e) => {
        if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.up = false;
        if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.down = false;
      };
      onPointerMove = (e) => {
        if (!active) return;
        // Follow while pressed (or always after pointerdown via capture)
        if (e.pointerType === "mouse" && e.buttons === 0 && pointerY == null) return;
        pointerY = clientToCanvasY(e);
      };
      onPointerDown = (e) => {
        if (!active) return;
        e.preventDefault();
        pointerY = clientToCanvasY(e);
        if (e.pointerId != null && canvas.setPointerCapture) {
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
      };
      onPointerUp = () => {
        pointerY = null;
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
    }

    function control(action, pressed = true) {
      if (!active) return;
      switch (action) {
        case "up":
          keys.up = pressed;
          if (pressed) keys.down = false;
          break;
        case "down":
          keys.down = pressed;
          if (pressed) keys.up = false;
          break;
        case "action":
          if (!pressed) break;
          if (gameOver) reset();
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
        keys.up = keys.down = false;
      },
      reset,
      pause,
      resume,
      togglePause,
      update,
      onKey(e) {
        return onKey({ key: e.key, type: "keydown" });
      },
      control,
      getScore: () => score,
      isGameOver: () => gameOver,
      isPaused: () => paused,
    };
  },
};
