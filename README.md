# JARVIS — AI Voice Assistant

> *"Just A Rather Very Intelligent System"* — powered by Claude Opus 4.6

A Tony Stark-style AI assistant that does **real work**: searches the web, controls your system, manages files, runs commands, sets timers, and more — all through natural voice or text conversation.

---

## Features

| Capability | What it does |
|---|---|
| 🌐 **Web Search** | Real-time DuckDuckGo search for current info |
| 📄 **Web Fetch** | Read and summarize any webpage |
| 💻 **System Control** | Run shell commands, check CPU/RAM/disk/battery |
| 📁 **File Management** | Read, write, list files and directories |
| 🧮 **Calculator** | Math expressions, trig, logarithms |
| 🕐 **Date & Time** | Current time, timezone support |
| ⏱️ **Timers** | Set countdown timers with alerts |
| 📋 **Clipboard** | Read and write clipboard contents |
| 📝 **Notes** | Save and recall notes persistently |
| 🖥️ **App Launcher** | Open applications and files |
| 🎙️ **Voice I/O** | Speech-to-text input + text-to-speech output |
| 🧠 **Adaptive Thinking** | Claude uses extended reasoning for hard problems |

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

> **Note on PyAudio:** On Linux, you may need `sudo apt install portaudio19-dev python3-dev` first.
> On macOS: `brew install portaudio`

### 2. Set your API key

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

Or export directly:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. Run

```bash
# Interactive mode (text + optional voice)
python main.py

# Text-only mode (no microphone/speaker needed)
python main.py --text

# Voice-first mode
python main.py --voice

# One-shot query
python main.py -q "What's the latest news on AI?"
python main.py --text -q "How much RAM am I using?"
```

---

## Example Conversations

```
You: What's the weather like in Tokyo right now?
JARVIS: [Using tool: web_search...]
        According to current data, Tokyo is experiencing...

You: How much RAM am I using?
JARVIS: [Using tool: get_system_info...]
        Your system is currently using 6.2 GB of 16 GB RAM (38.7%)...

You: Set a timer for 10 minutes
JARVIS: [Using tool: set_timer...]
        Timer set — it will fire at 14:35:00.

You: Calculate the compound interest on $10,000 at 7% for 20 years
JARVIS: [Using tool: calculate...]
        At 7% annual compound interest: $10,000 grows to $38,696.84...

You: Search for the best Python web frameworks in 2024
JARVIS: [Using tool: web_search...]
        Here's what I found...

You: Save a note: remind me to call the dentist
JARVIS: [Using tool: save_note...]
        Note saved. I've stored "remind me to call the dentist"...

You: What files are in my home directory?
JARVIS: [Using tool: list_directory...]
        Your home directory contains...
```

---

## Voice Commands

| Command | Effect |
|---|---|
| `listen` | One-shot voice input |
| `wake` | Enable wake-word mode (say "JARVIS") |
| `voice on/off` | Toggle voice output |

---

## Special Commands

| Command | Effect |
|---|---|
| `help` | Show help and capabilities |
| `clear` | Reset conversation history |
| `history` | Show session summary |
| `quit` / `exit` | Shut down JARVIS |

---

## Architecture

```
main.py          ← Entry point, CLI args, interactive loop
agent.py         ← Claude Opus 4.6 agent with tool use + streaming
tools.py         ← Tool implementations (15 tools)
voice.py         ← Speech recognition + text-to-speech
requirements.txt ← Dependencies
.env.example     ← API key template
```

### Key Design Decisions

- **Streaming responses** — Text appears token-by-token like a real conversation
- **Adaptive thinking** — Claude uses extended reasoning (`thinking: {type: "adaptive"}`) for complex queries
- **Agentic loop** — Automatic multi-step tool use until the task is complete
- **Conversation memory** — Full history kept (last 20 turns) for context
- **Graceful degradation** — Works text-only if mic/speakers unavailable

---

## Requirements

- Python 3.9+
- Anthropic API key (Claude Opus 4.6)
- Microphone (optional, for voice input)
- Speakers (optional, for voice output)
