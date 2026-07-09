"""
Multiplayer chess rooms — authoritative rules via python-chess.
Room codes let two friends match; server validates every move.
"""

from __future__ import annotations

import secrets
import string
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import chess

CODE_ALPHABET = string.ascii_uppercase + string.digits
CODE_LEN = 6
ROOM_TTL_SEC = 60 * 60  # 1 hour idle cleanup
MAX_ROOMS = 200


def _new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


@dataclass
class Room:
    code: str
    board: chess.Board = field(default_factory=chess.Board)
    white_sid: str | None = None
    black_sid: str | None = None
    white_name: str = "WHITE"
    black_name: str = "BLACK"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    status: str = "waiting"  # waiting | playing | ended
    result: str | None = None  # "1-0" | "0-1" | "1/2-1/2"
    result_reason: str | None = None
    last_move: str | None = None
    draw_offer_from: str | None = None  # "white" | "black"

    def touch(self) -> None:
        self.updated_at = time.time()

    def color_of(self, sid: str) -> str | None:
        if sid == self.white_sid:
            return "white"
        if sid == self.black_sid:
            return "black"
        return None

    def opponent_sid(self, sid: str) -> str | None:
        if sid == self.white_sid:
            return self.black_sid
        if sid == self.black_sid:
            return self.white_sid
        return None

    def player_count(self) -> int:
        return int(self.white_sid is not None) + int(self.black_sid is not None)

    def legal_uci(self) -> list[str]:
        return [m.uci() for m in self.board.legal_moves]

    def snapshot(self, for_sid: str | None = None) -> dict[str, Any]:
        color = self.color_of(for_sid) if for_sid else None
        your_turn = False
        if color and self.status == "playing":
            your_turn = (color == "white" and self.board.turn == chess.WHITE) or (
                color == "black" and self.board.turn == chess.BLACK
            )

        # Only send legal moves when it is this player's turn
        legal: list[str] = []
        if your_turn and self.status == "playing":
            legal = self.legal_uci()

        return {
            "room": self.code,
            "fen": self.board.fen(),
            "turn": "w" if self.board.turn == chess.WHITE else "b",
            "status": self.status,
            "result": self.result,
            "resultReason": self.result_reason,
            "lastMove": self.last_move,
            "inCheck": self.board.is_check(),
            "legal": legal,
            "you": color,
            "yourTurn": your_turn,
            "whiteName": self.white_name,
            "blackName": self.black_name,
            "players": self.player_count(),
            "drawOfferFrom": self.draw_offer_from,
            "canClaimDraw": self.board.can_claim_draw() if self.status == "playing" else False,
        }


