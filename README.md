# portfolio

my personal site. cyberpunk vibe, a few mini games, multiplayer chess, and a leaderboard that actually saves scores.

live demo depends on where you host it (see deploy notes at the bottom).

---

## whats in here

- about / skills / projects / contact
- arcade games:
  - neon snake
  - cyber pong
  - brick breaker
  - star blaster
- cyber chess (create a room, share the code, play a friend)
- top 10 scores per game stored in sqlite

---

## run it locally

you need python 3 installed.

```powershell
cd D:\hafil
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

then open:

http://127.0.0.1:5000

dont just double click the html file. the games, leaderboard and chess need the server running.

phone on same wifi: use your pc ip instead of 127.0.0.1, something like `http://192.168.x.x:5000`

---

## project structure

```
app.py            flask + socketio
db.py             sqlite leaderboard
chess_rooms.py    chess rooms / rules
static/           frontend stuff
requirements.txt
DEPLOY.md         longer deploy writeup if you need it
```

---

## games real quick

| game | notes |
|------|--------|
| snake | classic. scores go to db |
| pong | vs cpu, first to 7 |
| breakout | break bricks, levels |
| star blaster | shoot stuff, 3 lives |
| chess | multiplayer with room codes |

chess rules are checked on the server (python-chess), not just in the browser.

---

## leaderboard api

if you care:

```
GET  /api/health
GET  /api/scores?game=snake
POST /api/scores
     body: { "name": "you", "score": 120, "game": "snake" }
```

game ids: `snake`, `pong`, `breakout`, `shooter`

---

## chess

1. both people open the same site url
2. one person hits create room
3. other person types the code and joins
4. white moves first
5. tap piece then square on mobile

draw / resign / rematch are there too.

---

## deploy

1. push this repo to github
2. make a free web service on [render.com](https://render.com) from that repo
3. build command:
   ```
   pip install -r requirements.txt
   ```
4. start command:
   ```
   gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:$PORT app:app
   ```
5. env vars:
   - `SECRET_KEY` = random long string
   - `FLASK_ENV` = `production`

more detail in `DEPLOY.md`.

note: free render sleeps when idle so first load can be slow. sqlite scores might reset on redeploy on free tier. good enough for a portfolio.

---

## stack

python, flask, flask-socketio, sqlite, plain html/css/js. no fancy frontend framework on purpose.

---

if something breaks open an issue or just fix it and pr, whatever.
