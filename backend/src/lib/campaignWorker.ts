import { Worker, Job } from 'bullmq';
import { redis } from './redis';
import { prisma } from './prisma';
import { config } from '../config';
import { vobizService } from '../services/telephony/vobiz';
import { CampaignCallJobData, campaignQueue } from './queue';

/**
 * Campaign Worker
 *
 * Processes campaign-calls queue jobs.
 * Each job = one outbound call to one contact.
 *
 * Flow:
 *   enqueueCampaignCall() → BullMQ job → worker picks up
 *   → Vobiz makeCall() → Call record created → Vobiz dials contact
 *   → CallSession handles the conversation
 *   → On hangup: campaign counters updated
 */

async function processCampaignCall(job: Job<CampaignCallJobData>): Promise<void> {
  const { campaignId, contactId, phoneNumber, agentId, workspaceId, fromNumber } = job.data;

  // Check campaign is still running (user may have paused/stopped it)
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true, maxConcurrent: true },
  });

  if (!campaign || campaign.status !== 'running') {
    console.log(`[CampaignWorker] Campaign ${campaignId} not running — skipping contact ${contactId}`);
    return;
  }

  // Create Call record
  const call = await prisma.call.create({
    data: {
      workspaceId,
      agentId,
      campaignId,
      phoneNumber,
      direction: 'outbound',
      type: 'campaign',
      status: 'queued',
    },
  });

  const answerUrl = `${config.vobiz.webhookBaseUrl}/api/calls/answer/${call.id}`;

  try {
    // Dial via Vobiz
    const vobizCallUuid = await vobizService.makeCall(phoneNumber, fromNumber, answerUrl);

    await prisma.call.update({
      where: { id: call.id },
      data: { vobizCallUuid, status: 'in-progress' },
    });

    console.log(`[CampaignWorker] Dialed ${phoneNumber} (call: ${call.id})`);

    // Increment called count
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { calledCount: { increment: 1 } },
    });

    // Check if all contacts have been dialed → mark campaign completed
    await checkCampaignCompletion(campaignId);
  } catch (err) {
    console.error(`[CampaignWorker] Call failed for ${phoneNumber}:`, err);

    await prisma.call.update({
      where: { id: call.id },
      data: { status: 'failed', outcome: 'failed', endedAt: new Date() },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        calledCount: { increment: 1 },
        failedCount: { increment: 1 },
      },
    });

    await checkCampaignCompletion(campaignId);
    throw err; // let BullMQ retry
  }
}

async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { totalContacts: true, calledCount: true, status: true },
  });

  if (campaign && campaign.calledCount >= campaign.totalContacts && campaign.status === 'running') {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'completed', updatedAt: new Date() },
    });
    console.log(`[CampaignWorker] Campaign ${campaignId} completed`);
  }
}

export function startCampaignWorker(): Worker {
  const worker = new Worker<CampaignCallJobData>(
    'campaign-calls',
    processCampaignCall,
    {
      connection: redis,
      concurrency: 10, // max 10 simultaneous campaign calls across all campaigns
    }
  );

  worker.on('completed', (job) => {
    console.log(`[CampaignWorker] Job done: ${job.data.phoneNumber}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[CampaignWorker] Job failed: ${job?.data.phoneNumber}`, err.message);
  });

  console.log('[CampaignWorker] Started');
  return worker;
}

// ─── Enqueue all contacts for a campaign ─────────────────────────────────────

export async function startCampaignJobs(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      contactList: {
        include: { contacts: true },
      },
      phoneNumber: true,
    },
  });

  if (!campaign) throw new Error('Campaign not found');
  if (!campaign.agentId) throw new Error('Campaign has no agent assigned');
  if (!campaign.phoneNumber) throw new Error('Campaign has no phone number assigned');
  if (!campaign.contactList) throw new Error('Campaign has no contact list assigned');

  const contacts = campaign.contactList.contacts;
  if (contacts.length === 0) throw new Error('Contact list is empty');

  // Get calls already made for this campaign to avoid re-dialing
  const alreadyCalled = await prisma.call.findMany({
    where: { campaignId, status: { not: 'failed' } },
    select: { phoneNumber: true },
  });
  const alreadyCalledNumbers = new Set(alreadyCalled.map((c: { phoneNumber: string }) => c.phoneNumber));

  const pending = contacts.filter((c: { id: string; phoneNumber: string }) => !alreadyCalledNumbers.has(c.phoneNumber));

  // Enqueue jobs with rate limiting: spread calls with 1s delay between each
  for (let i = 0; i < pending.length; i++) {
    const contact = pending[i];
    await campaignQueue.add(
      'call',
      {
        campaignId,
        contactId: contact.id,
        phoneNumber: contact.phoneNumber,
        agentId: campaign.agentId,
        workspaceId: campaign.workspaceId!,
        fromNumber: campaign.phoneNumber.number,
      },
      {
        delay: i * 1000, // 1 second between each call to avoid flooding
        jobId: `campaign-${campaignId}-contact-${contact.id}`,
        // Prevent duplicate jobs if campaign is restarted
      }
    );
  }

  // Update campaign with total contacts
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      totalContacts: contacts.length,
      status: 'running',
      updatedAt: new Date(),
    },
  });

  console.log(`[Campaign ${campaignId}] Enqueued ${pending.length} calls`);
  return pending.length;
}
