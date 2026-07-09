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

        # Private code rooms (one creator code; others join with it)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS private_rooms (
                code TEXT PRIMARY KEY,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS private_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (code) REFERENCES private_rooms(code) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_private_msg_code_id
            ON private_messages (code, id)
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
    # Ensure table exists (safe if already created)
    init_db()

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
    if not row:
        return {
            "id": msg_id,
            "name": player,
            "body": text,
            "time": now[11:16],
            "date": now[:10],
        }
    return _chat_row(row)


def chat_message_count() -> int:
    """How many chat rows exist right now."""
    init_db()
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM chat_messages").fetchone()
        return int(row["n"])


def clear_chat_history() -> int:
    """Delete every chat message. Returns how many rows were removed."""
    init_db()
    with get_db() as conn:
        cur = conn.execute("SELECT COUNT(*) AS n FROM chat_messages")
        count = int(cur.fetchone()["n"])
        conn.execute("DELETE FROM chat_messages")
        # Also reset autoincrement so new messages start clean (best-effort)
        try:
            conn.execute("DELETE FROM sqlite_sequence WHERE name = 'chat_messages'")
        except Exception:
            pass
    return count


# ---------------------------------------------------------------------------
# Private code chat rooms
# ---------------------------------------------------------------------------

PRIVATE_CODE_LEN = 6
_PRIVATE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def normalize_room_code(code: str | None) -> str:
    raw = "".join(ch for ch in str(code or "").upper() if ch.isalnum())
    if len(raw) < 4 or len(raw) > 12:
        raise ValueError("Room code must be 4–12 characters")
    return raw


def _generate_room_code(conn: sqlite3.Connection) -> str:
    import secrets

    for _ in range(40):
        code = "".join(secrets.choice(_PRIVATE_ALPHABET) for _ in range(PRIVATE_CODE_LEN))
        exists = conn.execute(
            "SELECT 1 FROM private_rooms WHERE code = ?", (code,)
        ).fetchone()
        if not exists:
            return code
    raise RuntimeError("Could not allocate a free room code")


def create_private_room(created_by: str) -> dict[str, Any]:
    """Create a private room; returns {code, created_by, created_at}."""
    init_db()
    owner = sanitize_name(created_by)
    now = _utc_now()
    with get_db() as conn:
        code = _generate_room_code(conn)
        conn.execute(
            "INSERT INTO private_rooms (code, created_by, created_at) VALUES (?, ?, ?)",
            (code, owner, now),
        )
    return {"code": code, "created_by": owner, "created_at": now}


def private_room_exists(code: str) -> bool:
    init_db()
    try:
        code = normalize_room_code(code)
    except ValueError:
        return False
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM private_rooms WHERE code = ?", (code,)
        ).fetchone()
    return row is not None


def get_private_room(code: str) -> dict[str, Any] | None:
    init_db()
    code = normalize_room_code(code)
    with get_db() as conn:
        row = conn.execute(
            "SELECT code, created_by, created_at FROM private_rooms WHERE code = ?",
            (code,),
        ).fetchone()
    if not row:
        return None
    return {
        "code": row["code"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
    }


def get_private_messages(
    code: str, limit: int = CHAT_LIMIT, after_id: int = 0
) -> list[dict[str, Any]]:
    init_db()
    code = normalize_room_code(code)
    if not private_room_exists(code):
        raise ValueError("Room not found — check the code")
    limit = max(1, min(int(limit), 200))
    with get_db() as conn:
        if after_id > 0:
            rows = conn.execute(
                """
                SELECT id, name, body, created_at
                FROM private_messages
                WHERE code = ? AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (code, after_id, limit),
            ).fetchall()
            return [_chat_row(r) for r in rows]

        rows = conn.execute(
            """
            SELECT id, name, body, created_at
            FROM private_messages
            WHERE code = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (code, limit),
        ).fetchall()
    return [_chat_row(r) for r in reversed(rows)]


def private_message_count(code: str) -> int:
    init_db()
    code = normalize_room_code(code)
    with get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM private_messages WHERE code = ?",
            (code,),
        ).fetchone()
        return int(row["n"])


def add_private_message(code: str, name: str, body: str) -> dict[str, Any]:
    init_db()
    code = normalize_room_code(code)
    if not private_room_exists(code):
        raise ValueError("Room not found — check the code")

    player = sanitize_name(name)
    text = " ".join((body or "").strip().split())
    text = "".join(ch for ch in text if ch.isprintable())
    if not text:
        raise ValueError("Message cannot be empty")
    if len(text) > MAX_CHAT_LEN:
        raise ValueError(f"Message too long (max {MAX_CHAT_LEN} characters)")

    now = _utc_now()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO private_messages (code, name, body, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (code, player, text, now),
        )
        msg_id = cur.lastrowid
        # Cap history per room
        conn.execute(
            """
            DELETE FROM private_messages
            WHERE code = ? AND id NOT IN (
                SELECT id FROM (
                    SELECT id FROM private_messages
                    WHERE code = ?
                    ORDER BY id DESC LIMIT 300
                )
            )
            """,
            (code, code),
        )
        row = conn.execute(
            "SELECT id, name, body, created_at FROM private_messages WHERE id = ?",
            (msg_id,),
        ).fetchone()
    if not row:
        return {
            "id": msg_id,
            "name": player,
            "body": text,
            "time": now[11:16],
            "date": now[:10],
        }
    return _chat_row(row)


def clear_private_history(code: str) -> int:
    """Wipe messages in one private room. Room code stays valid."""
    init_db()
    code = normalize_room_code(code)
    if not private_room_exists(code):
        raise ValueError("Room not found — check the code")
    with get_db() as conn:
        cur = conn.execute(
            "SELECT COUNT(*) AS n FROM private_messages WHERE code = ?", (code,)
        )
        count = int(cur.fetchone()["n"])
        conn.execute("DELETE FROM private_messages WHERE code = ?", (code,))
    return count


def add_private_leave_notice(code: str, player_name: str) -> dict[str, Any]:
    """Post a system line: \"{name} left chat\" into the private room."""
    init_db()
    code = normalize_room_code(code)
    if not private_room_exists(code):
        raise ValueError("Room not found — check the code")

    player = sanitize_name(player_name)
    body = f"{player} left chat"
    now = _utc_now()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO private_messages (code, name, body, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (code, "System", body, now),
        )
        msg_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, name, body, created_at FROM private_messages WHERE id = ?",
            (msg_id,),
        ).fetchone()
    if not row:
        return {
            "id": msg_id,
            "name": "System",
            "body": body,
            "time": now[11:16],
            "date": now[:10],
            "system": True,
        }
    msg = _chat_row(row)
    msg["system"] = True
    return msg
