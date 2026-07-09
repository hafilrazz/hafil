/**
 * Hall of Fame — fetch / submit top 10 scores per game via API.
 */

const API = "/api/scores";

const GAME_LABELS = {
  snake: "Neon Snake",
  pong: "Cyber Pong",
  breakout: "Brick Breaker",
  shooter: "Star Blaster",
};

export function gameLabel(gameId) {
  return GAME_LABELS[gameId] || gameId;
}

export async function fetchLeaderboard(game = "snake") {
  const url = `${API}?game=${encodeURIComponent(game)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to load scores (${res.status})`);
  const data = await res.json();
  return data.scores || [];
}

export async function checkQualifies(score, game = "snake") {
  const url =
    `${API}/qualifies?score=${encodeURIComponent(score)}` +
    `&game=${encodeURIComponent(game)}`;
  const res = await fetch(url);
  if (!res.ok) return score > 0;
  const data = await res.json();
  return Boolean(data.qualifies);
}

export async function submitScore(name, score, game = "snake") {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ name, score, game }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Submit failed (${res.status})`);
  return data;
}

export function renderLeaderboard(scores, { highlightName, highlightScore } = {}) {
  const container = document.getElementById("leaderboard");
  if (!container) return;

  if (!scores || scores.length === 0) {
    container.innerHTML = `
      <div class="leaderboard-empty">
        <div class="icon">🏆</div>
        <p>No legends yet.<br>Score some points to claim the hall!</p>
      </div>
    `;
    return;
  }

  const medals = ["medal-1", "medal-2", "medal-3"];
  const topClass = ["top-1", "top-2", "top-3"];

  const rows = scores
    .map((entry, i) => {
      const rank = i + 1;
      const medal = medals[i] || "";
      const tier = topClass[i] || "";
      const isHighlight =
        highlightName &&
        highlightScore != null &&
        entry.name === highlightName &&
        entry.score === highlightScore;

      return `
        <div class="leaderboard-row ${tier} ${isHighlight ? "highlight" : ""}">
          <span class="leaderboard-rank ${medal}">#${rank}</span>
          <span class="leaderboard-name" title="${escapeAttr(entry.name)}">${escapeHtml(entry.name)}</span>
          <span class="leaderboard-score">${padScore(entry.score)}</span>
          <span class="leaderboard-date">${escapeHtml(entry.date || "")}</span>
        </div>
      `;
    })
    .join("");

  container.innerHTML = rows;
}

export function setLeaderboardStatus(message, isError = false) {
  const el = document.getElementById("leaderboardStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", isError);
}

export async function refreshLeaderboard(game = "snake", opts = {}) {
  try {
    const scores = await fetchLeaderboard(game);
    renderLeaderboard(scores, opts);
    const label = gameLabel(game);
    setLeaderboardStatus(
      scores.length
        ? `${label} · top ${scores.length} of 10 · SQLite online`
        : `${label} · board empty · be the first legend`
    );
    return scores;
  } catch (err) {
    console.error(err);
    renderLeaderboard([]);
    setLeaderboardStatus("Database offline — start the server to load scores", true);
    return [];
  }
}

function padScore(n) {
  return String(n).padStart(3, "0");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}
