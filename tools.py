"""
Tools Module — Real-world capabilities for the JARVIS assistant.
Provides: web search, web fetch, file I/O, system info, calculator,
          clipboard, notes, timers, and more.
"""

import os
import sys
import math
import time
import json
import shutil
import platform
import subprocess
import datetime
from pathlib import Path
from typing import Any

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

try:
    from duckduckgo_search import DDGS
    DDGS_AVAILABLE = True
except ImportError:
    DDGS_AVAILABLE = False

try:
    import requests
    from bs4 import BeautifulSoup
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    import pyperclip
    CLIPBOARD_AVAILABLE = True
except ImportError:
    CLIPBOARD_AVAILABLE = False


# ─────────────────────────── Tool definitions ───────────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "web_search",
        "description": (
            "Search the web for current information, news, facts, or any topic. "
            "Returns top results with titles, URLs, and snippets."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of results to return (default: 5)",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "web_fetch",
        "description": (
            "Fetch and read the content of a webpage. "
            "Useful for reading articles, documentation, or any URL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The full URL to fetch"
                }
            },
            "required": ["url"]
        }
    },
    {
        "name": "run_command",
        "description": (
            "Execute a shell command on the system and return stdout/stderr. "
            "Use for system tasks, file operations, running scripts, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 30)",
                    "default": 30
                }
            },
            "required": ["command"]
        }
    },
    {
        "name": "read_file",
        "description": "Read the contents of a file from disk.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file"
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "write_file",
        "description": "Write content to a file on disk (creates or overwrites).",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path where the file should be written"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file"
                },
                "append": {
                    "type": "boolean",
                    "description": "If true, append to file instead of overwriting",
                    "default": False
                }
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "list_directory",
        "description": "List files and directories in a given path.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path to list (default: current directory)"
                }
            },
            "required": []
        }
    },
    {
        "name": "get_system_info",
        "description": (
            "Get system information: CPU usage, RAM, disk space, "
            "battery, running processes, OS details, and uptime."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["all", "cpu", "memory", "disk", "battery", "network", "processes", "os"],
                    "description": "Which info category to retrieve (default: all)",
                    "default": "all"
                }
            },
            "required": []
        }
    },
    {
        "name": "calculate",
        "description": (
            "Evaluate a mathematical expression or calculation. "
            "Supports arithmetic, trigonometry, logarithms, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "Math expression to evaluate (e.g. '2 ** 10', 'math.sqrt(144)', 'sin(pi/2)')"
                }
            },
            "required": ["expression"]
        }
    },
    {
        "name": "get_datetime",
        "description": "Get the current date, time, day of week, or timezone info.",
        "input_schema": {
            "type": "object",
            "properties": {
                "timezone": {
                    "type": "string",
                    "description": "Optional timezone name (e.g. 'UTC', 'US/Eastern')"
                }
            },
            "required": []
        }
    },
    {
        "name": "clipboard_read",
        "description": "Read the current contents of the system clipboard.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "clipboard_write",
        "description": "Write text to the system clipboard.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Text to copy to clipboard"
                }
            },
            "required": ["text"]
        }
    },
    {
        "name": "save_note",
        "description": "Save a note or piece of information to the notes file for later recall.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Title or label for the note"
                },
                "content": {
                    "type": "string",
                    "description": "The note content to save"
                }
            },
            "required": ["title", "content"]
        }
    },
    {
        "name": "read_notes",
        "description": "Read all saved notes.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "set_timer",
        "description": "Set a countdown timer that will alert when done.",
        "input_schema": {
            "type": "object",
            "properties": {
                "seconds": {
                    "type": "integer",
                    "description": "Duration in seconds"
                },
                "label": {
                    "type": "string",
                    "description": "Optional label for the timer"
                }
            },
            "required": ["seconds"]
        }
    },
    {
        "name": "open_application",
        "description": "Open an application or file on the system.",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "description": "Application name or file path to open"
                }
            },
            "required": ["target"]
        }
    }
]


# ─────────────────────────── Tool implementations ───────────────────────────

