/**
 * Robot verification gate — random questions, correct answer required.
 */

// Lazy SFX — don't pull WebAudio synth until user interacts
let sfxMod = null;
async function getSfx() {
  if (!sfxMod) sfxMod = await import("./sfx.js");
  return sfxMod;
}

/** Static question bank: answers compared case-insensitively; numbers as strings too */
const QUIZ_BANK = [
  { q: "What is 7 + 5?", a: ["12"] },
  { q: "What is 9 × 3?", a: ["27"] },
  { q: "What is 15 - 8?", a: ["7"] },
  { q: "What is 6 × 6?", a: ["36"] },
  { q: "What is 100 ÷ 4?", a: ["25"] },
  { q: "How many days are in a week?", a: ["7"] },
  { q: "How many months are in a year?", a: ["12"] },
  { q: "How many hours are in a day?", a: ["24"] },
  { q: "What is the first letter of the English alphabet?", a: ["a"] },
  { q: "What color do you get mixing red + blue? (one word)", a: ["purple", "violet"] },
  { q: "How many sides does a triangle have?", a: ["3"] },
  { q: "How many legs does a spider have?", a: ["8"] },
  { q: "What is 2³ (2 to the power of 3)?", a: ["8"] },
  { q: "What is 11 + 11?", a: ["22"] },
  { q: "How many bits are in a byte?", a: ["8"] },
  { q: "What planet do we live on?", a: ["earth"] },
  { q: "What is H2O commonly called?", a: ["water"] },
  { q: "How many zeros in one hundred?", a: ["2"] },
  { q: "What is the capital of France?", a: ["paris"] },
  { q: "How many minutes in an hour?", a: ["60"] },
  { q: "Opposite of hot?", a: ["cold"] },
  { q: "How many colors in a rainbow?", a: ["7"] },
  { q: "What is 50% of 40?", a: ["20"] },
  { q: "Largest ocean on Earth? (one word)", a: ["pacific"] },
  { q: "How many players on a football/soccer team on the field?", a: ["11"] },
];

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Generate a fresh easy math question so the set feels endless */
function randomMathQuestion() {
  const type = randInt(0, 3);
  if (type === 0) {
    const a = randInt(2, 20);
    const b = randInt(2, 20);
    return { q: `What is ${a} + ${b}?`, a: [String(a + b)] };
  }
  if (type === 1) {
    const a = randInt(5, 30);
    const b = randInt(1, a - 1);
    return { q: `What is ${a} - ${b}?`, a: [String(a - b)] };
  }
  if (type === 2) {
    const a = randInt(2, 12);
    const b = randInt(2, 10);
    return { q: `What is ${a} × ${b}?`, a: [String(a * b)] };
  }
  // division that divides evenly
  const b = randInt(2, 10);
  const result = randInt(2, 12);
  const a = b * result;
  return { q: `What is ${a} ÷ ${b}?`, a: [String(result)] };
}

function pickQuestion(excludeQ = null) {
  // 50% math generated, 50% bank
  let item;
  if (Math.random() < 0.55) {
    item = randomMathQuestion();
  } else {
    item = QUIZ_BANK[randInt(0, QUIZ_BANK.length - 1)];
  }
  if (excludeQ && item.q === excludeQ) {
    return pickQuestion(excludeQ);
  }
  return { q: item.q, answers: item.a.map(normalizeAnswer) };
}

function normalizeAnswer(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ");
}

function isCorrect(userRaw, accepted) {
  const user = normalizeAnswer(userRaw);
  if (!user) return false;
  // exact match
  if (accepted.includes(user)) return true;
  // numeric equivalence: "12.0" vs "12"
  const nUser = Number(user);
  if (!Number.isNaN(nUser) && Number.isFinite(nUser)) {
    return accepted.some((a) => {
      const nA = Number(a);
      return !Number.isNaN(nA) && nA === nUser;
    });
  }
  return false;
}

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

  let current = pickQuestion();
  let fails = 0;

  // Allow text answers, not only numeric
  if (puzzleInput) {
    puzzleInput.removeAttribute("inputmode");
    puzzleInput.placeholder = "your answer";
  }

  function showQuestion(announce = true) {
    puzzleQ.textContent = current.q;
    if (announce) botSay(current.q);
  }

  function botSay(text, who = "BOT") {
    if (!botLog) return;
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

  function nextQuestion() {
    current = pickQuestion(current.q);
    showQuestion(true);
    puzzleInput.value = "";
    puzzleInput.focus();
  }

  async function grantAccess(message, botLine) {
    try {
      const { unlockAudio, sfx } = await getSfx();
      unlockAudio();
      sfx.win();
    } catch {
      /* audio optional */
    }
    gateMsg.style.color = "var(--neon)";
    gateMsg.textContent = message;
    botSay(botLine);
    sessionStorage.setItem("humanVerified", "true");
    if (puzzleBtn) puzzleBtn.disabled = true;
    if (puzzleInput) puzzleInput.disabled = true;
    setTimeout(() => unlock(true), 700);
  }

  async function checkPuzzle() {
    const val = puzzleInput.value.trim();
    botSay(val || "(empty)", "YOU");

    // Secret override keyword
    if (normalizeAnswer(val) === "fuck") {
      await grantAccess("✅ Override accepted. Welcome in.", "Heh. Master key accepted. Come on in. 🎮");
      return;
    }

    if (isCorrect(val, current.answers)) {
      await grantAccess("✅ Access granted. Welcome, human.", "Correct. Verification complete. Welcome in! 🎮");
      return;
    }

    // Wrong answer
    fails += 1;
    try {
      const { unlockAudio, sfx } = await getSfx();
      unlockAudio();
      sfx.die();
    } catch {
      /* ignore */
    }
    gateMsg.style.color = "var(--danger)";
    gateMsg.textContent = "❌ Incorrect. Try again.";
    botLog?.classList.add("shake");
    setTimeout(() => botLog?.classList.remove("shake"), 400);

    if (fails >= 2) {
      botSay("Nope. I'll give you a new challenge.");
      fails = 0;
      setTimeout(nextQuestion, 450);
    } else {
      botSay("That is not correct. Read the question again.");
      puzzleInput.value = "";
      puzzleInput.focus();
    }
  }

  setTimeout(() => botSay("Hello, traveler. I must confirm you're human. 🤖"), 350);
  setTimeout(() => {
    botSay("Answer correctly to enter.");
    showQuestion(true);
  }, 1100);

  puzzleBtn?.addEventListener("click", checkPuzzle);
  puzzleInput?.addEventListener("keydown", (e) => {
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
