/**
 * Cyber Chess — multiplayer via Socket.IO room codes.
 * Server (python-chess) is authoritative for all rules.
 */

import { unlockAudio, sfx } from "../sfx.js";

const PIECES = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const FILES = "abcdefgh";

function loadSocketIo() {
  return new Promise((resolve, reject) => {
    if (window.io) {
      resolve(window.io);
      return;
    }
    const existing = document.querySelector("script[data-socketio]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.io));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
    s.crossOrigin = "anonymous";
    s.dataset.socketio = "1";
    s.onload = () => resolve(window.io);
    s.onerror = () => reject(new Error("Failed to load Socket.IO client"));
    document.head.appendChild(s);
  });
}

function squareFromIndex(i, flipped) {
  const file = i % 8;
  const rank = 7 - ((i / 8) | 0);
  const f = flipped ? 7 - file : file;
  const r = flipped ? 7 - rank : rank;
  return FILES[f] + (r + 1);
}

function indexFromSquare(sq, flipped) {
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]) - 1;
  const f = flipped ? 7 - file : file;
  const r = flipped ? 7 - rank : rank;
  return (7 - r) * 8 + f;
}

function parseFenBoard(fen) {
  const placement = (fen || "").split(" ")[0] || "";
  const map = {};
  let rank = 7;
  let file = 0;
  for (const ch of placement) {
    if (ch === "/") {
      rank -= 1;
      file = 0;
      continue;
    }
    if (ch >= "1" && ch <= "8") {
      file += Number(ch);
      continue;
    }
    map[FILES[file] + (rank + 1)] = ch;
    file += 1;
  }
  return map;
}

function lastMoveSquares(uci) {
  if (!uci || uci.length < 4) return new Set();
  return new Set([uci.slice(0, 2), uci.slice(2, 4)]);
}

