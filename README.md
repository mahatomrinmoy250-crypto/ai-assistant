# JARVIS — AI Voice Assistant

> *"Just A Rather Very Intelligent System"* — powered by Claude Opus 4.6

A Tony Stark-style AI that does **real work**: searches the web, controls your system, manages files, **reads & replies to WhatsApp/Gmail/Facebook**, stores your business data in a knowledge base, and **auto-replies to customers** using your product info — all through natural voice or text conversation.

---

## Features

| Capability | What it does |
|---|---|
| 🌐 **Web Search** | Real-time DuckDuckGo search |
| 📄 **Web Fetch** | Read and summarize any webpage |
| 💻 **System Control** | Run shell commands, check CPU/RAM/disk/battery |
| 📁 **File Management** | Read, write, list files |
| 🧮 **Calculator** | Math, trig, expressions |
| ⏱️ **Timers** | Countdown timers with alerts |
| 📋 **Clipboard & Notes** | Read/write clipboard, save notes |
| 🧠 **Knowledge Base** | Store product prices, FAQs, company info — searchable by AI |
| 💬 **WhatsApp** | Read unread messages, send & reply to contacts |
| 📧 **Gmail** | Read inbox, reply to emails, send new emails |
| 📘 **Facebook** | Create posts, comment on posts |
| 🤖 **Auto-Reply** | Background monitor that reads WhatsApp/Gmail and auto-replies using your KB |
| 🎙️ **Voice I/O** | Speech-to-text + text-to-speech |

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

> **Linux (PyAudio):** `sudo apt install portaudio19-dev python3-dev`
> **macOS:** `brew install portaudio`

### 2. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...

# For Gmail auto-reply
GMAIL_ADDRESS=you@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx   # Google App Password

# For Facebook
FB_EMAIL=you@email.com
FB_PASSWORD=yourpassword
```

> **Gmail App Password**: Google Account → Security → 2-Step Verification → App passwords → Generate for "Mail"

### 3. Run

```bash
python main.py          # Interactive (text + voice)
python main.py --text   # Text-only
python main.py -q "What's the latest iPhone price in my knowledge base?"
```

---

## Knowledge Base — Feed JARVIS Your Business Data

The knowledge base (KB) is how JARVIS learns YOUR specific information:

### Store data

```
You: Remember that iPhone 15 costs $999
JARVIS: [kb_store → category: products, key: iPhone 15, value: $999]
        Stored. I'll use this when anyone asks.

You: Store our business hours: Monday to Friday, 9am to 6pm
JARVIS: [kb_store → category: company, key: business hours, value: Mon-Fri 9am-6pm]
        Done.

You: Here's our FAQ — Q: "Do you offer free shipping?" A: "Yes, on orders over $50"
JARVIS: [kb_store → category: faq, key: free shipping, value: Yes on orders over $50]
        Stored in the FAQ category.
```

### Load a whole product catalog at once

```
You: Load these products into the knowledge base:
     [{"category":"products","key":"iPhone 15","value":"$999"},
      {"category":"products","key":"Samsung S24","value":"$799"},
      {"category":"faq","key":"return policy","value":"30 days full refund"}]
JARVIS: [kb_bulk_store] → Stored 3 entries.
```

### JARVIS auto-uses KB when answering

```
You (or a customer on WhatsApp): What's the price of iPhone 15?
JARVIS: [kb_search → "iPhone 15 price"] → Found: $999
        The iPhone 15 is $999.
```

---

## WhatsApp Auto-Reply Setup

JARVIS can monitor WhatsApp and auto-reply to customers using your KB data:

```
You: Connect to WhatsApp
JARVIS: [whatsapp_connect] → Browser opens, QR code shown
        WhatsApp Web is open. Scan the QR code with your phone.

You: (scan QR on phone)

You: Start auto-replying to WhatsApp using my product info
JARVIS: [kb_list] → Shows your stored products/FAQs
        [whatsapp_connect] → Already connected
        [start_auto_reply, platforms=["whatsapp"]] →
        Auto-reply monitor started. Checking every 30 seconds.
        When customers message about your products, I'll reply using your knowledge base.
```

**What happens when a customer messages:**
1. Customer sends: *"Hi, how much is the Samsung S24?"*
2. JARVIS searches KB → finds $799
3. JARVIS replies: *"Hi! The Samsung S24 is priced at $799. Is there anything else I can help you with?"*

---

## Gmail Setup

```
You: Check my unread emails
JARVIS: [gmail_get_unread] → 3 unread emails
        You have 3 unread emails:
        1. From: john@example.com — "Product inquiry"
        2. From: sarah@co.com — "Order #1234 status"
        ...

You: Reply to the first email with info about our return policy
JARVIS: [kb_search → "return policy"] → 30 days full refund
        [gmail_reply uid=5 body="Hi John, our return policy is 30 days..."]
        Replied to john@example.com.

You: Start auto-replying to Gmail too
JARVIS: [start_auto_reply, platforms=["gmail"]]
        Gmail auto-reply started.
```

---

## Facebook

```
You: Post to Facebook: "New products just arrived! iPhone 15 now in stock at $999"
JARVIS: [facebook_connect] → Browser logs in
        [facebook_post] → Posted successfully!

You: Comment "Thanks for your interest!" on this post: https://facebook.com/...
JARVIS: [facebook_comment] → Comment posted.
```

---

## Architecture

```
main.py                    ← Entry point, interactive loop, CLI
agent.py                   ← Claude Opus 4.6 brain (streaming + tool use)
tools.py                   ← All tool implementations (33 tools)
voice.py                   ← Speech I/O (mic + speakers)
memory_db.py               ← SQLite knowledge base (full-text search)
integrations/
  whatsapp.py              ← WhatsApp Web via Selenium
  gmail.py                 ← Gmail via IMAP/SMTP
  facebook.py              ← Facebook via Selenium
  monitor.py               ← Auto-reply background daemon
```

### Tool count: 33

| Category | Tools |
|---|---|
| Web | web_search, web_fetch |
| System | run_command, get_system_info |
| Files | read_file, write_file, list_directory |
| Utility | calculate, get_datetime, clipboard_read/write, save_note, read_notes, set_timer, open_application |
| Knowledge Base | kb_store, kb_search, kb_list, kb_delete, kb_bulk_store |
| WhatsApp | whatsapp_connect, whatsapp_get_messages, whatsapp_send |
| Gmail | gmail_get_unread, gmail_reply, gmail_send, gmail_search |
| Facebook | facebook_connect, facebook_post, facebook_comment |
| Auto-Reply | start_auto_reply, stop_auto_reply, get_auto_reply_log |

---

## Special Commands

| Command | Effect |
|---|---|
| `help` | Show help |
| `clear` | Reset conversation |
| `voice on/off` | Toggle TTS |
| `listen` | One-shot voice input |
| `wake` | Wake-word mode ("JARVIS") |
| `quit` | Shut down |

---

## Requirements

- Python 3.9+
- Anthropic API key (Claude Opus 4.6)
- Chrome or Firefox (for WhatsApp/Facebook automation)
- Gmail App Password (for Gmail integration)
- Microphone + speakers (optional, for voice mode)
