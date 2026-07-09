/**
 * Robot verification gate — wrong math answer unlocks the site.
 */

import { unlockAudio, sfx } from "./sfx.js";

export function initGate() {
  const gate = document.getElementById("gate");
  const siteContent = document.getElementById("siteContent");
  const botLog = document.getElementById("botLog");
  const gateMsg = document.getElementById("gateMsg");
  const puzzleInput = document.getElementById("puzzleInput");
  const puzzleBtn = document.getElementById("puzzleBtn");
  const puzzleQ = document.getElementById("puzzleQ");

  if (!gate || !siteContent) return;

  if (sessionStorage.getItem("humanVerified") === "true") {
    unlock(false);
    return;
  }

  const answer = 2;
  puzzleQ.textContent = "What is 1 + 1?";

  function botSay(text, who = "BOT") {
    const line = document.createElement("div");
    const color = who === "YOU" ? "#fff" : "var(--neon)";
    line.innerHTML = `<span style="color:${color}"><b>${who}:</b> ${escapeHtml(text)}</span>`;
    botLog.appendChild(line);
    botLog.scrollTop = botLog.scrollHeight;
  }

  function unlock(animate = true) {
    siteContent.classList.remove("locked");
    if (!animate) {
      gate.classList.add("gate-hidden");
      return;
    }
    gate.style.transition = "opacity 0.6s";
    gate.style.opacity = "0";
    setTimeout(() => gate.classList.add("gate-hidden"), 600);
  }

  function checkPuzzle() {
    const val = puzzleInput.value.trim();
    botSay(val || "(empty)", "YOU");

    unlockAudio();

    // Intentionally inverted: bots ace basic math, humans "fail" in.
    if (parseInt(val, 10) === answer) {
      sfx.die();
      gateMsg.style.color = "var(--danger)";
      gateMsg.textContent = "❌ Bots know basic math. Try again, human.";
      botLog.classList.add("shake");
      setTimeout(() => botLog.classList.remove("shake"), 400);
      botSay("Too perfect. Only humans make mistakes here.");
      puzzleInput.value = "";
      puzzleInput.focus();
      return;
    }

    sfx.win();
    gateMsg.style.color = "var(--neon)";
    gateMsg.textContent = "✅ Interesting... You might actually be human.";
    botSay("Wrong answer. That's more human than I expected. Welcome in! 🎮");
    sessionStorage.setItem("humanVerified", "true");
    setTimeout(() => unlock(true), 900);
  }

  setTimeout(() => botSay("Hello, traveler. I must confirm you're human. 🤖"), 400);
  setTimeout(() => botSay("What is 1 + 1?"), 1400);

  puzzleBtn.addEventListener("click", checkPuzzle);
  puzzleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkPuzzle();
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
