import { prisma } from '../lib/prisma';
import { enqueueWebhook } from '../lib/queue';
import crypto from 'crypto';

/**
 * Dispatch a webhook event to all active endpoints for a workspace.
 * - Creates a WebhookDelivery record (status: pending)
 * - Enqueues to BullMQ for async delivery with HMAC signing + retries
 */
export async function dispatchWebhookEvent(
  workspaceId: string,
  event: string,
  payload: object
): Promise<void> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        workspaceId,
        isActive: true,
        events: { has: event },
      },
    });

    if (endpoints.length === 0) return;

    await Promise.all(
      endpoints.map(async (endpoint: { id: string; url: string; secret: string }) => {
        const deliveryId = crypto.randomUUID();

        await prisma.webhookDelivery.create({
          data: {
            id: deliveryId,
            webhookEndpointId: endpoint.id,
            event,
            payload,
            status: 'pending',
          },
        });

        await enqueueWebhook({
          deliveryId,
          url: endpoint.url,
          secret: endpoint.secret,
          event,
          payload,
        });
      })
    );
  } catch (err) {
    console.error(`[Webhook] dispatchWebhookEvent error (${event}):`, err);
  }
}
