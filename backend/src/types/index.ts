import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export interface CreateAssistantDto {
  name: string;
  systemPrompt: string;
  firstMessage?: string;
  llmProvider?: string;
  llmModel?: string;
  llmTemperature?: number;
  llmMaxTokens?: number;
  sttProvider?: string;
  sttLanguage?: string;
  sttModel?: string;
  ttsProvider?: string;
  ttsVoiceId?: string;
  ttsModel?: string;
  ttsStability?: number;
  ttsSimilarity?: number;
  ttsSpeed?: number;
  endCallMessage?: string;
  endCallPhrases?: string[];
  maxCallDuration?: number;
  webhookUrl?: string;
}

export interface UpdateAssistantDto extends Partial<CreateAssistantDto> {}

export interface CreateCallDto {
  assistantId: string;
  toNumber: string;
  fromNumber?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface STTResult {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
}

export interface TTSOptions {
  text: string;
  voiceId: string;
  model: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
}

export interface WebhookEvent {
  event: string;
  call: {
    id: string;
    status: string;
    type: string;
    assistantId: string;
    startedAt?: string;
    endedAt?: string;
    duration?: number;
    transcript?: ConversationMessage[];
  };
}
