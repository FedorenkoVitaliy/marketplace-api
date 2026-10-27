/**
 * demo:crash-write — SIGKILL ПІСЛЯ INSERT order+outbox, ДО COMMIT.
 * Обидва рядки відкочуються: write-failed=1 orders=0 outbox=0.
 * Доводить: outbox у тій самій транзакції, що й замовлення.
 */
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPool } from './db.js';
import { buildOrderPlaced } from './messaging/events.js';
import { insertOutbox } from './messaging/outbox.js';

const LAG_MS = 400;
const SELF = fileURLToPath(import.meta.url);

async function worker(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error('DATABASE_URL або DB_URL не задано');
  const pool = createPool(url);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const buyer = await client.query<{ id: string }>(
      'SELECT id::text FROM users ORDER BY id ASC LIMIT 1',
    );
    if (!buyer.rows[0]) throw new Error('buyer required');

    const product = await client.query<{ id: string; price: number }>(
      'SELECT id::text, price FROM products ORDER BY id ASC LIMIT 1',
    );
    if (!product.rows[0]) throw new Error('product required');

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO orders (status, created_at, user_id)
       VALUES ('pending', now(), $1)
       RETURNING id::text`,
      [buyer.rows[0].id],
    );
    const orderId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO order_items (qty, unit_price, order_id, product_id)
       VALUES (1, $1, $2, $3)`,
      [product.rows[0].price, orderId, product.rows[0].id],
    );

    const event = buildOrderPlaced({
      orderId,
      userId: buyer.rows[0].id,
      totalCents: product.rows[0].price,
    });
    await insertOutbox(client, {
      aggregateType: 'Order',
      aggregateId: String(orderId),
      type: 'order.placed',
      payload: event,
    });

    // Маркер ДО COMMIT — батько вбиває тут; транзакція відкочується.
    writeSync(1, `MARK:inserted:${orderId}\n`);
    await new Promise((r) => setTimeout(r, LAG_MS));

    await client.query('COMMIT');
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--worker')) {
    await worker();
    return;
  }

  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error('DATABASE_URL або DB_URL не задано');
  const pool = createPool(url);

  const marker = await new Promise<{ orderId: string; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [SELF, '--worker'], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let orderId = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          if (line.startsWith('MARK:inserted:')) {
            orderId = line.slice('MARK:inserted:'.length);
            child.kill('SIGKILL');
          }
        }
      });
      child.on('exit', (_c, signal) => resolve({ orderId, signal }));
      child.on('error', reject);
    },
  );

  const orders = await pool.query(`SELECT 1 FROM orders WHERE id = $1`, [
    marker.orderId || '0',
  ]);
  const outbox = await pool.query(`SELECT 1 FROM outbox WHERE aggregate_id = $1`, [
    marker.orderId || '0',
  ]);

  const writeFailed = marker.signal === 'SIGKILL' ? 1 : 0;
  const ordersN = orders.rowCount ?? 0;
  const outboxN = outbox.rowCount ?? 0;

  console.log(`write-failed=${writeFailed}`);
  console.log(`orders=${ordersN}`);
  console.log(`outbox=${outboxN}`);

  await pool.end();
  process.exit(writeFailed === 1 && ordersN === 0 && outboxN === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
