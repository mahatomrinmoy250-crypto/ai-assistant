"""
JARVIS Web API — Vercel serverless entry point
Exposes the AI chat + KB + web search as a REST API.

Endpoints:
  POST /api/chat          — send a message, get JARVIS response
  POST /api/kb/store      — store a KB entry
  GET  /api/kb/search     — search KB
  GET  /api/kb/list       — list all KB entries
  GET  /api/health        — health check
"""

from flask import Flask, request, jsonify, Response
import os
import sys
import json

# Add parent dir so we can import agent / tools / memory_db
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

app = Flask(__name__)

# ── Lazy singletons ──────────────────────────────────────────────────────────

_agent = None
_kb = None

def get_agent():
    global _agent
    if _agent is None:
        from agent import JARVISAgent
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        _agent = JARVISAgent(api_key=api_key)
    return _agent

def get_kb():
    global _kb
    if _kb is None:
        from memory_db import get_kb as _get_kb
        _kb = _get_kb()
    return _kb

# ── CORS helper ──────────────────────────────────────────────────────────────

def cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

@app.after_request
def after_request(response):
    return cors(response)

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "JARVIS API"})

# ── Chat ─────────────────────────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST", "OPTIONS"])
def chat():
    """
    Body: {"message": "...", "stream": false}
    Response: {"response": "...", "tool_calls": [...]}
    """
    if request.method == "OPTIONS":
        return jsonify({}), 200

    data = request.get_json(silent=True) or {}
    message = data.get("message", "").strip()
    stream = data.get("stream", False)

    if not message:
        return jsonify({"error": "message is required"}), 400

    try:
        agent = get_agent()

        if stream:
            def generate():
                for chunk in agent.chat(message):
                    yield f"data: {json.dumps({'chunk': chunk})}\n\n"
                yield "data: [DONE]\n\n"
            return Response(generate(), mimetype="text/event-stream")

        # Blocking response
        full_response = agent.chat_blocking(message)
        return jsonify({"response": full_response})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/chat/clear", methods=["POST"])
def chat_clear():
    """Clear conversation history."""
    try:
        get_agent().clear_history()
        return jsonify({"status": "cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Knowledge Base ────────────────────────────────────────────────────────────

@app.route("/api/kb/store", methods=["POST"])
def kb_store():
    """
    Body: {"category": "products", "key": "iPhone 15", "value": "$999", "tags": ""}
    """
    data = request.get_json(silent=True) or {}
    category = data.get("category")
    key = data.get("key")
    value = data.get("value")
    tags = data.get("tags", "")

    if not all([category, key, value]):
        return jsonify({"error": "category, key, and value are required"}), 400

    try:
        kb = get_kb()
        kb.store(category, key, value, tags)
        return jsonify({"status": "stored", "category": category, "key": key})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/kb/bulk", methods=["POST"])
def kb_bulk():
    """
    Body: {"entries": [{"category": ..., "key": ..., "value": ...}, ...]}
    """
    data = request.get_json(silent=True) or {}
    entries = data.get("entries", [])
    if not entries:
        return jsonify({"error": "entries array is required"}), 400
    try:
        kb = get_kb()
        count = 0
        for e in entries:
            kb.store(e.get("category", "general"), e.get("key", ""), e.get("value", ""), e.get("tags", ""))
            count += 1
        return jsonify({"status": "stored", "count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/kb/search", methods=["GET", "POST"])
def kb_search():
    """
    GET  /api/kb/search?q=iPhone&category=products&limit=10
    POST {"query": "iPhone", "category": "products", "limit": 10}
    """
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        query = data.get("query", "")
        category = data.get("category")
        limit = int(data.get("limit", 10))
    else:
        query = request.args.get("q", "")
        category = request.args.get("category")
        limit = int(request.args.get("limit", 10))

    if not query:
        return jsonify({"error": "query (q) is required"}), 400

    try:
        results = get_kb().search(query, category=category, limit=limit)
        return jsonify({"results": results, "count": len(results)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/kb/list", methods=["GET"])
def kb_list():
    """GET /api/kb/list?category=products"""
    category = request.args.get("category")
    try:
        items = get_kb().list_all(category=category)
        return jsonify({"items": items, "count": len(items)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/kb/delete", methods=["POST", "DELETE"])
def kb_delete():
    """Body: {"category": "products", "key": "iPhone 15"}"""
    data = request.get_json(silent=True) or {}
    category = data.get("category")
    key = data.get("key")
    if not all([category, key]):
        return jsonify({"error": "category and key are required"}), 400
    try:
        get_kb().delete(category, key)
        return jsonify({"status": "deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Root / index ──────────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "name": "JARVIS API",
        "version": "1.0",
        "description": "Just A Rather Very Intelligent System — powered by Claude Opus 4.6",
        "endpoints": {
            "GET  /api/health": "Health check",
            "POST /api/chat": "Chat with JARVIS",
            "POST /api/chat/clear": "Clear conversation history",
            "POST /api/kb/store": "Store a knowledge base entry",
            "POST /api/kb/bulk": "Bulk store KB entries",
            "GET  /api/kb/search?q=...": "Search KB",
            "GET  /api/kb/list": "List all KB entries",
            "POST /api/kb/delete": "Delete a KB entry",
        }
    })

# ── Vercel entry point ────────────────────────────────────────────────────────
# Vercel calls the `app` object directly — no need for app.run()
