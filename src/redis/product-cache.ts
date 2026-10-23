import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { UNLOCK_LUA } from './clients.js';

export type ProductCard = {
  id: number;
  name: string;
  price: number;
  stock: number;
  rating: number;
  reviews: number;
};

/** Чесний лічильник SELECT-ів (не «викликів функції»). */
let dbCallCount = 0;

export function resetDbCalls(): void {
  dbCallCount = 0;
}

export function getDbCalls(): number {
  return dbCallCount;
}

const cacheKey = (id: number) => `product:card:${id}`;
const lockKey = (id: number) => `lock:product:card:${id}`;

/** TTL 300 + jitter 0..60 с (≥10 с розкид). */
export function ttlWithJitter(baseSec = 300, jitterSec = 60): number {
  return baseSec + Math.floor(Math.random() * (jitterSec + 1));
}

export async function loadProductCard(pool: Pool, id: number): Promise<ProductCard> {
  dbCallCount += 1;
  // «Важке» читання: агрегати + sleep у SQL, щоб stampede було видно.
  const { rows } = await pool.query<{
    id: string;
    name: string;
    price: number;
    stock: number;
  }>(
    `SELECT id::text, name, price, COALESCE(stock, 0)::int AS stock,
            pg_sleep(0.02) AS _
       FROM products WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`product ${id} not found`);
  // Синтетичний рейтинг від id (стабільний) — без окремої таблиці відгуків.
  const rating = Math.round((3.5 + (id % 15) / 10) * 10) / 10;
  const reviews = 10 + (id % 90);
  return {
    id: Number(row.id),
    name: row.name,
    price: row.price,
    stock: row.stock,
    rating,
    reviews,
  };
}

/**
 * Cache-aside + single-flight: у базу йде лише власник SET NX PX.
 * Лок — оптимізація: зламається → два однакові SELECT.
 */
export async function getProductCached(
  redis: Redis,
  pool: Pool,
  id: number,
): Promise<ProductCard> {
  const key = cacheKey(id);
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as ProductCard;

  const token = randomUUID();
  const got = await redis.set(lockKey(id), token, 'PX', 5000, 'NX');
  if (got === 'OK') {
    try {
      const value = await loadProductCard(pool, id);
      await redis.set(key, JSON.stringify(value), 'EX', ttlWithJitter());
      return value;
    } finally {
      await redis.eval(UNLOCK_LUA, 1, lockKey(id), token);
    }
  }

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const again = await redis.get(key);
    if (again !== null) return JSON.parse(again) as ProductCard;
  }

  // Лідер не встиг — деградуємо в один SELECT, не в 500.
  const value = await loadProductCard(pool, id);
  await redis.set(key, JSON.stringify(value), 'EX', ttlWithJitter());
  return value;
}

export { cacheKey };
