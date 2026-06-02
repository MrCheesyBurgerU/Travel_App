# Diario de Viaje · Nicolás & Maca

A personal travel diary. Pin places on an interactive map, log food, activities and places, rate experiences, and keep a persistent record of your adventures.

---

## Features

- **Interactive map** — click anywhere to drop a pin and log an entry
- **Place search** — search by name or paste coordinates directly from Google Maps
- **Three categories** — Comida 🍽️, Actividad 🎉, Lugar 📍 with color-coded pins
- **1–5 star rating** and free-text notes
- **Grouped by country** — entries auto-group when visiting multiple countries
- **Per-country stats** — total entries, average rating, and per-category breakdown
- **Per-country filters and search** — filter and search within each country independently
- **Admin / viewer roles** — login button for full access, read-only by default

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3 + Flask |
| Database | SQLite (built-in `sqlite3`) |
| Map | Leaflet.js 1.9 (CDN) |
| Geocoding | Nominatim / OpenStreetMap (free, no API key) |

No npm, no build step, no external services.

---

## Running locally

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run
python app.py
```

Open [http://localhost:5000](http://localhost:5000).

The database (`diary.db`) is created automatically on first run. No login is required when running locally — you get full admin access by default.

To enable the login system locally, set environment variables before running:

```bash
DIARY_USER=nico DIARY_PASS=secreto python app.py
```

---

## Project structure

```
Travel_App/
├── app.py              # Flask app + API
├── requirements.txt    # flask
├── diary.db            # SQLite database (auto-created)
├── templates/
│   └── index.html
└── static/
    ├── css/style.css
    └── js/app.js
```

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serve the app |
| `GET` | `/api/me` | Current role (`admin` / `viewer`) |
| `POST` | `/api/login` | Login with credentials |
| `POST` | `/api/logout` | Logout |
| `GET` | `/api/entries` | List all entries (newest first) |
| `POST` | `/api/entries` | Create a new entry |
| `PUT` | `/api/entries/<id>` | Update an entry |
| `DELETE` | `/api/entries/<id>` | Delete an entry |
