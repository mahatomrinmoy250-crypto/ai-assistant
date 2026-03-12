"""
Auto-Reply Monitor — Background daemon that watches WhatsApp & Gmail
and generates smart replies using JARVIS + the Knowledge Base.

Usage:
    monitor = AutoReplyMonitor(agent, kb)
    monitor.start(platforms=["whatsapp", "gmail"])
    monitor.stop()
"""

import time
import threading
import logging
import json
from datetime import datetime
from typing import Optional

from rich.console import Console

console = Console()
logger = logging.getLogger(__name__)


class AutoReplyMonitor:
    """
    Background thread that monitors WhatsApp and Gmail,
    generates context-aware replies using KB + Claude, and sends them.
    """

    def __init__(self, agent, kb, check_interval: int = 30):
        """
        agent: JARVISAgent instance (for generating replies)
        kb: KnowledgeBase instance (for looking up info)
        check_interval: seconds between polls
        """
        self.agent = agent
        self.kb = kb
        self.check_interval = check_interval
        self._running = False
        self._threads: list = []
        self._replied_ids: set = set()  # Track already-replied message IDs
        self._auto_reply_enabled = {
            "whatsapp": False,
            "gmail": False,
        }
        self._reply_log: list = []  # Log of all auto-replies

    def start(self, platforms: list = None) -> dict:
        """Start monitoring specified platforms."""
        if platforms is None:
            platforms = ["whatsapp", "gmail"]

        self._running = True
        started = []
        errors = []

        for platform in platforms:
            if platform == "whatsapp":
                self._auto_reply_enabled["whatsapp"] = True
                t = threading.Thread(
                    target=self._whatsapp_loop,
                    name="WA-Monitor",
                    daemon=True
                )
                t.start()
                self._threads.append(t)
                started.append("whatsapp")

            elif platform == "gmail":
                self._auto_reply_enabled["gmail"] = True
                t = threading.Thread(
                    target=self._gmail_loop,
                    name="Gmail-Monitor",
                    daemon=True
                )
                t.start()
                self._threads.append(t)
                started.append("gmail")

        return {
            "success": True,
            "monitoring": started,
            "interval_seconds": self.check_interval,
            "errors": errors
        }

    def stop(self) -> dict:
        self._running = False
        self._auto_reply_enabled = {"whatsapp": False, "gmail": False}
        return {"success": True, "message": "Auto-reply monitor stopped"}

    def get_reply_log(self, limit: int = 20) -> dict:
        """Return recent auto-reply history."""
        return {
            "log": self._reply_log[-limit:],
            "total_replies": len(self._reply_log)
        }

    def is_running(self) -> bool:
        return self._running

    # ──────────────────── WhatsApp loop ──────────────────────────────────

    def _whatsapp_loop(self):
        from integrations.whatsapp import get_whatsapp_client

        while self._running and self._auto_reply_enabled.get("whatsapp"):
            try:
                wa = get_whatsapp_client()
                if not wa or not wa._check_logged_in():
                    time.sleep(self.check_interval)
                    continue

                result = wa.get_unread_messages(limit=5)
                if "error" in result:
                    time.sleep(self.check_interval)
                    continue

                for chat in result.get("unread_chats", []):
                    contact = chat["contact"]
                    messages = chat["messages"]

                    # Get the most recent incoming message
                    incoming = [m for m in messages if m.get("direction") == "received"]
                    if not incoming:
                        continue

                    latest = incoming[-1]
                    msg_text = latest.get("text", "")
                    msg_id = f"wa:{contact}:{msg_text[:50]}"

                    if msg_id in self._replied_ids:
                        continue

                    # Generate reply using KB + Claude
                    reply = self._generate_reply(
                        platform="WhatsApp",
                        sender=contact,
                        message=msg_text,
                        history=messages
                    )

                    if reply:
                        # Open the chat and reply
                        wa.send_message(contact, reply)
                        self._replied_ids.add(msg_id)
                        self._log_reply("whatsapp", contact, msg_text, reply)
                        console.print(
                            f"[green]✓ Auto-replied on WhatsApp to {contact}[/green]"
                        )

            except Exception as e:
                logger.error(f"WhatsApp monitor error: {e}")

            time.sleep(self.check_interval)

    # ──────────────────── Gmail loop ─────────────────────────────────────

    def _gmail_loop(self):
        from integrations.gmail import get_gmail_client

        while self._running and self._auto_reply_enabled.get("gmail"):
            try:
                gmail = get_gmail_client()
                result = gmail.get_unread(limit=5)

                if "error" in result:
                    time.sleep(self.check_interval)
                    continue

                for email_data in result.get("emails", []):
                    uid = email_data["uid"]
                    sender = email_data["from"]
                    subject = email_data["subject"]
                    body = email_data["body"]
                    msg_id = f"gmail:{uid}"

                    if msg_id in self._replied_ids:
                        continue

                    # Skip automated/noreply emails
                    if any(x in sender.lower() for x in ["noreply", "no-reply", "donotreply", "mailer"]):
                        gmail.mark_as_read(uid)
                        continue

                    # Generate reply
                    reply = self._generate_reply(
                        platform="Gmail",
                        sender=sender,
                        message=f"Subject: {subject}\n\n{body}",
                        history=[]
                    )

                    if reply:
                        gmail.reply_to_email(uid=uid, body=reply)
                        self._replied_ids.add(msg_id)
                        self._log_reply("gmail", sender, f"[{subject}] {body[:100]}", reply)
                        console.print(
                            f"[green]✓ Auto-replied on Gmail to {sender} re: {subject}[/green]"
                        )

            except Exception as e:
                logger.error(f"Gmail monitor error: {e}")

            time.sleep(self.check_interval)

    # ──────────────────── Reply generation ───────────────────────────────

    def _generate_reply(
        self,
        platform: str,
        sender: str,
        message: str,
        history: list
    ) -> Optional[str]:
        """Generate a smart reply using KB lookup + Claude."""

        # First: search KB for relevant info
        kb_results = self.kb.search(message, limit=5)
        kb_context = ""
        if kb_results["results"]:
            kb_context = "\n\nKnowledge Base context:\n"
            for entry in kb_results["results"]:
                kb_context += f"- [{entry['category']}] {entry['key']}: {entry['value']}\n"

        # Build prompt for reply generation
        history_text = ""
        if history:
            history_text = "\n\nConversation history:\n"
            for msg in history[-5:]:
                direction = "Them" if msg.get("direction") == "received" else "You"
                history_text += f"{direction}: {msg.get('text', '')}\n"

        prompt = f"""You are generating an auto-reply on behalf of the user on {platform}.

Sender: {sender}
Their message: {message}
{history_text}{kb_context}

Instructions:
- Reply naturally and helpfully using the knowledge base context above
- Keep the reply concise and professional
- If you don't have enough info to answer, say you'll follow up shortly
- Match the tone of the conversation
- Do NOT mention that you're an AI or auto-reply system
- Reply in the same language as the incoming message
- Output ONLY the reply text, no metadata or explanation"""

        try:
            reply = self.agent.chat_blocking(prompt)
            # Clean up any assistant preamble
            reply = reply.strip()
            if reply.lower().startswith("reply:"):
                reply = reply[6:].strip()
            return reply if reply else None
        except Exception as e:
            logger.error(f"Reply generation error: {e}")
            return None

    def _log_reply(self, platform: str, to: str, original: str, reply: str):
        self._reply_log.append({
            "platform": platform,
            "to": to,
            "original_message": original[:200],
            "reply_sent": reply[:200],
            "timestamp": datetime.now().isoformat()
        })
