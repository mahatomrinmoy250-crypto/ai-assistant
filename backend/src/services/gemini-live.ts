import { GoogleGenAI, Modality, Session, LiveConnectConfig, Tool } from '@google/genai';
import { config } from '../config';

/**
 * Gemini 3.1 Flash Live Service
 *
 * Replaces entire STT + LLM + TTS pipeline with a single real-time WebSocket session.
 *
 * Audio flow:
 *   Vobiz mulaw 8kHz → [transcoder] → PCM 16kHz → Gemini Live
 *   Gemini Live PCM 24kHz → [transcoder] → mulaw 8kHz → Vobiz
 *
 * Tool calling flow:
 *   Gemini issues toolCall → onToolCall callback → caller executes tool
 *   → sendToolResponse() → Gemini resumes with result
 */

export const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview';

// Available voices for Gemini 3.1 Flash Live
export const GEMINI_VOICES = [
  'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede',
  'Leda', 'Orus', 'Zephyr', 'Achernar', 'Schedar',
];

export interface ToolCallRequest {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiLiveConfig {
  systemPrompt: string;
  voiceName?: string;
  languageCode?: string;
  hasKnowledgeBase?: boolean;
  enableBooking?: boolean;        // turn on book_appointment tool
  onAudio: (pcm24kBuffer: Buffer) => void;
  onTranscript: (text: string, role: 'user' | 'model') => void;
  onToolCall: (call: ToolCallRequest) => Promise<string>;
  onError: (err: Error) => void;
  onClose: () => void;
}

// ─── Tool declarations ────────────────────────────────────────────────────────

const KB_SEARCH_TOOL: Tool = {
  functionDeclarations: [
    {
      name: 'search_knowledge_base',
      description:
        'Search the agent knowledge base for relevant information to answer the user. ' +
        'Use this when the user asks a question that may be answered from product, policy, or FAQ content.',
      parameters: {
        type: 'object' as any,
        properties: {
          query: {
            type: 'string' as any,
            description: 'The search query — what you want to look up',
          },
        },
        required: ['query'],
      },
    },
  ],
};

const BOOKING_TOOL: Tool = {
  functionDeclarations: [
    {
      name: 'book_appointment',
      description:
        'Book an appointment for the patient. Call this ONLY when the patient has clearly confirmed ' +
        'their name, preferred date, and preferred time. Confirm all details with the patient before calling.',
      parameters: {
        type: 'object' as any,
        properties: {
          patient_name: {
            type: 'string' as any,
            description: "Patient's full name as they said it",
          },
          patient_phone: {
            type: 'string' as any,
            description: "Patient's phone number if they provided it, else empty string",
          },
          appointment_date: {
            type: 'string' as any,
            description: 'Appointment date in YYYY-MM-DD format, e.g. 2026-04-05',
          },
          appointment_time: {
            type: 'string' as any,
            description: 'Appointment time as spoken, e.g. "3:00 PM" or "subah 10 baje"',
          },
          notes: {
            type: 'string' as any,
            description: 'Any additional notes the patient mentioned (symptoms, reason for visit, etc.)',
          },
        },
        required: ['patient_name', 'appointment_date', 'appointment_time'],
      },
    },
  ],
};

// ─── Session class ────────────────────────────────────────────────────────────

export class GeminiLiveSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private cfg: GeminiLiveConfig | null = null;
  private isClosed = false;

  constructor(cfg: GeminiLiveConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    this.cfg = cfg;
  }

  async connect(cfg: GeminiLiveConfig): Promise<void> {
    this.cfg = cfg;

    const tools: Tool[] = [];
    if (cfg.hasKnowledgeBase) tools.push(KB_SEARCH_TOOL);
    if (cfg.enableBooking)    tools.push(BOOKING_TOOL);

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
      // Tool declarations (only when KB is available)
      ...(tools.length > 0 ? { tools } : {}),
    };

