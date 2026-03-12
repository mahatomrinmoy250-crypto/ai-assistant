"""
Gmail Integration via IMAP/SMTP.
Uses App Password (no OAuth needed) — simpler and reliable.

Setup:
1. Go to Google Account > Security > 2-Step Verification > App passwords
2. Generate an App Password for "Mail"
3. Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD in .env

Handles: read unread emails, reply, send new email, mark as read.
"""

import os
import re
import email
import smtplib
import imaplib
import logging
from email import encoders
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

IMAP_SERVER = "imap.gmail.com"
IMAP_PORT = 993
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587


def _decode_header_value(value: str) -> str:
    """Decode RFC-2047 encoded email header."""
    if not value:
        return ""
    parts = decode_header(value)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            try:
                decoded.append(part.decode(charset or "utf-8", errors="replace"))
            except Exception:
                decoded.append(part.decode("utf-8", errors="replace"))
        else:
            decoded.append(str(part))
    return " ".join(decoded)


def _get_email_body(msg: email.message.Message) -> str:
    """Extract plain text body from email."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            disp = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in disp:
                try:
                    body = part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", errors="replace"
                    )
                    break
                except Exception:
                    pass
    else:
        try:
            body = msg.get_payload(decode=True).decode(
                msg.get_content_charset() or "utf-8", errors="replace"
            )
        except Exception:
            body = str(msg.get_payload())

    # Truncate very long bodies
    if len(body) > 4000:
        body = body[:4000] + "\n\n[...email truncated...]"
    return body.strip()


class GmailClient:
    """Gmail client using IMAP/SMTP with App Password."""

    def __init__(
        self,
        address: Optional[str] = None,
        app_password: Optional[str] = None
    ):
        self.address = address or os.environ.get("GMAIL_ADDRESS", "")
        self.app_password = app_password or os.environ.get("GMAIL_APP_PASSWORD", "")

    def _check_credentials(self) -> Optional[str]:
        if not self.address:
            return "GMAIL_ADDRESS not set in environment"
        if not self.app_password:
            return "GMAIL_APP_PASSWORD not set in environment"
        return None

    def _imap_connect(self) -> imaplib.IMAP4_SSL:
        mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
        mail.login(self.address, self.app_password)
        return mail

    # ──────────────────── Reading ────────────────────────────────────────

    def get_unread(self, folder: str = "INBOX", limit: int = 10) -> dict:
        """Fetch unread emails."""
        err = self._check_credentials()
        if err:
            return {"error": err}

        try:
            mail = self._imap_connect()
            mail.select(folder)

            _, data = mail.search(None, "UNSEEN")
            uid_list = data[0].split()

            if not uid_list:
                return {"emails": [], "count": 0, "message": "No unread emails"}

            # Get most recent first
            uid_list = uid_list[-limit:][::-1]

            emails = []
            for uid in uid_list:
                try:
                    _, msg_data = mail.fetch(uid, "(RFC822)")
                    raw = msg_data[0][1]
                    msg = email.message_from_bytes(raw)

                    emails.append({
                        "uid": uid.decode(),
                        "from": _decode_header_value(msg.get("From", "")),
                        "to": _decode_header_value(msg.get("To", "")),
                        "subject": _decode_header_value(msg.get("Subject", "(no subject)")),
                        "date": msg.get("Date", ""),
                        "body": _get_email_body(msg),
                        "message_id": msg.get("Message-ID", "")
                    })
                except Exception as e:
                    logger.warning(f"Failed to parse email {uid}: {e}")

            mail.logout()
            return {"emails": emails, "count": len(emails)}

        except imaplib.IMAP4.error as e:
            return {"error": f"IMAP error: {e}. Check credentials or enable IMAP in Gmail settings."}
        except Exception as e:
            return {"error": str(e)}

    def get_recent(self, folder: str = "INBOX", limit: int = 10, search: str = "ALL") -> dict:
        """Fetch recent emails (read or unread)."""
        err = self._check_credentials()
        if err:
            return {"error": err}

        try:
            mail = self._imap_connect()
            mail.select(folder)
            _, data = mail.search(None, search)
            uid_list = data[0].split()[-limit:][::-1]

            emails = []
            for uid in uid_list:
                try:
                    _, msg_data = mail.fetch(uid, "(RFC822)")
                    raw = msg_data[0][1]
                    msg = email.message_from_bytes(raw)
                    emails.append({
                        "uid": uid.decode(),
                        "from": _decode_header_value(msg.get("From", "")),
                        "subject": _decode_header_value(msg.get("Subject", "(no subject)")),
                        "date": msg.get("Date", ""),
                        "body": _get_email_body(msg),
                        "message_id": msg.get("Message-ID", "")
                    })
                except Exception:
                    continue

            mail.logout()
            return {"emails": emails, "count": len(emails)}

        except Exception as e:
            return {"error": str(e)}

    def search_emails(self, query: str, limit: int = 10) -> dict:
        """Search emails by subject or sender."""
        err = self._check_credentials()
        if err:
            return {"error": err}

        try:
            mail = self._imap_connect()
            mail.select("INBOX")

            # Search by subject
            _, data = mail.search(None, f'SUBJECT "{query}"')
            uids = data[0].split()

            if not uids:
                # Try by from
                _, data = mail.search(None, f'FROM "{query}"')
                uids = data[0].split()

            uids = uids[-limit:][::-1]
            emails = []
            for uid in uids:
                try:
                    _, msg_data = mail.fetch(uid, "(RFC822)")
                    msg = email.message_from_bytes(msg_data[0][1])
                    emails.append({
                        "uid": uid.decode(),
                        "from": _decode_header_value(msg.get("From", "")),
                        "subject": _decode_header_value(msg.get("Subject", "")),
                        "date": msg.get("Date", ""),
                        "body": _get_email_body(msg)
                    })
                except Exception:
                    continue

            mail.logout()
            return {"emails": emails, "count": len(emails)}
        except Exception as e:
            return {"error": str(e)}

    def mark_as_read(self, uid: str, folder: str = "INBOX") -> dict:
        """Mark an email as read."""
        err = self._check_credentials()
        if err:
            return {"error": err}
        try:
            mail = self._imap_connect()
            mail.select(folder)
            mail.store(uid, "+FLAGS", "\\Seen")
            mail.logout()
            return {"success": True, "uid": uid}
        except Exception as e:
            return {"error": str(e)}

    # ──────────────────── Sending ────────────────────────────────────────

    def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        reply_to_uid: str = None,
        reply_to_message_id: str = None,
        folder: str = "INBOX"
    ) -> dict:
        """Send or reply to an email."""
        err = self._check_credentials()
        if err:
            return {"error": err}

        try:
            msg = MIMEMultipart()
            msg["From"] = self.address
            msg["To"] = to
            msg["Subject"] = subject
            msg["Date"] = email.utils.formatdate(localtime=True)

            # Threading headers for replies
            if reply_to_message_id:
                msg["In-Reply-To"] = reply_to_message_id
                msg["References"] = reply_to_message_id

            msg.attach(MIMEText(body, "plain", "utf-8"))

            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(self.address, self.app_password)
                smtp.sendmail(self.address, to, msg.as_string())

            # Mark original as read if this is a reply
            if reply_to_uid:
                self.mark_as_read(reply_to_uid, folder)

            return {
                "success": True,
                "to": to,
                "subject": subject,
                "sent_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }

        except smtplib.SMTPAuthenticationError:
            return {"error": "Authentication failed. Check GMAIL_ADDRESS and GMAIL_APP_PASSWORD."}
        except smtplib.SMTPException as e:
            return {"error": f"SMTP error: {e}"}
        except Exception as e:
            return {"error": str(e)}

    def reply_to_email(self, uid: str, body: str, folder: str = "INBOX") -> dict:
        """Reply to a specific email by its UID."""
        err = self._check_credentials()
        if err:
            return {"error": err}

        try:
            mail = self._imap_connect()
            mail.select(folder)
            _, msg_data = mail.fetch(uid, "(RFC822)")
            mail.logout()

            msg = email.message_from_bytes(msg_data[0][1])
            original_from = _decode_header_value(msg.get("From", ""))
            original_subject = _decode_header_value(msg.get("Subject", ""))
            message_id = msg.get("Message-ID", "")

            # Extract just the email address from "Name <email>"
            match = re.search(r'<(.+?)>', original_from)
            reply_to_addr = match.group(1) if match else original_from

            # Prefix Re: if not already there
            reply_subject = original_subject
            if not reply_subject.lower().startswith("re:"):
                reply_subject = f"Re: {reply_subject}"

            return self.send_email(
                to=reply_to_addr,
                subject=reply_subject,
                body=body,
                reply_to_uid=uid,
                reply_to_message_id=message_id,
                folder=folder
            )

        except Exception as e:
            return {"error": str(e)}


# ──────────────────────── Singleton ─────────────────────────────────────

_gmail_client: Optional[GmailClient] = None

def get_gmail_client() -> GmailClient:
    global _gmail_client
    if _gmail_client is None:
        _gmail_client = GmailClient()
    return _gmail_client
