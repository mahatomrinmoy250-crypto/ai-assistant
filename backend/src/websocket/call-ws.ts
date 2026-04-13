import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { prisma } from '../lib/prisma';
import {
  CallSession,
  registerSession,
  getSession,
  removeSession,
} from '../services/call-session';

interface VobizMediaMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;   // Vobiz uses callSid or CallUUID
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;  // base64 L16 PCM (audio/x-l16)
  };
  stop?: {
    callSid: string;
  };
}

export function setupCallWebSocket(wss: WebSocketServer): void {
  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url || '';
    const match = url.match(/\/ws\/call\/([^/?]+)/);

    if (!match) {
      console.warn('[WS] Invalid WebSocket URL:', url);
      ws.close(1008, 'Invalid path');
      return;
    }

    const callId = match[1];
    console.log(`[WS] New connection for call: ${callId}`);

    let session: CallSession | null = null;
    let mediaCount = 0;

    ws.on('message', async (data: Buffer) => {
      let message: VobizMediaMessage;

      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      // Log every non-media event raw (media would flood)
      if (message.event !== 'media') {
        console.log(`[WS ${callId}] RAW ${message.event}:`, JSON.stringify(message).slice(0, 500));
      }

      switch (message.event) {
        case 'connected':
          console.log(`[WS ${callId}] Vobiz media stream connected`);
          break;

        case 'start': {
          const streamSid = message.start?.streamSid || (message as any).streamSid || (message as any).start_sid;
          console.log(`[WS ${callId}] Stream started, sid: ${streamSid}`);

          try {
            const call = await prisma.call.findUnique({
              where: { id: callId },
              include: { agent: true },
            });

            if (!call || !call.agent) {
              console.error(`[WS ${callId}] Call or agent not found`);
              ws.close();
              return;
            }

            const agent = call.agent;

            session = new CallSession({
              data: {
                callId: call.id,
                workspaceId: call.workspaceId ?? '',
                agentId: agent.id,
                agentName: agent.name,
                systemPrompt: agent.systemPrompt,
                greetingMessage: agent.greetingMessage,
                llmModel: agent.llmModel,
                ttsVoice: agent.ttsVoice,
                language: agent.language,
                maxDurationMinutes: agent.maxDurationMinutes,
                silenceTimeoutSeconds: agent.silenceTimeoutSeconds,
                vobizCallUuid: call.vobizCallUuid ?? null,
                enableBooking: agent.enableBooking,
              },
              ws,
              streamSid: streamSid,
            });

            registerSession(callId, session);
            await session.start();
          } catch (err) {
            console.error(`[WS ${callId}] Error starting session:`, err);
            ws.close();
          }
          break;
        }

        case 'media': {
          mediaCount++;
          if (mediaCount === 1 || mediaCount === 50 || mediaCount % 500 === 0) {
            console.log(`[WS ${callId}] media chunk #${mediaCount}, payload len: ${message.media?.payload?.length ?? 0}`);
          }
          const payload = message.media?.payload;
          if (payload && session) {
            session.processAudioChunk(payload);
          }
          break;
        }

        case 'stop': {
          console.log(`[WS ${callId}] Stream stopped`);
          const activeSession = getSession(callId);
          if (activeSession) {
            await activeSession.end('completed');
            removeSession(callId);
          }
          break;
        }
      }
    });

    ws.on('close', async () => {
      console.log(`[WS ${callId}] WebSocket closed`);
      const activeSession = getSession(callId);
      if (activeSession) {
        await activeSession.end('completed');
        removeSession(callId);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS ${callId}] WebSocket error:`, err);
    });
  });
}
