"""
WhatsApp Integration via WhatsApp Web (Selenium).
Handles: read unread messages, send messages, reply to conversations.

First run: Shows QR code in browser — scan with your phone once.
Subsequent runs: Session is saved, no QR needed.
"""

import os
import time
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Selenium imports — graceful if not installed
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.firefox.options import Options as FirefoxOptions
    from selenium.common.exceptions import (
        TimeoutException, NoSuchElementException, StaleElementReferenceException
    )
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

WA_PROFILE_DIR = Path.home() / ".jarvis_whatsapp_session"
WA_URL = "https://web.whatsapp.com"

# WhatsApp Web selectors (these may change with WA updates)
SEL = {
    "qr_code":        '[data-testid="qrcode"]',
    "main_panel":     '[data-testid="default-user"]',
    "chat_list":      '[data-testid="cell-frame-container"]',
    "unread_badge":   '[data-testid="icon-unread-count"]',
    "chat_title":     '[data-testid="cell-frame-title"]',
    "search_box":     '[data-testid="search"]',
    "message_input":  '[data-testid="conversation-compose-box-input"]',
    "send_button":    '[data-testid="compose-btn-send"]',
    "msg_in":         '[data-testid="msg-container"]',
    "msg_text":       'span.selectable-text',
    "chat_header":    '[data-testid="conversation-header"]',
    "conv_header_title": '[data-testid="conversation-info-header-chat-title"]',
}


