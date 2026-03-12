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


# ─────────────────────────── Dispatcher ─────────────────────────────────────

def execute_tool(tool_name: str, tool_input: dict) -> Any:
    """Dispatch tool calls to their implementations."""
    handlers = {
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
    }

    handler = handlers.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}"}

    try:
        result = handler(tool_input)
        return result
    except Exception as e:
        return {"error": f"Tool '{tool_name}' failed: {e}"}
