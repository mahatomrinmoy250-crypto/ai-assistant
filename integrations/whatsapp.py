"""
WhatsApp Integration — Persistent Session + Continuous Auto-Reply.

Flow:
  1. whatsapp_start_monitor() — opens browser
  2. If first time: QR shown → user scans once with phone
  3. Session saved to disk → next time no QR needed, auto-login
  4. Background thread polls every N seconds for new messages
  5. For each new message: searches KB + generates reply with Claude → sends
  6. Tracks replied messages (persisted to disk) → no duplicate replies

Session stored at: ~/.jarvis_whatsapp_session/  (Chrome profile)
Replied log at:    ~/.jarvis_replied.json
"""

import os
import sys
import time
import json
import hashlib
import logging
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, Callable

logger = logging.getLogger(__name__)

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.common.exceptions import (
        TimeoutException, NoSuchElementException,
        StaleElementReferenceException, WebDriverException
    )
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

# ─── Paths ───────────────────────────────────────────────────────────────────
WA_SESSION_DIR  = Path.home() / ".jarvis_whatsapp_session"
WA_REPLIED_FILE = Path.home() / ".jarvis_wa_replied.json"
WA_URL          = "https://web.whatsapp.com"

# ─── WhatsApp Web CSS selectors (multiple fallbacks per element) ──────────────
# WhatsApp frequently changes class names, so we keep ordered fallback lists.
SEL_SIDE_PANEL   = ['[data-testid="side"]', '#side', 'div[id="side"]']
SEL_QR           = ['[data-testid="qrcode"]', 'canvas[aria-label="Scan me!"]', 'div[data-ref]']
SEL_CHAT_CELLS   = [
    '[data-testid="cell-frame-container"]',
    'div[role="listitem"]',
    '._ak72',
]
SEL_UNREAD_BADGE = [
    '[data-testid="icon-unread-count"]',
    'span[data-testid="icon-unread-count"]',
    '._ahlk',
]
SEL_CHAT_TITLE   = [
    '[data-testid="cell-frame-title"]',
    'span[title]',
    '._ao3e',
]
SEL_MSG_INPUT    = [
    '[data-testid="conversation-compose-box-input"]',
    'div[contenteditable="true"][data-tab]',
    'footer div[contenteditable="true"]',
]
SEL_MSG_BODY     = [
    'span.selectable-text.copyable-text',
    'span.selectable-text',
    'div.copyable-text span',
]
SEL_MSG_ROW      = [
    '[data-testid="msg-container"]',
    'div.message-in',
    'div[class*="message-"]',
]
SEL_SEARCH       = [
    '[data-testid="search"]',
    'div[data-testid="search-input"]',
    'div[title="Search input textbox"]',
]


def _find_first(driver, selectors: list):
    """Try a list of CSS selectors, return first element found."""
    for sel in selectors:
        try:
            el = driver.find_element(By.CSS_SELECTOR, sel)
            if el:
                return el
        except NoSuchElementException:
            continue
    return None


def _find_all_first(driver, selectors: list):
    """Try a list of CSS selectors, return all elements from first match."""
    for sel in selectors:
        try:
            els = driver.find_elements(By.CSS_SELECTOR, sel)
            if els:
                return els
        except Exception:
            continue
    return []


def _msg_hash(contact: str, text: str) -> str:
    """Create a unique fingerprint for a contact+message combo."""
    return hashlib.md5(f"{contact}::{text}".encode()).hexdigest()[:16]


# ─── Replied-messages tracker (persisted to disk) ─────────────────────────────

class RepliedTracker:
    """Persists the set of message fingerprints we've already replied to."""

    def __init__(self, path: Path = WA_REPLIED_FILE):
        self.path = path
        self._seen: set = self._load()

    def _load(self) -> set:
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text())
                return set(data.get("replied", []))
            except Exception:
                return set()
        return set()

    def _save(self):
        try:
            self.path.write_text(json.dumps({"replied": list(self._seen)}, indent=2))
        except Exception as e:
            logger.warning(f"Could not save replied log: {e}")

    def has_replied(self, contact: str, msg_text: str) -> bool:
        return _msg_hash(contact, msg_text) in self._seen

    def mark_replied(self, contact: str, msg_text: str):
        self._seen.add(_msg_hash(contact, msg_text))
        # Keep only last 2000 entries to prevent unbounded growth
        if len(self._seen) > 2000:
            self._seen = set(list(self._seen)[-1500:])
        self._save()


