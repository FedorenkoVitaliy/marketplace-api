/**
 * ДЗ#23 demo:session — сесія в Redis (черга/noeviction) + rolling TTL.
 * Контракт: requests sessions in-redis ttl-renewed
 */
import { closeRedis, queueRedis } from './redis/clients.js';
import { createSession, sessionTtl, touchSession } from './redis/session.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // Сесії — на REDIS_QUEUE_URL (noeviction), не на кеш-LRU.
  const redis = queueRedis();
  await redis.flushdb();

  const sid = await createSession(redis, { userId: 'demo' });

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
  const inRedis = (await redis.exists(`session:${sid}`)) === 1 ? 1 : 0;
  const ttlRenewed = ttlAfter > ttlBefore ? 1 : 0;

  console.log(`requests=${requests}`);
  console.log(`sessions=1`);
  console.log(`in-redis=${inRedis}`);
  console.log(`ttl-renewed=${ttlRenewed}`);

  await closeRedis(redis);

  if (requests < 3 || inRedis !== 1 || ttlRenewed !== 1) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
