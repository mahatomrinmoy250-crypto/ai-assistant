import { ElevenLabsClient } from 'elevenlabs';
import { config } from '../../config';
import { TTSOptions } from '../../types';

export class ElevenLabsTTSService {
  private client: ElevenLabsClient;

  constructor() {
    this.client = new ElevenLabsClient({ apiKey: config.elevenlabs.apiKey });
  }

  async synthesize(options: TTSOptions): Promise<Buffer> {
    const {
      text,
      voiceId,
      model = 'eleven_turbo_v2_5',
      stability = 0.5,
      similarityBoost = 0.75,
      speed = 1.0,
    } = options;

    const audioStream = await this.client.generate({
      voice: voiceId,
      model_id: model,
      text,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        speed,
      },
      output_format: 'ulaw_8000',
    });

    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async synthesizeStream(
    options: TTSOptions,
    onChunk: (chunk: Buffer) => void
  ): Promise<void> {
    const {
      text,
      voiceId,
      model = 'eleven_turbo_v2_5',
      stability = 0.5,
      similarityBoost = 0.75,
      speed = 1.0,
    } = options;

    const audioStream = await this.client.generate({
      voice: voiceId,
      model_id: model,
      text,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        speed,
      },
      output_format: 'ulaw_8000',
    });

    for await (const chunk of audioStream) {
      onChunk(Buffer.from(chunk));
    }
  }

  async listVoices() {
    return this.client.voices.getAll();
  }
}

export const elevenLabsTTS = new ElevenLabsTTSService();
