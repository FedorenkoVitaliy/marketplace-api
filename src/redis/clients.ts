import { Redis } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';

/** Кеш-інстанс (allkeys-lru + maxmemory). */
export function cacheRedis(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error('REDIS_URL не задано');
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1 });
}

/** Черга / сесії / rate-limit (noeviction). */
export function queueRedis(url = process.env.REDIS_QUEUE_URL): Redis {
  if (!url) throw new Error('REDIS_QUEUE_URL не задано');
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1 });
}

/** Опції зʼєднання для BullMQ (Worker: maxRetriesPerRequest null). */
export function bullConnection(url = process.env.REDIS_QUEUE_URL): ConnectionOptions {
  if (!url) throw new Error('REDIS_QUEUE_URL не задано');
  return { url, maxRetriesPerRequest: null };
}

export async function conf(r: Redis, name: string): Promise<string> {
  const pairs = (await r.config('GET', name)) as unknown as string[];
  return pairs[1] ?? '';
}

export async function closeRedis(...clients: Array<Redis | undefined>): Promise<void> {
  await Promise.all(clients.map((c) => c?.quit().catch(() => undefined)));
}

/** Compare-and-delete: зняти лише свій лок. */
export const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** Ковзне вікно (атомарно). ARGV: nowMs, windowMs, limit, member. */
export const SLIDING_WINDOW_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])
local n = redis.call('ZCARD', KEYS[1])
if n < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;
