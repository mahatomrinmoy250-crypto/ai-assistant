"""
Auto-Reply Monitor — manages WhatsApp + Gmail auto-reply.

WhatsApp: Uses WhatsAppAutoReplyService for persistent session + continuous polling.
Gmail:    Background thread that polls IMAP for unread emails.

Both use KB search + Claude to generate smart replies.
"""

import time
import threading
import logging
import json
from datetime import datetime
from typing import Optional, Callable

from rich.console import Console

console = Console()
logger = logging.getLogger(__name__)


# ─── Reply generator (shared by both WA and Gmail) ───────────────────────────

def make_reply_fn(agent, kb) -> Callable:
    """
    Returns a reply_fn(contact, message, history) -> str
    that searches KB and uses Claude to generate a reply.
    """

    def reply_fn(contact: str, message: str, history: list = None) -> str:
        # 1. Search KB for relevant info
        kb_results = kb.search(message, limit=8)
        kb_context = ""
        if kb_results.get("results"):
            kb_context = "\n\nRelevant info from knowledge base:\n"
            for entry in kb_results["results"]:
                kb_context += f"  [{entry['category']}] {entry['key']}: {entry['value']}\n"

        # 2. Build history text
        history_text = ""
        if history:
            recent = [m for m in history if isinstance(m, dict)][-6:]
            if recent:
                history_text = "\nRecent conversation:\n"
                for m in recent:
                    who = "Them" if m.get("direction") == "received" else "You"
                    history_text += f"  {who}: {m.get('text', '')}\n"

        # 3. Build prompt
        prompt = f"""You are auto-replying on WhatsApp on behalf of the user.

Sender: {contact}
Their message: "{message}"
{history_text}{kb_context}

Write a short, natural reply:
- Use the knowledge base info above to answer their question accurately
- Be friendly and professional
- Keep it brief (1-4 sentences max)
- If KB has the answer, give it directly
- If you don't have enough info, say you'll check and get back shortly
- Do NOT mention you are an AI or auto-reply system
- Reply in the same language as their message
- Output ONLY the reply text"""

        try:
            reply = agent.chat_blocking(prompt)
            # Strip any preamble the model might add
            for prefix in ["Reply:", "Auto-reply:", "Response:"]:
                if reply.lower().startswith(prefix.lower()):
                    reply = reply[len(prefix):].strip()
            return reply.strip()
        except Exception as e:
            logger.error(f"Reply generation error: {e}")
            return ""

    return reply_fn


# ─── Gmail Monitor ─────────────────────────────────────────────────────────────

class GmailMonitor:
    """Background thread that polls Gmail for unread emails and auto-replies."""

    def __init__(self, reply_fn: Callable, interval: int = 60):
        self.reply_fn = reply_fn
        self.interval = interval
        self._running = False
        self._replied_uids: set = set()
        self._thread: Optional[threading.Thread] = None
        self._stats = {"replied": 0, "errors": 0, "last_check": None}

    def start(self) -> dict:
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, name="Gmail-Monitor", daemon=True
        )
        self._thread.start()
        return {"success": True, "message": "Gmail auto-reply started.", "interval": self.interval}

    def stop(self) -> dict:
        self._running = False
        return {"success": True, "message": "Gmail auto-reply stopped.", **self._stats}

    def get_stats(self) -> dict:
        return {"running": self._running, **self._stats}

    def _loop(self):
        from integrations.gmail import get_gmail_client

        console.print(f"[dim green]Gmail Monitor started (every {self.interval}s)[/dim green]")

        while self._running:
            try:
                self._stats["last_check"] = datetime.now().strftime("%H:%M:%S")
                gmail = get_gmail_client()
                result = gmail.get_unread(limit=10)

                if "error" in result:
                    logger.warning(f"Gmail fetch error: {result['error']}")
                    time.sleep(self.interval)
                    continue

                for email_data in result.get("emails", []):
                    uid = email_data["uid"]
                    if uid in self._replied_uids:
                        continue

                    sender = email_data["from"]
                    subject = email_data["subject"]
                    body = email_data["body"]

                    # Skip no-reply addresses
                    if any(x in sender.lower() for x in
                           ["noreply", "no-reply", "donotreply", "mailer", "bounce"]):
                        gmail.mark_as_read(uid)
                        self._replied_uids.add(uid)
                        continue

                    console.print(
                        f"\n[bold]📧 New Gmail from[/bold] [cyan]{sender}[/cyan]: {subject[:50]}"
                    )

                    reply = self.reply_fn(
                        contact=sender,
                        message=f"Subject: {subject}\n\n{body[:800]}",
                        history=[]
                    )

                    if reply:
                        result2 = gmail.reply_to_email(uid=uid, body=reply)
                        if result2.get("success"):
                            self._replied_uids.add(uid)
                            self._stats["replied"] += 1
                            console.print(f"[green]✓ Gmail replied to {sender}[/green]")
                        else:
                            console.print(f"[red]Gmail reply failed: {result2.get('error')}[/red]")
                            self._stats["errors"] += 1

            except Exception as e:
                logger.error(f"Gmail monitor error: {e}")
                self._stats["errors"] += 1

            time.sleep(self.interval)