def web_search(query: str, max_results: int = 5) -> dict:
    if not DDGS_AVAILABLE:
        return {"error": "duckduckgo-search not installed. Run: pip install duckduckgo-search"}

    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))

        if not results:
            return {"results": [], "message": "No results found."}

        formatted = []
        for r in results:
            formatted.append({
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", "")
            })

        return {"query": query, "results": formatted, "count": len(formatted)}

    except Exception as e:
        return {"error": str(e)}


def web_fetch(url: str) -> dict:
    if not REQUESTS_AVAILABLE:
        return {"error": "requests/beautifulsoup4 not installed."}

    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        }
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        # Remove scripts, styles, nav, footer
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
            tag.decompose()

        # Extract main content
        text = soup.get_text(separator="\n", strip=True)
        # Clean up whitespace
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        content = "\n".join(lines)

        # Truncate to avoid token overflow
        if len(content) > 8000:
            content = content[:8000] + "\n\n[...content truncated...]"

        return {
            "url": url,
            "title": soup.title.string if soup.title else "",
            "content": content,
            "length": len(content)
        }

    except requests.RequestException as e:
        return {"error": f"Request failed: {e}"}
    except Exception as e:
        return {"error": str(e)}


def run_command(command: str, timeout: int = 30) -> dict:
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return {
            "command": command,
            "stdout": result.stdout[:4000] if result.stdout else "",
            "stderr": result.stderr[:2000] if result.stderr else "",
            "return_code": result.returncode,
            "success": result.returncode == 0
        }
    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {timeout}s", "command": command}
    except Exception as e:
        return {"error": str(e), "command": command}


def read_file(path: str) -> dict:
    try:
        p = Path(path).expanduser()
        if not p.exists():
            return {"error": f"File not found: {path}"}
        if not p.is_file():
            return {"error": f"Not a file: {path}"}

        content = p.read_text(encoding="utf-8", errors="replace")
        if len(content) > 10000:
            content = content[:10000] + "\n\n[...truncated...]"

        return {
            "path": str(p.absolute()),
            "content": content,
            "size": p.stat().st_size,
            "lines": content.count("\n")
        }
    except Exception as e:
        return {"error": str(e)}


def write_file(path: str, content: str, append: bool = False) -> dict:
    try:
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        p.write_text(content, encoding="utf-8") if not append else open(p, "a").write(content)
        return {
            "path": str(p.absolute()),
            "success": True,
            "mode": "appended" if append else "written",
            "size": p.stat().st_size
        }
    except Exception as e:
        return {"error": str(e)}


def list_directory(path: str = ".") -> dict:
    try:
        p = Path(path).expanduser()
        if not p.exists():
            return {"error": f"Path not found: {path}"}

        items = []
        for item in sorted(p.iterdir()):
            stat = item.stat()
            items.append({
                "name": item.name,
                "type": "directory" if item.is_dir() else "file",
                "size": stat.st_size if item.is_file() else None,
                "modified": datetime.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M")
            })

        return {
            "path": str(p.absolute()),
            "items": items,
            "count": len(items)
        }
    except Exception as e:
        return {"error": str(e)}


