import { GoogleGenAI, Modality, Session, LiveConnectConfig } from '@google/genai';
import { config } from '../config';

/**
 * Gemini 3.1 Flash Live Service
 *
 * Replaces entire STT + LLM + TTS pipeline with a single real-time WebSocket session.
 *
 * Audio flow:
 *   Vobiz mulaw 8kHz → [transcoder] → PCM 16kHz → Gemini Live
 *   Gemini Live PCM 24kHz → [transcoder] → mulaw 8kHz → Vobiz
 */

export const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview';

// Available voices for Gemini 3.1 Flash Live
export const GEMINI_VOICES = [
  'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede',
  'Leda', 'Orus', 'Zephyr', 'Achernar', 'Schedar',
];

export interface GeminiLiveConfig {
  systemPrompt: string;
  voiceName?: string;
  languageCode?: string;
  onAudio: (pcm24kBuffer: Buffer) => void;
  onTranscript: (text: string, role: 'user' | 'model') => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export class GeminiLiveSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private onAudio: (pcm24kBuffer: Buffer) => void;
  private onTranscript: (text: string, role: 'user' | 'model') => void;
  private onError: (err: Error) => void;
  private onClose: () => void;
  private isClosed = false;

  constructor(cfg: GeminiLiveConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    this.onAudio = cfg.onAudio;
    this.onTranscript = cfg.onTranscript;
    this.onError = cfg.onError;
    this.onClose = cfg.onClose;
  }

  async connect(cfg: GeminiLiveConfig): Promise<void> {
    const liveConfig: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: {
        parts: [{ text: cfg.systemPrompt }],
      },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: cfg.voiceName || 'Puck',
          },
        },
        languageCode: cfg.languageCode || 'en-US',
      },
      // Enable input/output transcripts for logging
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Use minimal thinking for lowest latency
      thinkingConfig: {
        thinkingBudget: 0,
      },
    };

    this.session = await this.ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: liveConfig,
      callbacks: {
        onopen: () => {
          console.log('[GeminiLive] Session connected');
        },

        onmessage: (message) => {
          if (this.isClosed) return;

          // Audio response chunks
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
                const audioData = Buffer.from(part.inlineData.data || '', 'base64');
                this.onAudio(audioData);
              }
            }
          }

          // Input (user) transcript
          if (message.serverContent?.inputTranscription?.text) {
            this.onTranscript(message.serverContent.inputTranscription.text, 'user');
          }

          // Output (model) transcript
          if (message.serverContent?.outputTranscription?.text) {
            this.onTranscript(message.serverContent.outputTranscription.text, 'model');
          }

          // Turn complete
          if (message.serverContent?.turnComplete) {
            console.log('[GeminiLive] Model turn complete');
          }
        },

        onerror: (e) => {
          console.error('[GeminiLive] Error:', e);
          this.onError(e instanceof Error ? e : new Error(String(e)));
        },

        onclose: (e) => {
          console.log('[GeminiLive] Session closed:', e?.reason);
          this.isClosed = true;
          this.onClose();
        },
      },
    });

    console.log(`[GeminiLive] Connected — model: ${GEMINI_LIVE_MODEL}`);
  }

  /**
   * Send PCM audio (16kHz, 16-bit LE) to Gemini
   */
  sendAudio(pcm16kBuffer: Buffer): void {
    if (this.isClosed || !this.session) return;

    this.session.sendRealtimeInput({
      audio: {
        data: pcm16kBuffer.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  }

  /**
   * Send a text message (e.g. first greeting)
   */
  sendText(text: string): void {
    if (this.isClosed || !this.session) return;

    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
  }

  /**
   * Close the Gemini session
   */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.session?.close();
  }

  isConnected(): boolean {
    return !this.isClosed && this.session !== null;
  }
}
