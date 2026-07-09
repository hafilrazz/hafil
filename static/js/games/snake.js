/**
 * Neon Snake — smooth interp animation, particles, retro SFX.
 */

import { sfx } from "../sfx.js";
import {
  createParticlePool,
  loadHigh,
  saveHigh,
  makeGridCache,
  pad,
} from "./shared.js";

const GRID = 20;
const BASE_INTERVAL = 140;
const MIN_INTERVAL = 70;
const SPEED_STEP = 3;
const HIGH_KEY = "snakeHighScore";

export const snakeGame = {
  id: "snake",
  name: "Neon Snake",
  controls: "Swipe on board to turn · Pause / Restart buttons · keyboard WASD",
  leaderboard: true,

  create(api) {
    const { canvas, ctx, hud } = api;
    const W = canvas.width;
    const H = canvas.height;
    const tile = W / GRID;
    const particles = createParticlePool(100);
    const gridCache = makeGridCache(W, H, tile);

    let snake = [{ x: 10, y: 10 }];
    let prevSnake = [{ x: 10, y: 10 }];
    let dir = { x: 1, y: 0 };
    let nextDir = { x: 1, y: 0 };
    let food = { x: 15, y: 15 };
    let score = 0;
    let high = loadHigh(HIGH_KEY);
    let paused = false;
    let gameOver = false;
    let moveTimer = 0;
    let moveInterval = BASE_INTERVAL;
    let animT = 1; // 0..1 between cells
    let flash = 0;
    let foodPulse = 0;
    let active = false;
    let touchStart = { x: 0, y: 0 };
    let keyHandler = null;
    let touchStartH = null;
    let touchEndH = null;

    function snapshotPrev() {
      prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    }

    function spawnFood() {
      let spot;
      let guard = 0;
      do {
        spot = {
          x: (Math.random() * GRID) | 0,
          y: (Math.random() * GRID) | 0,
        };
        guard++;
      } while (
        guard < 200 &&
        snake.some((s) => s.x === spot.x && s.y === spot.y)
      );
      food = spot;
    }

    function setDirection(nx, ny) {
      if (nx === -dir.x && ny === -dir.y) return;
      if (nx === -nextDir.x && ny === -nextDir.y) return;
      if (nextDir.x === nx && nextDir.y === ny) return;
      nextDir = { x: nx, y: ny };
      sfx.blip();
    }

    function moveSnake() {
      snapshotPrev();
      dir = { x: nextDir.x, y: nextDir.y };
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

      if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
        endGame();
        return;
      }
      for (let i = 0; i < snake.length; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) {
          endGame();
          return;
        }
      }

      snake.unshift(head);
      // Soft step (no-op until audio unlocked — no console spam)
      if (snake.length % 3 === 0) sfx.move();

      if (head.x === food.x && head.y === food.y) {
        score += 10;
        hud.setScore(score);
        moveInterval = Math.max(
          MIN_INTERVAL,
          BASE_INTERVAL - (score / 10) * SPEED_STEP
        );
        particles.burst(
          food.x * tile + tile / 2,
          food.y * tile + tile / 2,
          20,
          "#ff2bd6"
        );
        flash = 0.35;
        sfx.eat();
        spawnFood();
      } else {
        snake.pop();
        prevSnake.pop();
        if (prevSnake.length < snake.length) {
          prevSnake.push({ ...snake[snake.length - 1] });
        }
      }
      animT = 0;
    }

    function endGame() {
      if (gameOver) return;
      gameOver = true;
      const head = snake[0];
      particles.burst(
        head.x * tile + tile / 2,
        head.y * tile + tile / 2,
        40,
        "#ff4d6d"
      );
      flash = 0.7;
      sfx.die();

      if (score > high) {
        high = score;
        saveHigh(HIGH_KEY, high);
        hud.setHigh(high);
        sfx.highScore();
      }
      hud.onGameOver(score, { leaderboard: true });
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function segPos(i, t) {
      const cur = snake[i];
      const prev = prevSnake[i] || cur;
      // ease-out for snappy feel
      const e = 1 - (1 - t) * (1 - t);
      return {
        x: lerp(prev.x, cur.x, e),
        y: lerp(prev.y, cur.y, e),
      };
    }

    function draw(ts) {
      foodPulse = ts * 0.008;

      // background
      ctx.fillStyle = "#070a0a";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(gridCache, 0, 0);

      if (flash > 0) {
        ctx.fillStyle = `rgba(255,80,120,${flash * 0.2})`;
        ctx.fillRect(0, 0, W, H);
      }

      const t = Math.min(1, animT);

      // body (no blur/glow — blur kills mobile FPS)
      for (let i = snake.length - 1; i >= 1; i--) {
        const p = segPos(i, t);
        const alpha = 0.4 + (1 - i / snake.length) * 0.5;
        const s = tile - 4;
        ctx.fillStyle = `rgba(0, 255, 159, ${alpha})`;
        ctx.fillRect(p.x * tile + 2, p.y * tile + 2, s, s);
      }

      const head = segPos(0, t);
      const hx = head.x * tile + 1;
      const hy = head.y * tile + 1;
      const hs = tile - 2;
      ctx.fillStyle = "#00ff9f";
      ctx.fillRect(hx, hy, hs, hs);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(hx + 4, hy + 4, hs - 10, hs - 10);

      ctx.fillStyle = "#050608";
      const ex = dir.x !== 0 ? dir.x * 3 : 0;
      const ey = dir.y !== 0 ? dir.y * 3 : 0;
      const eyeBaseX = hx + hs / 2 + ex;
      const eyeBaseY = hy + hs / 2 + ey;
      if (dir.x !== 0) {
        ctx.fillRect(eyeBaseX - 1, eyeBaseY - 4, 3, 3);
        ctx.fillRect(eyeBaseX - 1, eyeBaseY + 2, 3, 3);
      } else {
        ctx.fillRect(eyeBaseX - 4, eyeBaseY - 1, 3, 3);
        ctx.fillRect(eyeBaseX + 2, eyeBaseY - 1, 3, 3);
      }

      const fx = food.x * tile + tile / 2;
      const fy = food.y * tile + tile / 2;
      const pulse = 7 + Math.sin(foodPulse) * 1.5;
      ctx.fillStyle = "#ff2bd6";
      ctx.beginPath();
      ctx.arc(fx, fy, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(fx, fy, 3, 0, Math.PI * 2);
      ctx.fill();

      particles.draw(ctx);
    }

    function update(dt, ts) {
      if (!active) return;

      if (flash > 0) flash = Math.max(0, flash - dt * 0.0015);

      particles.update(dt * 0.06);

      if (!paused && !gameOver) {
        moveTimer += dt;
        // smooth anim progress toward next cell
        animT = Math.min(1, moveTimer / moveInterval);
        if (moveTimer >= moveInterval) {
          moveTimer -= moveInterval;
          moveSnake();
        }
      }

      draw(ts);
    }

    function reset() {
      snake = [{ x: 10, y: 10 }];
      prevSnake = [{ x: 10, y: 10 }];
      dir = { x: 1, y: 0 };
      nextDir = { x: 1, y: 0 };
      score = 0;
      gameOver = false;
      paused = false;
      moveTimer = 0;
      moveInterval = BASE_INTERVAL;
      animT = 1;
      flash = 0;
      particles.clear();
      spawnFood();
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
      let handled = true;
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          if (!gameOver) setDirection(0, -1);
          break;
        case "ArrowDown":
        case "s":
        case "S":
          if (!gameOver) setDirection(0, 1);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          if (!gameOver) setDirection(-1, 0);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          if (!gameOver) setDirection(1, 0);
          break;
        case " ":
          if (gameOver) reset();
          else togglePause();
          break;
        default:
          handled = false;
      }
      return handled;
    }

    function applySwipe(dX, dY) {
      if (gameOver || paused) return;
      // Low threshold so short finger flicks still register on phones
      const threshold = 18;
      if (Math.abs(dX) < threshold && Math.abs(dY) < threshold) return;
      if (Math.abs(dX) > Math.abs(dY)) {
        if (dX > 0) setDirection(1, 0);
        else setDirection(-1, 0);
      } else {
        if (dY > 0) setDirection(0, 1);
        else setDirection(0, -1);
      }
    }

    function bindInput() {
      let tracking = false;
      touchStartH = (e) => {
        if (!active) return;
        // Only track primary finger / left button
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        const t = e.changedTouches ? e.changedTouches[0] : e;
        touchStart.x = t.clientX;
        touchStart.y = t.clientY;
        tracking = true;
        if (e.pointerId != null && canvas.setPointerCapture) {
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
      };
      touchEndH = (e) => {
        if (!active || !tracking) return;
        if (e.cancelable) e.preventDefault();
        tracking = false;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        applySwipe(t.clientX - touchStart.x, t.clientY - touchStart.y);
      };
      // Swipe while moving (don't wait for finger up) for snappier snake
      const onMove = (e) => {
        if (!active || !tracking) return;
        if (e.cancelable) e.preventDefault();
        const t = e.changedTouches ? e.changedTouches[0] : e;
        const dX = t.clientX - touchStart.x;
        const dY = t.clientY - touchStart.y;
        if (Math.abs(dX) >= 22 || Math.abs(dY) >= 22) {
          applySwipe(dX, dY);
          touchStart.x = t.clientX;
          touchStart.y = t.clientY;
        }
      };
      if (window.PointerEvent) {
        canvas.addEventListener("pointerdown", touchStartH, { passive: false });
        canvas.addEventListener("pointermove", onMove, { passive: false });
        canvas.addEventListener("pointerup", touchEndH, { passive: false });
        canvas.addEventListener("pointercancel", touchEndH, { passive: false });
        touchStartH._onMove = onMove;
      } else {
        canvas.addEventListener("touchstart", touchStartH, { passive: false });
        canvas.addEventListener("touchmove", onMove, { passive: false });
        canvas.addEventListener("touchend", touchEndH, { passive: false });
        touchStartH._onMove = onMove;
      }
    }

    function unbindInput() {
      const onMove = touchStartH?._onMove;
      if (touchStartH) {
        canvas.removeEventListener("pointerdown", touchStartH);
        canvas.removeEventListener("touchstart", touchStartH);
      }
      if (onMove) {
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("touchmove", onMove);
      }
      if (touchEndH) {
        canvas.removeEventListener("pointerup", touchEndH);
        canvas.removeEventListener("pointercancel", touchEndH);
        canvas.removeEventListener("touchend", touchEndH);
      }
      touchStartH = touchEndH = null;
    }

    /** Virtual pad / hub mobile controls */
    function control(action, pressed = true) {
      if (!active || !pressed) return;
      switch (action) {
        case "up":
          if (!gameOver) setDirection(0, -1);
          break;
        case "down":
          if (!gameOver) setDirection(0, 1);
          break;
        case "left":
          if (!gameOver) setDirection(-1, 0);
          break;
        case "right":
          if (!gameOver) setDirection(1, 0);
          break;
        case "action":
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
        bindInput();
        reset();
      },
      stop() {
        active = false;
        paused = true;
        unbindInput();
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

export { pad };