# ─── Master controller ─────────────────────────────────────────────────────────

class AutoReplyMonitor:
    """
    Top-level controller for all auto-reply services.
    Provides start/stop/status for WA + Gmail.
    """

    def __init__(self, agent, kb):
        self.agent = agent
        self.kb = kb
        self._reply_fn = make_reply_fn(agent, kb)
        self._wa_service = None
        self._gmail_monitor: Optional[GmailMonitor] = None
        self._reply_log: list = []

    def start(self, platforms: list, interval: int = 15) -> dict:
        started = []
        errors = []

        for p in platforms:
            if p == "whatsapp":
                try:
                    from integrations.whatsapp import start_wa_autoreply

                    # Wrap reply_fn to also log replies
                    def wa_reply(contact, message, history, _fn=self._reply_fn):
                        reply = _fn(contact, message, history)
                        if reply:
                            self._log("whatsapp", contact, message, reply)
                        return reply

                    result = start_wa_autoreply(
                        reply_fn=wa_reply,
                        interval=interval,
                        headless=False  # Keep visible so user can see QR
                    )
                    if result.get("success"):
                        self._wa_service = True
                        started.append("whatsapp")
                    else:
                        errors.append(f"WhatsApp: {result.get('error', result)}")
                except Exception as e:
                    errors.append(f"WhatsApp: {e}")

            elif p == "gmail":
                try:
                    def gmail_reply(contact, message, history, _fn=self._reply_fn):
                        reply = _fn(contact, message, history)
                        if reply:
                            self._log("gmail", contact, message, reply)
                        return reply

                    self._gmail_monitor = GmailMonitor(
                        reply_fn=gmail_reply,
                        interval=max(interval, 30)  # Gmail min 30s to avoid rate limits
                    )
                    result = self._gmail_monitor.start()
                    started.append("gmail")
                except Exception as e:
                    errors.append(f"Gmail: {e}")

        return {
            "success": len(started) > 0,
            "started": started,
            "errors": errors,
            "interval_seconds": interval,
        }

    def stop(self) -> dict:
        stopped = []

        if self._wa_service:
            try:
                from integrations.whatsapp import stop_wa_autoreply
                stop_wa_autoreply()
                self._wa_service = None
                stopped.append("whatsapp")
            except Exception as e:
                logger.error(f"Stop WA error: {e}")

        if self._gmail_monitor:
            self._gmail_monitor.stop()
            self._gmail_monitor = None
            stopped.append("gmail")

        return {"success": True, "stopped": stopped}

    def get_status(self) -> dict:
        status = {}

        try:
            from integrations.whatsapp import get_whatsapp_service
            svc = get_whatsapp_service()
            if svc:
                status["whatsapp"] = svc.get_stats()
            else:
                status["whatsapp"] = {"running": False}
        except Exception:
            status["whatsapp"] = {"running": False}

        if self._gmail_monitor:
            status["gmail"] = self._gmail_monitor.get_stats()
        else:
            status["gmail"] = {"running": False}

        return status

    def get_reply_log(self, limit: int = 20) -> dict:
        return {
            "log": self._reply_log[-limit:],
            "total": len(self._reply_log)
        }

    def _log(self, platform: str, to: str, original: str, reply: str):
        self._reply_log.append({
            "platform": platform,
            "to": to,
            "original": original[:200],
            "reply": reply[:200],
            "at": datetime.now().strftime("%H:%M:%S")
        })
        # Keep last 500 entries
        if len(self._reply_log) > 500:
            self._reply_log = self._reply_log[-500:]
