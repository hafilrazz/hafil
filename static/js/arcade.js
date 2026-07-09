/**
 * Arcade hub — lazy game modules, idle loop, leaderboard hooks.
 */

import {
  unlockAudio,
  setMuted,
  isMuted,
  loadMutePreference,
  sfx,
} from "./sfx.js";
import {
  checkQualifies,
  refreshLeaderboard,
  submitScore,
  renderLeaderboard,
  gameLabel,
  setLeaderboardStatus,
} from "./leaderboard.js";
import { loadHigh, pad } from "./games/shared.js";

/** Lightweight catalog — full game code loads on demand */
const GAME_META = [
  {
    id: "snake",
    name: "Neon Snake",
    controls: "Swipe on board to turn · Pause / Restart · WASD",
    kind: "canvas",
    load: () => import("./games/snake.js").then((m) => m.snakeGame),
  },
  {
    id: "pong",
    name: "Cyber Pong",
    controls: "Drag finger up/down on board · Pause / Restart",
    kind: "canvas",
    load: () => import("./games/pong.js").then((m) => m.pongGame),
  },
  {
    id: "breakout",
    name: "Brick Breaker",
    controls: "Drag left/right · tap to launch · Pause / Restart",
    kind: "canvas",
    load: () => import("./games/breakout.js").then((m) => m.breakoutGame),
  },
  {
    id: "shooter",
    name: "Star Blaster",
    controls: "Drag left/right · tap to fire · Pause / Restart",
    kind: "canvas",
    load: () => import("./games/shooter.js").then((m) => m.shooterGame),
  },
  {
    id: "chess",
    name: "Cyber Chess",
    controls: "Tap piece → tap square · create/join room",
    kind: "chess",
    load: () => import("./games/chess.js").then((m) => m.chessGame),
  },
];

const HIGH_KEYS = {
  snake: "snakeHighScore",
  pong: "pongHighScore",
  breakout: "breakoutHighScore",
  shooter: "shooterHighScore",
};

const gameCache = new Map();

async function loadGameDef(meta) {
  if (gameCache.has(meta.id)) return gameCache.get(meta.id);
  const def = await meta.load();
  gameCache.set(meta.id, def);
  return def;
}

