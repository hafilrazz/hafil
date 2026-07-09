/**
 * Global public chat — classic script (not ES module) so onclick always works.
 * Loaded with <script src="..."> — no import/export.
 */
(function () {
  "use strict";

  var NAME_KEY = "siteChatName";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isClearWord(value) {
    return (
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "") === "clear"
    );
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, isError) {
    var status = $("chatStatus");
    if (!status) return;
    status.textContent = text || "";
    if (isError) status.classList.add("is-error");
    else status.classList.remove("is-error");
  }

  // ---- Immediate globals (available even before full init) ----
  window.clearGlobalChat = function clearGlobalChat() {
    var input = $("chatClearInput");
    var log = $("chatLog");
    var word = input ? input.value : "";
    if (!isClearWord(word)) {
      setStatus('Type "clear" in the box, then press WIPE.', true);
      if (input) {
        input.focus();
        input.classList.add("chat-input-error");
        setTimeout(function () {
          input.classList.remove("chat-input-error");
        }, 700);
      }
      return Promise.resolve(false);
    }

    setStatus("Wiping chat history…", false);
    return fetch("/api/chat/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "clear" }),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "Clear failed (" + res.status + ")");
          return data;
        });
      })
      .then(function (data) {
        if (input) input.value = "";
        if (log) {
          log.innerHTML =
            '<p class="chat-empty">Chat cleared. Start a new conversation.</p>';
        }
        // Reset poll state if full chat is running
        if (window.__chatState) {
          window.__chatState.seen = {};
          window.__chatState.lastId = 0;
        }
        setStatus(
          "History wiped (" + (data.deleted || 0) + " messages removed).",
          false
        );
        return true;
      })
      .catch(function (err) {
        setStatus(err.message || "Could not clear chat", true);
        console.error("[chat] wipe failed", err);
        return false;
      });
  };

  window.joinGlobalChat = function joinGlobalChat() {
    if (window.__chatApi && window.__chatApi.join) {
      return window.__chatApi.join();
    }
    // Fallback if full init has not finished
    initChat();
    if (window.__chatApi && window.__chatApi.join) {
      return window.__chatApi.join();
    }
    setStatus("Chat is starting — try JOIN again.", true);
  };

  window.sendGlobalChat = function sendGlobalChat(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (window.__chatApi && window.__chatApi.send) {
      return window.__chatApi.send(e);
    }
    setStatus("Join chat first, then send.", true);
  };

  function initChat() {
    var gate = $("chatNameGate");
    var main = $("chatMain");
    var nameInput = $("chatNameInput");
    var joinBtn = $("chatNameBtn");
    var nameLabel = $("chatDisplayName");
    var changeBtn = $("chatChangeName");
    var log = $("chatLog");
    var form = $("chatForm");
    var msgInput = $("chatMessageInput");
    var clearInput = $("chatClearInput");
    var clearBtn = $("chatClearBtn");
    var liveBadge = $("chatLiveBadge");

    if (!gate || !main || !nameInput || !joinBtn || !log || !form) {
      console.warn("[chat] UI elements not found yet");
      return false;
    }

    // Allow re-bind if previous init was incomplete
    if (window.__chatInited && window.__chatApi) return true;
    window.__chatInited = true;

    var myName = "";
    var lastId = 0;
    var timer = null;
    var holdStatusUntil = 0;
    var seen = Object.create(null);
    var state = { lastId: 0, seen: seen };
    window.__chatState = state;

    function statusText(t, err, holdMs) {
      setStatus(t, !!err);
      if (holdMs) holdStatusUntil = Date.now() + holdMs;
    }

    function statusIfFree(t, err) {
      if (Date.now() < holdStatusUntil) return;
      statusText(t, err);
    }

    function setLive(text, on) {
      if (!liveBadge) return;
      liveBadge.textContent = text;
      if (on) liveBadge.classList.add("is-on");
      else liveBadge.classList.remove("is-on");
    }

    function openRoom() {
      gate.style.display = "none";
      gate.hidden = true;
      main.hidden = false;
      main.style.display = "block";
      setLive("LIVE", true);
    }

    function openGate() {
      main.style.display = "none";
      main.hidden = true;
      gate.hidden = false;
      gate.style.display = "block";
      setLive("STANDBY", false);
    }

    function resetLogEmpty(msg) {
      log.innerHTML =
        '<p class="chat-empty">' +
        esc(msg || "Chat cleared. Start a new conversation.") +
        "</p>";
      seen = Object.create(null);
      lastId = 0;
      state.seen = seen;
      state.lastId = 0;
    }

    function addMsg(m) {
      if (!m || m.id == null || seen[m.id]) return;
      seen[m.id] = true;
      if (m.id > lastId) lastId = m.id;
      state.lastId = lastId;

      var empty = log.querySelector(".chat-empty");
      if (empty) empty.remove();

      var div = document.createElement("div");
      div.className = "chat-msg" + (m.name === myName ? " is-mine" : "");
      div.innerHTML =
        '<div class="chat-msg-head">' +
        '<span class="chat-msg-name">' +
        esc(m.name) +
        "</span>" +
        '<span class="chat-msg-time">' +
        esc(m.time || "") +
        "</span></div>" +
        '<div class="chat-msg-body">' +
        esc(m.body) +
        "</div>";
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    function refresh(full) {
      var url = full || !lastId ? "/api/chat" : "/api/chat?after=" + lastId;
      return fetch(url, { cache: "no-store" }).then(function (res) {
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Server needs restart (python app.py)"
              : "Load failed (" + res.status + ")"
          );
        }
        return res.json().then(function (data) {
          var list = data.messages || [];
          var total = typeof data.total === "number" ? data.total : null;

          if (
            total === 0 &&
            (Object.keys(seen).length > 0 || log.querySelector(".chat-msg"))
          ) {
            resetLogEmpty("Chat cleared. Start a new conversation.");
            return;
          }

          if (full) {
            log.innerHTML = "";
            seen = Object.create(null);
            lastId = 0;
            state.seen = seen;
            state.lastId = 0;
          }
          if (full && !list.length) {
            log.innerHTML =
              '<p class="chat-empty">No messages yet. Be the first!</p>';
            return;
          }
          list.forEach(addMsg);
        });
      });
    }

    function stopPoll() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function startPoll() {
      stopPoll();
      var ticks = 0;
      timer = setInterval(function () {
        ticks += 1;
        var full = ticks % 5 === 0;
        refresh(full)
          .then(function () {
            statusIfFree("Online — public chat");
          })
          .catch(function () {
            statusIfFree("Reconnecting…", true);
          });
      }, 3000);
    }

    function doJoin() {
      var name = (nameInput.value || "").trim().slice(0, 16);
      if (!name) {
        statusText("Type a name first.", true, 3000);
        nameInput.focus();
        return;
      }

      myName = name;
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch (_) {}

      if (nameLabel) nameLabel.textContent = name;
      openRoom();
      statusText("Loading…");

      refresh(true)
        .then(function () {
          statusText("Online — public chat");
          startPoll();
          if (msgInput) msgInput.focus();
        })
        .catch(function (e) {
          statusText(e.message || "Could not load chat", true, 5000);
          startPoll();
        });
    }

    function doSend(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!myName) {
        openGate();
        statusText("Join with your name first.", true, 3000);
        return;
      }
      var body = (msgInput.value || "").trim();
      if (!body) return;

      if (isClearWord(body)) {
        msgInput.value = "";
        if (clearInput) clearInput.value = "clear";
        return window.clearGlobalChat();
      }

      msgInput.value = "";
      return fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: myName, body: body }),
        cache: "no-store",
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          }).then(function (data) {
            if (!res.ok) throw new Error(data.error || "Send failed (" + res.status + ")");
            return data;
          });
        })
        .then(function (data) {
          if (data.cleared) {
            resetLogEmpty("Chat cleared. Start a new conversation.");
            statusText(
              "History wiped (" + (data.deleted || 0) + " messages removed).",
              false,
              5000
            );
            return;
          }
          if (data.message) addMsg(data.message);
          statusIfFree("Online — public chat");
        })
        .catch(function (err) {
          statusText(err.message || "Send failed", true, 4000);
          msgInput.value = body;
        });
    }

    // Full API for globals
    window.__chatApi = { join: doJoin, send: doSend };
    window.joinGlobalChat = doJoin;
    window.sendGlobalChat = doSend;
    // keep clearGlobalChat as the top-level wipe (already defined)

    joinBtn.onclick = function (e) {
      e.preventDefault();
      doJoin();
    };

    nameInput.onkeydown = function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        doJoin();
      }
    };

    form.onsubmit = function (e) {
      e.preventDefault();
      doSend(e);
    };

    if (changeBtn) {
      changeBtn.onclick = function (e) {
        e.preventDefault();
        stopPoll();
        openGate();
        nameInput.value = myName;
        nameInput.focus();
      };
    }

    if (clearBtn) {
      clearBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.clearGlobalChat();
      };
    }

    if (clearInput) {
      clearInput.onkeydown = function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          window.clearGlobalChat();
        }
      };
    }

    try {
      var saved = localStorage.getItem(NAME_KEY);
      if (saved) nameInput.value = saved;
    } catch (_) {}

    openGate();
    statusText("Enter your name, then press JOIN CHAT.");
    console.log("[chat] ready — join/clear globals attached");
    return true;
  }

  window.initChat = initChat;

  function boot() {
    try {
      initChat();
    } catch (e) {
      console.error("[chat] init error", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
