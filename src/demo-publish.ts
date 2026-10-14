import { depth, sleep, waitFor, withChannel, withConfirmChannel, body } from './messaging/amqp.js';
import { DLQ, EXCHANGE, PREFETCH, QUEUE, ROUTING_KEY } from './messaging/constants.js';
import { effectCount, resetState } from './messaging/effects.js';
import { buildOrderPlaced } from './messaging/events.js';
import { ConsumerProcess } from './messaging/consumer-process.js';
import { resetTopology } from './messaging/topology.js';

const EFFECTS = 'demo-publish-effects.jsonl';
const PROCESSED = 'demo-publish-processed.txt';
const N = 5;

async function main(): Promise<void> {
  resetState(EFFECTS, PROCESSED);

  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const consumer = new ConsumerProcess();
  consumer.start({
    CHILD_MODE: 'manual',
    CHILD_DEDUP: '1',
    CHILD_DEDUP_FILE: PROCESSED,
    CHILD_EFFECTS: EFFECTS,
    CHILD_EFFECT_MS: '30',
    CHILD_PREFETCH: String(PREFETCH),
  });
  await consumer.until((e) => e.some((x) => x.t === 'ready'), 15_000, 'consumer ready');

  let published = 0;
  await withConfirmChannel(async (ch) => {
    for (let i = 1; i <= N; i++) {
      const event = buildOrderPlaced({
        orderId: 1000 + i,
        userId: 1,
        totalCents: 100 * i,
      });
      ch.publish(EXCHANGE, ROUTING_KEY, body(event), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        type: event.type,
      });
      published += 1;
    }
    await ch.waitForConfirms();
  });

  await waitFor(
    'усі ефекти',
    () => effectCount(EFFECTS) >= N,
    20_000,
  );
  await sleep(200);

  const delivered = consumer.count('recv');
  const effect = effectCount(EFFECTS);
  const acked = consumer.count('acked');
  let work = 0;
  let dlq = 0;
  await withChannel(async (ch) => {
    work = await depth(ch, QUEUE);
    dlq = await depth(ch, DLQ);
  });

  await consumer.stop();

  console.log(`published=${published}`);
  console.log(`delivered=${delivered}`);
  console.log(`effect=${effect}`);
  console.log(`acked=${acked}`);
  console.log(`dlq=${dlq}`);
  console.log(`prefetch=${PREFETCH}`);

  const ok =
    published === 5 &&
    effect === 5 &&
    dlq === 0 &&
    PREFETCH >= 1 &&
    PREFETCH <= 2000;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
