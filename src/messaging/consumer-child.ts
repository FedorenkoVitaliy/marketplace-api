/**
 * Окремий процес-споживач — щоб demo:duplicate міг зробити справжній kill,
 * а не channel.close() (коректне завершення ≠ падіння в проді).
 *
 * Env:
 *   CHILD_MODE=manual|gap|reject
 *   CHILD_DEDUP=1 + CHILD_DEDUP_FILE
 *   CHILD_EFFECTS, CHILD_EFFECT_MS, CHILD_GAP_MS, CHILD_PREFETCH
 */
import { connect } from './amqp.js';
import { PREFETCH, QUEUE } from './constants.js';
import { applyEffect, remember, seen } from './effects.js';
import { assertTopology } from './topology.js';
import type { OrderPlacedEvent } from './events.js';

type Mode = 'manual' | 'gap' | 'reject';

const MODE = (process.env.CHILD_MODE ?? 'manual') as Mode;
const EFFECT_MS = Number(process.env.CHILD_EFFECT_MS ?? 40);
const GAP_MS = Number(process.env.CHILD_GAP_MS ?? 400);
const EFFECTS = process.env.CHILD_EFFECTS ?? 'effects.jsonl';
const DEDUP = process.env.CHILD_DEDUP === '1';
const DEDUP_FILE = process.env.CHILD_DEDUP_FILE ?? 'processed.txt';
const PREFETCH_N = Number(process.env.CHILD_PREFETCH ?? PREFETCH);

const send = (m: unknown) => process.send?.(m);

async function main(): Promise<void> {
  const conn = await connect();
  const ch = await conn.createChannel();
  await assertTopology(ch);
  await ch.prefetch(PREFETCH_N);

  let n = 0;
  const inbox: import('amqplib').ConsumeMessage[] = [];
  let busy = false;

  async function pump(): Promise<void> {
    if (busy) return;
    busy = true;
    while (inbox.length) {
      const msg = inbox.shift()!;
      n += 1;
      const payload = JSON.parse(msg.content.toString()) as OrderPlacedEvent;
      const id = payload.eventId ?? msg.properties.messageId ?? `#${n}`;

      if (MODE === 'reject') {
        ch.reject(msg, false);
        send({ t: 'rejected', n, id });
        continue;
      }

      if (DEDUP && seen(DEDUP_FILE, id)) {
        send({ t: 'skip', n, id });
        ch.ack(msg);
        continue;
      }

      await new Promise((r) => setTimeout(r, EFFECT_MS));
      if (DEDUP) remember(DEDUP_FILE, id);
      applyEffect(EFFECTS, id, payload);
      send({ t: 'effect', n, id });

      if (MODE === 'gap') await new Promise((r) => setTimeout(r, GAP_MS));
      ch.ack(msg);
      send({ t: 'acked', n, id });
    }
    busy = false;
  }

  await ch.consume(
    QUEUE,
    (msg) => {
      if (!msg) return;
      send({
        t: 'recv',
        n: inbox.length + 1,
        id: msg.properties.messageId,
        redelivered: msg.fields.redelivered,
      });
      inbox.push(msg);
      void pump();
    },
    { noAck: false },
  );

  send({ t: 'ready' });

  process.on('message', async (m: { t?: string }) => {
    if (m?.t === 'stop') {
      await ch.close().catch(() => {});
      await conn.close().catch(() => {});
      process.exit(0);
    }
  });
}

main().catch((e) => {
  console.error('child:', e);
  process.exit(1);
});
