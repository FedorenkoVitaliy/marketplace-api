import type { Channel } from 'amqplib';
import { DLQ, DLX, EXCHANGE, QUEUE, QUORUM, ROUTING_KEY } from './constants.js';

/**
 * Топологію оголошує споживач / бутстрап — не продюсер.
 * Продюсер не має знати, хто його слухає.
 */
export async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(DLX, 'fanout', { durable: true });
  await ch.assertQueue(DLQ, {
    durable: true,
    arguments: { ...QUORUM },
  });
  await ch.bindQueue(DLQ, DLX, '');

  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      ...QUORUM,
      'x-dead-letter-exchange': DLX,
    },
  });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
}

/** Чистий аркуш для демо: аргументи черги незмінні, тому delete → assert. */
export async function resetTopology(ch: Channel): Promise<void> {
  await ch.deleteQueue(QUEUE).catch(() => {});
  await ch.deleteQueue(DLQ).catch(() => {});
  await ch.deleteExchange(EXCHANGE).catch(() => {});
  await ch.deleteExchange(DLX).catch(() => {});
  await assertTopology(ch);
}
