"""
Facebook Integration via Selenium.
Handles: post to timeline, comment on posts, read notifications.

Uses saved session so login is only required once.
Set FB_EMAIL and FB_PASSWORD in .env (or they'll be prompted).
"""

import os
import time
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.common.exceptions import (
        TimeoutException, NoSuchElementException, StaleElementReferenceException
    )
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

FB_PROFILE_DIR = Path.home() / ".jarvis_facebook_session"
FB_URL = "https://www.facebook.com"

# Facebook selectors (may change with FB updates)
SEL = {
    "email_input":        '#email',
    "pass_input":         '#pass',
    "login_button":       '[name="login"]',
    "compose_box":        '[data-testid="status-attachment-mentions-input"]',
    "post_button":        '[data-testid="react-composer-post-button"]',
    "whats_on_mind":      '[data-pagelet="FeedComposer"]',
    "comment_input":      'div[aria-label="Write a comment…"]',
    "comment_button":     '[aria-label="Comment"]',
    "notification_bell":  '[aria-label="Notifications"]',
}


class FacebookClient:
    """Controls Facebook via Selenium browser automation."""

    def __init__(self, headless: bool = False):
        if not SELENIUM_AVAILABLE:
            raise ImportError("selenium not installed. Run: pip install selenium webdriver-manager")

        self.headless = headless
        self.driver: Optional[object] = None
        self._logged_in = False
        self.email = os.environ.get("FB_EMAIL", "")
        self.password = os.environ.get("FB_PASSWORD", "")

    def start(self) -> dict:
        """Launch browser and navigate to Facebook."""
        FB_PROFILE_DIR.mkdir(exist_ok=True)

        try:
            self.driver = self._start_chrome()
        except Exception:
            try:
                self.driver = self._start_firefox()
            except Exception as e:
                return {"error": f"Could not start browser: {e}"}

        self.driver.get(FB_URL)
        time.sleep(3)

        # Check if already logged in (session saved)
        if self._is_logged_in():
            self._logged_in = True
            return {"success": True, "status": "already_logged_in"}

        # Need to log in
        if not self.email or not self.password:
            return {
                "success": False,
                "status": "credentials_needed",
                "message": "Set FB_EMAIL and FB_PASSWORD in .env to enable Facebook automation"
            }

        return self._do_login()

    def _do_login(self) -> dict:
        """Perform Facebook login."""
        try:
            wait = WebDriverWait(self.driver, 15)

            email_field = wait.until(EC.presence_of_element_located((By.ID, "email")))
            email_field.clear()
            email_field.send_keys(self.email)

            pass_field = self.driver.find_element(By.ID, "pass")
            pass_field.clear()
            pass_field.send_keys(self.password)

            self.driver.find_element(By.NAME, "login").click()
            time.sleep(4)

            if self._is_logged_in():
                self._logged_in = True
                return {"success": True, "status": "logged_in"}
            else:
                return {
                    "success": False,
                    "status": "login_failed",
                    "message": "Login may have failed. Check credentials or 2FA prompt in browser."
                }

        except Exception as e:
            return {"error": str(e)}

    def _is_logged_in(self) -> bool:
        """Check if user is currently logged in."""
        try:
            # Look for home feed indicators
            indicators = [
                '[aria-label="Facebook"]',
                '[data-pagelet="LeftRail"]',
                'div[role="navigation"]'
            ]
            for sel in indicators:
                try:
                    self.driver.find_element(By.CSS_SELECTOR, sel)
                    return True
                except NoSuchElementException:
                    continue
            return False
        except Exception:
            return False

    def create_post(self, text: str, url: str = None) -> dict:
        """Create a new Facebook post."""
        if not self._check_session():
            return {"error": "Not logged in to Facebook"}

        try:
            # Navigate to home/feed
            self.driver.get("https://www.facebook.com/")
            time.sleep(2)

            wait = WebDriverWait(self.driver, 15)

            # Click the "What's on your mind?" composer
            composer_selectors = [
                '[data-testid="status-attachment-mentions-input"]',
                'div[role="textbox"][data-lexical-editor="true"]',
                'span[data-offset-key]',
                '[aria-label="What\'s on your mind"]',
                '[placeholder="What\'s on your mind"]',
            ]

            clicked = False
            for sel in composer_selectors:
                try:
                    el = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, sel)))
                    el.click()
                    clicked = True
                    break
                except TimeoutException:
                    continue

            if not clicked:
                # Try clicking the composer area by text
                try:
                    el = self.driver.find_element(
                        By.XPATH, '//*[contains(text(), "What\'s on your mind")]'
                    )
                    el.click()
                    time.sleep(1)
                except Exception:
                    return {"error": "Could not find post composer. Facebook may have updated their UI."}

            time.sleep(1.5)

            # Type the post content
            active = self.driver.switch_to.active_element
            active.send_keys(text)
            if url:
                active.send_keys(f"\n{url}")
            time.sleep(1)

            # Click Post button
            post_btn_selectors = [
                '[data-testid="react-composer-post-button"]',
                'div[aria-label="Post"]',
                'button[aria-label="Post"]',
            ]

            posted = False
            for sel in post_btn_selectors:
                try:
                    btn = WebDriverWait(self.driver, 8).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, sel))
                    )
                    btn.click()
                    posted = True
                    break
                except TimeoutException:
                    continue

            if not posted:
                # Try submit by CTRL+ENTER
                active.send_keys(Keys.CONTROL + Keys.ENTER)

            time.sleep(2)
            return {"success": True, "posted": text[:100] + ("..." if len(text) > 100 else "")}

        except Exception as e:
            return {"error": str(e)}

    def comment_on_post(self, post_url: str, comment_text: str) -> dict:
        """Comment on a specific Facebook post by URL."""
        if not self._check_session():
            return {"error": "Not logged in to Facebook"}

        try:
            self.driver.get(post_url)
            time.sleep(3)

            wait = WebDriverWait(self.driver, 15)

            # Find comment input
            comment_selectors = [
                'div[aria-label="Write a comment…"]',
                'div[aria-label="Write a comment"]',
                'div[data-lexical-editor="true"]',
            ]

            clicked = False
            for sel in comment_selectors:
                try:
                    el = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, sel)))
                    el.click()
                    clicked = True
                    break
                except TimeoutException:
                    continue

            if not clicked:
                return {"error": "Could not find comment input. Post URL may be incorrect."}

            time.sleep(0.8)
            active = self.driver.switch_to.active_element
            active.send_keys(comment_text)
            time.sleep(0.5)
            active.send_keys(Keys.ENTER)
            time.sleep(1.5)

            return {
                "success": True,
                "commented": comment_text[:100],
                "post_url": post_url
            }

        except Exception as e:
            return {"error": str(e)}

    def get_notifications(self, limit: int = 5) -> dict:
        """Read recent Facebook notifications."""
        if not self._check_session():
            return {"error": "Not logged in to Facebook"}

        try:
            self.driver.get("https://www.facebook.com/notifications")
            time.sleep(3)

            notif_items = self.driver.find_elements(
                By.CSS_SELECTOR, '[data-testid="notif_list_item"]'
            )[:limit]

            notifications = []
            for item in notif_items:
                try:
                    text = item.text.strip()
                    if text:
                        notifications.append({"text": text})
                except Exception:
                    continue

            return {"notifications": notifications, "count": len(notifications)}

        except Exception as e:
            return {"error": str(e)}

    def _check_session(self) -> bool:
        """Re-verify session is still active."""
        if not self.driver:
            return False
        return self._is_logged_in()

    def _start_chrome(self):
        opts = ChromeOptions()
        opts.add_argument(f"--user-data-dir={FB_PROFILE_DIR}")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        if self.headless:
            opts.add_argument("--headless=new")
            opts.add_argument("--window-size=1920,1080")

        try:
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=opts)
        except Exception:
            driver = webdriver.Chrome(options=opts)

        # Mask automation
        driver.execute_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        return driver

    def _start_firefox(self):
        opts = FirefoxOptions()
        opts.set_preference("profile", str(FB_PROFILE_DIR))
        if self.headless:
            opts.add_argument("--headless")
        try:
            from selenium.webdriver.firefox.service import Service
            from webdriver_manager.firefox import GeckoDriverManager
            service = Service(GeckoDriverManager().install())
            return webdriver.Firefox(service=service, options=opts)
        except Exception:
            return webdriver.Firefox(options=opts)

    def close(self):
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None


# ──────────────────────── Singleton ─────────────────────────────────────

_fb_client: Optional[FacebookClient] = None

def get_facebook_client() -> Optional[FacebookClient]:
    return _fb_client

def init_facebook(headless: bool = False) -> dict:
    global _fb_client
    if _fb_client and _fb_client._check_session():
        return {"success": True, "status": "already_running"}

    _fb_client = FacebookClient(headless=headless)
    result = _fb_client.start()
    return result

def close_facebook():
    global _fb_client
    if _fb_client:
        _fb_client.close()
        _fb_client = None
