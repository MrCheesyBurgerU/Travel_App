# Diario de Viaje

A lightweight personal travel diary. Pin places on an interactive map, log what you ate or did, rate experiences, and keep a persistent record — accessible from any device, anywhere.

---

## Features

- **Interactive map** — click anywhere to drop a pin and log an entry
- **Place search** — search by name or paste coordinates directly from Google Maps
- **Three categories** — Comida 🍽️, Actividad 🎉, Lugar 📍 with color-coded pins
- **1–5 star rating** and free-text notes
- **Grouped by country** — entries auto-group when you visit multiple countries
- **Stats bar** — total entries, average rating, countries visited
- **Password protected** — HTTP Basic Auth when deployed to the cloud

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3 + Flask |
| Database | SQLite (built-in `sqlite3`) |
| Production server | Gunicorn |
| Map | Leaflet.js 1.9 (CDN) |
| Geocoding | Nominatim / OpenStreetMap (free, no API key) |
| Hosting | Fly.io |

No npm, no build step.

---

## Running locally

```bash
# 1. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run
python app.py
```

Open [http://localhost:5000](http://localhost:5000). The database (`diary.db`) is created automatically.

---

## Deploying to Fly.io (cloud — access from phone/anywhere)

### Prerequisites

```bash
# Install the Fly CLI (macOS/Linux)
curl -L https://fly.io/install.sh | sh

# Create a free account and log in
fly auth login
```

### First deploy

**1. Edit `fly.toml`** — change the `app` name to something unique (e.g. `travel-diary-juan`):
```toml
app = "travel-diary-juan"
```

**2. Register the app with Fly:**
```bash
fly apps create travel-diary-juan
```

**3. Create a persistent volume for the database** (1 GB, free tier):
```bash
fly volumes create diary_data --size 1 --region dfw
```

**4. Set your login credentials** (these are stored as encrypted secrets, never in code):
```bash
fly secrets set DIARY_USER=tuusuario DIARY_PASS=tucontraseña
```

**5. Deploy:**
```bash
fly deploy
```

**6. Open your diary in the browser:**
```bash
fly open
```

Your diary is now live at `https://travel-diary-juan.fly.dev` — open it from your phone, any browser, anywhere.

### Subsequent deploys

Any time you make changes to the code, just run:
```bash
fly deploy
```

Data in the volume (`/data/diary.db`) is never touched by deploys.

### Useful commands

```bash
fly logs                          # view live server logs
fly ssh console                   # SSH into the running machine
fly volumes list                  # check volume status
fly secrets list                  # list secret names (values are hidden)
fly secrets set DIARY_PASS=nuevo  # change password
```

### How auth works

- If `DIARY_USER` and `DIARY_PASS` are set → the browser will ask for credentials on every new session
- If neither is set (local dev) → auth is skipped entirely
- Credentials are compared with `secrets.compare_digest` to prevent timing attacks

---

## Project structure

```
Travel_App/
├── app.py              # Flask app, API routes, auth
├── requirements.txt    # flask, gunicorn
├── Dockerfile          # container definition for Fly.io
├── fly.toml            # Fly.io configuration (region, volume, scaling)
├── .dockerignore
├── .gitignore
├── templates/
│   └── index.html
└── static/
    ├── css/style.css
    └── js/app.js
```

---

## API reference

All endpoints require Basic Auth when `DIARY_USER`/`DIARY_PASS` are set.

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serve the app |
| `GET` | `/api/entries` | List all entries (newest first) |
| `POST` | `/api/entries` | Create a new entry |
| `PUT` | `/api/entries/<id>` | Update an entry |
| `DELETE` | `/api/entries/<id>` | Delete an entry |

### Entry schema

```json
{
  "id": 1,
  "title": "Tacos al pastor",
  "description": "Increíbles, con piña.",
  "category": "food",
  "rating": 5,
  "lat": 19.4284,
  "lng": -99.1276,
  "location_name": "Mercado Roma, CDMX",
  "country": "México",
  "country_code": "MX",
  "created_at": "2026-05-31 18:00:00"
}
```

---

## Notes

- **SQLite + single worker** — Gunicorn is configured with `--workers 1`. SQLite doesn't support concurrent writes across processes, so running multiple workers would cause database errors.
- **Scaling to zero** — `auto_stop_machines = "stop"` in `fly.toml` means the machine stops when idle and starts on the next request. Cold start is ~2 seconds. Keeps usage within the free tier.
- **Nominatim rate limit** — the search bar debounces at 420 ms to stay under 1 req/s as required by Nominatim's terms.