# ─── Core WhatsApp client ─────────────────────────────────────────────────────

class WhatsAppClient:
    """
    Controls WhatsApp Web via Selenium.
    Handles session persistence, QR login, and message operations.
    """

    def __init__(self, headless: bool = False):
        if not SELENIUM_AVAILABLE:
            raise ImportError(
                "selenium not installed.\n"
                "Run: pip install selenium webdriver-manager"
            )
        self.headless = headless
        self.driver: Optional[object] = None

    # ── Connection ────────────────────────────────────────────────────────

    def connect(self, qr_wait_secs: int = 120) -> dict:
        """
        Launch browser, open WhatsApp Web.
        Returns immediately if already logged in (session restored).
        If QR needed, waits up to qr_wait_secs for scan.
        """
        WA_SESSION_DIR.mkdir(parents=True, exist_ok=True)

        # Start browser
        try:
            self.driver = self._launch_chrome()
        except Exception as chrome_err:
            try:
                self.driver = self._launch_firefox()
            except Exception as ff_err:
                return {"error": f"Could not start browser. Chrome: {chrome_err} | Firefox: {ff_err}"}

        self.driver.get(WA_URL)

        # Wait until either QR or main UI appears
        try:
            WebDriverWait(self.driver, 30).until(
                lambda d: self._any_exists(SEL_SIDE_PANEL) or self._any_exists(SEL_QR)
            )
        except TimeoutException:
            return {"error": "WhatsApp Web did not load in 30 seconds. Check internet connection."}

        # Already logged in?
        if self._any_exists(SEL_SIDE_PANEL):
            return {"success": True, "status": "session_restored", "message": "Already logged in — no QR needed."}

        # QR code shown — wait for user to scan
        print("\n" + "="*60)
        print("📱 WHATSAPP QR CODE IS VISIBLE IN THE BROWSER WINDOW")
        print("   Open WhatsApp on your phone:")
        print("   Settings → Linked Devices → Link a Device → Scan QR")
        print(f"   Waiting up to {qr_wait_secs} seconds...")
        print("="*60 + "\n")

        try:
            WebDriverWait(self.driver, qr_wait_secs).until(
                lambda d: self._any_exists(SEL_SIDE_PANEL)
            )
        except TimeoutException:
            return {"error": f"QR not scanned within {qr_wait_secs}s. Try again."}

        # Give WhatsApp a moment to finish loading chats
        time.sleep(3)
        return {
            "success": True,
            "status": "qr_scanned",
            "message": "QR scanned! Session saved. You won't need to scan again."
        }

    def is_connected(self) -> bool:
        if not self.driver:
            return False
        try:
            return self._any_exists(SEL_SIDE_PANEL)
        except WebDriverException:
            return False

    # ── Read unread chats ─────────────────────────────────────────────────

    def get_unread_chats(self, limit: int = 20) -> list:
        """
        Scan chat list for unread badges.
        Returns list of dicts: {contact, last_message, chat_element_index}
        Does NOT click any chat (non-destructive scan).
        """
        if not self.is_connected():
            return []

        try:
            time.sleep(0.5)
            cells = _find_all_first(self.driver, SEL_CHAT_CELLS)
            unread = []

            for idx, cell in enumerate(cells[:60]):
                try:
                    # Check unread badge
                    has_badge = False
                    for sel in SEL_UNREAD_BADGE:
                        try:
                            cell.find_element(By.CSS_SELECTOR, sel)
                            has_badge = True
                            break
                        except NoSuchElementException:
                            pass

                    if not has_badge:
                        continue

                    # Get contact name
                    contact = ""
                    for sel in SEL_CHAT_TITLE:
                        try:
                            el = cell.find_element(By.CSS_SELECTOR, sel)
                            contact = (el.get_attribute("title") or el.text or "").strip()
                            if contact:
                                break
                        except NoSuchElementException:
                            pass

                    if not contact:
                        contact = f"Contact_{idx}"

                    # Get preview text (snippet shown in chat list)
                    preview = ""
                    try:
                        # Last message preview in the list item
                        spans = cell.find_elements(By.CSS_SELECTOR, "span.selectable-text")
                        if spans:
                            preview = spans[-1].text.strip()
                    except Exception:
                        pass

                    unread.append({
                        "contact": contact,
                        "preview": preview,
                        "cell_index": idx
                    })

                    if len(unread) >= limit:
                        break

                except (StaleElementReferenceException, NoSuchElementException):
                    continue

            return unread

        except Exception as e:
            logger.error(f"get_unread_chats error: {e}")
            return []

    def open_chat_and_get_messages(self, cell_index: int, last_n: int = 8) -> list:
        """
        Open a chat by its position in the sidebar and read the last N messages.
        Returns list of {direction, text, time}.
        """
        if not self.is_connected():
            return []
        try:
            cells = _find_all_first(self.driver, SEL_CHAT_CELLS)
            if cell_index >= len(cells):
                return []

            cells[cell_index].click()
            time.sleep(1.5)  # Let messages load

            return self._read_open_chat_messages(last_n)

        except Exception as e:
            logger.error(f"open_chat_and_get_messages error: {e}")
            return []

    def open_chat_by_name(self, contact: str) -> bool:
        """Open a chat by searching for the contact name."""
        if not self.is_connected():
            return False
        try:
            # Click search box
            search = _find_first(self.driver, SEL_SEARCH)
            if not search:
                return False

            search.click()
            time.sleep(0.4)
            search.send_keys(Keys.CONTROL + "a")
            search.send_keys(contact)
            time.sleep(1.5)

            # Click first result
            cells = _find_all_first(self.driver, SEL_CHAT_CELLS)
            if not cells:
                return False
            cells[0].click()
            time.sleep(1.2)

            # Clear search
            try:
                search.send_keys(Keys.ESCAPE)
            except Exception:
                pass

            return True
        except Exception as e:
            logger.error(f"open_chat_by_name error: {e}")
            return False

    def _read_open_chat_messages(self, last_n: int = 8) -> list:
        """Read messages from the currently visible chat."""
        messages = []
        try:
            rows = _find_all_first(self.driver, SEL_MSG_ROW)
            rows = rows[-last_n:]

            for row in rows:
                try:
                    # Direction: incoming = no 'message-out' in class
                    cls = row.get_attribute("class") or ""
                    is_outgoing = "message-out" in cls

                    # Text
                    text = ""
                    for sel in SEL_MSG_BODY:
                        try:
                            el = row.find_element(By.CSS_SELECTOR, sel)
                            text = el.text.strip()
                            if text:
                                break
                        except NoSuchElementException:
                            pass

                    # Timestamp
                    ts = ""
                    try:
                        ts_el = row.find_element(By.CSS_SELECTOR, '[data-testid="msg-meta"]')
                        ts = ts_el.text.strip()
                    except NoSuchElementException:
                        pass

                    if text:
                        messages.append({
                            "direction": "sent" if is_outgoing else "received",
                            "text": text,
                            "time": ts
                        })
                except Exception:
                    continue

        except Exception as e:
            logger.error(f"_read_open_chat_messages: {e}")

        return messages

    # ── Send message ──────────────────────────────────────────────────────

    def send_reply(self, message: str) -> dict:
        """Send a message in the currently open chat."""
        if not self.is_connected():
            return {"error": "Not connected"}
        try:
            box = None
            for sel in SEL_MSG_INPUT:
                try:
                    box = WebDriverWait(self.driver, 6).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, sel))
                    )
                    if box:
                        break
                except TimeoutException:
                    continue

            if not box:
                return {"error": "Could not find message input box"}

            box.click()
            time.sleep(0.3)

            # Type message (handle newlines)
            for i, line in enumerate(message.split("\n")):
                box.send_keys(line)
                if i < message.count("\n"):
                    box.send_keys(Keys.SHIFT + Keys.ENTER)

            time.sleep(0.3)
            box.send_keys(Keys.ENTER)
            time.sleep(0.8)

            return {"success": True}

        except Exception as e:
            return {"error": str(e)}

    def send_to_contact(self, contact: str, message: str) -> dict:
        """Open a contact's chat and send a message."""
        if not self.open_chat_by_name(contact):
            return {"error": f"Could not find contact: {contact}"}
        return self.send_reply(message)

    # ── Browser launchers ─────────────────────────────────────────────────

    def _launch_chrome(self):
        opts = ChromeOptions()
        # Persistent session — same profile dir every time
        opts.add_argument(f"--user-data-dir={WA_SESSION_DIR}")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        # Disable notifications
        prefs = {"profile.default_content_setting_values.notifications": 2}
        opts.add_experimental_option("prefs", prefs)

        if self.headless:
            opts.add_argument("--headless=new")
            opts.add_argument("--window-size=1920,1080")

        try:
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager
            svc = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=svc, options=opts)
        except Exception:
            driver = webdriver.Chrome(options=opts)

        # Hide webdriver flag
        driver.execute_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        return driver

    def _launch_firefox(self):
        from selenium.webdriver.firefox.options import Options as FFOpts
        opts = FFOpts()
        if self.headless:
            opts.add_argument("--headless")
        try:
            from selenium.webdriver.firefox.service import Service
            from webdriver_manager.firefox import GeckoDriverManager
            svc = Service(GeckoDriverManager().install())
            return webdriver.Firefox(service=svc, options=opts)
        except Exception:
            return webdriver.Firefox(options=opts)

    # ── Helpers ───────────────────────────────────────────────────────────

    def _any_exists(self, selectors: list) -> bool:
        for sel in selectors:
            try:
                self.driver.find_element(By.CSS_SELECTOR, sel)
                return True
            except NoSuchElementException:
                pass
        return False

    def close(self):
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None


