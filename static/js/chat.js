/**
 * Public + private chat — classic script (not ES module).
 * Private rooms: one host creates a code; others join with that code.
 */
(function () {
  "use strict";

  var NAME_KEY = "siteChatName";
  var PRIVATE_CODE_KEY = "sitePrivateCode";

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

  function show(el, on) {
    if (!el) return;
    if (on) {
      el.hidden = false;
      el.style.display = "";
    } else {
      el.hidden = true;
      el.style.display = "none";
    }
  }

  // Active channel: "public" | "private"
  var channel = "public";
  var privateCode = "";
  var privateName = "";
  var publicName = "";

  // ---- Immediate globals ----
  window.clearGlobalChat = function clearGlobalChat() {
    var input = $("chatClearInput");
    var log = $("chatLog");
    var word = input ? input.value : "";
    if (!isClearWord(word)) {
      setStatus('Type "clear" in the box, then press WIPE.', true);
      return Promise.resolve(false);
    }
    setStatus("Wiping public chat…", false);
    return fetch("/api/chat/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "clear" }),
      cache: "no-store",
    })
      .then(parseJsonRes)
      .then(function (data) {
        if (input) input.value = "";
        if (log) {
          log.innerHTML =
            '<p class="chat-empty">Chat cleared. Start a new conversation.</p>';
        }
        if (window.__chatState) {
          window.__chatState.seen = {};
          window.__chatState.lastId = 0;
        }
        setStatus(
          "Public history wiped (" + (data.deleted || 0) + " messages).",
          false
        );
        return true;
      })
      .catch(function (err) {
        setStatus(err.message || "Could not clear chat", true);
        return false;
      });
  };

  window.clearPrivateChat = function clearPrivateChat() {
    var input = $("privateClearInput");
    var log = $("privateLog");
    var word = input ? input.value : "";
    if (!privateCode) {
      setStatus("Join a private room first.", true);
      return Promise.resolve(false);
    }
    if (!isClearWord(word)) {
      setStatus('Type "clear" in the box, then press WIPE.', true);
      return Promise.resolve(false);
    }
    setStatus("Wiping private room…", false);
    return fetch("/api/chat/private/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: privateCode, confirm: "clear" }),
      cache: "no-store",
    })
      .then(parseJsonRes)
      .then(function (data) {
        if (input) input.value = "";
        if (log) {
          log.innerHTML =
            '<p class="chat-empty">Room cleared. Start a new conversation.</p>';
        }
        if (window.__privateState) {
          window.__privateState.seen = {};
          window.__privateState.lastId = 0;
        }
        setStatus(
          "Private room wiped (" + (data.deleted || 0) + " messages).",
          false
        );
        return true;
      })
      .catch(function (err) {
        setStatus(err.message || "Could not clear room", true);
        return false;
      });
  };

  window.joinGlobalChat = function () {
    if (window.__chatApi && window.__chatApi.join) return window.__chatApi.join();
    initChat();
    if (window.__chatApi && window.__chatApi.join) return window.__chatApi.join();
    setStatus("Chat is starting — try JOIN again.", true);
  };

  window.createPrivateChat = function () {
    if (window.__chatApi && window.__chatApi.createPrivate) {
      return window.__chatApi.createPrivate();
    }
    initChat();
    if (window.__chatApi && window.__chatApi.createPrivate) {
      return window.__chatApi.createPrivate();
    }
    setStatus("Chat is starting — try again.", true);
  };

  window.joinPrivateChat = function () {
    if (window.__chatApi && window.__chatApi.joinPrivate) {
      return window.__chatApi.joinPrivate();
    }
    initChat();
    if (window.__chatApi && window.__chatApi.joinPrivate) {
      return window.__chatApi.joinPrivate();
    }
    setStatus("Chat is starting — try again.", true);
  };

  function parseJsonRes(res) {
    return res
      .json()
      .catch(function () {
        return {};
      })
      .then(function (data) {
        if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
        return data;
      });
  }

  function makeLogController(logEl, getMyName) {
    var lastId = 0;
    var seen = Object.create(null);

    function resetEmpty(msg) {
      logEl.innerHTML =
        '<p class="chat-empty">' +
        esc(msg || "No messages yet. Be the first!") +
        "</p>";
      seen = Object.create(null);
      lastId = 0;
    }

    function addMsg(m) {
      if (!m || m.id == null || seen[m.id]) return;
      seen[m.id] = true;
      if (m.id > lastId) lastId = m.id;

      var empty = logEl.querySelector(".chat-empty");
      if (empty) empty.remove();

      var isSystem =
        m.system === true ||
        String(m.name || "").toLowerCase() === "system";
      var mine = !isSystem && m.name === getMyName();
      var div = document.createElement("div");
      if (isSystem) {
        div.className = "chat-msg chat-msg--system";
        div.innerHTML =
          '<div class="chat-msg-body">' + esc(m.body || "") + "</div>";
      } else {
        div.className = "chat-msg" + (mine ? " is-mine" : "");
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
      }
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function applyList(list, full, total) {
      if (total === 0 && (Object.keys(seen).length > 0 || logEl.querySelector(".chat-msg"))) {
        resetEmpty("Chat cleared. Start a new conversation.");
        return;
      }
      if (full) {
        logEl.innerHTML = "";
        seen = Object.create(null);
        lastId = 0;
      }
      if (full && (!list || !list.length)) {
        resetEmpty("No messages yet. Be the first!");
        return;
      }
      (list || []).forEach(addMsg);
    }

    return {
      get lastId() {
        return lastId;
      },
      set lastId(v) {
        lastId = v;
      },
      get seen() {
        return seen;
      },
      set seen(v) {
        seen = v || Object.create(null);
      },
      resetEmpty: resetEmpty,
      addMsg: addMsg,
      applyList: applyList,
    };
  }

  function initChat() {
    var publicPane = $("chatPublicPane");
    var privatePane = $("chatPrivatePane");
    var modePublic = $("chatModePublic");
    var modePrivate = $("chatModePrivate");
    var shellTitle = $("chatShellTitle");
    var liveBadge = $("chatLiveBadge");

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

    var pGate = $("privateGate");
    var pMain = $("privateMain");
    var pNameInput = $("privateNameInput");
    var pCodeInput = $("privateCodeInput");
    var pCreateBtn = $("privateCreateBtn");
    var pJoinBtn = $("privateJoinBtn");
    var pNameLabel = $("privateDisplayName");
    var pCodeLabel = $("privateCodeLabel");
    var pCopyBtn = $("privateCopyBtn");
    var pLeaveBtn = $("privateLeaveBtn");
    var pLog = $("privateLog");
    var pForm = $("privateForm");
    var pMsgInput = $("privateMessageInput");
    var pClearInput = $("privateClearInput");
    var pClearBtn = $("privateClearBtn");

    if (!gate || !main || !nameInput || !joinBtn || !log || !form) {
      console.warn("[chat] public UI missing");
      return false;
    }
    if (!pGate || !pMain || !pNameInput || !pLog || !pForm) {
      console.warn("[chat] private UI missing");
      return false;
    }

    if (window.__chatInited && window.__chatApi) return true;
    window.__chatInited = true;

    var publicTimer = null;
    var privateTimer = null;
    var holdStatusUntil = 0;

    var publicLog = makeLogController(log, function () {
      return publicName;
    });
    var privateLog = makeLogController(pLog, function () {
      return privateName;
    });
    window.__chatState = publicLog;
    window.__privateState = privateLog;

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

    function stopPublicPoll() {
      if (publicTimer) clearInterval(publicTimer);
      publicTimer = null;
    }

    function stopPrivatePoll() {
      if (privateTimer) clearInterval(privateTimer);
      privateTimer = null;
    }

    function stopAllPolls() {
      stopPublicPoll();
      stopPrivatePoll();
    }

    function openPublicGate() {
      show(main, false);
      show(gate, true);
      setLive("STANDBY", false);
    }

    function openPublicRoom() {
      show(gate, false);
      show(main, true);
      setLive("LIVE", true);
    }

    function openPrivateGate() {
      show(pMain, false);
      show(pGate, true);
      setLive("STANDBY", false);
      privateCode = "";
    }

    function openPrivateRoom(code, name) {
      privateCode = String(code || "").toUpperCase();
      privateName = name;
      show(pGate, false);
      show(pMain, true);
      if (pNameLabel) pNameLabel.textContent = name;
      if (pCodeLabel) pCodeLabel.textContent = privateCode;
      setLive("LIVE", true);
      try {
        localStorage.setItem(PRIVATE_CODE_KEY, privateCode);
      } catch (_) {}
    }

    function setMode(mode) {
      channel = mode === "private" ? "private" : "public";
      stopAllPolls();

      if (modePublic) {
        modePublic.classList.toggle("is-active", channel === "public");
        modePublic.setAttribute("aria-selected", channel === "public" ? "true" : "false");
      }
      if (modePrivate) {
        modePrivate.classList.toggle("is-active", channel === "private");
        modePrivate.setAttribute("aria-selected", channel === "private" ? "true" : "false");
      }

      if (channel === "public") {
        show(publicPane, true);
        show(privatePane, false);
        if (shellTitle) shellTitle.textContent = "// PUBLIC CHANNEL";
        openPublicGate();
        statusText("Public lounge — enter your name, then JOIN CHAT.");
      } else {
        show(publicPane, false);
        show(privatePane, true);
        if (shellTitle) shellTitle.textContent = "// PRIVATE CHANNEL";
        openPrivateGate();
        statusText("Create a room (get a code) or join with a friend’s code.");
        // Sync name field
        if (pNameInput && !pNameInput.value && nameInput && nameInput.value) {
          pNameInput.value = nameInput.value;
        }
      }
    }

    function refreshPublicFixed(full) {
      var doFull = !!full || !publicLog.lastId;
      var url = doFull ? "/api/chat" : "/api/chat?after=" + publicLog.lastId;
      return fetch(url, { cache: "no-store" }).then(function (res) {
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Server needs restart (python app.py)"
              : "Load failed (" + res.status + ")"
          );
        }
        return res.json().then(function (data) {
          publicLog.applyList(data.messages || [], doFull, data.total);
        });
      });
    }

    function refreshPrivateFixed(full) {
      if (!privateCode) return Promise.reject(new Error("No private room"));
      var doFull = !!full || !privateLog.lastId;
      var url = doFull
        ? "/api/chat/private?code=" + encodeURIComponent(privateCode)
        : "/api/chat/private?code=" +
          encodeURIComponent(privateCode) +
          "&after=" +
          privateLog.lastId;
      return fetch(url, { cache: "no-store" }).then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!res.ok) throw new Error(data.error || "Load failed (" + res.status + ")");
            privateLog.applyList(data.messages || [], doFull, data.total);
          });
      });
    }

    function startPublicPoll() {
      stopPublicPoll();
      var ticks = 0;
      publicTimer = setInterval(function () {
        ticks += 1;
        refreshPublicFixed(ticks % 5 === 0)
          .then(function () {
            statusIfFree("Online — public chat");
          })
          .catch(function () {
            statusIfFree("Reconnecting…", true);
          });
      }, 3000);
    }

    function startPrivatePoll() {
      stopPrivatePoll();
      var ticks = 0;
      privateTimer = setInterval(function () {
        ticks += 1;
        refreshPrivateFixed(ticks % 5 === 0)
          .then(function () {
            statusIfFree("Private room " + privateCode);
          })
          .catch(function (e) {
            statusIfFree(e.message || "Reconnecting…", true);
          });
      }, 3000);
    }

    function doPublicJoin() {
      var name = (nameInput.value || "").trim().slice(0, 16);
      if (!name) {
        statusText("Type a name first.", true, 3000);
        nameInput.focus();
        return;
      }
      publicName = name;
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch (_) {}
      if (nameLabel) nameLabel.textContent = name;
      openPublicRoom();
      statusText("Loading…");
      refreshPublicFixed(true)
        .then(function () {
          statusText("Online — public chat");
          startPublicPoll();
          if (msgInput) msgInput.focus();
        })
        .catch(function (e) {
          statusText(e.message || "Could not load chat", true, 5000);
          startPublicPoll();
        });
    }

    function doPublicSend(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!publicName) {
        openPublicGate();
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
        body: JSON.stringify({ name: publicName, body: body }),
        cache: "no-store",
      })
        .then(parseJsonRes)
        .then(function (data) {
          if (data.cleared) {
            publicLog.resetEmpty("Chat cleared. Start a new conversation.");
            statusText(
              "History wiped (" + (data.deleted || 0) + " messages).",
              false,
              5000
            );
            return;
          }
          if (data.message) publicLog.addMsg(data.message);
          statusIfFree("Online — public chat");
        })
        .catch(function (err) {
          statusText(err.message || "Send failed", true, 4000);
          msgInput.value = body;
        });
    }

    function readPrivateName() {
      var name = (pNameInput.value || "").trim().slice(0, 16);
      if (!name) {
        statusText("Type a display name first.", true, 3000);
        pNameInput.focus();
        return "";
      }
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch (_) {}
      return name;
    }

    function enterPrivateRoom(code, name) {
      openPrivateRoom(code, name);
      statusText("Loading private room " + code + "…");
      privateLog.resetEmpty("Loading…");
      refreshPrivateFixed(true)
        .then(function () {
          statusText("Private room " + privateCode + " — share the code to invite friends.");
          startPrivatePoll();
          if (pMsgInput) pMsgInput.focus();
        })
        .catch(function (e) {
          statusText(e.message || "Could not load private room", true, 5000);
        });
    }

    function doCreatePrivate() {
      var name = readPrivateName();
      if (!name) return;
      statusText("Creating private room…");
      return fetch("/api/chat/private/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
        cache: "no-store",
      })
        .then(parseJsonRes)
        .then(function (data) {
          var code = (data.code || (data.room && data.room.code) || "").toUpperCase();
          if (!code) throw new Error("No code returned");
          enterPrivateRoom(code, name);
          statusText(
            "Room created! Share code " + code + " with friends.",
            false,
            8000
          );
        })
        .catch(function (err) {
          statusText(err.message || "Could not create room", true, 5000);
        });
    }

    function doJoinPrivate() {
      var name = readPrivateName();
      if (!name) return;
      var code = (pCodeInput.value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length < 4) {
        statusText("Enter a valid room code.", true, 3000);
        if (pCodeInput) pCodeInput.focus();
        return;
      }
      statusText("Joining room " + code + "…");
      return fetch("/api/chat/private/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code, name: name }),
        cache: "no-store",
      })
        .then(parseJsonRes)
        .then(function (data) {
          var joined = (data.code || code).toUpperCase();
          enterPrivateRoom(joined, name);
        })
        .catch(function (err) {
          statusText(err.message || "Could not join room", true, 5000);
        });
    }

    function doPrivateSend(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!privateCode || !privateName) {
        openPrivateGate();
        statusText("Create or join a private room first.", true, 3000);
        return;
      }
      var body = (pMsgInput.value || "").trim();
      if (!body) return;
      if (isClearWord(body)) {
        pMsgInput.value = "";
        if (pClearInput) pClearInput.value = "clear";
        return window.clearPrivateChat();
      }
      pMsgInput.value = "";
      return fetch("/api/chat/private", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: privateCode,
          name: privateName,
          body: body,
        }),
        cache: "no-store",
      })
        .then(parseJsonRes)
        .then(function (data) {
          if (data.cleared) {
            privateLog.resetEmpty("Room cleared. Start a new conversation.");
            statusText(
              "Room wiped (" + (data.deleted || 0) + " messages).",
              false,
              5000
            );
            return;
          }
          if (data.message) privateLog.addMsg(data.message);
          statusIfFree("Private room " + privateCode);
        })
        .catch(function (err) {
          statusText(err.message || "Send failed", true, 4000);
          pMsgInput.value = body;
        });
    }

    function leavePrivate() {
      var code = privateCode;
      var name = privateName;
      stopPrivatePoll();

      function finishLeave() {
        privateCode = "";
        privateName = "";
        if (pCodeInput) pCodeInput.value = "";
        privateLog.resetEmpty("Left private room.");
        openPrivateGate();
        statusText("Left private room. Create or join another.");
      }

      // Tell the room who left so others see: "Name left chat"
      if (code && name) {
        fetch("/api/chat/private/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: code, name: name }),
          cache: "no-store",
          keepalive: true,
        })
          .catch(function () {})
          .then(finishLeave);
      } else {
        finishLeave();
      }
    }

    function copyPrivateCode() {
      if (!privateCode) return;
      var done = function () {
        statusText("Code " + privateCode + " copied.", false, 3000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(privateCode).then(done).catch(function () {
          statusText("Code: " + privateCode, false, 5000);
        });
      } else {
        statusText("Code: " + privateCode, false, 5000);
      }
    }

    // API for globals
    window.__chatApi = {
      join: doPublicJoin,
      send: doPublicSend,
      createPrivate: doCreatePrivate,
      joinPrivate: doJoinPrivate,
    };
    window.joinGlobalChat = doPublicJoin;
    window.sendGlobalChat = doPublicSend;
    window.createPrivateChat = doCreatePrivate;
    window.joinPrivateChat = doJoinPrivate;

    // Mode tabs
    if (modePublic) {
      modePublic.onclick = function (e) {
        e.preventDefault();
        // Leaving private by switching tabs also announces leave
        if (channel === "private" && privateCode && privateName) {
          leavePrivate();
        }
        setMode("public");
      };
    }
    if (modePrivate) {
      modePrivate.onclick = function (e) {
        e.preventDefault();
        setMode("private");
      };
    }

    // Public binds
    joinBtn.onclick = function (e) {
      e.preventDefault();
      doPublicJoin();
    };
    nameInput.onkeydown = function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        doPublicJoin();
      }
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      doPublicSend(e);
    };
    if (changeBtn) {
      changeBtn.onclick = function (e) {
        e.preventDefault();
        stopPublicPoll();
        openPublicGate();
        nameInput.value = publicName;
        nameInput.focus();
      };
    }
    if (clearBtn) {
      clearBtn.onclick = function (e) {
        e.preventDefault();
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

    // Private binds
    if (pCreateBtn) {
      pCreateBtn.onclick = function (e) {
        e.preventDefault();
        doCreatePrivate();
      };
    }
    if (pJoinBtn) {
      pJoinBtn.onclick = function (e) {
        e.preventDefault();
        doJoinPrivate();
      };
    }
    if (pCodeInput) {
      pCodeInput.onkeydown = function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          doJoinPrivate();
        }
      };
    }
    if (pNameInput) {
      pNameInput.onkeydown = function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          // Prefer join if code filled, else create
          if ((pCodeInput.value || "").trim()) doJoinPrivate();
          else doCreatePrivate();
        }
      };
    }
    pForm.onsubmit = function (e) {
      e.preventDefault();
      doPrivateSend(e);
    };
    if (pLeaveBtn) {
      pLeaveBtn.onclick = function (e) {
        e.preventDefault();
        leavePrivate();
      };
    }
    if (pCopyBtn) {
      pCopyBtn.onclick = function (e) {
        e.preventDefault();
        copyPrivateCode();
      };
    }
    if (pClearBtn) {
      pClearBtn.onclick = function (e) {
        e.preventDefault();
        window.clearPrivateChat();
      };
    }
    if (pClearInput) {
      pClearInput.onkeydown = function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          window.clearPrivateChat();
        }
      };
    }

    // Prefill names
    try {
      var saved = localStorage.getItem(NAME_KEY);
      if (saved) {
        nameInput.value = saved;
        if (pNameInput) pNameInput.value = saved;
      }
    } catch (_) {}

    setMode("public");
    console.log("[chat] public + private ready");
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
