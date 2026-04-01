import Redis, { RedisOptions } from 'ioredis';
import { config } from '../config';

/**
 * Redis singleton — shared across the app.
 * Used for:
 *   - Call session metadata (callId → serverId mapping)
 *   - Rate limiting (per API key / per IP)
 *   - BullMQ job queues (webhook delivery)
 *   - Pub/Sub for cross-server events
 */

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,   // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: (times: number) => {
    if (times > 10) return null;
    return Math.min(times * 200, 3000);
  },
};

// Main Redis client
export const redis = new Redis(config.redis.url, redisOptions);

// Separate subscriber client (pub/sub requires dedicated connection)
export const redisSub = new Redis(config.redis.url, redisOptions);

redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redis.on('connect', () => console.log('[Redis] Connected'));

redisSub.on('error', (err) => console.error('[Redis Sub] Error:', err.message));

// ─── Session helpers ─────────────────────────────────────────────────────────
const SESSION_TTL = 7200; // 2 hours

export async function setCallSession(
  callId: string,
  data: { serverId: string; workspaceId: string; agentId: string }
): Promise<void> {
  await redis.set(
    `call:${callId}`,
    JSON.stringify(data),
    'EX',
    SESSION_TTL
  );
}

export async function getCallSession(
  callId: string
): Promise<{ serverId: string; workspaceId: string; agentId: string } | null> {
  const data = await redis.get(`call:${callId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteCallSession(callId: string): Promise<void> {
  await redis.del(`call:${callId}`);
}

// ─── Active call counter (for analytics) ────────────────────────────────────
export async function incrementActiveCalls(workspaceId: string): Promise<void> {
  await redis.incr(`active_calls:${workspaceId}`);
}

export async function decrementActiveCalls(workspaceId: string): Promise<void> {
  await redis.decr(`active_calls:${workspaceId}`);
}

export async function getActiveCalls(workspaceId: string): Promise<number> {
  const val = await redis.get(`active_calls:${workspaceId}`);
  return parseInt(val || '0', 10);
}
