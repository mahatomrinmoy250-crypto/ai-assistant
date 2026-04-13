import { WebSocket } from 'ws';
import { prisma } from '../lib/prisma';
import {
  setCallSession,
  deleteCallSession,
  incrementActiveCalls,
  decrementActiveCalls,
} from '../lib/redis';
import { GeminiLiveSession, ToolCallRequest } from './gemini-live';
import { vobizAudioToGemini, geminiAudioToVobiz } from './audio-transcoder';
import { dispatchWebhookEvent } from './webhook';
import { getAgentKbIds, searchKnowledgeBase } from './knowledge-base';
import { config } from '../config';

interface CallSessionData {
  callId: string;
  workspaceId: string;
  agentId: string;
  agentName: string;
  systemPrompt: string;
  greetingMessage: string;
  llmModel: string;
  ttsVoice: string;
  language: string;
  maxDurationMinutes: number;
  silenceTimeoutSeconds: number;
  vobizCallUuid: string | null;
  enableBooking: boolean;   // agent has booking tool enabled
}

interface CallSessionOptions {
  data: CallSessionData;
  ws: WebSocket;
  streamSid?: string;
}

/**
 * CallSession — one instance per active phone call on THIS server.
 *
 * Scaling model:
 *   - Nginx uses ip_hash sticky sessions → same caller always hits same server
 *   - Redis stores callId → serverId mapping for cross-server lookups
 *   - Each server holds its own in-memory sessions (audio is local)
 */
export class CallSession {
  private data: CallSessionData;
  private ws: WebSocket;
  private streamSid: string | null;
  private gemini: GeminiLiveSession;
  private isClosed = false;
  private audioQueue: Buffer[] = [];
  private isSending = false;
  private maxDurationTimer: NodeJS.Timeout | null = null;
  private kbIds: string[] = [];

  constructor({ data, ws, streamSid }: CallSessionOptions) {
    this.data = data;
    this.ws = ws;
    this.streamSid = streamSid || null;

    // GeminiLiveSession is initialized in start() once KB IDs are loaded
    this.gemini = new GeminiLiveSession({
      systemPrompt: data.systemPrompt,
      voiceName: data.ttsVoice,
      languageCode: data.language,
      hasKnowledgeBase: false,
      onAudio: this.handleGeminiAudio.bind(this),
      onTranscript: this.handleTranscript.bind(this),
      onToolCall: this.handleToolCall.bind(this),
      onError: (e) => console.error(`[CallSession ${data.callId}] Gemini error:`, e),
      onClose: () => this.end('completed').catch(console.error),
    });
  }

  async start(): Promise<void> {
    try {
      // Load agent's knowledge base IDs
      this.kbIds = await getAgentKbIds(this.data.agentId);
      const hasKnowledgeBase = this.kbIds.length > 0;

      if (hasKnowledgeBase) {
        console.log(`[CallSession ${this.data.callId}] KB attached: ${this.kbIds.join(', ')}`);
      }

      await this.gemini.connect({
        systemPrompt: this.data.systemPrompt,
        voiceName: this.data.ttsVoice,
        languageCode: this.data.language,
        hasKnowledgeBase,
        enableBooking: this.data.enableBooking,
        onAudio: this.handleGeminiAudio.bind(this),
        onTranscript: this.handleTranscript.bind(this),
        onToolCall: this.handleToolCall.bind(this),
        onError: (e) => console.error(`[CallSession ${this.data.callId}]`, e),
        onClose: () => this.end('completed').catch(console.error),
      });

      // Track in Redis
      await setCallSession(this.data.callId, {
        serverId: config.serverId,
        workspaceId: this.data.workspaceId,
        agentId: this.data.agentId,
      });
      await incrementActiveCalls(this.data.workspaceId);

      // Update call status
      await prisma.call.update({
        where: { id: this.data.callId },
        data: { status: 'in-progress' },
      });

      // Max duration enforcement
      this.maxDurationTimer = setTimeout(
        () => this.end('completed'),
        this.data.maxDurationMinutes * 60 * 1000
      );

      // Send greeting
      if (this.data.greetingMessage) {
        this.gemini.sendText(
          `[Start the call by saying exactly]: ${this.data.greetingMessage}`
        );
        await this.saveMessage('assistant', this.data.greetingMessage);
      }

      await dispatchWebhookEvent(this.data.workspaceId, 'call.started', {
        callId: this.data.callId,
        agentId: this.data.agentId,
        agentName: this.data.agentName,
      });

      console.log(`[CallSession ${this.data.callId}] Started — agent: ${this.data.agentName}`);
    } catch (err) {
      console.error(`[CallSession ${this.data.callId}] Start failed:`, err);
      await this.end('failed');
    }
  }

  private async handleToolCall(call: ToolCallRequest): Promise<string> {
    console.log(`[CallSession ${this.data.callId}] Tool: ${call.name}`, call.args);

    if (call.name === 'search_knowledge_base') {
      const query = String(call.args.query ?? '');
      if (!query) return 'No query provided.';
      const result = await searchKnowledgeBase(this.kbIds, query);
      return result || 'No relevant information found in the knowledge base.';
    }

    if (call.name === 'book_appointment') {
      return this.handleBookAppointment(call.args);
    }

    return `Unknown tool: ${call.name}`;
  }

