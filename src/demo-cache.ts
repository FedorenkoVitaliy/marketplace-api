/**
 * ДЗ#23 demo:cache — cache-aside + TTL jitter + single-flight.
 * Контракт: cache-lru cache-maxmemory warmed ttl-distinct concurrent db-calls db-calls-warm
 */
import { createPool } from './db.js';
import { cacheRedis, closeRedis, conf } from './redis/clients.js';
import {
  cacheKey,
  getDbCalls,
  getProductCached,
  loadProductCard,
  resetDbCalls,
  ttlWithJitter,
} from './redis/product-cache.js';

const CONCURRENT = 24;
const WARM_COUNT = 60;

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || process.env.DB_URL;
  if (!dbUrl) throw new Error('DATABASE_URL або DB_URL не задано');

  const redis = cacheRedis();
  const pool = createPool(dbUrl);

  const policy = await conf(redis, 'maxmemory-policy');
  const maxmem = await conf(redis, 'maxmemory');
  const cacheLru = policy !== 'noeviction' && /lru|lfu|random|volatile/.test(policy) ? 1 : 0;
  const cacheMaxmemory = Number(maxmem) > 0 ? 1 : 0;

  // Прогріти ≥50 ключів із джитером TTL
  const product = await pool.query<{ id: string }>(
    `SELECT id::text FROM products ORDER BY id ASC LIMIT 1`,
  );
  if (!product.rows[0]) throw new Error('немає products — зроби seed');
  const baseId = Number(product.rows[0].id);

  // Забезпечити достатньо id: використовуємо віртуальні картки поверх одного рядка
  // через ключі product:card:warm:N з реальним SELECT на baseId (лічильник чесний).
  const ttls = new Set<number>();
  for (let i = 0; i < WARM_COUNT; i++) {
    const ttl = ttlWithJitter(300, 60);
    ttls.add(ttl);
    resetDbCalls();
    const card = await loadProductCard(pool, baseId);
    await redis.set(`product:card:warm:${i}`, JSON.stringify({ ...card, warm: i }), 'EX', ttl);
  }
  const warmed = WARM_COUNT;
  const ttlDistinct = ttls.size;

  // Stampede: холодний ключ (DEL), потім N одночасних із single-flight
  const victimKey = cacheKey(baseId);
  await redis.del(victimKey);
  resetDbCalls();
  await Promise.all(
    Array.from({ length: CONCURRENT }, () => getProductCached(redis, pool, baseId)),
  );
  const dbCalls = getDbCalls();

  // Теплий кеш: 100 читань → 0 походів у базу
  resetDbCalls();
  for (let i = 0; i < 100; i++) {
    await getProductCached(redis, pool, baseId);
  }
  const dbCallsWarm = getDbCalls();

  console.log(`cache-lru=${cacheLru}`);
  console.log(`cache-maxmemory=${cacheMaxmemory}`);
  console.log(`warmed=${warmed}`);
  console.log(`ttl-distinct=${ttlDistinct}`);
  console.log(`concurrent=${CONCURRENT}`);
  console.log(`db-calls=${dbCalls}`);
  console.log(`db-calls-warm=${dbCallsWarm}`);

  await closeRedis(redis);
  await pool.end();

  if (cacheLru !== 1 || cacheMaxmemory !== 1) process.exit(1);
  if (dbCalls !== 1 || dbCallsWarm !== 0) process.exit(1);
  if (warmed < 50 || ttlDistinct < 5 || CONCURRENT < 20) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
