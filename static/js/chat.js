/**
 * Public global chat — everyone on the site, no room codes.
 * Messages stored in SQLite; live updates via Socket.IO when available, else poll.
 */

const CHAT_NAME_KEY = "globalChatName";
const POLL_MS = 4000;

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loadSocketIo() {
  return new Promise((resolve, reject) => {
    if (window.io) {
      resolve(window.io);
      return;
    }
    const existing = document.querySelector("script[data-socketio]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.io));
      existing.addEventListener("error", () => reject(new Error("socket.io load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
    s.crossOrigin = "anonymous";
    s.dataset.socketio = "1";
    s.onload = () => resolve(window.io);
    s.onerror = () => reject(new Error("socket.io load failed"));
    document.head.appendChild(s);
  });
}

export function initChat() {
  const nameGate = document.getElementById("chatNameGate");
  const chatMain = document.getElementById("chatMain");
  const nameInput = document.getElementById("chatNameInput");
  const nameBtn = document.getElementById("chatNameBtn");
  const displayName = document.getElementById("chatDisplayName");
  const changeNameBtn = document.getElementById("chatChangeName");
  const log = document.getElementById("chatLog");
  const form = document.getElementById("chatForm");
  const msgInput = document.getElementById("chatMessageInput");
  const status = document.getElementById("chatStatus");

  if (!nameGate || !chatMain || !log || !form) {
    console.warn("Chat UI missing from page — hard refresh (Ctrl+F5)");
    return;
  }

  // Avoid double-binding if initChat runs twice
  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  let myName = "";
  let lastId = 0;
  let pollTimer = null;
  let socket = null;
  const seen = new Set();

  function setStatus(text, isError = false) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  }

  function appendMessage(msg, { scroll = true } = {}) {
    if (!msg || seen.has(msg.id)) return;
    seen.add(msg.id);
    if (msg.id > lastId) lastId = msg.id;

    const row = document.createElement("div");
    row.className = "chat-msg";
    if (msg.name === myName) row.classList.add("is-mine");
    row.innerHTML = `
      <div class="chat-msg-head">
        <span class="chat-msg-name">${escapeHtml(msg.name)}</span>
        <span class="chat-msg-time">${escapeHtml(msg.time || "")}</span>
      </div>
      <div class="chat-msg-body">${escapeHtml(msg.body)}</div>
    `;
    log.appendChild(row);
    if (scroll) log.scrollTop = log.scrollHeight;
  }

  function renderMany(messages) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    for (const m of messages) appendMessage(m, { scroll: false });
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  async function fetchMessages({ after = 0, full = false } = {}) {
    const url = after > 0 ? `/api/chat?after=${after}` : "/api/chat";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 404) {
      throw new Error("Chat API not found — restart the server (python app.py)");
    }
    if (!res.ok) throw new Error(`Could not load chat (${res.status})`);
    const data = await res.json();
    const list = data.messages || [];
    if (full) {
      log.innerHTML = "";
      seen.clear();
      lastId = 0;
    }
    if (list.length) {
      const empty = log.querySelector(".chat-empty");
      if (empty) empty.remove();
      renderMany(list);
    } else if (full && !log.querySelector(".chat-msg")) {
      log.innerHTML = `<p class="chat-empty">No messages yet. Be the first to say something.</p>`;
    }
    return list;
  }

  async function sendMessage(body) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: myName, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) {
      throw new Error("Chat API not found — restart the server (python app.py)");
    }
    if (!res.ok) throw new Error(data.error || `Could not send (${res.status})`);
    // Also append locally in case socket is slow/missing
    if (data.message) {
      const empty = log.querySelector(".chat-empty");
      if (empty) empty.remove();
      appendMessage(data.message);
    }
    return data.message;
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        await fetchMessages({ after: lastId });
        setStatus("Online · public room");
      } catch {
        setStatus("Reconnecting…", true);
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function tryLiveSocket() {
    try {
      const io = await loadSocketIo();
      socket = io({
        path: "/socket.io",
        transports: ["websocket", "polling"],
        reconnection: true,
      });
      socket.on("connect", () => setStatus("Live · public room"));
      socket.on("disconnect", () => {
        setStatus("Polling · public room");
        startPolling();
      });
      socket.on("chat:message", (msg) => {
        // clear empty state
        const empty = log.querySelector(".chat-empty");
        if (empty) empty.remove();
        appendMessage(msg);
      });
      // Still light-poll as backup for missed events
      startPolling();
    } catch {
      setStatus("Polling · public room");
      startPolling();
    }
  }

  function enterChat(name) {
    myName = name;
    try {
      localStorage.setItem(CHAT_NAME_KEY, name);
    } catch {
      /* ignore */
    }
    nameGate.classList.add("hidden");
    chatMain.classList.remove("hidden");
    if (displayName) displayName.textContent = name;
    setStatus("Loading messages…");
    fetchMessages({ full: true })
      .then(() => {
        setStatus("Online · public room");
        tryLiveSocket();
        msgInput?.focus();
      })
      .catch(() => setStatus("Could not load chat. Is the server running?", true));
  }

  function showNameGate() {
    stopPolling();
    if (socket) {
      try {
        socket.disconnect();
      } catch {
        /* ignore */
      }
      socket = null;
    }
    chatMain.classList.add("hidden");
    nameGate.classList.remove("hidden");
    nameInput?.focus();
  }

  nameBtn?.addEventListener("click", () => {
    const name = (nameInput?.value || "").trim();
    if (!name) {
      nameInput?.focus();
      return;
    }
    enterChat(name.slice(0, 16));
  });

  nameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nameBtn?.click();
  });

  changeNameBtn?.addEventListener("click", () => {
    showNameGate();
    if (nameInput) nameInput.value = myName;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = (msgInput?.value || "").trim();
    if (!body || !myName) return;
    msgInput.value = "";
    try {
      const empty = log.querySelector(".chat-empty");
      if (empty) empty.remove();
      await sendMessage(body);
      setStatus("Online · public room");
    } catch (err) {
      setStatus(err.message || "Failed to send", true);
      msgInput.value = body;
    }
  });

  // Resume name if returning visitor
  try {
    const saved = localStorage.getItem(CHAT_NAME_KEY);
    if (saved) {
      if (nameInput) nameInput.value = saved;
      // Don't auto-join — let them confirm name, but prefill
    }
  } catch {
    /* ignore */
  }

  // Load messages in background so the log isn't empty when they join
  // (name gate still required before posting)
  const chatSection = document.getElementById("chat");
  if (chatSection && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && myName) {
          fetchMessages({ after: lastId }).catch(() => {});
        }
      },
      { threshold: 0.1 }
    );
    io.observe(chatSection);
  }
}
