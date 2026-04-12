import { config } from '../../config';

/**
 * Vobiz Telephony Service
 *
 * Vobiz uses the same XML + WebSocket pattern as Twilio Media Streams.
 * Flow:
 *   1. Inbound call → Vobiz POSTs to /api/calls/inbound (Answer URL)
 *   2. We return XML with <Stream> pointing to our WebSocket
 *   3. Vobiz opens WebSocket and streams mulaw 8kHz audio bidirectionally
 *   4. We process audio with Gemini Live and send audio response back
 */

export class VobizService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || config.vobiz.apiKey;
    this.baseUrl = baseUrl || config.vobiz.apiBaseUrl;
  }

  /** Create a workspace-scoped instance */
  static forWorkspace(ws: { vobizApiKey?: string | null; vobizBaseUrl?: string | null }) {
    return new VobizService(ws.vobizApiKey || undefined, ws.vobizBaseUrl || undefined);
  }

  /**
   * Generate XML for inbound call — streams audio to our WebSocket
   */
  generateInboundXML(callId: string): string {
    const wsUrl = `wss://${new URL(config.vobiz.webhookBaseUrl).host}/ws/call/${callId}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream keepCallAlive="true">${wsUrl}</Stream>
</Response>`;
  }

  /**
   * Generate XML for outbound call — same stream setup
   */
  generateOutboundXML(callId: string): string {
    const wsUrl = `wss://${new URL(config.vobiz.webhookBaseUrl).host}/ws/call/${callId}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream keepCallAlive="true">${wsUrl}</Stream>
</Response>`;
  }

  /**
   * Initiate an outbound call via Vobiz REST API
   */
  async makeCall(
    to: string,
    from: string,
    answerUrl: string
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/Call/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        from,
        answer_url: answerUrl,
        answer_method: 'POST',
        hangup_url: `${config.vobiz.webhookBaseUrl}/api/calls/status`,
        hangup_method: 'POST',
        record: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Vobiz makeCall failed: ${err}`);
    }

    const data = await response.json() as { call_uuid: string };
    return data.call_uuid;
  }

  /**
   * Hang up an active call
   */
  async hangupCall(callUuid: string): Promise<void> {
    await fetch(`${this.baseUrl}/Call/${callUuid}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });
  }

  /**
   * List available DIDs (phone numbers to purchase)
   */
  async listAvailableNumbers(countryCode: string = 'IN', limit: number = 10) {
    const res = await fetch(
      `${this.baseUrl}/AvailableNumberList/?country_iso=${countryCode}&limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      }
    );
    const data = await res.json() as { objects: AvailableNumber[] };
    return data.objects || [];
  }

  /**
   * Purchase a phone number
   */
  async purchasePhoneNumber(number: string): Promise<{ uuid: string; number: string }> {
    const res = await fetch(`${this.baseUrl}/Number/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number }),
    });

    if (!res.ok) throw new Error('Failed to purchase number');
    const data = await res.json() as { uuid: string; number: string };
    return data;
  }

  /**
   * Assign webhook URLs to a phone number
   */
  async updateNumberWebhook(numberUuid: string, answerUrl: string): Promise<void> {
    await fetch(`${this.baseUrl}/Number/${numberUuid}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        answer_url: answerUrl,
        answer_method: 'POST',
      }),
    });
  }

  /**
   * Release a phone number
   */
  async releasePhoneNumber(numberUuid: string): Promise<void> {
    await fetch(`${this.baseUrl}/Number/${numberUuid}/`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
  }
}

export interface AvailableNumber {
  number: string;
  country: string;
  type: string;
  monthly_rental_rate: string;
}

export const vobizService = new VobizService();
