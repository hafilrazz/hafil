"""Flask app: portfolio, leaderboard API, multiplayer chess (Socket.IO)."""

from __future__ import annotations

import os
import socket
import sys

# ---------------------------------------------------------------------------
# Async mode
# - Windows local: threading (eventlet is deprecated + flaky on Win)
# - Linux / Render: eventlet (monkey_patch before other imports)
# Override anytime: SOCKETIO_ASYNC_MODE=threading|eventlet
# ---------------------------------------------------------------------------
_async = os.environ.get("SOCKETIO_ASYNC_MODE", "").strip().lower()
if _async not in ("threading", "eventlet", "gevent"):
    if sys.platform == "win32":
        _async = "threading"
    else:
        try:
            import eventlet

            eventlet.monkey_patch()
            _async = "eventlet"
        except ImportError:
            _async = "threading"
elif _async == "eventlet":
    try:
        import eventlet

        eventlet.monkey_patch()
    except ImportError:
        _async = "threading"

from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, make_response, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

import db
from chess_rooms import manager as chess_manager

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

IS_PROD = bool(
    os.environ.get("FLASK_ENV", "").lower() == "production"
    or os.environ.get("RENDER")
    or os.environ.get("RAILWAY_ENVIRONMENT")
)

app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "hafil-arcade-dev-change-me")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 60 * 60 * 24 * 7  # 7 days static default

CORS(app, resources={r"/api/*": {"origins": os.environ.get("CORS_ORIGINS", "*")}})

socketio = SocketIO(
    app,
    cors_allowed_origins=os.environ.get("CORS_ORIGINS", "*"),
    async_mode=_async,
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=1_000_000,
)

# Optional gzip — installed via flask-compress when available
try:
    from flask_compress import Compress

    Compress(app)
except ImportError:
    pass


def _init():
    db.init_db()


_init()


@app.after_request
def add_perf_headers(response):
    """Caching, compression hints, security headers."""
    path = request.path or ""

    if path.startswith("/static/"):
        if path.endswith((".js", ".mjs")):
            response.cache_control.public = True
            response.cache_control.max_age = 60 * 60 * 24
            response.headers["Vary"] = "Accept-Encoding"
        elif path.endswith((".css", ".woff2", ".woff")):
            response.cache_control.public = True
            response.cache_control.max_age = 60 * 60 * 24 * 7
            response.headers["Vary"] = "Accept-Encoding"
        elif path.endswith(
            (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ogg", ".wav", ".mp3")
        ):
            response.cache_control.public = True
            response.cache_control.max_age = 60 * 60 * 24 * 30
        else:
            response.cache_control.public = True
            response.cache_control.max_age = 60 * 30

    if path == "/" or path.endswith(".html"):
        response.cache_control.no_cache = True
        response.cache_control.must_revalidate = True
        response.headers["Link"] = (
            "</static/css/styles.css>; rel=preload; as=style, "
            "</static/js/main.js>; rel=modulepreload, "
            "</static/js/gate.js>; rel=modulepreload"
        )

    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"

    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


@app.route("/")
def index():
    resp = make_response(send_from_directory(STATIC, "index.html"))
    resp.cache_control.no_cache = True
    return resp


@app.get("/api/health")
@app.get("/api/chess/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "hafil-arcade",
            "time": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get("/api/games")
def list_games():
    return jsonify({"games": db.list_games()})


@app.get("/api/scores")
def list_scores():
    game = request.args.get("game", db.DEFAULT_GAME)
    try:
        scores = db.get_top_scores(game)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    resp = jsonify({"game": db.normalize_game(game), "scores": scores})
    # Leaderboard can be slightly cached to reduce DB hits
    resp.cache_control.public = True
    resp.cache_control.max_age = 5
    return resp


@app.get("/api/scores/qualifies")
def check_qualifies():
    game = request.args.get("game", db.DEFAULT_GAME)
    try:
        score = int(request.args.get("score", -1))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid score"}), 400
    try:
        qualifies = db.qualifies_for_board(score, game)
        game_id = db.normalize_game(game)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"qualifies": qualifies, "score": score, "game": game_id})


@app.post("/api/scores")
def submit_score():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "ANON")
    raw_score = payload.get("score")
    game = payload.get("game", db.DEFAULT_GAME)

    try:
        score = int(raw_score)
    except (TypeError, ValueError):
        return jsonify({"error": "Score must be an integer"}), 400

    if score < 0:
        return jsonify({"error": "Score cannot be negative"}), 400

    try:
        result = db.add_score(str(name), score, game)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(result), 201 if result["made_board"] else 200


@app.errorhandler(404)
def not_found(_err):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(STATIC, "index.html")


# ---------------------------------------------------------------------------
# Chess multiplayer (Socket.IO)
# ---------------------------------------------------------------------------

def _emit_states(result: dict) -> None:
    states = result.get("states") or {}
    for sid, state in states.items():
        socketio.emit("chess:state", state, to=sid)