def get_system_info(category: str = "all") -> dict:
    info = {}

    try:
        if category in ("all", "os"):
            info["os"] = {
                "system": platform.system(),
                "release": platform.release(),
                "version": platform.version(),
                "machine": platform.machine(),
                "processor": platform.processor(),
                "python": sys.version.split()[0],
                "hostname": platform.node()
            }

        if PSUTIL_AVAILABLE:
            if category in ("all", "cpu"):
                info["cpu"] = {
                    "percent": psutil.cpu_percent(interval=0.5),
                    "count_logical": psutil.cpu_count(),
                    "count_physical": psutil.cpu_count(logical=False),
                    "frequency_mhz": round(psutil.cpu_freq().current, 1) if psutil.cpu_freq() else None
                }

            if category in ("all", "memory"):
                mem = psutil.virtual_memory()
                info["memory"] = {
                    "total_gb": round(mem.total / 1e9, 2),
                    "available_gb": round(mem.available / 1e9, 2),
                    "used_percent": mem.percent
                }

            if category in ("all", "disk"):
                disk = psutil.disk_usage("/")
                info["disk"] = {
                    "total_gb": round(disk.total / 1e9, 2),
                    "free_gb": round(disk.free / 1e9, 2),
                    "used_percent": disk.percent
                }

            if category in ("all", "battery"):
                bat = psutil.sensors_battery()
                if bat:
                    info["battery"] = {
                        "percent": bat.percent,
                        "plugged_in": bat.power_plugged,
                        "time_left_min": round(bat.secsleft / 60) if bat.secsleft > 0 else None
                    }

            if category in ("all", "network"):
                net = psutil.net_io_counters()
                info["network"] = {
                    "bytes_sent_mb": round(net.bytes_sent / 1e6, 2),
                    "bytes_recv_mb": round(net.bytes_recv / 1e6, 2)
                }

            if category in ("processes",):
                procs = []
                for p in sorted(psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]),
                                  key=lambda x: x.info.get("cpu_percent", 0) or 0, reverse=True)[:10]:
                    procs.append(p.info)
                info["top_processes"] = procs

            if category in ("all",):
                info["uptime_hours"] = round((time.time() - psutil.boot_time()) / 3600, 1)

        else:
            info["note"] = "psutil not installed — limited system info available"

    except Exception as e:
        info["error"] = str(e)

    return info


def calculate(expression: str) -> dict:
    # Safe math evaluation
    safe_globals = {
        "__builtins__": {},
        "math": math,
        "abs": abs, "round": round, "min": min, "max": max,
        "sum": sum, "pow": pow, "int": int, "float": float,
        "sqrt": math.sqrt, "sin": math.sin, "cos": math.cos,
        "tan": math.tan, "log": math.log, "log10": math.log10,
        "exp": math.exp, "pi": math.pi, "e": math.e,
        "ceil": math.ceil, "floor": math.floor
    }
    try:
        result = eval(expression, safe_globals, {})
        return {"expression": expression, "result": result}
    except ZeroDivisionError:
        return {"error": "Division by zero"}
    except Exception as e:
        return {"error": f"Cannot evaluate '{expression}': {e}"}


def get_datetime(timezone: str = None) -> dict:
    try:
        if timezone:
            try:
                import zoneinfo
                tz = zoneinfo.ZoneInfo(timezone)
                now = datetime.datetime.now(tz)
            except Exception:
                now = datetime.datetime.now()
        else:
            now = datetime.datetime.now()

        return {
            "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
            "date": now.strftime("%A, %B %d, %Y"),
            "time": now.strftime("%I:%M %p"),
            "time_24h": now.strftime("%H:%M:%S"),
            "day_of_week": now.strftime("%A"),
            "week_of_year": now.isocalendar()[1],
            "timezone": str(now.tzinfo) if now.tzinfo else "local"
        }
    except Exception as e:
        return {"error": str(e)}


def clipboard_read() -> dict:
    if not CLIPBOARD_AVAILABLE:
        return {"error": "pyperclip not installed. Run: pip install pyperclip"}
    try:
        content = pyperclip.paste()
        return {"content": content, "length": len(content)}
    except Exception as e:
        return {"error": str(e)}


def clipboard_write(text: str) -> dict:
    if not CLIPBOARD_AVAILABLE:
        return {"error": "pyperclip not installed."}
    try:
        pyperclip.copy(text)
        return {"success": True, "copied_length": len(text)}
    except Exception as e:
        return {"error": str(e)}


NOTES_FILE = Path.home() / ".jarvis_notes.json"

def save_note(title: str, content: str) -> dict:
    try:
        notes = {}
        if NOTES_FILE.exists():
            notes = json.loads(NOTES_FILE.read_text())

        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        notes[title] = {"content": content, "saved_at": timestamp}
        NOTES_FILE.write_text(json.dumps(notes, indent=2))

        return {"success": True, "title": title, "saved_at": timestamp}
    except Exception as e:
        return {"error": str(e)}


def read_notes() -> dict:
    try:
        if not NOTES_FILE.exists():
            return {"notes": {}, "count": 0, "message": "No notes saved yet."}

        notes = json.loads(NOTES_FILE.read_text())
        return {"notes": notes, "count": len(notes)}
    except Exception as e:
        return {"error": str(e)}