class WhatsAppClient:
    """Controls WhatsApp Web via Selenium."""

    def __init__(self, headless: bool = False):
        if not SELENIUM_AVAILABLE:
            raise ImportError("selenium not installed. Run: pip install selenium webdriver-manager")

        self.headless = headless
        self.driver: Optional[object] = None
        self._logged_in = False

    def start(self, timeout: int = 60) -> dict:
        """Launch browser and wait for WhatsApp Web login."""
        WA_PROFILE_DIR.mkdir(exist_ok=True)

        # Try Chrome first, fall back to Firefox
        try:
            self.driver = self._start_chrome()
        except Exception:
            try:
                self.driver = self._start_firefox()
            except Exception as e:
                return {"error": f"Could not start browser: {e}. Install Chrome or Firefox + webdriver."}

        self.driver.get(WA_URL)

        # Wait for either QR code (not logged in) or main panel (logged in)
        wait = WebDriverWait(self.driver, timeout)
        try:
            wait.until(lambda d:
                self._element_exists(SEL["qr_code"]) or
                self._element_exists('[data-testid="side"]')
            )
        except TimeoutException:
            return {"error": "WhatsApp Web did not load in time"}

        if self._element_exists('[data-testid="side"]'):
            self._logged_in = True
            return {"success": True, "status": "already_logged_in"}

        # QR code visible — user needs to scan
        return {
            "success": True,
            "status": "qr_code_shown",
            "message": "QR code is visible in the browser. Please scan with your WhatsApp mobile app."
        }

    def wait_for_login(self, timeout: int = 120) -> dict:
        """Wait until user scans QR and logs in."""
        if not self.driver:
            return {"error": "Browser not started. Call start() first."}

        try:
            WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '[data-testid="side"]'))
            )
            self._logged_in = True
            return {"success": True, "status": "logged_in"}
        except TimeoutException:
            return {"error": f"Login timed out after {timeout}s"}

    def get_unread_messages(self, limit: int = 10) -> dict:
        """Fetch unread chats and their messages."""
        if not self._check_logged_in():
            return {"error": "Not logged in"}

        try:
            # Find chats with unread badges
            time.sleep(1)
            unread_chats = []

            chat_cells = self.driver.find_elements(By.CSS_SELECTOR, '[data-testid="cell-frame-container"]')

            for cell in chat_cells[:50]:  # Check first 50 chats
                try:
                    # Check for unread indicator
                    has_unread = False
                    try:
                        cell.find_element(By.CSS_SELECTOR, '[data-testid="icon-unread-count"]')
                        has_unread = True
                    except NoSuchElementException:
                        pass

                    if has_unread:
                        title_el = cell.find_element(By.CSS_SELECTOR, '[data-testid="cell-frame-title"]')
                        contact_name = title_el.text.strip()

                        # Click to open chat
                        cell.click()
                        time.sleep(1.2)

                        messages = self._read_current_chat_messages(last_n=5)
                        unread_chats.append({
                            "contact": contact_name,
                            "messages": messages
                        })

                        if len(unread_chats) >= limit:
                            break

                except (StaleElementReferenceException, NoSuchElementException):
                    continue

            return {"unread_chats": unread_chats, "count": len(unread_chats)}

        except Exception as e:
            return {"error": str(e)}

    def _read_current_chat_messages(self, last_n: int = 10) -> list:
        """Read messages from the currently open chat."""
        messages = []
        try:
            msg_containers = self.driver.find_elements(
                By.CSS_SELECTOR, '[data-testid="msg-container"]'
            )[-last_n:]

            for container in msg_containers:
                try:
                    # Determine direction (in/out)
                    is_outgoing = "message-out" in container.get_attribute("class") or False
                    try:
                        text_el = container.find_element(By.CSS_SELECTOR, "span.selectable-text")
                        text = text_el.text.strip()
                    except NoSuchElementException:
                        text = "[media/non-text]"

                    # Try to get timestamp
                    timestamp = ""
                    try:
                        ts_el = container.find_element(By.CSS_SELECTOR, '[data-testid="msg-meta"]')
                        timestamp = ts_el.text.strip()
                    except NoSuchElementException:
                        pass

                    if text:
                        messages.append({
                            "direction": "sent" if is_outgoing else "received",
                            "text": text,
                            "time": timestamp
                        })
                except Exception:
                    continue

        except Exception as e:
            messages = [{"error": str(e)}]

        return messages

    def send_message(self, contact: str, message: str) -> dict:
        """Send a message to a contact (opens chat via search)."""
        if not self._check_logged_in():
            return {"error": "Not logged in"}

        try:
            # Open search and find contact
            search = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-testid="search"]'))
            )
            search.click()
            time.sleep(0.5)
            search.send_keys(contact)
            time.sleep(1.5)

            # Click first result
            results = self.driver.find_elements(
                By.CSS_SELECTOR, '[data-testid="cell-frame-container"]'
            )
            if not results:
                return {"error": f"Contact '{contact}' not found"}

            results[0].click()
            time.sleep(1)

            # Type and send message
            return self._type_and_send(message)

        except Exception as e:
            return {"error": str(e)}

    def reply_in_current_chat(self, message: str) -> dict:
        """Reply in the currently open chat."""
        if not self._check_logged_in():
            return {"error": "Not logged in"}
        return self._type_and_send(message)

    def _type_and_send(self, message: str) -> dict:
        """Type a message and hit send in current chat."""
        try:
            box = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, '[data-testid="conversation-compose-box-input"]')
                )
            )
            box.click()
            # Send multi-line by typing line by line with Shift+Enter
            lines = message.split("\n")
            for i, line in enumerate(lines):
                box.send_keys(line)
                if i < len(lines) - 1:
                    box.send_keys(Keys.SHIFT + Keys.ENTER)

            box.send_keys(Keys.ENTER)
            time.sleep(0.8)

            return {"success": True, "sent": message[:100] + ("..." if len(message) > 100 else "")}

        except Exception as e:
            return {"error": str(e)}

    def _start_chrome(self):
        opts = ChromeOptions()
        opts.add_argument(f"--user-data-dir={WA_PROFILE_DIR}")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        if self.headless:
            opts.add_argument("--headless=new")
            opts.add_argument("--window-size=1920,1080")

        try:
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager
            service = Service(ChromeDriverManager().install())
            return webdriver.Chrome(service=service, options=opts)
        except Exception:
            return webdriver.Chrome(options=opts)

    def _start_firefox(self):
        opts = FirefoxOptions()
        opts.set_preference("profile", str(WA_PROFILE_DIR))
        if self.headless:
            opts.add_argument("--headless")

        try:
            from selenium.webdriver.firefox.service import Service
            from webdriver_manager.firefox import GeckoDriverManager
            service = Service(GeckoDriverManager().install())
            return webdriver.Firefox(service=service, options=opts)
        except Exception:
            return webdriver.Firefox(options=opts)

    def _element_exists(self, selector: str) -> bool:
        try:
            self.driver.find_element(By.CSS_SELECTOR, selector)
            return True
        except NoSuchElementException:
            return False

    def _check_logged_in(self) -> bool:
        if not self.driver:
            return False
        return self._element_exists('[data-testid="side"]')

    def close(self):
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None
            self._logged_in = False


# ──────────────────────── Singleton management ───────────────────────────

_wa_client: Optional[WhatsAppClient] = None

def get_whatsapp_client() -> Optional[WhatsAppClient]:
    return _wa_client

def init_whatsapp(headless: bool = False) -> dict:
    global _wa_client
    if _wa_client and _wa_client._check_logged_in():
        return {"success": True, "status": "already_running"}

    _wa_client = WhatsAppClient(headless=headless)
    result = _wa_client.start()
    return result

def close_whatsapp():
    global _wa_client
    if _wa_client:
        _wa_client.close()
        _wa_client = None