@socketio.on("connect")
def on_connect():
    emit("chess:hello", {"ok": True, "msg": "Chess server online"})


@socketio.on("disconnect")
def on_disconnect():
    from flask import request as flask_request

    sid = flask_request.sid
    result = chess_manager.leave(sid)
    if result and result.get("states"):
        _emit_states(result)


@socketio.on("chess:create")
def on_create(data):
    from flask import request as flask_request

    data = data or {}
    name = data.get("name") or "WHITE"
    result = chess_manager.create_room(flask_request.sid, name)
    if not result.get("ok"):
        emit("chess:error", {"error": result.get("error", "Create failed")})
        return
    code = result["state"]["room"]
    join_room(code)
    emit("chess:state", result["state"])


@socketio.on("chess:join")
def on_join(data):
    from flask import request as flask_request

    data = data or {}
    code = data.get("code") or ""
    name = data.get("name") or "BLACK"
    sid = flask_request.sid
    result = chess_manager.join_room(sid, code, name)
    if not result.get("ok"):
        emit("chess:error", {"error": result.get("error", "Join failed")})
        return

    code = result["state"]["room"]
    join_room(code)
    emit("chess:state", result["state"])

    for other in chess_manager.room_sids(code):
        st = chess_manager.get_state(other)
        if st:
            socketio.emit("chess:state", st, to=other)

    if result.get("started"):
        socketio.emit(
            "chess:message",
            {"msg": "Opponent joined. Game started!", "type": "info"},
            room=code,
        )


@socketio.on("chess:move")
def on_move(data):
    from flask import request as flask_request

    data = data or {}
    uci = data.get("uci") or data.get("move") or ""
    result = chess_manager.make_move(flask_request.sid, uci)
    if not result.get("ok"):
        emit("chess:error", {"error": result.get("error", "Illegal move")})
        st = chess_manager.get_state(flask_request.sid)
        if st:
            emit("chess:state", st)
        return
    _emit_states(result)


@socketio.on("chess:resign")
def on_resign(_data=None):
    from flask import request as flask_request

    result = chess_manager.resign(flask_request.sid)
    if not result.get("ok"):
        emit("chess:error", {"error": result.get("error", "Resign failed")})
        return
    _emit_states(result)


@socketio.on("chess:draw")
def on_draw(_data=None):
    from flask import request as flask_request

    result = chess_manager.offer_draw(flask_request.sid)
    if not result.get("ok"):
        emit("chess:error", {"error": result.get("error", "Draw failed")})
        return
    _emit_states(result)


@socketio.on("chess:rematch")
def on_rematch(_data=None):
    from flask import request as flask_request

    result = chess_manager.rematch(flask_request.sid)
    if not result.get("ok"):
        emit("chess:error", {"error": result.get("error", "Rematch failed")})
        return
    _emit_states(result)
    room = result.get("room")
    if room:
        socketio.emit(
            "chess:message",
            {"msg": "Rematch! Colors swapped.", "type": "info"},
            room=room,
        )


@socketio.on("chess:leave")
def on_leave(_data=None):
    from flask import request as flask_request

    sid = flask_request.sid
    st = chess_manager.get_state(sid)
    code = st["room"] if st else None
    result = chess_manager.leave(sid)
    if code:
        leave_room(code)
    if result and result.get("states"):
        _emit_states(result)
    emit("chess:left", {"ok": True})


@socketio.on("chess:sync")
def on_sync(_data=None):
    from flask import request as flask_request

    st = chess_manager.get_state(flask_request.sid)
    if st:
        emit("chess:state", st)
    else:
        emit("chess:error", {"error": "Not in a room."})


def _port_free(host: str, port: int) -> bool:
    """Return True if we can bind this host/port."""
    family = socket.AF_INET6 if ":" in host and host != "0.0.0.0" else socket.AF_INET
    # For 0.0.0.0 just probe IPv4
    if host in ("0.0.0.0", "::"):
        family = socket.AF_INET
        probe_host = "127.0.0.1"
    else:
        probe_host = host
    s = socket.socket(family, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((probe_host if host == "0.0.0.0" else host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1" and not IS_PROD

    if not _port_free(host, port):
        print(f"ERROR: port {port} is already in use.")
        print("Close the other server or pick another port, e.g.:")
        print(f"  set PORT=5001")
        print(f"  python app.py")
        if sys.platform == "win32":
            print()
            print("To find/kill whatever is on that port (PowerShell):")
            print(f"  Get-NetTCPConnection -LocalPort {port} | Select OwningProcess")
            print(f"  Stop-Process -Id <PID> -Force")
        sys.exit(1)

    print("Hall of Fame DB:", db.DB_PATH)
    print("Games:", ", ".join(db.list_games()))
    print("Socket.IO async_mode:", _async)
    print("Production:", IS_PROD)
    print(f"Open http://127.0.0.1:{port}")
    socketio.run(
        app,
        host=host,
        port=port,
        debug=debug,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
        log_output=True,
    )


if __name__ == "__main__":
    main()

