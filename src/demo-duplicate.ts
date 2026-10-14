import { depth, waitFor, withChannel, withConfirmChannel, body, sleep } from './messaging/amqp.js';
import { EXCHANGE, PREFETCH, QUEUE, ROUTING_KEY } from './messaging/constants.js';
import { closeEffectsPool, effectCount, resetState } from './messaging/effects.js';
import { buildOrderPlaced } from './messaging/events.js';
import { ConsumerProcess } from './messaging/consumer-process.js';
import { resetTopology } from './messaging/topology.js';

const CONSUMER = 'demo-dup';

async function main(): Promise<void> {
  await resetState(CONSUMER);

  await withChannel(async (ch) => {
    await resetTopology(ch);
  });

  const event = buildOrderPlaced({
    orderId: 42,
    userId: 1,
    totalCents: 500,
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
  });

  // Падіння між ефектом і ack (окремий процес + SIGKILL), не channel.close().
  const crash = new ConsumerProcess();
  crash.start({
    CHILD_MODE: 'gap',
    CHILD_DEDUP: '1',
    CHILD_CONSUMER: CONSUMER,
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
    CHILD_CONSUMER: CONSUMER,
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
  const effect = await effectCount(CONSUMER);
  const skipped = drain.count('skip');

  // Зонд персистентності між процесами (спільний Postgres): :42 лишився 1;
  // контрольна :43 дає другий ефект.
  const control = buildOrderPlaced({
    orderId: 43,
    userId: 1,
    totalCents: 500,
  });
  const probe = new ConsumerProcess();
  probe.start({
    CHILD_MODE: 'manual',
    CHILD_DEDUP: '1',
    CHILD_CONSUMER: CONSUMER,
    CHILD_EFFECT_MS: '20',
    CHILD_PREFETCH: '1',
  });
  await probe.until((e) => e.some((x) => x.t === 'ready'), 15_000, 'probe ready');
  await withConfirmChannel(async (ch) => {
    const ok = ch.publish(EXCHANGE, ROUTING_KEY, body(control), {
      persistent: true,
      messageId: control.eventId,
      type: control.type,
      mandatory: true,
    });
    if (!ok) throw new Error('publish buffer full');
    await ch.waitForConfirms();
  });
  await waitFor(
    'контрольний ефект :43',
    async () => (await effectCount(CONSUMER)) === 2,
    15_000,
  );
  await probe.stop();
  await closeEffectsPool();

  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effect}`);
  console.log(`skipped=${skipped}`);

  const ok = deliveries >= 2 && effect === 1 && skipped >= 1;
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await closeEffectsPool().catch(() => {});
  process.exit(1);
});