# Active timers storage
_active_timers: list = []

def set_timer(seconds: int, label: str = "Timer") -> dict:
    import threading

    def _timer_callback(secs, lbl, trigger_time):
        time.sleep(secs)
        elapsed = datetime.datetime.now().strftime("%H:%M:%S")
        # Print alert (the main loop will pick this up visually)
        print(f"\n\n🔔 ⏰ TIMER ALERT: '{lbl}' — {secs}s elapsed! (at {elapsed})\n")
        try:
            # Try system notification
            if platform.system() == "Linux":
                subprocess.run(
                    ["notify-send", f"JARVIS Timer", f"'{lbl}' — {secs}s done!"],
                    capture_output=True
                )
            elif platform.system() == "Darwin":
                subprocess.run(
                    ["osascript", "-e", f'display notification "{lbl} done!" with title "JARVIS Timer"'],
                    capture_output=True
                )
        except Exception:
            pass

    t = threading.Thread(
        target=_timer_callback,
        args=(seconds, label, time.time() + seconds),
        daemon=True
    )
    t.start()
    _active_timers.append({"label": label, "seconds": seconds, "started_at": time.time()})

    end_time = datetime.datetime.now() + datetime.timedelta(seconds=seconds)
    return {
        "success": True,
        "label": label,
        "duration_seconds": seconds,
        "will_fire_at": end_time.strftime("%H:%M:%S")
    }


def open_application(target: str) -> dict:
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["open", target])
        elif system == "Windows":
            os.startfile(target)
        else:  # Linux
            subprocess.Popen(["xdg-open", target])

        return {"success": True, "opened": target, "system": system}
    except Exception as e:
        return {"error": str(e), "target": target}


# ──────────────────── Knowledge Base tool definitions ────────────────────────

KB_TOOL_DEFINITIONS = [
    {
        "name": "kb_store",
        "description": (
            "Store a piece of information in the persistent knowledge base. "
            "Use this to remember company info, product prices, FAQs, contact details, "
            "policies, or ANY data the user wants JARVIS to remember and use for replies. "
            "Example: store('products', 'iPhone 15 price', '$999'), "
            "store('company', 'business hours', 'Mon-Fri 9am-6pm')"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Category/topic (e.g. 'products', 'company', 'faq', 'contacts', 'pricing')"
                },
                "key": {
                    "type": "string",
                    "description": "The label/name for this info (e.g. 'iPhone 15 price')"
                },
                "value": {
                    "type": "string",
                    "description": "The actual information/value to store"
                },
                "tags": {
                    "type": "string",
                    "description": "Optional comma-separated tags for better search (e.g. 'price,apple,phone')"
                }
            },
            "required": ["category", "key", "value"]
        }
    },
    {
        "name": "kb_search",
        "description": (
            "Search the knowledge base for information matching a query. "
            "Use this to look up stored data before answering questions. "
            "ALWAYS search the KB when someone asks about prices, products, policies, or company info."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query (e.g. 'iPhone price', 'return policy', 'opening hours')"
                },
                "category": {
                    "type": "string",
                    "description": "Optional: filter by category"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results to return (default: 10)"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "kb_list",
        "description": "List all knowledge base entries, optionally filtered by category.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Optional: filter by category"
                }
            },
            "required": []
        }
    },
    {
        "name": "kb_delete",
        "description": "Delete a specific entry from the knowledge base.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Category of the entry"},
                "key": {"type": "string", "description": "Key of the entry to delete"}
            },
            "required": ["category", "key"]
        }
    },
    {
        "name": "kb_bulk_store",
        "description": (
            "Store multiple knowledge base entries at once from a list. "
            "Useful for loading a product catalog, FAQ sheet, or contact list."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entries": {
                    "type": "array",
                    "description": "Array of {category, key, value, tags?} objects",
                    "items": {
                        "type": "object",
                        "properties": {
                            "category": {"type": "string"},
                            "key": {"type": "string"},
                            "value": {"type": "string"},
                            "tags": {"type": "string"}
                        },
                        "required": ["category", "key", "value"]
                    }
                }
            },
            "required": ["entries"]
        }
    }
]

