/**
 * demo:outbox — happy path: 2 POST /orders з тим самим Idempotency-Key
 * → 1 order; relay + споживач → processed=1.
 */
import { createPool } from './db.js';
import { createHttpApp } from './main.js';
import { depth, sleep, waitFor, withChannel } from './messaging/amqp.js';
import { QUEUE } from './messaging/constants.js';
import { closeEffectsPool, effectCount, resetState } from './messaging/effects.js';
import { ConsumerProcess } from './messaging/consumer-process.js';
import { relayPass } from './messaging/outbox.js';
import { resetTopology } from './messaging/topology.js';
import { seedCatalog } from '../test/integration/seed-catalog.js';

const CONSUMER = 'demo-outbox-happy';
const IDEM = `hw22-outbox-${Date.now()}`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error('DATABASE_URL або DB_URL не задано');

  process.env.DATABASE_URL = url;
  process.env.DB_URL = url;
  process.env.PORT = process.env.PORT ?? '3022';
  process.env.LOG_LEVEL = 'error';

  const pool = createPool(url);
  await seedCatalog(pool, {
    buyerEmail: 'outbox-buyer@demo.test',
    sellerEmail: 'outbox-seller@demo.test',
  });

  const product = await pool.query<{ id: string }>(
    `SELECT id::text FROM products WHERE name = 'Blue Shirt' LIMIT 1`,
  );
  if (!product.rows[0]) throw new Error('product missing after seed');
  const productId = Number(product.rows[0].id);

  await resetState(CONSUMER);
  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const http = await createHttpApp();
  await http.listen(0);
  const base = http.url();

  const post = () =>
    fetch(`${base}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': IDEM,
      },
      body: JSON.stringify({ items: [productId] }),
    });

  const r1 = await post();
  const r2 = await post();
  const requests = 2;
  if (!r1.ok || !r2.ok) {
    throw new Error(`POST /orders → ${r1.status}/${r2.status}`);
  }
  const b1 = (await r1.json()) as { id: number };
  const b2 = (await r2.json()) as { id: number };
  if (b1.id !== b2.id) throw new Error(`idempotency broke: ${b1.id} ≠ ${b2.id}`);

  const { rows: orderRows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM orders WHERE id = $1`,
    [b1.id],
  );
  const orders = Number(orderRows[0]?.n ?? 0);

  await relayPass(pool, { crashBeforeUpdate: false });

  const consumer = new ConsumerProcess();
  consumer.start({
    CHILD_MODE: 'manual',
    CHILD_DEDUP: '1',
    CHILD_CONSUMER: CONSUMER,
    CHILD_EFFECT_MS: '15',
    CHILD_PREFETCH: '10',
  });
  await consumer.until((e) => e.some((x) => x.t === 'ready'), 15_000, 'consumer ready');
  await waitFor(
    'черга порожня',
    async () => withChannel(async (ch) => (await depth(ch, QUEUE)) === 0),
    20_000,
  );
  await waitFor('ефект', async () => (await effectCount(CONSUMER)) >= 1, 15_000);
  await sleep(150);

  const processed = await effectCount(CONSUMER);

  await consumer.stop();
  await http.close();
  await closeEffectsPool();
  await pool.end();

  console.log(`requests=${requests}`);
  console.log(`orders=${orders}`);
  console.log(`processed=${processed}`);

  process.exit(requests === 2 && orders === 1 && processed === 1 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await closeEffectsPool().catch(() => {});
  process.exit(1);
});
