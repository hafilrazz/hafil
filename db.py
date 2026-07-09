"""SQLite leaderboard — top 10 scores per game."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent / "data" / "leaderboard.db"
TOP_N = 10
MAX_NAME_LEN = 16
VALID_GAMES = frozenset({"snake", "pong", "breakout", "shooter"})
DEFAULT_GAME = "snake"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@contextmanager
def get_db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def normalize_game(game: str | None) -> str:
    g = (game or DEFAULT_GAME).strip().lower()
    if g not in VALID_GAMES:
        raise ValueError(f"Invalid game. Expected one of: {', '.join(sorted(VALID_GAMES))}")
    return g


def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game TEXT NOT NULL DEFAULT 'snake',
                name TEXT NOT NULL,
                score INTEGER NOT NULL CHECK (score >= 0),
                created_at TEXT NOT NULL
            )
            """
        )
        # Migrate older DBs that pre-date the game column
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(scores)").fetchall()}
        if "game" not in cols:
            conn.execute(
                "ALTER TABLE scores ADD COLUMN game TEXT NOT NULL DEFAULT 'snake'"
            )
            conn.execute("UPDATE scores SET game = 'snake' WHERE game IS NULL OR game = ''")

        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_scores_game_score
            ON scores (game, score DESC, created_at ASC)
            """
        )

        # Public site-wide chat (no rooms / no codes)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_chat_created
            ON chat_messages (id DESC)
            """
        )


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    game = row["game"] if "game" in row.keys() else DEFAULT_GAME
    return {
        "id": row["id"],
        "game": game,
        "name": row["name"],
        "score": row["score"],
        "date": row["created_at"][:10],
    }


def get_top_scores(game: str = DEFAULT_GAME, limit: int = TOP_N) -> list[dict[str, Any]]:
    game = normalize_game(game)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, game, name, score, created_at
            FROM scores
            WHERE game = ?
            ORDER BY score DESC, created_at ASC
            LIMIT ?
            """,
            (game, limit),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_lowest_top_score(game: str = DEFAULT_GAME) -> int | None:
    """Lowest score on that game's board, or None if fewer than TOP_N entries."""
    scores = get_top_scores(game, TOP_N)
    if len(scores) < TOP_N:
        return None
    return scores[-1]["score"]


def qualifies_for_board(score: int, game: str = DEFAULT_GAME) -> bool:
    if score <= 0:
        return False
    lowest = get_lowest_top_score(game)
    return lowest is None or score > lowest


def sanitize_name(name: str) -> str:
    cleaned = "".join(ch for ch in name.strip() if ch.isprintable())
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return "ANON"
    return cleaned[:MAX_NAME_LEN]


def add_score(name: str, score: int, game: str = DEFAULT_GAME) -> dict[str, Any]:
    """Insert a score if it qualifies for that game's top N; prune extras; return board."""
    game = normalize_game(game)

    if not isinstance(score, int) or score < 0:
        raise ValueError("Score must be a non-negative integer")
    if score > 1_000_000:
        raise ValueError("Score is unrealistically high")

    player = sanitize_name(name)
    made_board = qualifies_for_board(score, game)

    if made_board:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            conn.execute(
                "INSERT INTO scores (game, name, score, created_at) VALUES (?, ?, ?, ?)",
                (game, player, score, now),
            )
            # Keep only top N for this game
            conn.execute(
                """
                DELETE FROM scores
                WHERE game = ?
                  AND id NOT IN (
                    SELECT id FROM (
                        SELECT id FROM scores
                        WHERE game = ?
                        ORDER BY score DESC, created_at ASC
                        LIMIT ?
                    )
                  )
                """,
                (game, game, TOP_N),
            )

    board = get_top_scores(game, TOP_N)
    rank = None
    if made_board:
        for i, entry in enumerate(board):
            if entry["name"] == player and entry["score"] == score:
                rank = i + 1
                break

    return {
        "made_board": made_board,
        "rank": rank,
        "name": player,
        "score": score,
        "game": game,
        "scores": board,
    }


def list_games() -> list[str]:
    return sorted(VALID_GAMES)


# ---------------------------------------------------------------------------
# Public chatroom
# ---------------------------------------------------------------------------

MAX_CHAT_LEN = 280
CHAT_LIMIT = 80


def _chat_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "body": row["body"],
        "time": row["created_at"][11:16] if len(row["created_at"]) >= 16 else row["created_at"],
        "date": row["created_at"][:10],
    }


def get_chat_messages(limit: int = CHAT_LIMIT, after_id: int = 0) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 200))
    with get_db() as conn:
        if after_id > 0:
            rows = conn.execute(
                """
                SELECT id, name, body, created_at
                FROM chat_messages
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (after_id, limit),
            ).fetchall()
            return [_chat_row(r) for r in rows]

        rows = conn.execute(
            """
            SELECT id, name, body, created_at
            FROM chat_messages
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    # oldest → newest for display
    return [_chat_row(r) for r in reversed(rows)]


def add_chat_message(name: str, body: str) -> dict[str, Any]:
    player = sanitize_name(name)
    text = " ".join((body or "").strip().split())
    text = "".join(ch for ch in text if ch.isprintable())
    if not text:
        raise ValueError("Message cannot be empty")
    if len(text) > MAX_CHAT_LEN:
        raise ValueError(f"Message too long (max {MAX_CHAT_LEN} characters)")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO chat_messages (name, body, created_at) VALUES (?, ?, ?)",
            (player, text, now),
        )
        msg_id = cur.lastrowid
        # Keep table from growing forever
        conn.execute(
            """
            DELETE FROM chat_messages
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id FROM chat_messages ORDER BY id DESC LIMIT 500
                )
            )
            """
        )
        row = conn.execute(
            "SELECT id, name, body, created_at FROM chat_messages WHERE id = ?",
            (msg_id,),
        ).fetchone()
    return _chat_row(row)
