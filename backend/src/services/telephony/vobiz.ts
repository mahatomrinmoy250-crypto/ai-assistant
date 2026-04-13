import { config } from '../../config';

/**
 * Vobiz Telephony Service
 *
 * Vobiz API authentication uses TWO credentials:
 *   - Auth ID  → X-Auth-ID header
 *   - Auth Token → X-Auth-Token header
 *
 * Base URL: https://api.vobiz.ai
 * Endpoints: /api/v1/Account/{AUTH_ID}/...
 *
 * Flow:
 *   1. Inbound call → Vobiz POSTs to /api/calls/inbound (Answer URL)
 *   2. We return XML with <Stream url="wss://..."/> pointing to our WebSocket
 *   3. Vobiz opens WebSocket and streams mulaw 8kHz audio bidirectionally
 *   4. We process audio with Gemini Live and send audio response back
 */

export class VobizService {
  private authId: string;
  private authToken: string;
  private baseUrl: string;

  constructor(authId?: string, authToken?: string, baseUrl?: string) {
    this.authId = authId || config.vobiz.authId;
    this.authToken = authToken || config.vobiz.authToken;
    this.baseUrl = baseUrl || config.vobiz.apiBaseUrl;
  }

  /** Create a workspace-scoped instance */
  static forWorkspace(ws: {
    vobizAuthId?: string | null;
    vobizAuthToken?: string | null;
    vobizBaseUrl?: string | null;
  }) {
    return new VobizService(
      ws.vobizAuthId || undefined,
      ws.vobizAuthToken || undefined,
      ws.vobizBaseUrl || undefined,
    );
  }

  private get accountUrl() {
    return `${this.baseUrl}/api/v1/Account/${this.authId}`;
  }

  private authHeaders(): Record<string, string> {
    return {
      'X-Auth-ID': this.authId,
      'X-Auth-Token': this.authToken,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Generate XML for inbound/outbound call — streams audio to our WebSocket.
   * Vobiz (Plivo-based) uses <URL> as child element, not url attribute.
   */
  generateInboundXML(callId: string): string {
    const wsUrl = `wss://${new URL(config.vobiz.webhookBaseUrl).host}/ws/call/${callId}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream keepCallAlive="true" bidirectional="true">
    <URL>${wsUrl}</URL>
  </Stream>
</Response>`;
  }

  generateOutboundXML(callId: string): string {
    return this.generateInboundXML(callId);
  }

  /**
   * Initiate an outbound call via Vobiz REST API
   */
  async makeCall(to: string, from: string, answerUrl: string): Promise<string> {
    const response = await fetch(`${this.accountUrl}/Call/`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        from,
        to,
        answer_url: answerUrl,
        answer_method: 'POST',
        hangup_url: `${config.vobiz.webhookBaseUrl}/api/calls/status`,
        hangup_method: 'POST',
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
    await fetch(`${this.accountUrl}/Call/${callUuid}/`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  /**
   * List available DIDs (phone numbers to purchase)
   */
  async listAvailableNumbers(countryCode: string = 'IN', limit: number = 10) {
    const res = await fetch(
      `${this.accountUrl}/AvailableNumberList/?country_iso=${countryCode}&limit=${limit}`,
      { headers: this.authHeaders() }
    );
    const data = await res.json() as { objects: AvailableNumber[] };
    return data.objects || [];
  }

  /**
   * Purchase a phone number
   */
  async purchasePhoneNumber(number: string): Promise<{ uuid: string; number: string }> {
    const res = await fetch(`${this.accountUrl}/Number/`, {
      method: 'POST',
      headers: this.authHeaders(),
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
    await fetch(`${this.accountUrl}/Number/${numberUuid}/`, {
      method: 'POST',
      headers: this.authHeaders(),
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
    await fetch(`${this.accountUrl}/Number/${numberUuid}/`, {
      method: 'DELETE',
      headers: this.authHeaders(),
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
