/**
 * ДЗ#23 demo:session — сесія в Redis (черга/noeviction) + rolling TTL.
 * Контракт: requests sessions in-redis ttl-renewed
 * Без flushdb: прибираємо лише свої ключі через UNLINK.
 */
import { closeRedis, queueRedis } from './redis/clients.js';
import {
  createSession,
  sessionKey,
  sessionTtl,
  touchSession,
} from './redis/session.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // Сесії — на REDIS_QUEUE_URL (noeviction), не на кеш-LRU.
  const redis = queueRedis();

  const sid = await createSession(redis, { userId: 'demo' });
  const key = sessionKey(sid);

  // Дати TTL зменшитись, інакше renew не видно.
  await sleep(2000);
  const ttlBefore = await sessionTtl(redis, sid);

  let requests = 0;
  for (let i = 0; i < 3; i++) {
    const data = await touchSession(redis, sid);
    if (!data) throw new Error('сесія зникла');
    requests += 1;
    if (i < 2) await sleep(400);
  }

  const ttlAfter = await sessionTtl(redis, sid);
  const inRedis = (await redis.exists(key)) === 1 ? 1 : 0;
  const ttlRenewed = ttlAfter > ttlBefore ? 1 : 0;

  console.log(`requests=${requests}`);
  console.log(`sessions=1`);
  console.log(`in-redis=${inRedis}`);
  console.log(`ttl-renewed=${ttlRenewed}`);

  // Лише свій ключ — не зносимо BullMQ / rate-limit чужих демо.
  await redis.unlink(key);
  await closeRedis(redis);

  if (requests < 3 || inRedis !== 1 || ttlRenewed !== 1) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