  private async handleBookAppointment(args: Record<string, unknown>): Promise<string> {
    const patientName   = String(args.patient_name   ?? '').trim();
    const patientPhone  = String(args.patient_phone  ?? '').trim();
    const appointmentDate = String(args.appointment_date ?? '').trim();
    const appointmentTime = String(args.appointment_time ?? '').trim();
    const notes         = String(args.notes          ?? '').trim();

    if (!patientName || !appointmentDate || !appointmentTime) {
      return 'Booking failed: name, date, and time are required.';
    }

    try {
      // Save booking to DB
      const booking = await prisma.booking.create({
        data: {
          workspaceId:     this.data.workspaceId,
          agentId:         this.data.agentId,
          callId:          this.data.callId,
          patientName,
          patientPhone,
          appointmentDate,
          appointmentTime,
          notes,
          status:          'confirmed',
        },
      });

      // Mark call as booking confirmed
      await prisma.call.update({
        where: { id: this.data.callId },
        data: {
          bookingConfirmed: true,
          extractedData: {
            patientName, patientPhone, appointmentDate, appointmentTime, notes,
            bookingId: booking.id,
          },
        },
      });

      // Fire webhook so doctor's CRM / Google Sheets / n8n can pick it up
      await dispatchWebhookEvent(this.data.workspaceId, 'booking.created', {
        bookingId:       booking.id,
        callId:          this.data.callId,
        agentId:         this.data.agentId,
        patientName,
        patientPhone,
        appointmentDate,
        appointmentTime,
        notes,
      });

      console.log(`[CallSession ${this.data.callId}] Booking saved: ${booking.id} — ${patientName} on ${appointmentDate} at ${appointmentTime}`);

      return `Appointment confirmed for ${patientName} on ${appointmentDate} at ${appointmentTime}. Booking ID: ${booking.id}`;
    } catch (err) {
      console.error(`[CallSession ${this.data.callId}] Booking save failed:`, err);
      return 'Booking could not be saved due to a system error. Please try again.';
    }
  }

  processAudioChunk(l16Base64: string): void {
    if (this.isClosed || !this.gemini.isConnected()) return;
    try {
      const pcm16k = vobizAudioToGemini(l16Base64);
      this.gemini.sendAudio(pcm16k);
    } catch (err) {
      console.error(`[CallSession ${this.data.callId}] Audio error:`, err);
    }
  }

  setStreamSid(sid: string): void {
    this.streamSid = sid;
  }

  private handleGeminiAudio(pcm24kBuffer: Buffer): void {
    if (this.isClosed) return;
    this.audioQueue.push(pcm24kBuffer);
    if (!this.isSending) this.flushAudioQueue();
  }

  private flushAudioQueue(): void {
    if (this.audioQueue.length === 0) {
      this.isSending = false;
      return;
    }
    this.isSending = true;
    const chunk = this.audioQueue.shift()!;

    try {
      const l16Base64 = geminiAudioToVobiz(chunk);
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            event: 'playAudio',
            media: {
              contentType: 'audio/x-l16',
              sampleRate: 8000,
              payload: l16Base64,
            },
          }),
          () => setImmediate(() => this.flushAudioQueue())
        );
      }
    } catch (err) {
      console.error(`[CallSession ${this.data.callId}] Audio send error:`, err);
      this.flushAudioQueue();
    }
  }

  private async handleTranscript(text: string, role: 'user' | 'model'): Promise<void> {
    if (!text.trim()) return;
    const dbRole = role === 'user' ? 'user' : 'assistant';
    console.log(`[CallSession ${this.data.callId}] ${dbRole.toUpperCase()}: ${text}`);
    await this.saveMessage(dbRole, text).catch(console.error);
  }

  clearAudio(): void {
    if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
      this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
    }
    this.audioQueue = [];
    this.isSending = false;
  }

  async end(outcome: 'completed' | 'failed' | 'canceled' = 'completed'): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    this.gemini.close();
    this.audioQueue = [];

    const endedAt = new Date();

    try {
      // Calculate cost in rupees: ~₹0.5/min (Gemini + Vobiz combined)
      const call = await prisma.call.findUnique({ where: { id: this.data.callId } });
      const durationSeconds = call?.createdAt
        ? Math.floor((endedAt.getTime() - new Date(call.createdAt).getTime()) / 1000)
        : 0;
      const costRupees = parseFloat(((durationSeconds / 60) * 0.5).toFixed(2));

      await prisma.call.update({
        where: { id: this.data.callId },
        data: { status: outcome, outcome, endedAt, durationSeconds, costRupees },
      });

      // Deduct credits from workspace
      await prisma.workspace.update({
        where: { id: this.data.workspaceId },
        data: { creditsBalance: { decrement: costRupees } },
      });

      // Log billing transaction
      await prisma.billingTransaction.create({
        data: {
          workspaceId: this.data.workspaceId,
          callId: this.data.callId,
          amount: -costRupees,
          type: 'call_deduction',
          description: `Call ${this.data.callId} — ${durationSeconds}s`,
        },
      });

      await deleteCallSession(this.data.callId);
      await decrementActiveCalls(this.data.workspaceId);

      await dispatchWebhookEvent(this.data.workspaceId, 'call.ended', {
        callId: this.data.callId,
        agentId: this.data.agentId,
        outcome,
        durationSeconds,
        costRupees,
      });

      console.log(`[CallSession ${this.data.callId}] Ended — ${outcome}, ${durationSeconds}s, ₹${costRupees}`);
    } catch (err) {
      console.error(`[CallSession ${this.data.callId}] End error:`, err);
    }

    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }

  private async saveMessage(role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    await prisma.callMessage.create({
      data: { callId: this.data.callId, role, content },
    });
  }
}

// ─── Per-server in-memory session registry ───────────────────────────────────
// Sticky sessions (Nginx ip_hash) ensure each call always hits the same server
const activeSessions = new Map<string, CallSession>();

export function registerSession(callId: string, session: CallSession): void {
  activeSessions.set(callId, session);
}

export function getSession(callId: string): CallSession | undefined {
  return activeSessions.get(callId);
}

export function removeSession(callId: string): void {
  activeSessions.delete(callId);
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