# ──────────────────── Messaging tool definitions ─────────────────────────────

MESSAGING_TOOL_DEFINITIONS = [
    # ── WhatsApp ──
    {
        "name": "whatsapp_connect",
        "description": (
            "Connect to WhatsApp Web. Opens a browser window — "
            "scan the QR code with your phone on first use. "
            "Session is saved so subsequent calls don't need QR."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "headless": {
                    "type": "boolean",
                    "description": "Run browser in background (headless). Default false so you can see the QR code.",
                    "default": False
                }
            },
            "required": []
        }
    },
    {
        "name": "whatsapp_get_messages",
        "description": (
            "Get unread WhatsApp messages from all chats. "
            "Returns contact names and their recent messages."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max number of unread chats to fetch (default: 10)"
                }
            },
            "required": []
        }
    },
    {
        "name": "whatsapp_send",
        "description": "Send a WhatsApp message to a specific contact.",
        "input_schema": {
            "type": "object",
            "properties": {
                "contact": {
                    "type": "string",
                    "description": "Contact name exactly as it appears in WhatsApp"
                },
                "message": {
                    "type": "string",
                    "description": "The message to send"
                }
            },
            "required": ["contact", "message"]
        }
    },
    # ── Gmail ──
    {
        "name": "gmail_get_unread",
        "description": (
            "Get unread emails from Gmail inbox. "
            "Returns sender, subject, and body of each email."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max emails to fetch (default: 10)"
                }
            },
            "required": []
        }
    },
    {
        "name": "gmail_reply",
        "description": "Reply to a Gmail email by its UID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "uid": {
                    "type": "string",
                    "description": "Email UID (from gmail_get_unread result)"
                },
                "body": {
                    "type": "string",
                    "description": "Reply message body"
                }
            },
            "required": ["uid", "body"]
        }
    },
    {
        "name": "gmail_send",
        "description": "Send a new email via Gmail.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {
                    "type": "string",
                    "description": "Recipient email address"
                },
                "subject": {
                    "type": "string",
                    "description": "Email subject"
                },
                "body": {
                    "type": "string",
                    "description": "Email body text"
                }
            },
            "required": ["to", "subject", "body"]
        }
    },
    {
        "name": "gmail_search",
        "description": "Search Gmail for emails matching a query (by subject or sender).",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search term (subject or sender name/email)"
                },
                "limit": {"type": "integer", "description": "Max results (default: 10)"}
            },
            "required": ["query"]
        }
    },
    # ── Facebook ──
    {
        "name": "facebook_connect",
        "description": (
            "Connect to Facebook. Opens a browser window and logs in. "
            "Requires FB_EMAIL and FB_PASSWORD in .env file."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "headless": {
                    "type": "boolean",
                    "description": "Run in background. Default false.",
                    "default": False
                }
            },
            "required": []
        }
    },
    {
        "name": "facebook_post",
        "description": "Create a new post on your Facebook timeline.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Post content"
                },
                "url": {
                    "type": "string",
                    "description": "Optional URL to include in the post"
                }
            },
            "required": ["text"]
        }
    },
    {
        "name": "facebook_comment",
        "description": "Post a comment on a specific Facebook post.",
        "input_schema": {
            "type": "object",
            "properties": {
                "post_url": {
                    "type": "string",
                    "description": "Full URL of the Facebook post to comment on"
                },
                "comment": {
                    "type": "string",
                    "description": "Comment text"
                }
            },
            "required": ["post_url", "comment"]
        }
    },
    # ── Auto-reply ──
    {
        "name": "start_auto_reply",
        "description": (
            "Start background auto-reply monitoring for WhatsApp and/or Gmail. "
            "JARVIS will check for new messages every N seconds and reply using "
            "knowledge base data. Perfect for handling customer queries automatically."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "platforms": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["whatsapp", "gmail"]},
                    "description": "Which platforms to monitor"
                },
                "check_interval": {
                    "type": "integer",
                    "description": "Seconds between checks (default: 30)"
                }
            },
            "required": ["platforms"]
        }
    },
    {
        "name": "stop_auto_reply",
        "description": "Stop the auto-reply monitor.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "get_auto_reply_log",
        "description": "View recent auto-reply activity log.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of log entries (default: 20)"}
            },
            "required": []
        }
    }
]

