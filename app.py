from flask import Flask, render_template, request, jsonify
import sqlite3

# ── Config ────────────────────────────────────────────────────
DB    = "diary.db"
DEBUG = True          # set False for production

app = Flask(__name__)


# ── Database ──────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT    NOT NULL,
                description  TEXT,
                category     TEXT    NOT NULL,
                rating       INTEGER NOT NULL,
                lat          REAL    NOT NULL,
                lng          REAL    NOT NULL,
                location_name TEXT,
                country      TEXT,
                country_code TEXT,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Non-destructive migrations for existing databases
        for col, typedef in [("country", "TEXT"), ("country_code", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE entries ADD COLUMN {col} {typedef}")
            except Exception:
                pass  # column already exists


# ── Routes ────────────────────────────────────────────────────
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
def update_entry(entry_id):
    data = request.json
    if not data or not data.get("title"):
        return jsonify({"error": "title is required"}), 400

    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM entries WHERE id=?", (entry_id,)
        ).fetchone()
        if not existing:
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
def delete_entry(entry_id):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM entries WHERE id=?", (entry_id,)
        ).fetchone()
        if not existing:
            return jsonify({"error": "not found"}), 404
        conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
    return jsonify({"ok": True})


# ── Entry point ───────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    app.run(debug=DEBUG)