# ─── Continuous Auto-Reply Service ────────────────────────────────────────────

class WhatsAppAutoReplyService:
    """
    Persistent WhatsApp monitor that:
    - Connects once (QR scan saved to disk)
    - Polls every N seconds for new messages
    - Generates replies using KB + Claude
    - Sends replies automatically
    - Tracks replied messages so no duplicates

    Usage:
        service = WhatsAppAutoReplyService(reply_fn=my_fn, interval=15)
        service.start()   # non-blocking
        service.stop()
    """

    def __init__(
        self,
        reply_fn: Callable[[str, str, list], str],
        interval: int = 15,
        headless: bool = False
    ):
        """
        reply_fn(contact, message, history) -> reply_text
        Called for each new incoming message that needs a reply.
        """
        self.reply_fn = reply_fn
        self.interval = interval
        self.headless = headless

        self.client = WhatsAppClient(headless=headless)
        self.tracker = RepliedTracker()

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stats = {
            "started_at": None,
            "messages_replied": 0,
            "last_check": None,
            "last_reply_to": None,
            "errors": 0,
        }

    def connect_and_start(self) -> dict:
        """Connect to WhatsApp (QR if needed), then start monitoring."""
        # Connect / restore session
        result = self.client.connect(qr_wait_secs=120)
        if not result.get("success"):
            return result

        # Start background monitor
        self._running = True
        self._stats["started_at"] = datetime.now().isoformat()
        self._thread = threading.Thread(
            target=self._monitor_loop,
            name="WA-AutoReply",
            daemon=True
        )
        self._thread.start()

        status = result.get("status", "")
        msg = (
            "Auto-reply started! WhatsApp session restored — no QR needed."
            if status == "session_restored"
            else "QR scanned and session saved. Auto-reply is now running."
        )

        return {
            "success": True,
            "message": msg,
            "status": status,
            "interval_seconds": self.interval,
        }

    def stop(self) -> dict:
        self._running = False
        return {
            "success": True,
            "messages_replied": self._stats["messages_replied"],
            "message": "WhatsApp auto-reply stopped."
        }

    def get_stats(self) -> dict:
        return {
            **self._stats,
            "running": self._running,
            "interval_seconds": self.interval,
        }

    # ── Monitor loop (runs in background thread) ──────────────────────────

    def _monitor_loop(self):
        from rich.console import Console
        con = Console()

        con.print(f"[dim green]WA Monitor started (every {self.interval}s)[/dim green]")

        while self._running:
            try:
                self._stats["last_check"] = datetime.now().strftime("%H:%M:%S")

                if not self.client.is_connected():
                    con.print("[yellow]WA: session lost, trying to reconnect...[/yellow]")
                    result = self.client.connect(qr_wait_secs=60)
                    if not result.get("success"):
                        con.print(f"[red]WA reconnect failed: {result.get('error')}[/red]")
                        time.sleep(30)
                        continue

                # Get all unread chats
                unread = self.client.get_unread_chats(limit=20)

                for chat in unread:
                    if not self._running:
                        break

                    contact = chat["contact"]
                    preview = chat.get("preview", "")
                    cell_idx = chat["cell_index"]

                    # Open chat and read full last messages
                    msgs = self.client.open_chat_and_get_messages(cell_idx, last_n=10)

                    # Get the last incoming message
                    incoming = [m for m in msgs if m.get("direction") == "received"]
                    if not incoming:
                        continue

                    last_msg = incoming[-1]["text"]

                    # Already replied to this exact message?
                    if self.tracker.has_replied(contact, last_msg):
                        continue

                    # Skip empty or media-only messages
                    if not last_msg or last_msg in ("[media/non-text]", "[sticker]", "[image]"):
                        self.tracker.mark_replied(contact, last_msg)
                        continue

                    con.print(f"\n[bold]📩 New WA from[/bold] [cyan]{contact}[/cyan]: {last_msg[:60]}")

                    # Generate reply
                    try:
                        reply = self.reply_fn(contact, last_msg, msgs)
                    except Exception as e:
                        con.print(f"[red]Reply generation error: {e}[/red]")
                        self._stats["errors"] += 1
                        continue

                    if not reply:
                        continue

                    # Send the reply (chat is already open)
                    result = self.client.send_reply(reply)
                    if result.get("success"):
                        self.tracker.mark_replied(contact, last_msg)
                        self._stats["messages_replied"] += 1
                        self._stats["last_reply_to"] = contact
                        con.print(f"[green]✓ Replied to {contact}:[/green] {reply[:80]}")
                    else:
                        con.print(f"[red]Failed to send reply to {contact}: {result.get('error')}[/red]")
                        self._stats["errors"] += 1

            except WebDriverException as e:
                logger.error(f"WA WebDriver error: {e}")
                self._stats["errors"] += 1
                time.sleep(10)  # Brief pause before retry
            except Exception as e:
                logger.error(f"WA monitor loop error: {e}")
                self._stats["errors"] += 1

            # Wait before next check
            for _ in range(self.interval):
                if not self._running:
                    break
                time.sleep(1)

        logger.info("WA monitor loop exited")


