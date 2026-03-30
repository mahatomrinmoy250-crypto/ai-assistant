import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { ConversationMessage } from '../../types';

export class ClaudeLLMService {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  async chat(
    messages: ConversationMessage[],
    systemPrompt: string,
    model: string = 'claude-sonnet-4-6',
    temperature: number = 0.7,
    maxTokens: number = 500
  ): Promise<string> {
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  async *streamChat(
    messages: ConversationMessage[],
    systemPrompt: string,
    model: string = 'claude-sonnet-4-6',
    temperature: number = 0.7,
    maxTokens: number = 500
  ): AsyncGenerator<string> {
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const stream = await this.client.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }
}

export const claudeLLM = new ClaudeLLMService();
