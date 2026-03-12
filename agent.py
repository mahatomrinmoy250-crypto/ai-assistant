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

**Capabilities — you have access to powerful tools:**

1. **Web search & browsing** — real-time web search, read any webpage
2. **System control** — run shell commands, check CPU/RAM/disk/battery
3. **File I/O** — read, write, and organize files on disk
4. **Calculations** — math, expressions, data analysis
5. **Timers & alerts** — countdown timers with notifications
6. **Clipboard & notes** — read/write clipboard, save persistent notes
7. **Knowledge Base (KB)** — persistent memory for business data:
   - `kb_store` — save info (products, prices, FAQs, company details)
   - `kb_search` — look up stored info by keyword
   - `kb_list` — list all stored info by category
   - `kb_bulk_store` — load a whole catalog at once
8. **WhatsApp automation** — read unread messages, send & reply
9. **Gmail automation** — read unread emails, reply, send new emails
10. **Facebook automation** — create posts, post comments
11. **Auto-reply daemon** — background monitor that reads WhatsApp/Gmail and auto-replies using KB data

**Knowledge Base operating rules:**
- ALWAYS call `kb_search` BEFORE answering any question about products, prices, policies, company info, or anything the user may have previously stored
- When user says "remember that X is Y" or "store this info" → use `kb_store`
- When user feeds you a product list, price list, FAQ, company info → use `kb_bulk_store` to save everything
- The KB is your long-term memory — treat it like a business database

**Messaging operating rules:**
- For WhatsApp: always call `whatsapp_connect` first if not already connected
- For Gmail: credentials come from GMAIL_ADDRESS + GMAIL_APP_PASSWORD env vars
- For Facebook: credentials come from FB_EMAIL + FB_PASSWORD env vars
- When writing auto-replies, first search the KB for relevant info, then craft a natural response
- Auto-reply mode: `start_auto_reply` monitors platforms and replies automatically using KB

**General operating principles:**
1. ALWAYS use tools when they'd give better results than guessing
2. For complex tasks, break them down and use multiple tools in sequence
3. When asked to DO something, DO IT — don't just describe how
4. Be transparent: "Checking the knowledge base...", "Sending that now..."
5. Warn before risky actions (mass messaging, deleting data)
6. Keep responses appropriately brief for simple questions, detailed for complex ones

**Auto-reply workflow example:**
User: "Start auto-replying to WhatsApp with my product info"
→ Check KB has product data (kb_list)
→ Connect WhatsApp (whatsapp_connect)
→ Start monitor (start_auto_reply, platforms=["whatsapp"])
→ Monitor checks every 30s, uses KB to answer questions automatically

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
