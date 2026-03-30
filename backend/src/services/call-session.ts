import { Assistant, Call } from '@prisma/client';
import { WebSocket } from 'ws';
import { ListenLiveClient } from '@deepgram/sdk';
import { prisma } from '../lib/prisma';
import { deepgramSTT } from './stt/deepgram';
import { claudeLLM } from './llm/claude';
import { elevenLabsTTS } from './tts/elevenlabs';
import { ConversationMessage } from '../types';
import { sendWebhookEvent } from './webhook';

interface CallSessionOptions {
  call: Call & { assistant: Assistant };
  ws: WebSocket;
}

export class CallSession {
  private call: Call & { assistant: Assistant };
  private ws: WebSocket;
  private sttConnection: ListenLiveClient | null = null;
  private conversationHistory: ConversationMessage[] = [];
  private isProcessing = false;
  private transcriptBuffer = '';
  private silenceTimer: NodeJS.Timeout | null = null;
  private streamSid: string | null = null;
  private isClosed = false;

  constructor({ call, ws }: CallSessionOptions) {
    this.call = call;
    this.ws = ws;
  }

  async start(): Promise<void> {
    const assistant = this.call.assistant;

    // Initialize STT
    this.sttConnection = deepgramSTT.createLiveTranscription(
      assistant.sttLanguage,
      assistant.sttModel,
      this.onTranscript.bind(this),
      this.onSTTError.bind(this)
    );

    // Update call status
    await prisma.call.update({
      where: { id: this.call.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    // Send first message if configured
    if (assistant.firstMessage) {
      await this.speak(assistant.firstMessage);

      this.conversationHistory.push({
        role: 'assistant',
        content: assistant.firstMessage,
      });

      await this.saveMessage('ASSISTANT', assistant.firstMessage);
    }

    await sendWebhookEvent(assistant, 'call.started', this.call);
  }

  processAudioChunk(audioData: Buffer): void {
    if (this.sttConnection && !this.isClosed) {
      this.sttConnection.send(audioData);
    }
  }

  setStreamSid(sid: string): void {
    this.streamSid = sid;
  }

  private async onTranscript(result: {
    transcript: string;
    isFinal: boolean;
    confidence?: number;
  }): Promise<void> {
    if (this.isClosed) return;

    if (!result.isFinal) {
      // Clear silence timer on activity
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    this.transcriptBuffer += ' ' + result.transcript;

    // Debounce: wait for brief silence before processing
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    this.silenceTimer = setTimeout(async () => {
      const userInput = this.transcriptBuffer.trim();
      this.transcriptBuffer = '';

      if (userInput && !this.isProcessing) {
        await this.processUserInput(userInput);
      }
    }, 500);
  }

  private async processUserInput(userInput: string): Promise<void> {
    this.isProcessing = true;
    const assistant = this.call.assistant;

    try {
      console.log(`[CallSession ${this.call.id}] User: ${userInput}`);

      // Check for end-call phrases
      if (assistant.endCallPhrases.length > 0) {
        const lowerInput = userInput.toLowerCase();
        const shouldEnd = assistant.endCallPhrases.some((phrase) =>
          lowerInput.includes(phrase.toLowerCase())
        );
        if (shouldEnd) {
          if (assistant.endCallMessage) {
            await this.speak(assistant.endCallMessage);
          }
          await this.end('COMPLETED');
          return;
        }
      }

      // Save user message
      this.conversationHistory.push({ role: 'user', content: userInput });
      await this.saveMessage('USER', userInput);

      // Get LLM response
      let responseText = '';
      for await (const chunk of claudeLLM.streamChat(
        this.conversationHistory,
        assistant.systemPrompt,
        assistant.llmModel,
        assistant.llmTemperature,
        assistant.llmMaxTokens
      )) {
        responseText += chunk;
      }

      if (!responseText) {
        this.isProcessing = false;
        return;
      }

      console.log(`[CallSession ${this.call.id}] Assistant: ${responseText}`);

      // Save assistant message
      this.conversationHistory.push({ role: 'assistant', content: responseText });
      await this.saveMessage('ASSISTANT', responseText);

      // Speak the response
      await this.speak(responseText);
    } catch (err) {
      console.error(`[CallSession ${this.call.id}] Error:`, err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async speak(text: string): Promise<void> {
    if (this.isClosed || !this.streamSid) return;

    const assistant = this.call.assistant;

    try {
      const audioBuffer = await elevenLabsTTS.synthesize({
        text,
        voiceId: assistant.ttsVoiceId,
        model: assistant.ttsModel,
        stability: assistant.ttsStability,
        similarityBoost: assistant.ttsSimilarity,
        speed: assistant.ttsSpeed,
      });

      // Send audio to Twilio via WebSocket media stream
      const base64Audio = audioBuffer.toString('base64');
      const mediaMessage = JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: base64Audio,
        },
      });

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(mediaMessage);
      }
    } catch (err) {
      console.error(`[CallSession ${this.call.id}] TTS error:`, err);
    }
  }

  private onSTTError(error: Error): void {
    console.error(`[CallSession ${this.call.id}] STT error:`, error);
  }

  async end(status: 'COMPLETED' | 'FAILED' | 'CANCELED' = 'COMPLETED'): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    if (this.sttConnection) {
      this.sttConnection.requestClose();
    }

    const endedAt = new Date();
    const startedAt = this.call.startedAt || endedAt;
    const duration = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

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

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  private async saveMessage(role: 'USER' | 'ASSISTANT' | 'SYSTEM', content: string): Promise<void> {
    await prisma.callMessage.create({
      data: {
        callId: this.call.id,
        role: role as 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL',
        content,
      },
    });
  }

  getTranscript(): ConversationMessage[] {
    return this.conversationHistory;
  }
}

// Active call sessions registry
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