export const chessGame = {
  id: "chess",
  name: "Cyber Chess",
  controls: "Tap piece → tap square · create/join room to play a friend",
  leaderboard: false,
  kind: "chess",

  create(api) {
    const { hud } = api;
    const root = document.getElementById("chessPanel");
    if (!root) {
      console.error("chessPanel missing from DOM");
      return dummyInstance();
    }

    const els = {
      lobby: root.querySelector("[data-chess-lobby]"),
      play: root.querySelector("[data-chess-play]"),
      board: root.querySelector("[data-chess-board]"),
      status: root.querySelector("[data-chess-status]"),
      roomCode: root.querySelector("[data-chess-room-code]"),
      roomDisplay: root.querySelector("[data-chess-room-display]"),
      nameInput: root.querySelector("[data-chess-name]"),
      joinCode: root.querySelector("[data-chess-join-code]"),
      createBtn: root.querySelector("[data-chess-create]"),
      joinBtn: root.querySelector("[data-chess-join]"),
      copyBtn: root.querySelector("[data-chess-copy]"),
      resignBtn: root.querySelector("[data-chess-resign]"),
      drawBtn: root.querySelector("[data-chess-draw]"),
      rematchBtn: root.querySelector("[data-chess-rematch]"),
      leaveBtn: root.querySelector("[data-chess-leave]"),
      msg: root.querySelector("[data-chess-msg]"),
      turn: root.querySelector("[data-chess-turn]"),
      you: root.querySelector("[data-chess-you]"),
      promo: root.querySelector("[data-chess-promo]"),
      connection: root.querySelector("[data-chess-connection]"),
    };

    let socket = null;
    let state = null;
    let selected = null;
    let targets = new Set();
    let pendingPromo = null; // { from, to }
    let active = false;
    let connecting = false;
    let endSoundPlayed = false;

    function setMsg(text, type = "info") {
      if (!els.msg) return;
      els.msg.textContent = text || "";
      els.msg.dataset.type = type;
    }

    function setConnection(text, ok = true) {
      if (!els.connection) return;
      els.connection.textContent = text;
      els.connection.classList.toggle("is-error", !ok);
    }

    async function ensureSocket() {
      if (socket?.connected) return socket;
      if (connecting) {
        await new Promise((r) => setTimeout(r, 200));
        if (socket?.connected) return socket;
      }
      connecting = true;
      setConnection("Connecting…", true);
      try {
        const io = await loadSocketIo();
        // Same origin — works for localhost and LAN IP on phones
        socket = io({
          path: "/socket.io",
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 12,
          reconnectionDelay: 800,
          timeout: 12000,
        });

        socket.on("connect", () => {
          setConnection("Online", true);
          sfx.blip();
          if (state?.room) socket.emit("chess:sync");
        });
        socket.on("disconnect", () => {
          setConnection("Disconnected — retrying…", false);
        });
        socket.on("connect_error", () => {
          setConnection("Connection error", false);
        });
        socket.on("chess:state", onState);
        socket.on("chess:error", (p) => {
          setMsg(p?.error || "Error", "error");
          sfx.die();
        });
        socket.on("chess:message", (p) => {
          setMsg(p?.msg || "", p?.type || "info");
          sfx.select();
        });
        socket.on("chess:left", () => {
          state = null;
          showLobby();
          setMsg("Left the room.");
        });
        socket.on("chess:hello", () => setConnection("Online", true));

        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("timeout")), 10000);
          socket.once("connect", () => {
            clearTimeout(t);
            resolve();
          });
          socket.once("connect_error", (e) => {
            clearTimeout(t);
            reject(e);
          });
        });
      } finally {
        connecting = false;
      }
      return socket;
    }

    function showLobby() {
      els.lobby?.classList.remove("hidden");
      els.play?.classList.add("hidden");
      els.promo?.classList.add("hidden");
      selected = null;
      targets = new Set();
    }

    function showPlay() {
      els.lobby?.classList.add("hidden");
      els.play?.classList.remove("hidden");
    }

    function playerName() {
      const n = (els.nameInput?.value || "").trim();
      if (n) {
        try {
          localStorage.setItem("chessPlayerName", n);
        } catch {
          /* ignore */
        }
        return n;
      }
      return "PILOT";
    }

    function onState(next) {
      state = next;
      if (!state) return;
      showPlay();
      if (els.roomDisplay) els.roomDisplay.textContent = state.room || "—";
      if (els.roomCode) els.roomCode.textContent = state.room || "—";

      const you = state.you ? state.you.toUpperCase() : "—";
      if (els.you) {
        els.you.textContent = state.you
          ? `You are ${you} · ${state.you === "white" ? state.whiteName : state.blackName}`
          : "Spectating";
      }

      let status = "";
      if (state.status === "waiting") {
        status = "Waiting for opponent… share the room code";
      } else if (state.status === "ended") {
        status = `${state.result || "Game over"} — ${state.resultReason || ""}`;
        if (!endSoundPlayed) {
          endSoundPlayed = true;
          sfx.win();
        }
      } else if (state.inCheck) {
        status = state.yourTurn ? "CHECK — your move" : "CHECK — opponent to move";
      } else if (state.yourTurn) {
        status = "Your turn";
      } else {
        status = "Opponent's turn";
      }
      if (els.status) els.status.textContent = status;
      if (els.turn) {
        els.turn.textContent =
          state.turn === "w" ? "White to move" : "Black to move";
      }

      if (state.drawOfferFrom && state.you && state.drawOfferFrom !== state.you) {
        setMsg("Opponent offers a draw. Press DRAW to accept.", "info");
      }

      if (state.status === "ended") {
        els.rematchBtn?.classList.remove("hidden");
      } else {
        els.rematchBtn?.classList.add("hidden");
        endSoundPlayed = false;
      }

      renderBoard();
    }

    function renderBoard() {
      if (!els.board || !state) return;
      const flipped = state.you === "black";
      const pieces = parseFenBoard(state.fen);
      const last = lastMoveSquares(state.lastMove);
      const legal = new Set(state.legal || []);

      // Rebuild targets from selected
      targets = new Set();
      if (selected) {
        for (const u of legal) {
          if (u.startsWith(selected)) targets.add(u.slice(2, 4));
        }
      }

      const frag = document.createDocumentFragment();
      // ranks from white's view unless flipped
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const sq = squareFromIndex(row * 8 + col, flipped);
          const light = (row + col) % 2 === 0;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "chess-sq" + (light ? " is-light" : " is-dark");
          btn.dataset.square = sq;
          btn.setAttribute("aria-label", sq);

          if (last.has(sq)) btn.classList.add("is-last");
          if (selected === sq) btn.classList.add("is-selected");
          if (targets.has(sq)) btn.classList.add("is-target");
          if (state.inCheck) {
            const k = state.turn === "w" ? "K" : "k";
            if (pieces[sq] === k) btn.classList.add("is-check");
          }

          const piece = pieces[sq];
          if (piece) {
            const span = document.createElement("span");
            span.className =
              "chess-piece" + (piece === piece.toUpperCase() ? " is-white" : " is-black");
            span.textContent = PIECES[piece] || piece;
            btn.appendChild(span);
          }

          // coord labels on edge
          if (col === 0) {
            const lab = document.createElement("span");
            lab.className = "chess-coord chess-rank";
            lab.textContent = sq[1];
            btn.appendChild(lab);
          }
          if (row === 7) {
            const lab = document.createElement("span");
            lab.className = "chess-coord chess-file";
            lab.textContent = sq[0];
            btn.appendChild(lab);
          }

          btn.addEventListener("click", () => onSquare(sq));
          frag.appendChild(btn);
        }
      }
      els.board.replaceChildren(frag);
      els.board.dataset.flipped = flipped ? "1" : "0";
    }

    function pieceAt(sq) {
      if (!state) return null;
      return parseFenBoard(state.fen)[sq] || null;
    }

    function isOwnPiece(piece) {
      if (!piece || !state?.you) return false;
      if (state.you === "white") return piece === piece.toUpperCase();
      return piece === piece.toLowerCase();
    }

    function onSquare(sq) {
      if (!state || state.status !== "playing" || !state.yourTurn) {
        if (state?.status === "waiting") setMsg("Waiting for opponent…");
        else if (state && !state.yourTurn) setMsg("Not your turn.");
        return;
      }
      unlockAudio();

      const legal = state.legal || [];
      const piece = pieceAt(sq);

      if (!selected) {
        if (piece && isOwnPiece(piece)) {
          selected = sq;
          sfx.pad();
          renderBoard();
        }
        return;
      }

      if (selected === sq) {
        selected = null;
        renderBoard();
        return;
      }

      // reselect own piece
      if (piece && isOwnPiece(piece)) {
        selected = sq;
        sfx.pad();
        renderBoard();
        return;
      }

      // try move
      const from = selected;
      const to = sq;
      const matches = legal.filter((u) => u.startsWith(from + to));
      if (!matches.length) {
        selected = null;
        sfx.blip();
        renderBoard();
        return;
      }

      if (matches.length > 1 || matches.some((u) => u.length === 5)) {
        // promotion
        pendingPromo = { from, to, options: matches };
        selected = null;
        openPromo();
        return;
      }

      selected = null;
      sendMove(matches[0]);
    }

    function openPromo() {
      if (!els.promo) {
        sendMove(pendingPromo.from + pendingPromo.to + "q");
        return;
      }
      els.promo.classList.remove("hidden");
    }

    function closePromo() {
      els.promo?.classList.add("hidden");
      pendingPromo = null;
    }

    function sendMove(uci) {
      if (!socket || !uci) return;
      sfx.paddle();
      socket.emit("chess:move", { uci });
      closePromo();
      renderBoard();
    }

    async function createRoom() {
      unlockAudio();
      try {
        await ensureSocket();
        socket.emit("chess:create", { name: playerName() });
        setMsg("Room created — share the code with your friend.");
        sfx.start();
      } catch (e) {
        console.error(e);
        setMsg("Could not connect to chess server. Is the app running?", "error");
        setConnection("Offline", false);
      }
    }

    async function joinRoom() {
      unlockAudio();
      const code = (els.joinCode?.value || "").trim().toUpperCase();
      if (code.length < 4) {
        setMsg("Enter a valid room code.", "error");
        return;
      }
      try {
        await ensureSocket();
        socket.emit("chess:join", { code, name: playerName() });
        sfx.select();
      } catch (e) {
        console.error(e);
        setMsg("Could not connect to chess server.", "error");
      }
    }

    function copyCode() {
      const code = state?.room || els.roomDisplay?.textContent || "";
      if (!code || code === "—") return;
      unlockAudio();
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(() => {
          setMsg(`Copied code ${code}`);
          sfx.coin();
        });
      } else {
        setMsg(`Room code: ${code}`);
      }
    }

    function resign() {
      if (!socket || !state || state.status !== "playing") return;
      if (!confirm("Resign this game?")) return;
      unlockAudio();
      socket.emit("chess:resign");
      sfx.die();
    }

    function draw() {
      if (!socket || !state || state.status !== "playing") return;
      unlockAudio();
      socket.emit("chess:draw");
      sfx.select();
      setMsg("Draw offer sent (or accepted).");
    }

    function rematch() {
      if (!socket) return;
      unlockAudio();
      socket.emit("chess:rematch");
      sfx.start();
    }

    function leave() {
      if (!socket) {
        showLobby();
        return;
      }
      unlockAudio();
      socket.emit("chess:leave");
      state = null;
      showLobby();
      sfx.blip();
    }

    function bindUi() {
      els.createBtn?.addEventListener("click", createRoom);
      els.joinBtn?.addEventListener("click", joinRoom);
      els.copyBtn?.addEventListener("click", copyCode);
      els.resignBtn?.addEventListener("click", resign);
      els.drawBtn?.addEventListener("click", draw);
      els.rematchBtn?.addEventListener("click", rematch);
      els.leaveBtn?.addEventListener("click", leave);
      els.joinCode?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") joinRoom();
      });

      els.promo?.querySelectorAll("[data-promo]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!pendingPromo) return;
          const p = btn.getAttribute("data-promo");
          sendMove(pendingPromo.from + pendingPromo.to + p);
        });
      });

      try {
        const saved = localStorage.getItem("chessPlayerName");
        if (saved && els.nameInput) els.nameInput.value = saved;
      } catch {
        /* ignore */
      }
    }

    // prevent double-bind if create called once
    let uiBound = false;

    return {
      start() {
        active = true;
        root.classList.remove("hidden");
        root.setAttribute("aria-hidden", "false");
        if (!uiBound) {
          bindUi();
          uiBound = true;
        }
        showLobby();
        setMsg("Create a room or join with a friend's code.");
        setConnection("Ready", true);
        hud.setScore(0);
        hud.setHigh(0);
        hud.hideOverlay();
        // Preconnect socket so create/join is faster
        ensureSocket().catch(() => setConnection("Offline", false));
      },
      stop() {
        active = false;
        root.classList.add("hidden");
        root.setAttribute("aria-hidden", "true");
        if (socket && state?.room) {
          socket.emit("chess:leave");
        }
        state = null;
        selected = null;
      },
      reset() {
        if (state?.status === "ended") rematch();
        else if (!state) showLobby();
      },
      pause() {},
      resume() {},
      togglePause() {},
      update() {
        // no canvas loop
      },
      onKey() {
        return false;
      },
      control() {},
      getScore: () => 0,
      isGameOver: () => state?.status === "ended",
      isPaused: () => false,
    };
  },
};

function dummyInstance() {
  return {
    start() {},
    stop() {},
    reset() {},
    pause() {},
    resume() {},
    togglePause() {},
    update() {},
    onKey: () => false,
    control() {},
    getScore: () => 0,
    isGameOver: () => false,
    isPaused: () => false,
  };
}
