import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { SLIDING_WINDOW_LUA } from './clients.js';

export type RateLimitResult = {
  allowed: boolean;
  status: number;
  retryAfterSec: number;
};

/**
 * Ковзне вікно в Redis (Lua): спільне для всіх подів.
 * Чому не фіксоване: не дозволяємо 2× сплеск на межі хвилини.
 * Чому не token bucket: API-край хоче рівний потік, не залп.
 */
export async function slidingWindowLimit(
  redis: Redis,
  who: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const allowed =
    Number(
      await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `rl:slide:${who}`,
        String(Date.now()),
        String(windowMs),
        String(limit),
        randomUUID(),
      ),
    ) === 1;

  if (allowed) return { allowed: true, status: 200, retryAfterSec: 0 };
  return {
    allowed: false,
    status: 429,
    retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)),
  };
}
