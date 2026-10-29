/**
 * demo:crash-relay — одна подія: SIGKILL між publish і UPDATE published_at
 * → 2 доставки в брокер → 1 ефект (дедуп). Контракт: deliveries=2 applied=1 effect=1.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './db.js';
import { depth, sleep, waitFor, withChannel } from './messaging/amqp.js';
import { QUEUE } from './messaging/constants.js';
import {
  closeEffectsPool,
  effectCount,
  processedCount,
  resetState,
} from './messaging/effects.js';
import { buildOrderPlaced } from './messaging/events.js';
import { insertOutbox, unpublishedCount, relayPass } from './messaging/outbox.js';
import { resetTopology } from './messaging/topology.js';
import { ConsumerProcess } from './messaging/consumer-process.js';

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'messaging/outbox-relay-child.js');
const CONSUMER = 'demo-crash-relay';

type ChildEvt = { t: string; n?: number };

function runCrashRelay(): Promise<{ published: number; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = fork(CHILD, [], {
      env: {
        ...process.env,
        CHILD_CRASH: '1',
        CHILD_LAG_MS: '500',
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let published = 0;
    let settled = false;
    const finish = (signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      resolve({ published, signal });
    };
    child.on('message', (m: ChildEvt) => {
      if (m.t === 'published') {
        published = m.n ?? 0;
        child.kill('SIGKILL');
      }
    });
    child.on('exit', (_code, signal) => finish(signal));
    child.on('error', reject);
    setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timeout waiting for relay publish'));
    }, 20_000);
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error('DATABASE_URL або DB_URL не задано');
  const pool = createPool(url);

  await resetState(CONSUMER);
  await pool.query('TRUNCATE outbox');

  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const event = buildOrderPlaced({
      orderId: 2001,
      userId: 1,
      totalCents: 100,
    });
    await insertOutbox(client, {
      aggregateType: 'Order',
      aggregateId: '2001',
      type: 'order.placed',
      payload: event,
    });
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  // Прохід 1: publish → SIGKILL до UPDATE (транзакція релея відкочується)
  const crash = await runCrashRelay();
  await sleep(200);

  const stillUnpublished = await unpublishedCount(pool);

  await withChannel(async (ch) => {
    await waitFor('черга після crash', async () => (await depth(ch, QUEUE)) >= 1, 15_000);
  });

  // Прохід 2: релей чесно добиває той самий рядок → дубль у брокері
  await relayPass(pool, { crashBeforeUpdate: false });

  await withChannel(async (ch) => {
    await waitFor('черга після другого проходу', async () => (await depth(ch, QUEUE)) >= 2, 15_000);
  });

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
  await sleep(200);

  const deliveries = consumer.count('recv');
  const applied = consumer.count('effect');
  const processed = await processedCount(CONSUMER);
  const effects = await effectCount(CONSUMER);
  const unpublished = await unpublishedCount(pool);

  await consumer.stop();
  await closeEffectsPool();
  await pool.end();

  console.log(`deliveries=${deliveries}`);
  console.log(`applied=${applied}`);
  console.log(`processed=${processed}`);
  console.log(`effect=${effects}`);

  const ok =
    crash.published === 1 &&
    stillUnpublished === 1 &&
    deliveries === 2 &&
    applied === 1 &&
    processed === 1 &&
    effects === 1 &&
    unpublished === 0;
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await closeEffectsPool().catch(() => {});
  process.exit(1);
});
