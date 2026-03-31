import { Assistant, Call } from '@prisma/client';
import { WebSocket } from 'ws';
import { prisma } from '../lib/prisma';
import { GeminiLiveSession } from './gemini-live';
import { vobizAudioToGemini, geminiAudioToVobiz } from './audio-transcoder';
import { sendWebhookEvent } from './webhook';

interface CallSessionOptions {
  call: Call & { assistant: Assistant };
  ws: WebSocket;
  streamSid?: string;
}

/**
 * CallSession — one instance per active phone call.
 *
 * Audio pipeline:
 *   Vobiz WS (mulaw 8kHz base64)
 *     → vobizAudioToGemini()   [mulaw 8k → PCM 16k]
 *     → GeminiLiveSession.sendAudio()
 *     ← GeminiLiveSession.onAudio()  [PCM 24k]
 *     ← geminiAudioToVobiz()   [PCM 24k → mulaw 8k base64]
 *     → Vobiz WS media message
 */
export class CallSession {
  private call: Call & { assistant: Assistant };
  private ws: WebSocket;
  private streamSid: string | null;
  private gemini: GeminiLiveSession;
  private isClosed = false;
  private audioQueue: Buffer[] = [];
  private isSending = false;

  constructor({ call, ws, streamSid }: CallSessionOptions) {
    this.call = call;
    this.ws = ws;
    this.streamSid = streamSid || null;

    this.gemini = new GeminiLiveSession({
      systemPrompt: call.assistant.systemPrompt,
      voiceName: call.assistant.ttsVoiceId || 'Puck',
      languageCode: call.assistant.sttLanguage || 'en-US',
      onAudio: this.handleGeminiAudio.bind(this),
      onTranscript: this.handleTranscript.bind(this),
      onError: this.handleGeminiError.bind(this),
      onClose: this.handleGeminiClose.bind(this),
    });
  }

  async start(): Promise<void> {
    const assistant = this.call.assistant;

    try {
      // Connect to Gemini Live
      await this.gemini.connect({
        systemPrompt: assistant.systemPrompt,
        voiceName: assistant.ttsVoiceId || 'Puck',
        languageCode: assistant.sttLanguage || 'en-US',
        onAudio: this.handleGeminiAudio.bind(this),
        onTranscript: this.handleTranscript.bind(this),
        onError: this.handleGeminiError.bind(this),
        onClose: this.handleGeminiClose.bind(this),
      });

      // Update call status
      await prisma.call.update({
        where: { id: this.call.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });

      // Send first message if configured
      if (assistant.firstMessage) {
        this.gemini.sendText(
          `[SYSTEM: Say this exactly as the opening greeting]: ${assistant.firstMessage}`
        );
        await this.saveMessage('ASSISTANT', assistant.firstMessage);
      }

      await sendWebhookEvent(assistant, 'call.started', this.call);
      console.log(`[CallSession ${this.call.id}] Started`);
    } catch (err) {
      console.error(`[CallSession ${this.call.id}] Failed to start:`, err);
      await this.end('FAILED');
    }
  }

  /**
   * Called when Vobiz sends inbound audio (mulaw 8kHz, base64)
   */
  processAudioChunk(mulawBase64: string): void {
    if (this.isClosed || !this.gemini.isConnected()) return;

    try {
      const pcm16k = vobizAudioToGemini(mulawBase64);
      this.gemini.sendAudio(pcm16k);
    } catch (err) {
      console.error(`[CallSession ${this.call.id}] Audio processing error:`, err);
    }
  }

  setStreamSid(sid: string): void {
    this.streamSid = sid;
  }

  /**
   * Gemini sends back PCM 24kHz audio → transcode → send to Vobiz
   */
  private handleGeminiAudio(pcm24kBuffer: Buffer): void {
    if (this.isClosed || !this.streamSid) return;

    // Queue for ordered delivery
    this.audioQueue.push(pcm24kBuffer);
    if (!this.isSending) {
      this.flushAudioQueue();
    }
  }

  private flushAudioQueue(): void {
    if (this.audioQueue.length === 0) {
      this.isSending = false;
      return;
    }

    this.isSending = true;
    const chunk = this.audioQueue.shift()!;

    try {
      const mulawBase64 = geminiAudioToVobiz(chunk);

      if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
        this.ws.send(
          JSON.stringify({
            event: 'media',
            streamSid: this.streamSid,
            media: { payload: mulawBase64 },
          }),
          () => {
            // Send next chunk after this one is queued
            setImmediate(() => this.flushAudioQueue());
          }
        );
      }
    } catch (err) {
      console.error(`[CallSession ${this.call.id}] Audio send error:`, err);
      this.flushAudioQueue();
    }
  }

  /**
   * Save transcript messages to DB
   */
  private async handleTranscript(text: string, role: 'user' | 'model'): Promise<void> {
    if (!text.trim()) return;

    const dbRole = role === 'user' ? 'USER' : 'ASSISTANT';
    console.log(`[CallSession ${this.call.id}] ${dbRole}: ${text}`);

    try {
      await this.saveMessage(dbRole as 'USER' | 'ASSISTANT', text);
    } catch (err) {
      console.error(`[CallSession ${this.call.id}] Failed to save transcript:`, err);
    }
  }

  private handleGeminiError(err: Error): void {
    console.error(`[CallSession ${this.call.id}] Gemini error:`, err);
  }

  private handleGeminiClose(): void {
    if (!this.isClosed) {
      console.log(`[CallSession ${this.call.id}] Gemini closed — ending call`);
      this.end('COMPLETED').catch(console.error);
    }
  }

  /**
   * Send clear message to Vobiz to stop buffered audio (for barge-in)
   */
  clearAudio(): void {
    if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
      this.ws.send(
        JSON.stringify({ event: 'clear', streamSid: this.streamSid })
      );
    }
    this.audioQueue = [];
    this.isSending = false;
  }

  async end(status: 'COMPLETED' | 'FAILED' | 'CANCELED' = 'COMPLETED'): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    this.gemini.close();
    this.audioQueue = [];

    const endedAt = new Date();
    const startedAt = this.call.startedAt || endedAt;
    const duration = Math.floor(
      (endedAt.getTime() - startedAt.getTime()) / 1000
    );

    try {
      await prisma.call.update({
        where: { id: this.call.id },
        data: { status, endedAt, duration },
      });

      await sendWebhookEvent(this.call.assistant, 'call.ended', {
        ...this.call,
        status,
        endedAt,
        duration,
      });
    } catch (err) {
      console.error(`[CallSession ${this.call.id}] Failed to update call:`, err);
    }

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    console.log(`[CallSession ${this.call.id}] Ended — status: ${status}, duration: ${duration}s`);
  }

  private async saveMessage(
    role: 'USER' | 'ASSISTANT' | 'SYSTEM',
    content: string
  ): Promise<void> {
    await prisma.callMessage.create({
      data: { callId: this.call.id, role, content },
    });
  }
}

// ─── Active session registry ─────────────────────────────────────────────────
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
