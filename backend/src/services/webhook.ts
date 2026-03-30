import { Assistant, Call } from '@prisma/client';

export async function sendWebhookEvent(
  assistant: Assistant,
  event: string,
  call: Partial<Call>
): Promise<void> {
  if (!assistant.webhookUrl) return;

  const payload = {
    event,
    call: {
      id: call.id,
      status: call.status,
      type: call.type,
      assistantId: call.assistantId,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      duration: call.duration,
      toNumber: call.toNumber,
      fromNumber: call.fromNumber,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(assistant.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': event,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error('[Webhook] Failed to send webhook:', err);
  }
}
