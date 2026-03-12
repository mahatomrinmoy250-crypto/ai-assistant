#!/usr/bin/env python3
"""
JARVIS — AI Voice Assistant
Just A Rather Very Intelligent System

Like Tony Stark's AI — does real work: web search, system control,
file management, calculations, timers, and much more.

Usage:
    python main.py              # Interactive mode (voice + text)
    python main.py --text       # Text-only mode
    python main.py --voice      # Voice mode (requires mic)
    python main.py -q "..."     # One-shot query
"""

import os
import sys
import time
import argparse
import threading
from pathlib import Path

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.live import Live
from rich.spinner import Spinner
from rich import print as rprint
from rich.rule import Rule
from colorama import Fore, Style, init as colorama_init

colorama_init(autoreset=True)

from agent import JARVISAgent
from voice import VoiceEngine

console = Console()

# ─────────────────────────── Banner ─────────────────────────────────────────

BANNER = """
[bold cyan]
     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
     ██║███████║██████╔╝██║   ██║██║███████╗
██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
 ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
[/bold cyan]
[dim]Just A Rather Very Intelligent System[/dim]
[dim]Powered by Claude Opus 4.6[/dim]
"""

STARTUP_MESSAGES = [
    "Good day. All systems are online.",
    "JARVIS online. Ready to assist.",
    "At your service. What can I do for you?",
    "Systems operational. How may I help?",
    "Online and standing by.",
]

HELP_TEXT = """
[bold]Commands:[/bold]
  [cyan]help[/cyan]          Show this help
  [cyan]clear[/cyan]         Clear conversation history
  [cyan]history[/cyan]       Show conversation summary
  [cyan]voice on/off[/cyan]  Toggle voice output
  [cyan]listen[/cyan]        Listen for voice input (one-shot)
  [cyan]wake[/cyan]          Enable wake-word mode ("JARVIS")
  [cyan]quit / exit[/cyan]   Shut down JARVIS

[bold]What JARVIS can do:[/bold]
  • Search the web for current information
  • Read and write files on your system
  • Run shell commands
  • Check CPU, RAM, disk, battery status
  • Calculate anything (math, expressions)
  • Set timers and reminders
  • Manage clipboard
  • Save and recall notes
  • Open applications
  • Browse webpages

[bold]Example prompts:[/bold]
  "What's the weather like in New York?"
  "Search for the latest news on AI"
  "What time is it?"
  "How much RAM am I using?"
  "Calculate 2^32 divided by 1000"
  "Save a note: meeting at 3pm tomorrow"
  "Set a timer for 5 minutes"
  "Read my notes"
  "List files in my home directory"
  "Open a web browser"
"""


# ─────────────────────────── Main Assistant Class ───────────────────────────

