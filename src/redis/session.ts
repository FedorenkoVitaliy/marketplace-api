import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const SESSION_TTL_SEC = 30;

export function sessionKey(id: string): string {
  return `session:${id}`;
}

/** Створити сесію в Redis (черга/noeviction-інстанс). */
export async function createSession(
  redis: Redis,
  data: Record<string, string> = {},
): Promise<string> {
  const id = randomUUID();
  const key = sessionKey(id);
  await redis.hset(key, { sid: id, ...data, createdAt: new Date().toISOString() });
  await redis.expire(key, SESSION_TTL_SEC);
  return id;
}

/**
 * Прочитати сесію і продовжити TTL (rolling).
 * GETEX з Redis 6.2+ — атомарно читає і ставить EXPIRE.
 * Для hash: HGETALL + EXPIRE (достатньо для критерію).
 */
export async function touchSession(
  redis: Redis,
  id: string,
): Promise<Record<string, string> | null> {
  const key = sessionKey(id);
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  await redis.expire(key, SESSION_TTL_SEC);
  return data;
}

export async function sessionTtl(redis: Redis, id: string): Promise<number> {
  return redis.ttl(sessionKey(id));
}
