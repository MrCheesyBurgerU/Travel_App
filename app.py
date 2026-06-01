import os
import secrets
from datetime import timedelta
from functools import wraps
from flask import Flask, render_template, request, jsonify, session
import sqlite3

# ── Config ────────────────────────────────────────────────────
DB         = os.environ.get("DB_PATH", "diary.db")
DEBUG      = os.environ.get("FLASK_DEBUG", "1") == "1"
DIARY_USER = os.environ.get("DIARY_USER", "")
DIARY_PASS = os.environ.get("DIARY_PASS", "")
# SECRET_KEY must be stable across restarts for sessions to survive.
# Set it once with: fly secrets set SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = timedelta(days=7)


# ── Auth ──────────────────────────────────────────────────────
def get_role():
    """Return 'admin' or 'viewer'. No credentials configured → always admin (local dev)."""
    if not DIARY_USER:
        return "admin"
    return session.get("role", "viewer")


def require_admin(f):
    """Reject non-admin requests with 403."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if get_role() != "admin":
            return jsonify({"error": "Acceso restringido — inicia sesión como admin"}), 403
        return f(*args, **kwargs)
    return decorated


# ── Database ──────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    if os.path.dirname(DB):
        os.makedirs(os.path.dirname(DB), exist_ok=True)
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
        for col, typedef in [("country", "TEXT"), ("country_code", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE entries ADD COLUMN {col} {typedef}")
            except Exception:
                pass


# ── Auth routes ───────────────────────────────────────────────
@app.route("/api/me", methods=["GET"])
def me():
    return jsonify({"role": get_role()})


@app.route("/api/login", methods=["POST"])
def login():
    # No credentials configured → grant admin immediately (local dev)
    if not DIARY_USER:
        session.permanent = True
        session["role"] = "admin"
        return jsonify({"role": "admin"})

    data = request.json or {}
    user_ok = secrets.compare_digest(data.get("username", ""), DIARY_USER)
    pass_ok = secrets.compare_digest(data.get("password", ""), DIARY_PASS)
    if user_ok and pass_ok:
        session.permanent = True
        session["role"] = "admin"
        return jsonify({"role": "admin"})

    return jsonify({"error": "Usuario o contraseña incorrectos"}), 401


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"role": "viewer"})


# ── App routes ────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/entries", methods=["GET"])
def get_entries():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM entries ORDER BY created_at DESC"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/entries", methods=["POST"])
@require_admin
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
@require_admin
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
@require_admin
def delete_entry(entry_id):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM entries WHERE id=?", (entry_id,)).fetchone():
            return jsonify({"error": "not found"}), 404
        conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
    return jsonify({"ok": True})


# ── Entry point ───────────────────────────────────────────────
init_db()

if __name__ == "__main__":
    app.run(debug=DEBUG, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
