import sqlite3
import json
import os
import time
from contextlib import contextmanager
from backend.config import DATABASE_PATH

DB_DIR = os.path.dirname(DATABASE_PATH)
if DB_DIR:
    os.makedirs(DB_DIR, exist_ok=True)

def get_conn():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            language TEXT DEFAULT 'zh',
            mode TEXT DEFAULT 'diagram',
            chart_type TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS instructions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            seq INTEGER NOT NULL,
            action TEXT NOT NULL,
            params TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    # Migration: add columns if missing in existing databases
    for col, typ in [("language", "TEXT DEFAULT 'zh'"), ("mode", "TEXT DEFAULT 'diagram'"), ("chart_type", "TEXT DEFAULT ''")]:
        try:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass  # column already exists
    conn.commit()
    conn.close()

def save_session(session_id: str, prompt: str, language: str = "zh", mode: str = "diagram", chart_type: str = ""):
    conn = get_conn()
    now_ms = int(time.time() * 1000)
    conn.execute(
        "INSERT OR IGNORE INTO sessions (id, prompt, language, mode, chart_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (session_id, prompt, language, mode, chart_type, now_ms)
    )
    conn.commit()
    conn.close()

def save_instruction(session_id: str, seq: int, action: str, params: dict, description: str = ""):
    inst_id = f"{session_id}_{seq}"
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO instructions (id, session_id, seq, action, params, description) VALUES (?, ?, ?, ?, ?, ?)",
        (inst_id, session_id, seq, action, json.dumps(params), description)
    )
    conn.commit()
    conn.close()
    return inst_id

def get_session(session_id: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_instructions(session_id: str):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM instructions WHERE session_id = ? ORDER BY seq", (session_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_all_sessions(limit: int = 20):
    conn = get_conn()
    rows = conn.execute("SELECT id, prompt, created_at FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_instruction_params(session_id: str, seq: int, params: dict):
    """Update params for an instruction after layout optimization."""
    inst_id = f"{session_id}_{seq}"
    conn = get_conn()
    conn.execute(
        "UPDATE instructions SET params = ? WHERE id = ?",
        (json.dumps(params), inst_id)
    )
    conn.commit()
    conn.close()


def delete_instruction(inst_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM instructions WHERE id = ?", (inst_id,))
    conn.commit()
    conn.close()

def delete_session_instructions(session_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM instructions WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()

def delete_session(session_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM instructions WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
