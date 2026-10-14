import type { Message } from 'amqplib';
import { depth, parse, waitFor, withChannel, withConfirmChannel, body } from './messaging/amqp.js';
import { DLQ, EXCHANGE, QUEUE, ROUTING_KEY } from './messaging/constants.js';
import { closeEffectsPool, resetState } from './messaging/effects.js';
import { buildOrderPlaced } from './messaging/events.js';
import { ConsumerProcess } from './messaging/consumer-process.js';
import { resetTopology } from './messaging/topology.js';

const REASONS = new Set(['rejected', 'expired', 'maxlen', 'delivery_limit']);

function deathReason(msg: Message): string {
  const h = msg.properties.headers ?? {};
  const first = h['x-first-death-reason'];
  if (typeof first === 'string' && REASONS.has(first)) return first;
  const deaths = (h['x-death'] ?? []) as { reason?: string }[];
  const reason = deaths[0]?.reason;
  if (typeof reason === 'string' && REASONS.has(reason)) return reason;
  return 'unknown';
}

async function main(): Promise<void> {
  await resetState('demo-dlq');

  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const event = buildOrderPlaced({
    orderId: 9999,
    userId: 1,
    totalCents: 0,
  });

  await withConfirmChannel(async (ch) => {
    const ok = ch.publish(EXCHANGE, ROUTING_KEY, body(event), {
      persistent: true,
      messageId: event.eventId,
      type: event.type,
      mandatory: true,
    });
    if (!ok) throw new Error('publish buffer full');
    await ch.waitForConfirms();
    await waitFor('у робочій', async () => (await ch.checkQueue(QUEUE)).messageCount === 1);
  });

  const consumer = new ConsumerProcess();
  consumer.start({
    CHILD_MODE: 'reject',
    CHILD_PREFETCH: '1',
  });
  await consumer.until((e) => e.some((x) => x.t === 'ready'), 15_000, 'ready');
  await consumer.until((e) => e.some((x) => x.t === 'rejected'), 15_000, 'rejected');

  let work = 1;
  let dlq = 0;
  let reason = 'unknown';
  await withChannel(async (ch) => {
    await waitFor('у DLQ', async () => (await ch.checkQueue(DLQ)).messageCount >= 1);
    work = await depth(ch, QUEUE);
    dlq = await depth(ch, DLQ);
    const msg = await ch.get(DLQ, { noAck: false });
    if (msg) {
      reason = deathReason(msg);
      parse(msg.content);
      ch.ack(msg);
    }
  });

  await consumer.stop();
  await closeEffectsPool();

  const rejected = consumer.count('rejected');
  const effect = 0;

  console.log(`rejected=${rejected}`);
  console.log(`work=${work}`);
  console.log(`dlq=${dlq}`);
  console.log(`dlq-reason=${reason}`);
  console.log(`effect=${effect}`);

  const ok = work === 0 && dlq === 1 && REASONS.has(reason);
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await closeEffectsPool().catch(() => {});
  process.exit(1);
});
