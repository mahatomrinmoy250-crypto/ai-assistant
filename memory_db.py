"""
Knowledge Base — Persistent memory for JARVIS.
Stores company info, product prices, FAQs, contacts, and any custom data.
SQLite-backed, full-text searchable, category-organized.

Usage:
    kb = KnowledgeBase()
    kb.store("price", "iPhone 15", "$999")
    kb.store("faq", "return policy", "30-day full refund")
    results = kb.search("iPhone price")
"""

import sqlite3
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

DB_PATH = Path.home() / ".jarvis_knowledge.db"


class KnowledgeBase:
    """Persistent key-value knowledge store with full-text search."""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        # Enable FTS (full-text search)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS knowledge (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    category    TEXT    NOT NULL DEFAULT 'general',
                    key         TEXT    NOT NULL,
                    value       TEXT    NOT NULL,
                    tags        TEXT    DEFAULT '',
                    created_at  TEXT    NOT NULL,
                    updated_at  TEXT    NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_category ON knowledge(category);
                CREATE INDEX IF NOT EXISTS idx_key      ON knowledge(key);

                CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
                USING fts5(
                    category, key, value, tags,
                    content='knowledge',
                    content_rowid='id'
                );

                CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
                    INSERT INTO knowledge_fts(rowid, category, key, value, tags)
                    VALUES (new.id, new.category, new.key, new.value, new.tags);
                END;

                CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
                    INSERT INTO knowledge_fts(knowledge_fts, rowid, category, key, value, tags)
                    VALUES ('delete', old.id, old.category, old.key, old.value, old.tags);
                    INSERT INTO knowledge_fts(rowid, category, key, value, tags)
                    VALUES (new.id, new.category, new.key, new.value, new.tags);
                END;

                CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
                    INSERT INTO knowledge_fts(knowledge_fts, rowid, category, key, value, tags)
                    VALUES ('delete', old.id, old.category, old.key, old.value, old.tags);
                END;
            """)

    # ──────────────────────── CRUD ────────────────────────────────────────

    def store(self, category: str, key: str, value: str, tags: str = "") -> dict:
        """Store or update a knowledge entry."""
        now = datetime.now().isoformat()
        with self._connect() as conn:
            # Check if entry exists (same category + key)
            existing = conn.execute(
                "SELECT id FROM knowledge WHERE category=? AND key=?",
                (category.lower(), key)
            ).fetchone()

            if existing:
                conn.execute(
                    "UPDATE knowledge SET value=?, tags=?, updated_at=? WHERE id=?",
                    (value, tags, now, existing["id"])
                )
                action = "updated"
                entry_id = existing["id"]
            else:
                cur = conn.execute(
                    "INSERT INTO knowledge (category, key, value, tags, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                    (category.lower(), key, value, tags, now, now)
                )
                action = "stored"
                entry_id = cur.lastrowid

        return {"success": True, "action": action, "id": entry_id, "category": category, "key": key}

    def search(self, query: str, category: str = None, limit: int = 10) -> dict:
        """Full-text search across all knowledge entries."""
        with self._connect() as conn:
            if category:
                rows = conn.execute("""
                    SELECT k.id, k.category, k.key, k.value, k.tags, k.updated_at
                    FROM knowledge k
                    JOIN knowledge_fts fts ON k.id = fts.rowid
                    WHERE knowledge_fts MATCH ? AND k.category = ?
                    ORDER BY rank
                    LIMIT ?
                """, (self._clean_query(query), category.lower(), limit)).fetchall()
            else:
                rows = conn.execute("""
                    SELECT k.id, k.category, k.key, k.value, k.tags, k.updated_at
                    FROM knowledge k
                    JOIN knowledge_fts fts ON k.id = fts.rowid
                    WHERE knowledge_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                """, (self._clean_query(query), limit)).fetchall()

            results = [dict(r) for r in rows]

            # Fallback: simple LIKE search if FTS returns nothing
            if not results:
                like = f"%{query}%"
                if category:
                    rows = conn.execute(
                        "SELECT * FROM knowledge WHERE category=? AND (key LIKE ? OR value LIKE ? OR tags LIKE ?) LIMIT ?",
                        (category.lower(), like, like, like, limit)
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM knowledge WHERE key LIKE ? OR value LIKE ? OR tags LIKE ? LIMIT ?",
                        (like, like, like, limit)
                    ).fetchall()
                results = [dict(r) for r in rows]

        return {"query": query, "results": results, "count": len(results)}

    def get(self, category: str, key: str) -> dict:
        """Exact lookup by category and key."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM knowledge WHERE category=? AND key=?",
                (category.lower(), key)
            ).fetchone()
        if row:
            return {"found": True, "entry": dict(row)}
        return {"found": False, "category": category, "key": key}

    def list_all(self, category: str = None) -> dict:
        """List all knowledge entries, optionally filtered by category."""
        with self._connect() as conn:
            if category:
                rows = conn.execute(
                    "SELECT * FROM knowledge WHERE category=? ORDER BY category, key",
                    (category.lower(),)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM knowledge ORDER BY category, key"
                ).fetchall()

        entries = [dict(r) for r in rows]

        # Group by category for readability
        grouped = {}
        for e in entries:
            cat = e["category"]
            grouped.setdefault(cat, []).append(e)

        return {"entries": entries, "grouped": grouped, "count": len(entries)}

    def delete(self, category: str, key: str) -> dict:
        """Delete a specific entry."""
        with self._connect() as conn:
            result = conn.execute(
                "DELETE FROM knowledge WHERE category=? AND key=?",
                (category.lower(), key)
            )
        if result.rowcount:
            return {"success": True, "deleted": f"{category}/{key}"}
        return {"success": False, "error": f"Entry '{category}/{key}' not found"}

    def delete_category(self, category: str) -> dict:
        """Delete all entries in a category."""
        with self._connect() as conn:
            result = conn.execute(
                "DELETE FROM knowledge WHERE category=?",
                (category.lower(),)
            )
        return {"success": True, "deleted_count": result.rowcount, "category": category}

    def list_categories(self) -> dict:
        """List all categories with entry counts."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT category, COUNT(*) as count FROM knowledge GROUP BY category ORDER BY category"
            ).fetchall()
        return {"categories": [dict(r) for r in rows]}

    def bulk_store(self, entries: list) -> dict:
        """Store multiple entries at once. entries = [{category, key, value, tags?}]"""
        stored = 0
        errors = []
        for e in entries:
            try:
                self.store(
                    e.get("category", "general"),
                    e["key"],
                    e["value"],
                    e.get("tags", "")
                )
                stored += 1
            except Exception as ex:
                errors.append({"entry": e, "error": str(ex)})

        return {"stored": stored, "errors": errors, "total": len(entries)}

    @staticmethod
    def _clean_query(query: str) -> str:
        """Sanitize FTS query — escape special chars."""
        # Remove FTS special chars that cause parse errors
        clean = re.sub(r'["\'\(\)\[\]\{\}:^*]', " ", query)
        clean = clean.strip()
        if not clean:
            return '""'
        # Wrap in quotes for phrase search if multi-word
        words = clean.split()
        if len(words) == 1:
            return f"{words[0]}*"  # Prefix match
        return " OR ".join(f"{w}*" for w in words)  # OR across words


# ──────────────────────── Singleton accessor ──────────────────────────────

_kb_instance: Optional[KnowledgeBase] = None

def get_kb() -> KnowledgeBase:
    global _kb_instance
    if _kb_instance is None:
        _kb_instance = KnowledgeBase()
    return _kb_instance
