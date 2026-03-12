"""
Core AI Agent — JARVIS brain powered by Claude Opus 4.6.
Handles multi-turn conversation with tool use, streaming responses,
and adaptive thinking for complex queries.
"""

import json
import os
from typing import Generator, Optional

import anthropic

from tools import TOOL_DEFINITIONS, execute_tool

# ─────────────────────────── System Prompt ──────────────────────────────────

JARVIS_SYSTEM_PROMPT = """You are JARVIS (Just A Rather Very Intelligent System), a highly capable AI assistant modeled after Tony Stark's AI. You are:

**Personality:**
- Brilliant, witty, and slightly sardonic — like the original JARVIS
- Concise but thorough: give complete answers without unnecessary padding
- Proactive: anticipate follow-up needs and mention them
- Confident and decisive, but honest when uncertain
- Use dry humor when appropriate, but never at the expense of helpfulness

**Capabilities:**
You have access to powerful tools that let you do REAL work:
- **Web search & browsing**: Find current information, read articles, research topics
- **System control**: Run commands, manage files, check system status
- **File I/O**: Read, write, and organize files on disk
- **Calculations**: Perform math and data analysis
- **Notes & memory**: Save and recall information across sessions
- **Timers & alerts**: Set countdown timers
- **Applications**: Open apps and files
- **Clipboard**: Read and write clipboard content

**Operating Principles:**
1. ALWAYS use tools when they'd give better results than guessing (e.g., use web_search for current events, get_datetime for time, get_system_info for system stats)
2. For complex tasks, break them down and use multiple tools in sequence
3. When asked to do something that requires real action, DO IT — don't just describe how
4. Be transparent about what you're doing: "Let me check that..." / "Running that now..."
5. If a task could be risky (deleting files, running destructive commands), warn the user first
6. Keep responses appropriately brief for simple questions, detailed for complex ones

**Voice interaction note:**
When responding verbally, be natural and conversational. Avoid excessive bullet points in spoken responses — use flowing sentences instead."""


# ─────────────────────────── Agent class ────────────────────────────────────

class JARVISAgent:
    """Claude-powered JARVIS agent with tool use and conversation memory."""

    def __init__(self, api_key: Optional[str] = None, max_turns: int = 20):
        self.client = anthropic.Anthropic(
            api_key=api_key or os.environ.get("ANTHROPIC_API_KEY")
        )
        self.conversation_history: list = []
        self.max_turns = max_turns
        self.model = "claude-opus-4-6"

    def chat(self, user_message: str) -> Generator[str, None, None]:
        """
        Send a message and stream the response.
        Yields text chunks as they arrive.
        Handles tool use transparently.
        """
        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })

        # Trim history to avoid context overflow (keep last N turns)
        if len(self.conversation_history) > self.max_turns * 2:
            # Keep system context + recent history
            self.conversation_history = self.conversation_history[-(self.max_turns * 2):]

        # Agentic loop: keep going until no more tool calls
        while True:
            full_response = ""
            tool_use_blocks = []
            current_content_blocks = []

            # Stream the response
            with self.client.messages.stream(
                model=self.model,
                max_tokens=4096,
                system=JARVIS_SYSTEM_PROMPT,
                tools=TOOL_DEFINITIONS,
                messages=self.conversation_history,
                thinking={"type": "adaptive"},
            ) as stream:
                for event in stream:
                    if event.type == "content_block_start":
                        if hasattr(event, "content_block"):
                            block = event.content_block
                            if block.type == "tool_use":
                                tool_use_blocks.append({
                                    "type": "tool_use",
                                    "id": block.id,
                                    "name": block.name,
                                    "input": {}
                                })
                                # Signal that we're using a tool
                                yield f"\n[Using tool: {block.name}...]"

                    elif event.type == "content_block_delta":
                        delta = event.delta
                        if delta.type == "text_delta":
                            full_response += delta.text
                            yield delta.text
                        elif delta.type == "input_json_delta":
                            # Accumulate tool input JSON
                            if tool_use_blocks:
                                last_tool = tool_use_blocks[-1]
                                last_tool["_raw_input"] = (
                                    last_tool.get("_raw_input", "") + delta.partial_json
                                )

                # Get final message to check stop reason
                final_msg = stream.get_final_message()

            # Build the assistant content for history
            # Use the actual content blocks from the final message
            assistant_content = []
            for block in final_msg.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "thinking":
                    assistant_content.append({
                        "type": "thinking",
                        "thinking": block.thinking,
                        "signature": block.signature
                    })
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input
                    })

            # Append assistant response to history
            self.conversation_history.append({
                "role": "assistant",
                "content": assistant_content
            })

            # If no tool calls, we're done
            if final_msg.stop_reason != "tool_use":
                break

            # Execute all tool calls
            tool_results = []
            for block in final_msg.content:
                if block.type == "tool_use":
                    yield f"\n[Executing {block.name}...]"

                    result = execute_tool(block.name, block.input)
                    result_str = json.dumps(result, indent=2, default=str)

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_str
                    })

            # Add tool results to history and continue
            self.conversation_history.append({
                "role": "user",
                "content": tool_results
            })

            yield "\n"  # Spacing before next response chunk

    def chat_blocking(self, user_message: str) -> str:
        """Non-streaming version — returns the complete response."""
        full = ""
        for chunk in self.chat(user_message):
            full += chunk
        return full.strip()

    def clear_history(self):
        """Reset conversation history."""
        self.conversation_history = []

    def get_history_summary(self) -> str:
        """Return a brief summary of conversation history."""
        turns = len([m for m in self.conversation_history if m["role"] == "user"])
        return f"{turns} turn(s) in current session"