# Combine all tool definitions
TOOL_DEFINITIONS = (
    TOOL_DEFINITIONS
    + KB_TOOL_DEFINITIONS
    + MESSAGING_TOOL_DEFINITIONS
)

# ──────────────────── KB tool implementations ─────────────────────────────

def kb_store(category: str, key: str, value: str, tags: str = "") -> dict:
    from memory_db import get_kb
    return get_kb().store(category, key, value, tags)

def kb_search(query: str, category: str = None, limit: int = 10) -> dict:
    from memory_db import get_kb
    return get_kb().search(query, category, limit)

def kb_list(category: str = None) -> dict:
    from memory_db import get_kb
    return get_kb().list_all(category)

def kb_delete(category: str, key: str) -> dict:
    from memory_db import get_kb
    return get_kb().delete(category, key)

def kb_bulk_store(entries: list) -> dict:
    from memory_db import get_kb
    return get_kb().bulk_store(entries)

# ──────────────────── Messaging implementations ───────────────────────────

def whatsapp_connect(headless: bool = False) -> dict:
    try:
        from integrations.whatsapp import init_whatsapp
        return init_whatsapp(headless=headless)
    except ImportError as e:
        return {"error": str(e)}

def whatsapp_get_messages(limit: int = 10) -> dict:
    try:
        from integrations.whatsapp import get_whatsapp_client
        wa = get_whatsapp_client()
        if not wa:
            return {"error": "WhatsApp not connected. Call whatsapp_connect first."}
        return wa.get_unread_messages(limit=limit)
    except Exception as e:
        return {"error": str(e)}

def whatsapp_send(contact: str, message: str) -> dict:
    try:
        from integrations.whatsapp import get_whatsapp_client
        wa = get_whatsapp_client()
        if not wa:
            return {"error": "WhatsApp not connected. Call whatsapp_connect first."}
        return wa.send_message(contact, message)
    except Exception as e:
        return {"error": str(e)}

def gmail_get_unread(limit: int = 10) -> dict:
    try:
        from integrations.gmail import get_gmail_client
        return get_gmail_client().get_unread(limit=limit)
    except Exception as e:
        return {"error": str(e)}

def gmail_reply(uid: str, body: str) -> dict:
    try:
        from integrations.gmail import get_gmail_client
        return get_gmail_client().reply_to_email(uid=uid, body=body)
    except Exception as e:
        return {"error": str(e)}

def gmail_send(to: str, subject: str, body: str) -> dict:
    try:
        from integrations.gmail import get_gmail_client
        return get_gmail_client().send_email(to=to, subject=subject, body=body)
    except Exception as e:
        return {"error": str(e)}

def gmail_search(query: str, limit: int = 10) -> dict:
    try:
        from integrations.gmail import get_gmail_client
        return get_gmail_client().search_emails(query=query, limit=limit)
    except Exception as e:
        return {"error": str(e)}

def facebook_connect(headless: bool = False) -> dict:
    try:
        from integrations.facebook import init_facebook
        return init_facebook(headless=headless)
    except ImportError as e:
        return {"error": str(e)}

def facebook_post(text: str, url: str = None) -> dict:
    try:
        from integrations.facebook import get_facebook_client
        fb = get_facebook_client()
        if not fb:
            return {"error": "Facebook not connected. Call facebook_connect first."}
        return fb.create_post(text=text, url=url)
    except Exception as e:
        return {"error": str(e)}

def facebook_comment(post_url: str, comment: str) -> dict:
    try:
        from integrations.facebook import get_facebook_client
        fb = get_facebook_client()
        if not fb:
            return {"error": "Facebook not connected. Call facebook_connect first."}
        return fb.comment_on_post(post_url=post_url, comment_text=comment)
    except Exception as e:
        return {"error": str(e)}

# Global monitor instance
_monitor = None

