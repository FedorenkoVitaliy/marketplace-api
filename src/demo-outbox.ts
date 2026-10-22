/**
 * Головне демо ДЗ#22: SIGKILL між publish і UPDATE published_at.
 * 5 подій → 10 доставок у брокер → 5 ефектів (дедуп у Postgres).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './db.js';
import { depth, sleep, waitFor, withChannel } from './messaging/amqp.js';
import { QUEUE } from './messaging/constants.js';
import { closeEffectsPool, effectCount, resetState } from './messaging/effects.js';
import { buildOrderPlaced } from './messaging/events.js';
import { insertOutbox, outboxCount, unpublishedCount, relayPass } from './messaging/outbox.js';
import { resetTopology } from './messaging/topology.js';
import { ConsumerProcess } from './messaging/consumer-process.js';

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'messaging/outbox-relay-child.js');
const CONSUMER = 'demo-outbox';
const N = 5;

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
    for (let i = 1; i <= N; i++) {
      const event = buildOrderPlaced({
        orderId: 2000 + i,
        userId: 1,
        totalCents: 100 * i,
      });
      await insertOutbox(client, {
        aggregateType: 'Order',
        aggregateId: String(2000 + i),
        type: 'order.placed',
        payload: event,
      });
    }
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  console.log(`outbox_seeded=${await outboxCount(pool)}`);

  // Прохід 1: publish → SIGKILL до UPDATE (транзакція релея відкочується)
  const crash = await runCrashRelay();
  console.log(`crash_published=${crash.published}`);
  console.log(`crash_signal=${crash.signal}`);
  await sleep(200);

  const stillUnpublished = await unpublishedCount(pool);
  console.log(`unpublished_after_crash=${stillUnpublished}`);

  let depthAfterCrash = 0;
  await withChannel(async (ch) => {
    await waitFor(
      'черга після crash',
      async () => (await depth(ch, QUEUE)) >= N,
      15_000,
    );
    depthAfterCrash = await depth(ch, QUEUE);
  });
  console.log(`broker_after_crash=${depthAfterCrash}`);

  // Прохід 2: релей чесно добиває ті самі рядки → дублі в брокері
  const second = await relayPass(pool, { crashBeforeUpdate: false });
  console.log(`relay_second_pass=${second}`);

  let depthAfterSecond = 0;
  await withChannel(async (ch) => {
    await waitFor(
      'черга після другого проходу',
      async () => (await depth(ch, QUEUE)) >= N * 2,
      15_000,
    );
    depthAfterSecond = await depth(ch, QUEUE);
  });
  console.log(`broker_after_second=${depthAfterSecond}`);

  // Споживач з claimAndApply: 10 доставок → 5 ефектів
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
  await waitFor(
    'ефекти',
    async () => (await effectCount(CONSUMER)) >= N,
    15_000,
  );
  await sleep(200);

  const deliveries = consumer.count('recv');
  const effects = await effectCount(CONSUMER);
  const skipped = consumer.count('skip');
  const unpublished = await unpublishedCount(pool);

  await consumer.stop();
  await closeEffectsPool();
  await pool.end();

  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effects}`);
  console.log(`skipped=${skipped}`);
  console.log(`unpublished_final=${unpublished}`);

  const ok =
    crash.published === N &&
    stillUnpublished === N &&
    depthAfterSecond >= N * 2 &&
    deliveries >= N * 2 &&
    effects === N &&
    skipped >= N &&
    unpublished === 0;
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await closeEffectsPool().catch(() => {});
  process.exit(1);
});
