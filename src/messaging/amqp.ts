import * as amqp from 'amqplib';
import type { Channel, ChannelModel, ConfirmChannel } from 'amqplib';

export function brokerUrl(): string {
  const url = process.env.BROKER_URL ?? process.env.AMQP_URL;
  if (!url) {
    throw new Error('BROKER_URL (або AMQP_URL) не задано');
  }
  return url;
}

export async function connect(): Promise<ChannelModel> {
  return amqp.connect(brokerUrl());
}

export async function withChannel<T>(
  fn: (ch: Channel, conn: ChannelModel) => Promise<T>,
): Promise<T> {
  const conn = await connect();
  const ch = await conn.createChannel();
  try {
    return await fn(ch, conn);
  } finally {
    await ch.close().catch(() => {});
    await conn.close().catch(() => {});
  }
}

export async function withConfirmChannel<T>(
  fn: (ch: ConfirmChannel, conn: ChannelModel) => Promise<T>,
): Promise<T> {
  const conn = await connect();
  const ch = await conn.createConfirmChannel();
  try {
    return await fn(ch, conn);
  } finally {
    await ch.close().catch(() => {});
    await conn.close().catch(() => {});
  }
}

export async function depth(ch: Channel, queue: string): Promise<number> {
  const r = await ch.checkQueue(queue);
  return r.messageCount;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(
  what: string,
  cond: () => Promise<boolean> | boolean,
  timeoutMs = 20_000,
  everyMs = 50,
): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`не дочекались: ${what} (${timeoutMs} мс)`);
    }
    await sleep(everyMs);
  }
}

export const body = (o: unknown) => Buffer.from(JSON.stringify(o));
export const parse = <T>(b: Buffer): T => JSON.parse(b.toString()) as T;