def start_auto_reply(platforms: list, check_interval: int = 30) -> dict:
    global _monitor
    try:
        from integrations.monitor import AutoReplyMonitor
        from memory_db import get_kb
        # Import agent lazily to avoid circular import
        import sys
        agent = None
        # Try to get the running agent from main module
        main_mod = sys.modules.get("__main__")
        if main_mod and hasattr(main_mod, "jarvis") and hasattr(main_mod.jarvis, "agent"):
            agent = main_mod.jarvis.agent

        if not agent:
            return {"error": "Could not access JARVIS agent for reply generation. Run from main.py."}

        _monitor = AutoReplyMonitor(agent=agent, kb=get_kb(), check_interval=check_interval)
        return _monitor.start(platforms=platforms)
    except Exception as e:
        return {"error": str(e)}

def stop_auto_reply() -> dict:
    global _monitor
    if not _monitor:
        return {"error": "Auto-reply monitor is not running"}
    result = _monitor.stop()
    _monitor = None
    return result

def get_auto_reply_log(limit: int = 20) -> dict:
    global _monitor
    if not _monitor:
        return {"log": [], "message": "Auto-reply monitor not running"}
    return _monitor.get_reply_log(limit=limit)


# ─────────────────────────── Dispatcher ─────────────────────────────────────

def execute_tool(tool_name: str, tool_input: dict) -> Any:
    """Dispatch tool calls to their implementations."""
    handlers = {
        # Original tools
        "web_search": lambda i: web_search(i["query"], i.get("max_results", 5)),
        "web_fetch": lambda i: web_fetch(i["url"]),
        "run_command": lambda i: run_command(i["command"], i.get("timeout", 30)),
        "read_file": lambda i: read_file(i["path"]),
        "write_file": lambda i: write_file(i["path"], i["content"], i.get("append", False)),
        "list_directory": lambda i: list_directory(i.get("path", ".")),
        "get_system_info": lambda i: get_system_info(i.get("category", "all")),
        "calculate": lambda i: calculate(i["expression"]),
        "get_datetime": lambda i: get_datetime(i.get("timezone")),
        "clipboard_read": lambda i: clipboard_read(),
        "clipboard_write": lambda i: clipboard_write(i["text"]),
        "save_note": lambda i: save_note(i["title"], i["content"]),
        "read_notes": lambda i: read_notes(),
        "set_timer": lambda i: set_timer(i["seconds"], i.get("label", "Timer")),
        "open_application": lambda i: open_application(i["target"]),
        # Knowledge base
        "kb_store": lambda i: kb_store(i["category"], i["key"], i["value"], i.get("tags", "")),
        "kb_search": lambda i: kb_search(i["query"], i.get("category"), i.get("limit", 10)),
        "kb_list": lambda i: kb_list(i.get("category")),
        "kb_delete": lambda i: kb_delete(i["category"], i["key"]),
        "kb_bulk_store": lambda i: kb_bulk_store(i["entries"]),
        # WhatsApp
        "whatsapp_connect": lambda i: whatsapp_connect(i.get("headless", False)),
        "whatsapp_get_messages": lambda i: whatsapp_get_messages(i.get("limit", 10)),
        "whatsapp_send": lambda i: whatsapp_send(i["contact"], i["message"]),
        # Gmail
        "gmail_get_unread": lambda i: gmail_get_unread(i.get("limit", 10)),
        "gmail_reply": lambda i: gmail_reply(i["uid"], i["body"]),
        "gmail_send": lambda i: gmail_send(i["to"], i["subject"], i["body"]),
        "gmail_search": lambda i: gmail_search(i["query"], i.get("limit", 10)),
        # Facebook
        "facebook_connect": lambda i: facebook_connect(i.get("headless", False)),
        "facebook_post": lambda i: facebook_post(i["text"], i.get("url")),
        "facebook_comment": lambda i: facebook_comment(i["post_url"], i["comment"]),
        # Auto-reply
        "start_auto_reply": lambda i: start_auto_reply(i["platforms"], i.get("check_interval", 30)),
        "stop_auto_reply": lambda i: stop_auto_reply(),
        "get_auto_reply_log": lambda i: get_auto_reply_log(i.get("limit", 20)),
    }

    handler = handlers.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}"}

    try:
        result = handler(tool_input)
        return result
    except Exception as e:
        return {"error": f"Tool '{tool_name}' failed: {e}"}