class ChessRoomManager:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._sid_room: dict[str, str] = {}
        self._lock = threading.RLock()

    def _cleanup_locked(self) -> None:
        now = time.time()
        stale = [
            code
            for code, room in self._rooms.items()
            if now - room.updated_at > ROOM_TTL_SEC or room.player_count() == 0
        ]
        for code in stale:
            room = self._rooms.pop(code, None)
            if not room:
                continue
            for sid in (room.white_sid, room.black_sid):
                if sid and self._sid_room.get(sid) == code:
                    self._sid_room.pop(sid, None)

    def create_room(self, sid: str, name: str = "WHITE") -> dict[str, Any]:
        with self._lock:
            self._cleanup_locked()
            if len(self._rooms) >= MAX_ROOMS:
                return {"ok": False, "error": "Server is full. Try again later."}

            # Leave any existing room first
            self._leave_locked(sid)

            for _ in range(40):
                code = _new_code()
                if code not in self._rooms:
                    break
            else:
                return {"ok": False, "error": "Could not allocate room code."}

            room = Room(code=code, white_sid=sid, white_name=_safe_name(name, "WHITE"))
            self._rooms[code] = room
            self._sid_room[sid] = code
            return {"ok": True, "state": room.snapshot(sid)}

    def join_room(self, sid: str, code: str, name: str = "BLACK") -> dict[str, Any]:
        with self._lock:
            self._cleanup_locked()
            self._leave_locked(sid)

            code = (code or "").strip().upper()
            room = self._rooms.get(code)
            if not room:
                return {"ok": False, "error": "Room not found. Check the code."}

            # Rejoin same seat if reconnecting
            if room.white_sid == sid or room.black_sid == sid:
                self._sid_room[sid] = code
                room.touch()
                return {"ok": True, "state": room.snapshot(sid), "rejoined": True}

            if room.black_sid is None and room.white_sid != sid:
                room.black_sid = sid
                room.black_name = _safe_name(name, "BLACK")
                room.status = "playing"
                room.result = None
                room.result_reason = None
                room.draw_offer_from = None
                room.touch()
                self._sid_room[sid] = code
                return {"ok": True, "state": room.snapshot(sid), "started": True}

            if room.white_sid is None:
                room.white_sid = sid
                room.white_name = _safe_name(name, "WHITE")
                if room.black_sid:
                    room.status = "playing"
                room.touch()
                self._sid_room[sid] = code
                return {"ok": True, "state": room.snapshot(sid), "started": bool(room.black_sid)}

            return {"ok": False, "error": "Room is full (2/2 players)."}

    def make_move(self, sid: str, uci: str) -> dict[str, Any]:
        with self._lock:
            room = self._room_for_sid(sid)
            if not room:
                return {"ok": False, "error": "You are not in a room."}
            if room.status != "playing":
                return {"ok": False, "error": "Game is not in progress."}

            color = room.color_of(sid)
            if not color:
                return {"ok": False, "error": "Spectator moves not allowed."}

            is_white_turn = room.board.turn == chess.WHITE
            if (color == "white") != is_white_turn:
                return {"ok": False, "error": "Not your turn."}

            uci = (uci or "").strip().lower()
            try:
                move = chess.Move.from_uci(uci)
            except ValueError:
                return {"ok": False, "error": "Invalid move format."}

            if move not in room.board.legal_moves:
                # Auto-promote to queen if missing promotion and legal
                if len(uci) == 4:
                    promo = chess.Move.from_uci(uci + "q")
                    if promo in room.board.legal_moves:
                        move = promo
                    else:
                        return {"ok": False, "error": "Illegal move."}
                else:
                    return {"ok": False, "error": "Illegal move."}

            room.board.push(move)
            room.last_move = move.uci()
            room.draw_offer_from = None
            room.touch()
            self._evaluate_end(room)

            return {
                "ok": True,
                "states": {
                    sid: room.snapshot(sid)
                    for sid in (room.white_sid, room.black_sid)
                    if sid
                },
            }

    def resign(self, sid: str) -> dict[str, Any]:
        with self._lock:
            room = self._room_for_sid(sid)
            if not room:
                return {"ok": False, "error": "Not in a room."}
            if room.status != "playing":
                return {"ok": False, "error": "Game is not in progress."}
            color = room.color_of(sid)
            if not color:
                return {"ok": False, "error": "Not a player."}

            if color == "white":
                room.result = "0-1"
                room.result_reason = "White resigned"
            else:
                room.result = "1-0"
                room.result_reason = "Black resigned"
            room.status = "ended"
            room.touch()
            return self._broadcast_states(room)

    def offer_draw(self, sid: str) -> dict[str, Any]:
        with self._lock:
            room = self._room_for_sid(sid)
            if not room or room.status != "playing":
                return {"ok": False, "error": "Cannot offer draw now."}
            color = room.color_of(sid)
            if not color:
                return {"ok": False, "error": "Not a player."}

            # Claimable draws (50-move / threefold) — accept immediately if board allows
            if room.board.can_claim_draw():
                room.result = "1/2-1/2"
                room.result_reason = "Draw claimed"
                room.status = "ended"
                room.touch()
                return self._broadcast_states(room)

            if room.draw_offer_from and room.draw_offer_from != color:
                # Opponent already offered — accept
                room.result = "1/2-1/2"
                room.result_reason = "Draw by agreement"
                room.status = "ended"
                room.draw_offer_from = None
                room.touch()
                return self._broadcast_states(room)

            room.draw_offer_from = color
            room.touch()
            return self._broadcast_states(room)

    def rematch(self, sid: str) -> dict[str, Any]:
        with self._lock:
            room = self._room_for_sid(sid)
            if not room:
                return {"ok": False, "error": "Not in a room."}
            if room.player_count() < 2:
                return {"ok": False, "error": "Need both players for a rematch."}

            # Swap colors for fairness
            room.white_sid, room.black_sid = room.black_sid, room.white_sid
            room.white_name, room.black_name = room.black_name, room.white_name
            room.board.reset()
            room.status = "playing"
            room.result = None
            room.result_reason = None
            room.last_move = None
            room.draw_offer_from = None
            room.touch()
            return self._broadcast_states(room)

    def leave(self, sid: str) -> dict[str, Any] | None:
        with self._lock:
            return self._leave_locked(sid)

    def get_state(self, sid: str) -> dict[str, Any] | None:
        with self._lock:
            room = self._room_for_sid(sid)
            if not room:
                return None
            return room.snapshot(sid)

    def room_sids(self, code: str) -> list[str]:
        with self._lock:
            room = self._rooms.get(code)
            if not room:
                return []
            return [s for s in (room.white_sid, room.black_sid) if s]

    def _room_for_sid(self, sid: str) -> Room | None:
        code = self._sid_room.get(sid)
        if not code:
            return None
        return self._rooms.get(code)

    def _leave_locked(self, sid: str) -> dict[str, Any] | None:
        code = self._sid_room.pop(sid, None)
        if not code:
            return None
        room = self._rooms.get(code)
        if not room:
            return None

        color = room.color_of(sid)
        if room.white_sid == sid:
            room.white_sid = None
        if room.black_sid == sid:
            room.black_sid = None

        notify: dict[str, Any] | None = None
        if room.status == "playing" and color:
            # Forfeit if leave mid-game
            if color == "white":
                room.result = "0-1"
                room.result_reason = "White disconnected"
            else:
                room.result = "1-0"
                room.result_reason = "Black disconnected"
            room.status = "ended"
            notify = self._broadcast_states(room)
        elif room.player_count() == 0:
            self._rooms.pop(code, None)
            return None
        else:
            room.status = "waiting" if room.status != "ended" else room.status
            room.touch()
            notify = self._broadcast_states(room)

        return notify

    def _evaluate_end(self, room: Room) -> None:
        board = room.board
        if board.is_checkmate():
            # Side to move is checkmated
            if board.turn == chess.WHITE:
                room.result = "0-1"
                room.result_reason = "Checkmate — Black wins"
            else:
                room.result = "1-0"
                room.result_reason = "Checkmate — White wins"
            room.status = "ended"
        elif board.is_stalemate():
            room.result = "1/2-1/2"
            room.result_reason = "Stalemate"
            room.status = "ended"
        elif board.is_insufficient_material():
            room.result = "1/2-1/2"
            room.result_reason = "Insufficient material"
            room.status = "ended"
        elif board.is_seventyfive_moves():
            room.result = "1/2-1/2"
            room.result_reason = "75-move rule"
            room.status = "ended"
        elif board.is_fivefold_repetition():
            room.result = "1/2-1/2"
            room.result_reason = "Fivefold repetition"
            room.status = "ended"

    def _broadcast_states(self, room: Room) -> dict[str, Any]:
        return {
            "ok": True,
            "states": {
                sid: room.snapshot(sid)
                for sid in (room.white_sid, room.black_sid)
                if sid
            },
            "room": room.code,
        }


def _safe_name(name: str, default: str) -> str:
    cleaned = "".join(ch for ch in (name or "").strip() if ch.isprintable())
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return default
    return cleaned[:16]


manager = ChessRoomManager()
