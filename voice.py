"""
Voice I/O Module — Speech-to-Text and Text-to-Speech
Handles mic input and spoken output for the JARVIS assistant.
"""

import os
import sys
import threading
import queue
import time
from typing import Optional

try:
    import speech_recognition as sr
    SPEECH_RECOGNITION_AVAILABLE = True
except ImportError:
    SPEECH_RECOGNITION_AVAILABLE = False

try:
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False

from rich.console import Console

console = Console()


class VoiceEngine:
    """Handles speech-to-text and text-to-speech."""

    def __init__(self, voice_rate: int = 175, voice_volume: float = 0.9):
        self.voice_rate = voice_rate
        self.voice_volume = voice_volume
        self._tts_engine = None
        self._recognizer = None
        self._microphone = None
        self._tts_queue: queue.Queue = queue.Queue()
        self._tts_thread: Optional[threading.Thread] = None
        self._speaking = False
        self._setup()

    def _setup(self):
        """Initialize TTS and STT engines."""
        # Setup TTS
        if PYTTSX3_AVAILABLE:
            try:
                self._tts_engine = pyttsx3.init()
                self._tts_engine.setProperty("rate", self.voice_rate)
                self._tts_engine.setProperty("volume", self.voice_volume)

                # Try to find a good voice (prefer a male voice for JARVIS feel)
                voices = self._tts_engine.getProperty("voices")
                if voices:
                    # Prefer a deeper, authoritative voice
                    chosen = voices[0]
                    for v in voices:
                        name = v.name.lower()
                        if any(x in name for x in ["david", "daniel", "james", "male", "en_us"]):
                            chosen = v
                            break
                    self._tts_engine.setProperty("voice", chosen.id)

                console.print("[green]✓ TTS engine initialized[/green]")
            except Exception as e:
                console.print(f"[yellow]⚠ TTS unavailable: {e}[/yellow]")
                self._tts_engine = None
        else:
            console.print("[yellow]⚠ pyttsx3 not installed — voice output disabled[/yellow]")

        # Setup STT
        if SPEECH_RECOGNITION_AVAILABLE:
            try:
                self._recognizer = sr.Recognizer()
                self._recognizer.energy_threshold = 4000
                self._recognizer.dynamic_energy_threshold = True
                self._recognizer.pause_threshold = 0.8

                # Test microphone availability
                with sr.Microphone() as mic:
                    self._recognizer.adjust_for_ambient_noise(mic, duration=0.5)
                self._microphone = sr.Microphone()
                console.print("[green]✓ Microphone initialized[/green]")
            except Exception as e:
                console.print(f"[yellow]⚠ Microphone unavailable: {e}[/yellow]")
                self._recognizer = None
                self._microphone = None
        else:
            console.print("[yellow]⚠ SpeechRecognition not installed — voice input disabled[/yellow]")

    def speak(self, text: str, blocking: bool = False):
        """Convert text to speech."""
        # Strip markdown for cleaner speech
        clean = self._strip_markdown(text)

        if self._tts_engine:
            if blocking:
                try:
                    self._speaking = True
                    self._tts_engine.say(clean)
                    self._tts_engine.runAndWait()
                    self._speaking = False
                except Exception as e:
                    console.print(f"[red]TTS error: {e}[/red]")
                    self._speaking = False
            else:
                # Non-blocking: run in thread
                def _speak():
                    try:
                        self._speaking = True
                        self._tts_engine.say(clean)
                        self._tts_engine.runAndWait()
                        self._speaking = False
                    except Exception:
                        self._speaking = False

                t = threading.Thread(target=_speak, daemon=True)
                t.start()
        else:
            # Fallback: print to console
            console.print(f"[bold cyan]🔊 JARVIS:[/bold cyan] {clean}")

    def listen(self, timeout: int = 10, phrase_limit: int = 30) -> Optional[str]:
        """Listen for voice input and return transcribed text."""
        if not self._recognizer or not self._microphone:
            return None

        console.print("[dim]🎤 Listening...[/dim]")

        try:
            with self._microphone as source:
                self._recognizer.adjust_for_ambient_noise(source, duration=0.3)
                audio = self._recognizer.listen(
                    source,
                    timeout=timeout,
                    phrase_time_limit=phrase_limit
                )

            console.print("[dim]Processing speech...[/dim]")

            # Try Google first, fallback to Sphinx
            try:
                text = self._recognizer.recognize_google(audio)
                return text.strip()
            except sr.UnknownValueError:
                return None
            except sr.RequestError:
                # Fallback to offline recognition
                try:
                    text = self._recognizer.recognize_sphinx(audio)
                    return text.strip()
                except Exception:
                    return None

        except sr.WaitTimeoutError:
            return None
        except Exception as e:
            console.print(f"[red]Listen error: {e}[/red]")
            return None

    def listen_for_wake_word(self, wake_word: str = "jarvis", timeout: int = 3) -> bool:
        """Listen for wake word activation."""
        if not self._recognizer or not self._microphone:
            return False

        try:
            with self._microphone as source:
                audio = self._recognizer.listen(source, timeout=timeout, phrase_time_limit=4)

            try:
                text = self._recognizer.recognize_google(audio).lower()
                return wake_word.lower() in text
            except Exception:
                return False
        except sr.WaitTimeoutError:
            return False
        except Exception:
            return False

    def is_speaking(self) -> bool:
        return self._speaking

    def stop_speaking(self):
        if self._tts_engine and self._speaking:
            try:
                self._tts_engine.stop()
                self._speaking = False
            except Exception:
                pass

    def has_microphone(self) -> bool:
        return self._microphone is not None

    def has_voice_output(self) -> bool:
        return self._tts_engine is not None

    @staticmethod
    def _strip_markdown(text: str) -> str:
        """Remove markdown formatting for cleaner TTS output."""
        import re
        # Remove code blocks
        text = re.sub(r"```[\s\S]*?```", "code block", text)
        text = re.sub(r"`[^`]+`", "", text)
        # Remove headers
        text = re.sub(r"#{1,6}\s+", "", text)
        # Remove bold/italic
        text = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"\1", text)
        text = re.sub(r"_{1,3}([^_]+)_{1,3}", r"\1", text)
        # Remove links
        text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
        # Remove bullet points
        text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
        # Remove extra whitespace
        text = re.sub(r"\n+", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()
