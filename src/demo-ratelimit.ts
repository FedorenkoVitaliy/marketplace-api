/**
 * ДЗ#23 demo:ratelimit — спільний ліміт на 2 «поди», 429 + Retry-After.
 * Контракт: instances limit requests allowed blocked status retry-after
 */
import { closeRedis, queueRedis } from './redis/clients.js';
import { slidingWindowLimit } from './redis/rate-limit.js';

const LIMIT = 5;
const WINDOW_MS = 2000;
const INSTANCES = 2;
const TOTAL = 12;

async function main(): Promise<void> {
  const redis = queueRedis();
  await redis.del('rl:slide:demo-client');

  // Два незалежні екземпляри лімітера (як два поди) — одне Redis-сховище.
  const pods = Array.from({ length: INSTANCES }, () => ({
    allow: (who: string) => slidingWindowLimit(redis, who, LIMIT, WINDOW_MS),
  }));

  let allowed = 0;
  let blocked = 0;
  let lastStatus = 200;
  let retryAfter = 0;

  for (let i = 0; i < TOTAL; i++) {
    const pod = pods[i % INSTANCES]!;
    const res = await pod.allow('demo-client');
    if (res.allowed) {
      allowed += 1;
    } else {
      blocked += 1;
      lastStatus = res.status;
      retryAfter = res.retryAfterSec > 0 ? 1 : 0;
    }
  }

  console.log(`instances=${INSTANCES}`);
  console.log(`limit=${LIMIT}`);
  console.log(`requests=${TOTAL}`);
  console.log(`allowed=${allowed}`);
  console.log(`blocked=${blocked}`);
  console.log(`status=${lastStatus}`);
  console.log(`retry-after=${retryAfter}`);

  await closeRedis(redis);

  if (INSTANCES < 2 || allowed !== LIMIT || blocked < 1) process.exit(1);
  if (lastStatus !== 429 || retryAfter !== 1) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