# ─── Singletons ───────────────────────────────────────────────────────────────

_wa_client: Optional[WhatsAppClient] = None
_wa_service: Optional[WhatsAppAutoReplyService] = None


def get_whatsapp_client() -> Optional[WhatsAppClient]:
    return _wa_client


def get_whatsapp_service() -> Optional[WhatsAppAutoReplyService]:
    return _wa_service


def init_whatsapp_client(headless: bool = False) -> dict:
    """Just connect — no auto-reply. For manual send/read operations."""
    global _wa_client
    if _wa_client and _wa_client.is_connected():
        return {"success": True, "status": "already_connected"}
    _wa_client = WhatsAppClient(headless=headless)
    return _wa_client.connect()


def start_wa_autoreply(reply_fn: Callable, interval: int = 15, headless: bool = False) -> dict:
    """Connect + start continuous auto-reply service."""
    global _wa_service, _wa_client
    if _wa_service and _wa_service._running:
        return {"success": True, "status": "already_running", "stats": _wa_service.get_stats()}

    _wa_service = WhatsAppAutoReplyService(reply_fn=reply_fn, interval=interval, headless=headless)
    _wa_client = _wa_service.client  # Share the same client
    return _wa_service.connect_and_start()


def stop_wa_autoreply() -> dict:
    global _wa_service
    if not _wa_service:
        return {"error": "Auto-reply service is not running"}
    result = _wa_service.stop()
    _wa_service = None
    return result


def close_whatsapp():
    global _wa_client, _wa_service
    if _wa_service:
        _wa_service.stop()
        _wa_service = None
    if _wa_client:
        _wa_client.close()
        _wa_client = None
