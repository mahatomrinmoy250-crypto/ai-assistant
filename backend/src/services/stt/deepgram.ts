import {
  createClient,
  LiveTranscriptionEvents,
  ListenLiveClient,
} from '@deepgram/sdk';
import { config } from '../../config';
import { STTResult } from '../../types';

export class DeepgramSTTService {
  private client;

  constructor() {
    this.client = createClient(config.deepgram.apiKey);
  }

  createLiveTranscription(
    language: string = 'en-US',
    model: string = 'nova-2',
    onTranscript: (result: STTResult) => void,
    onError: (error: Error) => void
  ): ListenLiveClient {
    const connection = this.client.listen.live({
      model,
      language,
      smart_format: true,
      interim_results: true,
      endpointing: 300,
      utterance_end_ms: 1000,
      vad_events: true,
      encoding: 'mulaw',
      sample_rate: 8000,
    });

    connection.on(LiveTranscriptionEvents.Open, () => {
      console.log('[Deepgram] Connection opened');
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript =
        data.channel?.alternatives?.[0]?.transcript || '';
      const isFinal = data.is_final ?? false;
      const confidence = data.channel?.alternatives?.[0]?.confidence;

      if (transcript.trim()) {
        onTranscript({ transcript, isFinal, confidence });
      }
    });

    connection.on(LiveTranscriptionEvents.Error, (err) => {
      console.error('[Deepgram] Error:', err);
      onError(err instanceof Error ? err : new Error(String(err)));
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log('[Deepgram] Connection closed');
    });

    return connection;
  }

  async transcribeBuffer(
    audioBuffer: Buffer,
    mimetype: string = 'audio/wav'
  ): Promise<string> {
    const response = await this.client.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: 'nova-2',
        smart_format: true,
        mimetype,
      }
    );

    return (
      response.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ||
      ''
    );
  }
}

export const deepgramSTT = new DeepgramSTTService();