class JARVISInterface:
    def __init__(self, text_only: bool = False, voice_only: bool = False):
        self.text_only = text_only
        self.voice_only = voice_only
        self.voice_enabled = not text_only
        self.wake_mode = False

        # Check API key
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            console.print("[bold red]ERROR: ANTHROPIC_API_KEY environment variable not set.[/bold red]")
            console.print("Set it with: [cyan]export ANTHROPIC_API_KEY='your-key-here'[/cyan]")
            sys.exit(1)

        console.print(BANNER)
        console.print(Rule("[dim]Initializing systems...[/dim]"))

        # Initialize agent
        with console.status("[cyan]Loading AI core...[/cyan]"):
            self.agent = JARVISAgent(api_key=api_key)
        console.print("[green]✓ AI core ready[/green]")

        # Initialize voice engine
        if not text_only:
            with console.status("[cyan]Initializing voice systems...[/cyan]"):
                self.voice = VoiceEngine(voice_rate=170, voice_volume=0.9)
        else:
            self.voice = None
            console.print("[yellow]Voice systems disabled (text-only mode)[/yellow]")

        console.print(Rule())
        console.print()

    def _display_thinking(self, label: str = "Processing"):
        """Show a thinking indicator."""
        return console.status(f"[cyan]{label}...[/cyan]", spinner="dots")

    def _print_user(self, text: str):
        console.print(f"\n[bold green]You:[/bold green] {text}")

    def _print_jarvis_start(self):
        console.print(f"\n[bold cyan]JARVIS:[/bold cyan] ", end="")

    def _stream_response(self, user_input: str) -> str:
        """Stream JARVIS response to console and optionally speak it."""
        self._print_user(user_input)
        self._print_jarvis_start()

        full_response = ""
        tool_output_lines = []
        in_tool_section = False

        for chunk in self.agent.chat(user_input):
            if chunk.startswith("\n[") and ("tool:" in chunk.lower() or "executing" in chunk.lower()):
                # Tool activity indicator
                tool_name = chunk.strip().lstrip("\n")
                console.print(f"\n  [dim yellow]{tool_name}[/dim yellow]", end="")
                tool_output_lines.append(chunk)
                in_tool_section = True
            else:
                if in_tool_section and chunk.strip():
                    console.print(f"\n[bold cyan]JARVIS:[/bold cyan] ", end="")
                    in_tool_section = False
                print(chunk, end="", flush=True)
                full_response += chunk

        print()  # Newline after response

        # Speak the response (filter out tool indicators)
        if self.voice and self.voice_enabled and full_response.strip():
            # Speak in background thread
            self.voice.speak(full_response, blocking=False)

        return full_response

    def _get_input(self) -> str:
        """Get input from user (text or voice)."""
        if self.voice_only and self.voice and self.voice.has_microphone():
            return self._voice_input()
        else:
            return self._text_input()

    def _text_input(self) -> str:
        try:
            text = input(f"\n{Fore.GREEN}You: {Style.RESET_ALL}").strip()
            return text
        except (EOFError, KeyboardInterrupt):
            return "quit"

    def _voice_input(self) -> str:
        if not self.voice or not self.voice.has_microphone():
            console.print("[yellow]Microphone not available — using text input[/yellow]")
            return self._text_input()

        text = self.voice.listen(timeout=10)
        if text:
            console.print(f"[green]Heard:[/green] {text}")
            return text
        else:
            console.print("[dim]No speech detected[/dim]")
            return ""

    def _handle_command(self, cmd: str) -> bool:
        """Handle special commands. Returns True if handled."""
        cmd_lower = cmd.lower().strip()

        if cmd_lower in ("quit", "exit", "bye", "shutdown"):
            farewell = "Goodbye. JARVIS shutting down."
            console.print(f"\n[bold cyan]JARVIS:[/bold cyan] {farewell}")
            if self.voice and self.voice_enabled:
                self.voice.speak(farewell, blocking=True)
            return None  # Signal to exit

        if cmd_lower == "help":
            console.print(Panel(HELP_TEXT, title="[bold cyan]JARVIS Help[/bold cyan]", expand=False))
            return True

        if cmd_lower == "clear":
            self.agent.clear_history()
            console.print("[green]Conversation history cleared.[/green]")
            return True

        if cmd_lower == "history":
            summary = self.agent.get_history_summary()
            console.print(f"[cyan]Session: {summary}[/cyan]")
            return True

        if cmd_lower == "voice on":
            if self.voice:
                self.voice_enabled = True
                console.print("[green]Voice output enabled.[/green]")
            else:
                console.print("[yellow]Voice engine not available.[/yellow]")
            return True

        if cmd_lower == "voice off":
            self.voice_enabled = False
            console.print("[yellow]Voice output disabled.[/yellow]")
            return True

        if cmd_lower == "listen":
            if self.voice and self.voice.has_microphone():
                console.print("[cyan]Listening for voice command...[/cyan]")
                text = self._voice_input()
                if text:
                    self._stream_response(text)
            else:
                console.print("[yellow]Microphone not available.[/yellow]")
            return True

        if cmd_lower == "wake":
            self._wake_word_mode()
            return True

        return False

    def _wake_word_mode(self):
        """Activate wake-word listening mode."""
        if not self.voice or not self.voice.has_microphone():
            console.print("[yellow]Wake word mode requires a microphone.[/yellow]")
            return

        console.print(
            Panel(
                "[cyan]Wake word mode active.[/cyan]\n"
                "Say [bold]'JARVIS'[/bold] followed by your command.\n"
                "Press [bold]Ctrl+C[/bold] to exit wake mode.",
                title="Wake Word Mode"
            )
        )

        try:
            while True:
                console.print("[dim]Waiting for wake word 'JARVIS'...[/dim]")
                if self.voice.listen_for_wake_word("jarvis", timeout=4):
                    console.print("[cyan]Wake word detected! Listening for command...[/cyan]")
                    if self.voice_enabled:
                        self.voice.speak("Yes?", blocking=False)
                    time.sleep(0.3)
                    text = self._voice_input()
                    if text and text.lower() not in ("nothing", "never mind", "cancel"):
                        self._stream_response(text)
        except KeyboardInterrupt:
            console.print("\n[yellow]Exiting wake word mode.[/yellow]")

    def run_once(self, query: str):
        """Run a single query and exit."""
        response = self._stream_response(query)
        if self.voice and self.voice_enabled:
            # Wait for speech to finish
            time.sleep(1)
            while self.voice.is_speaking():
                time.sleep(0.2)

    def run_interactive(self):
        """Main interactive loop."""
        # Startup greeting
        import random
        greeting = random.choice(STARTUP_MESSAGES)
        console.print(f"[bold cyan]JARVIS:[/bold cyan] {greeting}")
        if self.voice and self.voice_enabled:
            self.voice.speak(greeting, blocking=False)

        console.print(
            f"\n[dim]Type [bold]help[/bold] for available commands. "
            f"Type [bold]quit[/bold] to exit.[/dim]"
        )

        mode_info = []
        if self.voice and self.voice.has_microphone():
            mode_info.append("voice input: type 'listen'")
        if self.voice and self.voice_enabled:
            mode_info.append("voice output: ON")
        if mode_info:
            console.print(f"[dim]({', '.join(mode_info)})[/dim]")

        while True:
            try:
                user_input = self._get_input()

                if not user_input:
                    continue

                # Handle special commands
                result = self._handle_command(user_input)

                if result is None:
                    break  # Exit signal
                if result:
                    continue  # Command handled, next iteration

                # Regular conversation
                self._stream_response(user_input)

            except KeyboardInterrupt:
                console.print("\n[yellow]Use 'quit' to exit, or Ctrl+C again to force exit.[/yellow]")
                try:
                    time.sleep(1)
                except KeyboardInterrupt:
                    console.print("\n[red]Force exit.[/red]")
                    break

        console.print("\n[dim]JARVIS offline.[/dim]")


# ─────────────────────────── Entry point ────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="JARVIS — AI Voice Assistant powered by Claude",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py                    # Interactive mode
  python main.py --text             # Text-only (no voice I/O)
  python main.py --voice            # Voice-first mode
  python main.py -q "What time is it?"  # One-shot query
  python main.py -q "How's my system?" --text
        """
    )
    parser.add_argument(
        "--text", action="store_true",
        help="Text-only mode (disables voice I/O)"
    )
    parser.add_argument(
        "--voice", action="store_true",
        help="Voice-first mode (uses mic for input)"
    )
    parser.add_argument(
        "-q", "--query", type=str,
        help="Run a single query and exit"
    )

    args = parser.parse_args()

    jarvis = JARVISInterface(
        text_only=args.text,
        voice_only=args.voice
    )

    if args.query:
        jarvis.run_once(args.query)
    else:
        jarvis.run_interactive()


if __name__ == "__main__":
    main()
