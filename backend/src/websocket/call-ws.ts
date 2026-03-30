import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { prisma } from '../lib/prisma';
import {
  CallSession,
  registerSession,
  getSession,
  removeSession,
} from '../services/call-session';

interface TwilioMediaMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
    accountSid: string;
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
    payload: string;
  };
  stop?: {
    accountSid: string;
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

    ws.on('message', async (data: Buffer) => {
      let message: TwilioMediaMessage;

      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (message.event) {
        case 'connected':
          console.log(`[WS ${callId}] Twilio media stream connected`);
          break;

        case 'start': {
          console.log(`[WS ${callId}] Stream started`);
          const streamSid = message.start?.streamSid;

          try {
            const call = await prisma.call.findUnique({
              where: { id: callId },
              include: { assistant: true },
            });

            if (!call) {
              console.error(`[WS ${callId}] Call not found`);
              ws.close();
              return;
            }

            session = new CallSession({ call, ws });
            registerSession(callId, session);

            if (streamSid) {
              session.setStreamSid(streamSid);
            }

            await session.start();
          } catch (err) {
            console.error(`[WS ${callId}] Error starting session:`, err);
            ws.close();
          }
          break;
        }

        case 'media': {
          const payload = message.media?.payload;
          if (payload && session) {
            const audioBuffer = Buffer.from(payload, 'base64');
            session.processAudioChunk(audioBuffer);
          }
          break;
        }

        case 'stop': {
          console.log(`[WS ${callId}] Stream stopped`);
          const activeSession = getSession(callId);
          if (activeSession) {
            await activeSession.end('COMPLETED');
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
        await activeSession.end('COMPLETED');
        removeSession(callId);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS ${callId}] WebSocket error:`, err);
    });
  });
}
