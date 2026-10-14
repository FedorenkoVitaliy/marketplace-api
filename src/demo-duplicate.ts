import { depth, waitFor, withChannel, withConfirmChannel, body, sleep } from './messaging/amqp.js';
import { EXCHANGE, PREFETCH, QUEUE, ROUTING_KEY } from './messaging/constants.js';
import { effectCount, resetState } from './messaging/effects.js';
import { buildOrderPlaced } from './messaging/events.js';
import { ConsumerProcess } from './messaging/consumer-process.js';
import { resetTopology } from './messaging/topology.js';

const EFFECTS = 'demo-dup-effects.jsonl';
const PROCESSED = 'demo-dup-processed.txt';

async function main(): Promise<void> {
  resetState(EFFECTS, PROCESSED);

  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const event = buildOrderPlaced({
    orderId: 42,
    userId: 1,
    totalCents: 500,
  });

  await withConfirmChannel(async (ch) => {
    ch.publish(EXCHANGE, ROUTING_KEY, body(event), {
      persistent: true,
      messageId: event.eventId,
      type: event.type,
    });
    await ch.waitForConfirms();
  });

  // Падіння між ефектом і ack (окремий процес + SIGKILL), не channel.close().
  const crash = new ConsumerProcess();
  crash.start({
    CHILD_MODE: 'gap',
    CHILD_DEDUP: '1',
    CHILD_DEDUP_FILE: PROCESSED,
    CHILD_EFFECTS: EFFECTS,
    CHILD_EFFECT_MS: '40',
    CHILD_GAP_MS: '500',
    CHILD_PREFETCH: '1',
  });
  await crash.until((e) => e.some((x) => x.t === 'ready'), 15_000, 'ready');
  await crash.until((e) => e.some((x) => x.t === 'effect'), 15_000, 'effect before kill');
  const recvBeforeKill = crash.count('recv');
  crash.kill();

  await withChannel(async (ch) => {
    await waitFor(
      'повідомлення повернулось у чергу',
      async () => (await depth(ch, QUEUE)) >= 1,
      15_000,
    );
  });
  await sleep(300);

  const drain = new ConsumerProcess();
  drain.start({
    CHILD_MODE: 'manual',
    CHILD_DEDUP: '1',
    CHILD_DEDUP_FILE: PROCESSED,
    CHILD_EFFECTS: EFFECTS,
    CHILD_EFFECT_MS: '20',
    CHILD_PREFETCH: String(PREFETCH),
  });
  await drain.until((e) => e.some((x) => x.t === 'ready'), 15_000, 'drain ready');
  await waitFor('черга порожня', async () => {
    return withChannel(async (ch) => (await depth(ch, QUEUE)) === 0);
  }, 20_000);
  await drain.until(
    (e) => e.some((x) => x.t === 'acked' || x.t === 'skip'),
    15_000,
    'drain done',
  );
  await sleep(200);
  await drain.stop();

  const deliveries = recvBeforeKill + drain.count('recv');
  const effect = effectCount(EFFECTS);
  const skipped = drain.count('skip');

  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effect}`);
  console.log(`skipped=${skipped}`);

  const ok = deliveries >= 2 && effect === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