    this.session = await this.ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: liveConfig,
      callbacks: {
        onopen: () => {
          console.log('[GeminiLive] Session connected');
        },

        onmessage: (message) => {
          if (this.isClosed || !this.cfg) return;

          // Diagnostic: log structure of every message
          const structure: string[] = [];
          if (message.serverContent?.modelTurn) structure.push('modelTurn');
          if (message.serverContent?.inputTranscription) structure.push('inputTx');
          if (message.serverContent?.outputTranscription) structure.push('outputTx');
          if (message.serverContent?.turnComplete) structure.push('turnComplete');
          if (message.serverContent?.interrupted) structure.push('interrupted');
          if (message.serverContent?.generationComplete) structure.push('genComplete');
          if (message.toolCall) structure.push('toolCall');
          if (message.setupComplete) structure.push('setupComplete');
          if (structure.length > 0) {
            console.log(`[GeminiLive] msg: ${structure.join(',')}`);
          } else {
            console.log('[GeminiLive] msg raw:', JSON.stringify(message).slice(0, 300));
          }

          // Audio response chunks
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              const mime = part.inlineData?.mimeType;
              if (mime) console.log(`[GeminiLive] audio part mimeType: ${mime}`);
              if (mime?.startsWith('audio/pcm')) {
                const audioData = Buffer.from(part.inlineData?.data || '', 'base64');
                this.cfg.onAudio(audioData);
              }
            }
          }

          // Input (user) transcript
          if (message.serverContent?.inputTranscription?.text) {
            this.cfg.onTranscript(message.serverContent.inputTranscription.text, 'user');
          }

          // Output (model) transcript
          if (message.serverContent?.outputTranscription?.text) {
            this.cfg.onTranscript(message.serverContent.outputTranscription.text, 'model');
          }

          // Turn complete
          if (message.serverContent?.turnComplete) {
            console.log('[GeminiLive] Model turn complete');
          }

          // Tool call request from Gemini
          if (message.toolCall?.functionCalls?.length) {
            for (const fc of message.toolCall.functionCalls) {
              const callRequest: ToolCallRequest = {
                callId: fc.id ?? '',
                name: fc.name ?? '',
                args: (fc.args as Record<string, unknown>) ?? {},
              };

              console.log(`[GeminiLive] Tool call: ${callRequest.name}`, callRequest.args);

              // Execute async and send response back
              this.cfg.onToolCall(callRequest)
                .then((result) => this.sendToolResponse(callRequest.callId, callRequest.name, result))
                .catch((err) => {
                  console.error('[GeminiLive] Tool call failed:', err);
                  this.sendToolResponse(callRequest.callId, callRequest.name, 'Error: could not retrieve information');
                });
            }
          }
        },

        onerror: (e) => {
          console.error('[GeminiLive] Error:', e);
          this.cfg?.onError(e instanceof Error ? e : new Error(String(e)));
        },

        onclose: (e) => {
          console.log('[GeminiLive] Session closed:', e?.reason);
          this.isClosed = true;
          this.cfg?.onClose();
        },
      },
    });

    console.log(`[GeminiLive] Connected — model: ${GEMINI_LIVE_MODEL}, tools: ${tools.length}`);
  }

  private sendAudioCount = 0;

  /**
   * Send PCM audio (16kHz, 16-bit LE) to Gemini
   */
  sendAudio(pcm16kBuffer: Buffer): void {
    if (this.isClosed || !this.session) return;

    this.sendAudioCount++;
    if (this.sendAudioCount === 1 || this.sendAudioCount % 100 === 0) {
      console.log(`[GeminiLive] sendAudio #${this.sendAudioCount}, bytes: ${pcm16kBuffer.length}`);
    }

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

    console.log(`[GeminiLive] sendText: ${text.slice(0, 100)}`);
    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
  }

  /**
   * Send tool result back to Gemini so it can continue the conversation
   */
  sendToolResponse(callId: string, name: string, result: string): void {
    if (this.isClosed || !this.session) return;

    this.session.sendToolResponse({
      functionResponses: [
        {
          id: callId,
          name,
          response: { output: result },
        },
      ],
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
