# VoiceAI Platform

A VAPI/Vaani-like voice AI platform for building, deploying, and managing AI-powered voice agents that can make and receive phone calls.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              VoiceAI Platform                        │
├──────────────────┬──────────────────────────────────┤
│  Next.js         │  Express + WebSocket              │
│  Dashboard       │  Backend API                      │
│  (port 3000)     │  (port 3001)                      │
├──────────────────┴──────────────────────────────────┤
│           Core AI Services                           │
│  STT: Deepgram  │  LLM: Claude  │  TTS: ElevenLabs  │
├──────────────────────────────────────────────────────┤
│  Telephony: Twilio  │  DB: PostgreSQL + Prisma        │
└─────────────────────────────────────────────────────┘
```

## Features

- **Voice AI Assistants** — Configurable agents with custom prompts, LLM, STT, and TTS settings
- **Inbound Calls** — Assign phone numbers to assistants for automatic call handling
- **Outbound Calls** — Programmatically dial numbers with AI agents
- **Real-time Streaming** — WebSocket-based audio pipeline: Twilio → Deepgram STT → Claude LLM → ElevenLabs TTS → Twilio
- **Call Transcripts** — Full conversation history for every call
- **Webhooks** — Receive call events at your endpoint
- **API Keys** — Authenticate with REST API using `sk-` prefixed keys
- **Dashboard** — Full web UI for managing assistants, calls, and phone numbers

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma + PostgreSQL |
| WebSocket | ws library |
| STT | Deepgram nova-2 |
| LLM | Anthropic Claude (claude-sonnet-4-6) |
| TTS | ElevenLabs eleven_turbo_v2_5 |
| Telephony | Twilio |
| Frontend | Next.js 15 + Tailwind CSS |
| Auth | JWT + API Keys |

## Quick Start

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
# Fill in your API keys
```

Required env vars:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret for JWT signing
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — Twilio credentials
- `TWILIO_WEBHOOK_BASE_URL` — Public URL for webhooks (use ngrok in dev)
- `DEEPGRAM_API_KEY` — Deepgram API key
- `ANTHROPIC_API_KEY` — Anthropic API key
- `ELEVENLABS_API_KEY` — ElevenLabs API key

### 3. Start database

```bash
docker-compose up -d postgres
```

### 4. Run migrations

```bash
npm run db:push
```

### 5. Start development

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

### 6. Expose backend for Twilio webhooks (dev)

```bash
ngrok http 3001
# Copy the https URL and set TWILIO_WEBHOOK_BASE_URL in .env
```

## REST API

All endpoints require `Authorization: Bearer <jwt-or-api-key>` header.

### Assistants
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assistants` | List assistants |
| POST | `/api/assistants` | Create assistant |
| GET | `/api/assistants/:id` | Get assistant |
| PATCH | `/api/assistants/:id` | Update assistant |
| DELETE | `/api/assistants/:id` | Delete assistant |

### Calls
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/calls` | List calls |
| POST | `/api/calls` | Initiate outbound call |
| GET | `/api/calls/:id` | Get call with transcript |
| DELETE | `/api/calls/:id` | Hang up call |

### Phone Numbers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/phone-numbers` | List numbers |
| POST | `/api/phone-numbers` | Purchase number |
| PATCH | `/api/phone-numbers/:id` | Assign assistant |
| DELETE | `/api/phone-numbers/:id` | Release number |

## Call Flow

```
Incoming Call → Twilio
    → POST /api/calls/inbound (TwiML response)
    → WebSocket /ws/call/:callId
    → Deepgram STT (real-time transcription)
    → Claude LLM (generate response)
    → ElevenLabs TTS (synthesize audio)
    → Audio sent back via WebSocket to Twilio
```

## Webhook Events

Configure a `webhookUrl` on your assistant to receive:

```json
{
  "event": "call.started",
  "call": {
    "id": "...",
    "status": "IN_PROGRESS",
    "type": "INBOUND",
    "assistantId": "..."
  },
  "timestamp": "2026-03-30T00:00:00Z"
}
```

Events: `call.started`, `call.ended`
