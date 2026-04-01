import { Queue, Worker, Job } from 'bullmq';
import { redis } from './redis';
import { prisma } from './prisma';
import { config } from '../config';
import crypto from 'crypto';

const QUEUE_NAME = 'webhook-delivery';

// ─── Queue (producer) ────────────────────────────────────────────────────────
export const webhookQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export interface WebhookJobData {
  deliveryId: string;
  url: string;
  secret: string;
  event: string;
  payload: object;
}

export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  await webhookQueue.add('deliver', data, {
    jobId: data.deliveryId,
  });
}

// ─── Worker (consumer) ───────────────────────────────────────────────────────
export function startWebhookWorker(): Worker {
  const worker = new Worker<WebhookJobData>(
    QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      const { deliveryId, url, secret, event, payload } = job.data;

      const body = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      let statusCode: number | null = null;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Event': event,
            'X-Webhook-Signature': `sha256=${signature}`,
            'User-Agent': 'VoiceAI-Platform/1.0',
          },
          body,
          signal: AbortSignal.timeout(10000),
        });

        statusCode = res.status;

        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: res.ok ? 'success' : 'failed',
            statusCode,
            attempts: job.attemptsMade + 1,
            lastAttemptAt: new Date(),
          },
        });

        if (!res.ok) {
          throw new Error(`Webhook returned ${statusCode}`);
        }
      } catch (err) {
        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'failed',
            statusCode,
            attempts: job.attemptsMade + 1,
            lastAttemptAt: new Date(),
          },
        });
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 20,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[WebhookWorker] Delivered: ${job.data.event} → ${job.data.url}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[WebhookWorker] Failed: ${job?.data.event}`, err.message);
  });

  return worker;
}

// ─── Campaign call queue ──────────────────────────────────────────────────────
export const campaignQueue = new Queue('campaign-calls', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export interface CampaignCallJobData {
  campaignId: string;
  contactId: string;
  phoneNumber: string;
  agentId: string;
  workspaceId: string;
  fromNumber: string;
}

export async function enqueueCampaignCall(data: CampaignCallJobData): Promise<void> {
  await campaignQueue.add('call', data);
}
