# Travel Diary

A lightweight personal travel diary app built with Python and Flask. Pin places on an interactive map, log what you ate or did, rate your experiences, and keep a persistent record of your adventures.

Built for a 2-month trip through Mexico 🇲🇽, coming from Colombia 🇨🇴.

![screenshot](https://raw.githubusercontent.com/placeholder/screenshot.png)

---

## Features

- **Interactive map** — click anywhere to drop a pin and create a new entry
- **Place search** — search for any location (powered by OpenStreetMap / Nominatim), fly to it, and drag the marker to fine-tune the spot
- **Diary entries** — title, free-text notes, category, and a 1–5 star rating
- **Three categories** — Food 🍽️, Activity 🎉, Place 📍 — each with its own color-coded pin
- **Sidebar with filters** — browse all entries or filter by category
- **Click any card or pin** — view full details, edit, or delete
- **Persistent storage** — SQLite database, survives restarts with no setup required

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3 + Flask |
| Database | SQLite (via Python's built-in `sqlite3`) |
| Map | Leaflet.js 1.9 (via CDN) |
| Geocoding | Nominatim / OpenStreetMap (free, no API key) |
| Frontend | Vanilla HTML, CSS, JavaScript |

No npm, no build step, no external services.

---

## Getting started

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd Travel_App
```

### 2. Create a virtual environment (optional but recommended)

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

The SQLite database (`diary.db`) is created automatically on first run.

---

## How to use

| Action | How |
|---|---|
| Add an entry | Click anywhere on the map |
| Search a place | Type in the search bar at the top of the map |
| Fine-tune a searched location | Drag the cyan pulsing marker before clicking it |
| View an entry | Click a card in the sidebar or a pin on the map |
| Edit / Delete | Open an entry and use the buttons at the bottom |
| Filter by category | Use the All / Food / Activity / Place buttons |

---

## Project structure

```
Travel_App/
├── app.py              # Flask app + SQLite API
├── requirements.txt
├── diary.db            # Auto-created on first run
├── templates/
│   └── index.html
└── static/
    ├── css/
    │   └── style.css
    └── js/
        └── app.js
```

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serve the app |
| `GET` | `/api/entries` | List all diary entries |
| `POST` | `/api/entries` | Create a new entry |
| `PUT` | `/api/entries/<id>` | Update an existing entry |
| `DELETE` | `/api/entries/<id>` | Delete an entry |

### Entry schema

```json
{
  "id": 1,
  "title": "Best tacos al pastor",
  "description": "Incredible al pastor, the pineapple makes it.",
  "category": "food",
  "rating": 5,
  "lat": 19.4284,
  "lng": -99.1276,
  "location_name": "Mercado Roma, CDMX",
  "created_at": "2026-05-31 18:00:00"
}
```

---

## Notes

- Nominatim (the geocoding service) has a rate limit of 1 request/second. The search bar debounces input at 420 ms to stay well within that limit.
- The app runs in Flask's development mode by default. For any kind of shared or remote deployment, put it behind a production WSGI server like Gunicorn.
- The database file `diary.db` is excluded from version control by default — add it to `.gitignore` if you want to keep your diary private.