export function initArcade() {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return null;

  // low-power hint helps mobile browsers throttle GPU less aggressively for 2d
  const ctx =
    canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
    }) || canvas.getContext("2d", { alpha: false });

  const select = document.getElementById("gameSelect");
  const scoreEl = document.getElementById("score");
  const highEl = document.getElementById("highscore");
  const pauseBtn = document.getElementById("pauseBtn");
  const restartBtn = document.getElementById("restartBtn");
  const muteBtn = document.getElementById("muteBtn");
  const overlay = document.getElementById("gameOverlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayScore = document.getElementById("overlayScore");
  const overlayRestart = document.getElementById("overlayRestart");
  const controlsHint = document.getElementById("controlsHint");
  const gameTitle = document.getElementById("activeGameTitle");
  const hofNote = document.getElementById("hofNote");
  const hofSub = document.getElementById("hofSub") || document.querySelector(".hof-sub");
  const arcadeSection = document.getElementById("arcade");
  const scoreHud = document.getElementById("scoreHud");
  const canvasGameArea = document.getElementById("canvasGameArea");
  const chessPanel = document.getElementById("chessPanel");
  const classicControls = document.querySelector(".arcade-controls");
  const hofPanel = document.querySelector(".hof-panel");
  const arcadeGrid = document.querySelector(".arcade-grid");

  const modal = document.getElementById("scoreModal");
  const nameInput = document.getElementById("playerName");
  const submitBtn = document.getElementById("submitScoreBtn");
  const skipBtn = document.getElementById("skipScoreBtn");
  const modalScore = document.getElementById("modalScore");
  const modalMsg = document.getElementById("modalMsg");

  let currentMeta = GAME_META[0];
  let currentDef = null;
  let instance = null;
  let rafId = 0;
  let lastTs = 0;
  let running = true;
  let loopActive = false;
  let lastPauseLabel = "";
  let pendingScore = 0;
  let pendingGame = "snake";
  let submitting = false;
  let arcadeInView = false;
  let switching = false;

  if (loadMutePreference()) {
    setMuted(true);
    if (muteBtn) {
      muteBtn.textContent = "SOUND: OFF";
      muteBtn.setAttribute("aria-pressed", "true");
    }
  }

  if (select) {
    select.innerHTML = GAME_META.map(
      (g) => `<option value="${g.id}">${g.name}</option>`
    ).join("");
  }

  const hud = {
    setScore(n) {
      if (scoreEl) scoreEl.textContent = pad(n);
    },
    setHigh(n) {
      if (highEl) highEl.textContent = pad(n);
    },
    showOverlay(title, score) {
      if (!overlay) return;
      overlayTitle.textContent = title;
      overlayScore.textContent = `SCORE ${pad(score)}`;
      overlay.classList.add("active");
    },
    hideOverlay() {
      overlay?.classList.remove("active");
    },
    onGameOver(score, opts = {}) {
      const title = opts.win ? "YOU WIN!" : "GAME OVER";
      hud.showOverlay(title, score);
      if (score > 0) {
        pendingScore = score;
        pendingGame = currentMeta.id;
        maybePromptLeaderboard(score, currentMeta.id);
      }
    },
  };

  function setArcadeMode(mode) {
    const chess = mode === "chess";
    canvasGameArea?.classList.toggle("hidden", chess);
    scoreHud?.classList.toggle("hidden", chess);
    classicControls?.classList.toggle("hidden", chess);
    hofPanel?.classList.toggle("hidden", chess);
    arcadeGrid?.classList.toggle("is-chess", chess);
    document.getElementById("arcade")?.classList.toggle("chess-mode", chess);
    if (hofNote) hofNote.classList.toggle("hidden", chess);
    if (!chess) {
      chessPanel?.classList.add("hidden");
      chessPanel?.setAttribute("aria-hidden", "true");
    }
  }

  function needsGameLoop() {
    if (!running || document.hidden) return false;
    if (!instance) return false;
    if (currentMeta?.kind === "chess") return false;
    if (!arcadeInView) return false;
    return true;
  }

  function startLoop() {
    if (loopActive) return;
    if (!needsGameLoop()) return;
    loopActive = true;
    lastTs = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    loopActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTs = 0;
  }

  function loop(ts) {
    if (!loopActive || !running) return;
    if (!needsGameLoop()) {
      stopLoop();
      return;
    }

    if (!lastTs) lastTs = ts;
    const safeDt = Math.min(ts - lastTs, 50);
    lastTs = ts;

    if (instance) {
      instance.update(safeDt, ts);
      if (pauseBtn && !instance.isGameOver()) {
        const label = instance.isPaused() ? "RESUME" : "PAUSE";
        if (label !== lastPauseLabel) {
          lastPauseLabel = label;
          pauseBtn.textContent = label;
        }
      }
    }

    rafId = requestAnimationFrame(loop);
  }

  async function switchGame(id) {
    if (switching) return;
    switching = true;

    const meta = GAME_META.find((g) => g.id === id) || GAME_META[0];
    if (instance) {
      try {
        instance.stop();
      } catch {
        /* ignore */
      }
      instance = null;
    }
    stopLoop();
    currentMeta = meta;

    const isChess = meta.kind === "chess";
    setArcadeMode(isChess ? "chess" : "canvas");

    if (gameTitle) gameTitle.textContent = meta.name;
    if (controlsHint) controlsHint.textContent = meta.controls;
    if (hofNote && !isChess) {
      hofNote.textContent = `${meta.name} scores save to the live Hall of Fame (top 10 for this game).`;
    }
    if (hofSub) {
      hofSub.textContent = isChess
        ? "Multiplayer · room codes"
        : `${meta.name} · top 10 · SQLite`;
    }
    if (select && select.value !== meta.id) select.value = meta.id;

    hud.hideOverlay();
    closeScoreModal();

    try {
      if (controlsHint) controlsHint.textContent = "Loading…";
      currentDef = await loadGameDef(meta);
      if (controlsHint) controlsHint.textContent = meta.controls;

      if (isChess) {
        hud.setScore(0);
        hud.setHigh(0);
        instance = currentDef.create({ canvas, ctx, hud });
        instance.start();
      } else {
        const high = loadHigh(HIGH_KEYS[meta.id] || `${meta.id}HighScore`);
        hud.setScore(0);
        hud.setHigh(high);
        instance = currentDef.create({ canvas, ctx, hud });
        instance.start();
        pauseBtn.textContent = "PAUSE";
        lastPauseLabel = "PAUSE";
        setLeaderboardStatus(`Loading ${gameLabel(meta.id)} scores...`);
        // Don't block game start on network
        refreshLeaderboard(meta.id);
        if (arcadeInView) startLoop();
      }
    } catch (err) {
      console.error(err);
      if (controlsHint) controlsHint.textContent = "Failed to load game.";
      setLeaderboardStatus("Could not load game module", true);
    } finally {
      switching = false;
    }
  }

  function bindScrollLock() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const lock = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    wrap.addEventListener("touchmove", lock, { passive: false });
    canvas.addEventListener("touchmove", lock, { passive: false });
  }

  async function maybePromptLeaderboard(finalScore, gameId) {
    let qualifies = false;
    try {
      qualifies = await checkQualifies(finalScore, gameId);
    } catch {
      qualifies = finalScore > 0;
    }
    if (!qualifies) return;
    openScoreModal(finalScore, gameId);
  }

  function openScoreModal(finalScore, gameId = currentMeta.id) {
    if (!modal) return;
    pendingGame = gameId;
    modalScore.textContent = pad(finalScore);
    modalMsg.textContent = `${gameLabel(gameId)} · top 10! Enter a callsign.`;
    nameInput.value =
      localStorage.getItem("arcadePlayerName") ||
      localStorage.getItem("snakePlayerName") ||
      "";
    submitBtn.disabled = false;
    modal.classList.add("open");
    setTimeout(() => nameInput.focus(), 50);
  }

  function closeScoreModal() {
    modal?.classList.remove("open");
    pendingScore = 0;
  }

  async function handleSubmitScore() {
    if (submitting || pendingScore <= 0) return;
    submitting = true;
    submitBtn.disabled = true;
    modalMsg.textContent = "Uploading to Hall of Fame...";

    const name = nameInput.value.trim() || "ANON";
    localStorage.setItem("arcadePlayerName", name);
    localStorage.setItem("snakePlayerName", name);
    const gameId = pendingGame || currentMeta.id;

    try {
      const result = await submitScore(name, pendingScore, gameId);
      renderLeaderboard(result.scores, {
        highlightName: result.name,
        highlightScore: result.score,
      });
      setLeaderboardStatus(
        `${gameLabel(gameId)} · top ${result.scores.length} of 10 · SQLite online`
      );
      if (result.made_board) {
        sfx.coin();
        if (result.rank && result.rank <= 3) sfx.highScore();
        modalMsg.textContent = result.rank
          ? `Rank #${result.rank} on ${gameLabel(gameId)}. Respect.`
          : "Score saved!";
      } else {
        sfx.blip();
        modalMsg.textContent = "Close, but not quite top 10 this time.";
      }
      setTimeout(closeScoreModal, 900);
    } catch (err) {
      console.error(err);
      sfx.die();
      modalMsg.textContent = "Could not reach the database. Is the server running?";
      submitBtn.disabled = false;
    } finally {
      submitting = false;
    }
  }

  document.addEventListener("keydown", (e) => {
    if (modal?.classList.contains("open")) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    unlockAudio();
    if (!instance) return;
    if (instance.onKey(e)) e.preventDefault();
  });

  const unlockOnce = () => unlockAudio();
  canvas.addEventListener("pointerdown", unlockOnce, { once: true, passive: true });
  arcadeSection?.addEventListener("pointerdown", unlockOnce, { once: true, passive: true });

  select?.addEventListener("change", () => {
    unlockAudio();
    sfx.select();
    switchGame(select.value);
  });

  pauseBtn?.addEventListener("click", () => {
    unlockAudio();
    if (!instance || instance.isGameOver()) return;
    instance.togglePause();
    pauseBtn.textContent = instance.isPaused() ? "RESUME" : "PAUSE";
    lastPauseLabel = pauseBtn.textContent;
  });

  restartBtn?.addEventListener("click", () => {
    unlockAudio();
    instance?.reset();
    pauseBtn.textContent = "PAUSE";
    lastPauseLabel = "PAUSE";
  });

  overlayRestart?.addEventListener("click", () => {
    unlockAudio();
    instance?.reset();
    pauseBtn.textContent = "PAUSE";
    lastPauseLabel = "PAUSE";
  });

  muteBtn?.addEventListener("click", () => {
    unlockAudio();
    if (isMuted()) {
      setMuted(false);
      muteBtn.textContent = "SOUND: ON";
      muteBtn.setAttribute("aria-pressed", "false");
      sfx.muteOff();
    } else {
      sfx.muteOn();
      setMuted(true);
      muteBtn.textContent = "SOUND: OFF";
      muteBtn.setAttribute("aria-pressed", "true");
    }
  });

  submitBtn?.addEventListener("click", () => {
    unlockAudio();
    handleSubmitScore();
  });
  skipBtn?.addEventListener("click", () => {
    unlockAudio();
    sfx.blip();
    closeScoreModal();
  });
  nameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmitScore();
    if (e.key === "Escape") closeScoreModal();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop();
    else startLoop();
  });

  if (arcadeSection && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        arcadeInView = Boolean(entry?.isIntersecting);
        if (arcadeInView) startLoop();
        else stopLoop();
      },
      { rootMargin: "80px 0px", threshold: 0.02 }
    );
    io.observe(arcadeSection);
  } else {
    arcadeInView = true;
  }

  bindScrollLock();
  switchGame(select?.value || "snake");

  return {
    switchGame,
    destroy() {
      running = false;
      stopLoop();
      instance?.stop();
    },
  };
}

export function initGame() {
  return initArcade();
}
