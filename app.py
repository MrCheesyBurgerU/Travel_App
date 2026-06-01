import os
import secrets
from functools import wraps
from flask import Flask, render_template, request, jsonify, Response
import sqlite3

# ── Config ────────────────────────────────────────────────────
# In production set these via environment variables / fly secrets
DB         = os.environ.get("DB_PATH", "diary.db")
DEBUG      = os.environ.get("FLASK_DEBUG", "1") == "1"
DIARY_USER = os.environ.get("DIARY_USER", "")   # leave empty to disable auth
DIARY_PASS = os.environ.get("DIARY_PASS", "")

app = Flask(__name__)


# ── Auth ──────────────────────────────────────────────────────
def _unauthorized():
    return Response(
        "Acceso restringido",
        401,
        {"WWW-Authenticate": 'Basic realm="Diario de Viaje"'},
    )


def require_auth(f):
    """HTTP Basic Auth gate — skipped if DIARY_USER/DIARY_PASS are not set."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not DIARY_USER or not DIARY_PASS:
            return f(*args, **kwargs)
        auth = request.authorization
        if not auth:
            return _unauthorized()
        user_ok = secrets.compare_digest(auth.username, DIARY_USER)
        pass_ok = secrets.compare_digest(auth.password, DIARY_PASS)
        if not (user_ok and pass_ok):
            return _unauthorized()
        return f(*args, **kwargs)
    return decorated


# ── Database ──────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB), exist_ok=True) if os.path.dirname(DB) else None
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                title         TEXT    NOT NULL,
                description   TEXT,
                category      TEXT    NOT NULL,
                rating        INTEGER NOT NULL,
                lat           REAL    NOT NULL,
                lng           REAL    NOT NULL,
                location_name TEXT,
                country       TEXT,
                country_code  TEXT,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Non-destructive migrations for existing databases
        for col, typedef in [("country", "TEXT"), ("country_code", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE entries ADD COLUMN {col} {typedef}")
            except Exception:
                pass


# ── Routes ────────────────────────────────────────────────────
@app.route("/")
@require_auth
def index():
    return render_template("index.html")


@app.route("/api/entries", methods=["GET"])
@require_auth
def get_entries():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM entries ORDER BY created_at DESC"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/entries", methods=["POST"])
@require_auth
def add_entry():
    data = request.json
    if not data or not data.get("title"):
        return jsonify({"error": "title is required"}), 400

    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO entries
               (title, description, category, rating, lat, lng,
                location_name, country, country_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data["title"],
                data.get("description", ""),
                data["category"],
                int(data["rating"]),
                float(data["lat"]),
                float(data["lng"]),
                data.get("location_name", ""),
                data.get("country"),
                data.get("country_code"),
            ),
        )
        entry = conn.execute(
            "SELECT * FROM entries WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return jsonify(dict(entry)), 201


@app.route("/api/entries/<int:entry_id>", methods=["PUT"])
@require_auth
def update_entry(entry_id):
    data = request.json
    if not data or not data.get("title"):
        return jsonify({"error": "title is required"}), 400

    with get_db() as conn:
        if not conn.execute("SELECT id FROM entries WHERE id=?", (entry_id,)).fetchone():
            return jsonify({"error": "not found"}), 404
        conn.execute(
            """UPDATE entries
               SET title=?, description=?, category=?, rating=?, location_name=?
               WHERE id=?""",
            (
                data["title"],
                data.get("description", ""),
                data["category"],
                int(data["rating"]),
                data.get("location_name", ""),
                entry_id,
            ),
        )
        entry = conn.execute(
            "SELECT * FROM entries WHERE id=?", (entry_id,)
        ).fetchone()
    return jsonify(dict(entry))


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
@require_auth
def delete_entry(entry_id):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM entries WHERE id=?", (entry_id,)).fetchone():
            return jsonify({"error": "not found"}), 404
        conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
    return jsonify({"ok": True})


# ── Entry point ───────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    app.run(debug=DEBUG, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
