# HAFIL RAZAK — Portfolio + Retro Arcade

Cyberpunk portfolio with mini-games, SQLite leaderboards, and multiplayer chess.

## Local run

```powershell
cd D:\hafil
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**

## Deploy (GitHub + Render)

**GitHub Pages cannot run this app** (needs Python + WebSockets).

Full correct steps → **[DEPLOY.md](./DEPLOY.md)**

Short version:

1. Push this folder to a **GitHub** repo  
2. On **[Render](https://render.com)** create a **Web Service** from that repo  
3. **Build:** `pip install -r requirements.txt`  
4. **Start:** `gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:$PORT app:app`  
5. Env: `SECRET_KEY` (random), `FLASK_ENV=production`  
6. Use the Render URL as your live site  

## Arcade

| Game | Notes |
|------|--------|
| Neon Snake | Top-10 DB board |
| Cyber Pong | First to 7 |
| Brick Breaker | Lives + levels |
| Star Blaster | Shoot invaders |
| Cyber Chess | Multiplayer room codes |

## Project layout

```
app.py              Flask + Socket.IO
db.py               SQLite leaderboards
chess_rooms.py      Chess rooms + rules
requirements.txt
Procfile            Render/Heroku start command
render.yaml         Optional Render blueprint
DEPLOY.md           Deployment guide
static/             Frontend
```

## API

- `GET /api/health`
- `GET /api/scores?game=snake`
- `POST /api/scores` → `{ "name", "score", "game" }`

Games: `snake`, `pong`, `breakout`, `shooter`
