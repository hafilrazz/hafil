/**
 * Arcade hub — game dropdown, shared canvas loop, HUD, leaderboard hooks.
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
import { snakeGame } from "./games/snake.js";
import { pongGame } from "./games/pong.js";
import { breakoutGame } from "./games/breakout.js";
import { shooterGame } from "./games/shooter.js";
import { chessGame } from "./games/chess.js";
import { loadHigh, pad } from "./games/shared.js";
import { isTouchDevice } from "./games/mobile.js";

const CATALOG = [
  snakeGame,
  pongGame,
  breakoutGame,
  shooterGame,
  chessGame,
];

const HIGH_KEYS = {
  snake: "snakeHighScore",
  pong: "pongHighScore",
  breakout: "breakoutHighScore",
  shooter: "shooterHighScore",
};

export function initArcade() {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return null;

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
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
  const mobilePad = document.getElementById("mobilePad");
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

  let currentDef = CATALOG[0];
  let instance = null;
  let rafId = 0;
  let lastTs = 0;
  let running = true;
  let pendingScore = 0;
  let pendingGame = "snake";
  let submitting = false;

  // Restore mute preference + UI
  if (loadMutePreference()) {
    setMuted(true);
    if (muteBtn) {
      muteBtn.textContent = "SOUND: OFF";
      muteBtn.setAttribute("aria-pressed", "true");
    }
  }

  // Populate dropdown
  if (select) {
    select.innerHTML = CATALOG.map(
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
      // Every game can enter the per-game DB hall of fame
      if (score > 0) {
        pendingScore = score;
        pendingGame = currentDef.id;
        maybePromptLeaderboard(score, currentDef.id);
      }
    },
  };

  function buildInstance(def) {
    return def.create({ canvas, ctx, hud });
  }

  function setMobileLayout(layout) {
    if (!mobilePad) return;
    if (layout === "none") {
      mobilePad.hidden = true;
      return;
    }
    const mode = layout || "dpad";
    mobilePad.dataset.layout = mode;
    mobilePad.querySelectorAll(".pad-layout").forEach((el) => {
      el.hidden = el.dataset.for !== mode;
    });
  }

  function showMobilePad(show) {
    if (!mobilePad) return;
    if (currentDef?.mobileLayout === "none" || currentDef?.kind === "chess") {
      mobilePad.hidden = true;
      document.body.classList.remove("arcade-touch");
      return;
    }
    // Show on touch devices always; on desktop hide unless narrow
    const shouldShow =
      show && (isTouchDevice() || window.matchMedia("(max-width: 900px)").matches);
    mobilePad.hidden = !shouldShow;
    document.body.classList.toggle("arcade-touch", shouldShow);
  }

  function setArcadeMode(mode) {
    const chess = mode === "chess";
    canvasGameArea?.classList.toggle("hidden", chess);
    scoreHud?.classList.toggle("hidden", chess);
    classicControls?.classList.toggle("hidden", chess);
    // Chess uses full width — no leaderboard panel
    hofPanel?.classList.toggle("hidden", chess);
    arcadeGrid?.classList.toggle("is-chess", chess);
    document.getElementById("arcade")?.classList.toggle("chess-mode", chess);
    if (hofNote) hofNote.classList.toggle("hidden", chess);
    if (!chess) {
      chessPanel?.classList.add("hidden");
      chessPanel?.setAttribute("aria-hidden", "true");
    }
  }

  function switchGame(id) {
    const def = CATALOG.find((g) => g.id === id) || CATALOG[0];
    if (instance) {
      instance.stop();
      instance = null;
    }
    currentDef = def;

    const isChess = def.kind === "chess" || def.id === "chess";
    setArcadeMode(isChess ? "chess" : "canvas");

    if (gameTitle) gameTitle.textContent = def.name;
    if (controlsHint) {
      controlsHint.textContent = isChess
        ? def.controls
        : isTouchDevice()
          ? `${def.controls} · use the pad below`
          : def.controls;
    }
    if (hofNote) {
      hofNote.textContent = isChess
        ? "Cyber Chess is multiplayer — create a room code and share it with a friend."
        : `${def.name} scores save to the live Hall of Fame (top 10 for this game).`;
    }
    if (hofSub) {
      hofSub.textContent = isChess
        ? "Multiplayer · Socket.IO rooms · python-chess rules"
        : `${def.name} · top 10 · SQLite database`;
    }
    if (select && select.value !== def.id) select.value = def.id;

    hud.hideOverlay();
    closeScoreModal();

    if (isChess) {
      hud.setScore(0);
      hud.setHigh(0);
      setMobileLayout("none");
      showMobilePad(false);
      instance = buildInstance(def);
      instance.start();
    } else {
      const high = loadHigh(HIGH_KEYS[def.id] || `${def.id}HighScore`);
      hud.setScore(0);
      hud.setHigh(high);
      setMobileLayout(def.mobileLayout || "dpad");
      showMobilePad(true);
      instance = buildInstance(def);
      instance.start();
      pauseBtn.textContent = "PAUSE";
      setLeaderboardStatus(`Loading ${gameLabel(def.id)} scores...`);
      refreshLeaderboard(def.id);
    }
  }

  /* ---------- Mobile virtual pad ---------- */
  function bindMobilePad() {
    if (!mobilePad) return;

    const onPress = (btn, pressed) => {
      const action = btn.dataset.action;
      if (!action || !instance?.control) return;
      unlockAudio();
      if (pressed) sfx.pad();
      instance.control(action, pressed);
      btn.classList.toggle("is-active", pressed);
    };

    mobilePad.querySelectorAll(".pad-btn").forEach((btn) => {
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress(btn, true);
      };
      const up = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress(btn, false);
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointerleave", up);
      btn.addEventListener("pointercancel", up);
      // Prevent long-press context menu / text select
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  // Keep page from scrolling while dragging on the cabinet
  function bindScrollLock() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const lock = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    wrap.addEventListener("touchmove", lock, { passive: false });
    mobilePad?.addEventListener("touchmove", lock, { passive: false });
  }

  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;

    // Cap huge tab-switch spikes
    const safeDt = Math.min(dt, 50);
    if (instance) {
      instance.update(safeDt, ts);
      if (pauseBtn && !instance.isGameOver()) {
        pauseBtn.textContent = instance.isPaused() ? "RESUME" : "PAUSE";
      }
    }

    rafId = requestAnimationFrame(loop);
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

  function openScoreModal(finalScore, gameId = currentDef.id) {
    if (!modal) return;
    pendingGame = gameId;
    modalScore.textContent = pad(finalScore);
    modalMsg.textContent = `${gameLabel(gameId)} · top 10! Enter a callsign.`;
    nameInput.value = localStorage.getItem("arcadePlayerName") || localStorage.getItem("snakePlayerName") || "";
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

    const gameId = pendingGame || currentDef.id;

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

  // Input routing
  document.addEventListener("keydown", (e) => {
    if (modal?.classList.contains("open")) return;
    // Don't steal typing from inputs
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    unlockAudio();
    if (!instance) return;
    if (instance.onKey(e)) e.preventDefault();
  });

  // First interaction unlocks audio
  const unlockOnce = () => unlockAudio();
  canvas.addEventListener("pointerdown", unlockOnce, { once: true });
  document.getElementById("arcade")?.addEventListener("pointerdown", unlockOnce, {
    once: true,
  });

  select?.addEventListener("change", () => {
    unlockAudio();
    sfx.select();
    switchGame(select.value);
  });

  pauseBtn?.addEventListener("click", () => {
    unlockAudio();
    if (!instance) return;
    if (instance.isGameOver()) return;
    instance.togglePause();
    pauseBtn.textContent = instance.isPaused() ? "RESUME" : "PAUSE";
  });

  restartBtn?.addEventListener("click", () => {
    unlockAudio();
    instance?.reset();
    pauseBtn.textContent = "PAUSE";
  });

  overlayRestart?.addEventListener("click", () => {
    unlockAudio();
    instance?.reset();
    pauseBtn.textContent = "PAUSE";
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

  // Visibility: pause RAF math when tab hidden (still ok to pause game optionally)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      lastTs = 0;
    }
  });

  bindMobilePad();
  bindScrollLock();

  // Re-evaluate pad visibility on rotate / resize
  window.addEventListener("resize", () => {
    showMobilePad(true);
  });

  // Scroll arcade into view on mobile when selecting a game (optional comfort)
  select?.addEventListener("focus", () => {
    if (isTouchDevice() && arcadeSection) {
      // don't force scroll on every focus
    }
  });

  switchGame(select?.value || "snake");
  rafId = requestAnimationFrame(loop);

  return {
    switchGame,
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      instance?.stop();
    },
  };
}

// Back-compat alias
export function initGame() {
  return initArcade();
}
