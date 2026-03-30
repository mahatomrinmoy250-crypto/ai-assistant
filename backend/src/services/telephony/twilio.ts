import twilio from 'twilio';
import { config } from '../../config';

const VoiceResponse = twilio.twiml.VoiceResponse;

export class TwilioService {
  private client: twilio.Twilio;

  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }

  /**
   * Generate TwiML to connect an inbound call to our WebSocket media stream
   */
  generateInboundTwiML(callId: string): string {
    const response = new VoiceResponse();
    const connect = response.connect();

    connect.stream({
      url: `wss://${new URL(config.twilio.webhookBaseUrl).host}/ws/call/${callId}`,
      track: 'inbound_track',
    });

    return response.toString();
  }

  /**
   * Generate TwiML for outbound call
   */
  generateOutboundTwiML(callId: string): string {
    const response = new VoiceResponse();
    const connect = response.connect();

    connect.stream({
      url: `wss://${new URL(config.twilio.webhookBaseUrl).host}/ws/call/${callId}`,
      track: 'inbound_track',
    });

    return response.toString();
  }

  /**
   * Initiate an outbound call
   */
  async makeCall(
    to: string,
    from: string,
    twimlUrl: string
  ): Promise<string> {
    const call = await this.client.calls.create({
      to,
      from,
      url: twimlUrl,
      method: 'POST',
      statusCallback: `${config.twilio.webhookBaseUrl}/api/calls/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      record: true,
    });

    return call.sid;
  }

  /**
   * Hang up an active call
   */
  async hangupCall(callSid: string): Promise<void> {
    await this.client.calls(callSid).update({ status: 'completed' });
  }

  /**
   * Purchase a phone number
   */
  async purchasePhoneNumber(areaCode: string = '415'): Promise<{
    sid: string;
    number: string;
    friendlyName: string;
  }> {
    const available =
      await this.client.availablePhoneNumbers('US').local.list({
        areaCode: parseInt(areaCode, 10),
        limit: 1,
      });

    if (!available.length) {
      throw new Error(`No numbers available in area code ${areaCode}`);
    }

    const purchased = await this.client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      voiceUrl: `${config.twilio.webhookBaseUrl}/api/calls/inbound`,
      voiceMethod: 'POST',
    });

    return {
      sid: purchased.sid,
      number: purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
    };
  }

  /**
   * Update the webhook URL for an incoming phone number
   */
  async updatePhoneWebhook(
    twilioSid: string,
    webhookUrl: string
  ): Promise<void> {
    await this.client.incomingPhoneNumbers(twilioSid).update({
      voiceUrl: webhookUrl,
      voiceMethod: 'POST',
    });
  }

  /**
   * Release a phone number
   */
  async releasePhoneNumber(twilioSid: string): Promise<void> {
    await this.client.incomingPhoneNumbers(twilioSid).remove();
  }

  /**
   * List available phone numbers
   */
  async listAvailableNumbers(areaCode: string = '415', limit: number = 10) {
    return this.client.availablePhoneNumbers('US').local.list({
      areaCode: parseInt(areaCode, 10),
      limit,
    });
  }

  /**
   * Validate that a request came from Twilio
   */
  validateRequest(
    authToken: string,
    twilioSignature: string,
    url: string,
    params: Record<string, string>
  ): boolean {
    return twilio.validateRequest(authToken, twilioSignature, url, params);
  }
}

export const twilioService = new TwilioService();
