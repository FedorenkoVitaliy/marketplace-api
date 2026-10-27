/**
 * Окремий процес релея — щоб demo:crash-relay міг зробити SIGKILL
 * між publish і UPDATE published_at.
 *
 * Env: CHILD_CRASH=1, CHILD_LAG_MS, DATABASE_URL / DB_URL, BROKER_URL
 */
import { createPool } from '../db.js';
import { assertTopology } from './topology.js';
import { connect } from './amqp.js';
import { relayPass } from './outbox.js';

const send = (m: unknown) => process.send?.(m);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error('DATABASE_URL або DB_URL не задано');

  const conn = await connect();
  const ch = await conn.createChannel();
  await assertTopology(ch);
  await ch.close();
  await conn.close();

  const pool = createPool(url);
  const crash = process.env.CHILD_CRASH === '1';
  const lagMs = Number(process.env.CHILD_LAG_MS ?? 400);

  const n = await relayPass(pool, {
    crashBeforeUpdate: crash,
    lagMs,
    onPublished: (count) => {
      send({ t: 'published', n: count });
      if (crash) {
        // батько вбиває процес у цьому вікні
      }
    },
  });

  send({ t: 'done', n });
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('relay-child:', e);
  process.exit(1);
});
