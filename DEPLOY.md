# Deploy this project correctly

## What this app needs

| Feature | Needs a real server? |
|---------|----------------------|
| Portfolio pages | Yes (served by Flask) |
| Game leaderboards (SQLite) | Yes |
| Multiplayer chess (Socket.IO) | Yes |

**GitHub Pages cannot host this project.**  
Pages only serves static files. It cannot run Python, SQLite, or WebSockets.

**Correct approach:**

1. Put the code on **GitHub** (storage + version control)  
2. Deploy the server on **Render** (or Railway) linked to that GitHub repo  
3. Share the Render URL (e.g. `https://something.onrender.com`)

---

## Prerequisites (your PC)

Install these if missing:

1. **Git** — https://git-scm.com/download/win  
   Then close and reopen PowerShell.
2. **GitHub account** — https://github.com/signup  
3. **Render account** — https://render.com (sign up with GitHub)

Check Git works:

```powershell
git --version
```

---

## Step 1 — Create a GitHub repository

1. Open https://github.com/new  
2. **Repository name:** e.g. `hafil-portfolio`  
3. Public or Private  
4. **Do not** check “Add a README” (you already have project files)  
5. Click **Create repository**  
6. Leave that page open — you’ll need the repo URL  

Example URL shape:

```text
https://github.com/YOUR_USERNAME/hafil-portfolio.git
```

---

## Step 2 — Push this folder to GitHub

In PowerShell:

```powershell
cd D:\hafil

git init
git add .
git commit -m "Deploy portfolio arcade"

git branch -M main

# Replace with YOUR real GitHub URL:
git remote add origin https://github.com/YOUR_USERNAME/hafil-portfolio.git

git push -u origin main
```

### Login when Git asks for a password

GitHub no longer accepts account passwords for `git push`.

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens**  
2. Generate a token (classic) with scope **`repo`**  
3. Username = your GitHub username  
4. Password = **the token** (paste it)

### If `git remote add` fails (remote already exists)

```powershell
git remote remove origin
git remote add origin https://github.com/YOUR_USERNAME/hafil-portfolio.git
git push -u origin main
```

### Confirm on GitHub

Refresh your repo page. You should see `app.py`, `static/`, `requirements.txt`, etc.

---

## Step 3 — Deploy on Render (live website)

### 3.1 Create the service

1. Go to https://dashboard.render.com  
2. **New +** → **Web Service**  
3. **Connect** your GitHub account if asked  
4. Select repository: `hafil-portfolio` (or your name)  
5. Click **Connect**

### 3.2 Fill in these settings exactly

| Setting | Value |
|---------|--------|
| **Name** | `hafil-arcade` (any name is fine) |
| **Region** | closest to you |
| **Runtime** | **Python 3** |
| **Branch** | `main` |
| **Root Directory** | *(leave empty)* |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `python app.py` |
| **Instance type** | **Free** |

> **Note:** Do **not** use `gunicorn --worker-class eventlet` — Gunicorn 26+ no longer
> includes that worker, which causes deploy crash. This app starts with `python app.py`
> and uses **eventlet** through Flask-SocketIO (reads `$PORT` on Render automatically).

### 3.3 Environment variables

Open **Environment** → add:

| Key | Value |
|-----|--------|
| `SECRET_KEY` | Click **Generate** (or any long random string) |
| `FLASK_ENV` | `production` |

Optional:

| Key | Value |
|-----|--------|
| `PYTHON_VERSION` | `3.12.8` |

### 3.4 Deploy

1. Click **Create Web Service**  
2. Wait for **Build successful** and **Live** (often 3–8 minutes the first time)  
3. Copy the public URL, e.g.:

```text
https://hafil-arcade.onrender.com
```

### 3.5 Test

- Open the URL in a browser  
- Pass the human gate (wrong answer to 1+1)  
- Play Snake / arcade  
- Open **Cyber Chess** → Create room → open same URL on another device → Join with code  

---

## Step 4 — Update the site later

Whenever you change code on your PC:

```powershell
cd D:\hafil
git add .
git commit -m "Update site"
git push
```

If **Auto-Deploy** is on (default on Render), it rebuilds from `main` automatically.

---

## One-click option (Blueprint)

Your repo includes `render.yaml`.

1. Render → **New +** → **Blueprint**  
2. Select the repo  
3. Apply  

It uses the same build/start commands as above.

---

## Important limitations (be aware)

### Free Render tier

- App **sleeps after ~15 minutes** with no traffic  
- First visit after sleep can take **30–60 seconds**  
- That is normal on free hosting  

### SQLite leaderboard on free hosts

- Scores are stored in a file on the server disk  
- On free Render, that disk can **reset on redeploy**  
- For a portfolio demo this is usually OK  
- For permanent scores later: use a paid disk or an external database  

### Chess multiplayer

- Both players must use the **same public HTTPS URL**  
- Rooms live in memory → server restart clears active games  

---

## Local run (not deploy)

```powershell
cd D:\hafil
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open: http://127.0.0.1:5000  

On your phone (same Wi‑Fi), use your PC’s LAN IP, e.g. `http://192.168.x.x:5000`  
(`python app.py` already binds `0.0.0.0`).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `git` not recognized | Install Git, restart PowerShell |
| `git push` auth failed | Use a Personal Access Token, not your GitHub password |
| Render build fails | Check logs; ensure `requirements.txt` is at repo root |
| `eventlet` worker not found | Start command must be `python app.py` (not gunicorn -k eventlet) |
| Site 502 / spinning | Wait for cold start; open `/api/health` |
| Chess “connection error” | Both users must use the Render HTTPS URL, not `file://` or localhost vs public mix |
| Styles/JS old | Hard refresh: Ctrl+F5 |
| Push rejected | `git pull origin main --rebase` then `git push` |

Health check URL after deploy:

```text
https://YOUR-APP.onrender.com/api/health
```

Should return JSON like `{"ok": true, ...}`.

---

## What not to do

| Don’t | Why |
|-------|-----|
| Deploy only with **GitHub Pages** | No Python / sockets / DB |
| Open `static/index.html` as a file online | API and chess will fail |
| Commit `.env` or `.venv` | Secrets + huge junk (already in `.gitignore`) |
| Start with `gunicorn -k eventlet` | Broken on Gunicorn 26+; use `python app.py` |

---

## Quick checklist

- [ ] Git installed  
- [ ] Repo created on GitHub  
- [ ] `git push` succeeded (files visible on GitHub)  
- [ ] Render Web Service created  
- [ ] Build + Start commands set correctly  
- [ ] `SECRET_KEY` + `FLASK_ENV=production` set  
- [ ] `/api/health` returns OK  
- [ ] Site opens in browser and arcade loads  

Your live site URL is the **Render URL**, not the GitHub repo URL.
