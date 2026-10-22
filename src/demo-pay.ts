/**
 * Демо платіжного шару ДЗ#22:
 * freeze quote → intent+outbox в одному COMMIT → HMAC webhook →
 * леджер + дедуп → повтор вебхука = duplicate, баланс той самий.
 */
import { createPool } from './db.js';
import { freezeQuote, idempotencyKeyFor } from './payments/pricing.js';
import { StubProvider } from './payments/stub-provider.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error('DATABASE_URL або DB_URL не задано');
  const pool = createPool(url);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? 'stub-dev-secret';
  const provider = new StubProvider(secret);

  await pool.query('DELETE FROM ledger_entries');
  await pool.query('DELETE FROM payments');
  await pool.query(
    `DELETE FROM processed_messages WHERE consumer = 'payments-webhook'`,
  );

  // Забезпечити buyer + product + order
  let buyer = await pool.query<{ id: string }>(
    `SELECT id::text FROM users WHERE email = 'pay-buyer@demo.test'`,
  );
  if (!buyer.rows[0]) {
    buyer = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ('pay-buyer@demo.test') RETURNING id::text`,
    );
  }
  const seller = await pool.query<{ id: string }>(
    `SELECT id::text FROM users ORDER BY id ASC LIMIT 1`,
  );
  await pool.query(
    `INSERT INTO products (name, description, price, stock, seller_id)
     SELECT 'Pay Demo Item', 'hw22', 120001, 10, $1::bigint
     WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Pay Demo Item')`,
    [seller.rows[0].id],
  );
  const product = await pool.query<{ id: string; price: number }>(
    `SELECT id::text, price FROM products WHERE name = 'Pay Demo Item'`,
  );

  const order = await pool.query<{ id: string }>(
    `INSERT INTO orders (status, created_at, user_id)
     VALUES ('pending', now(), $1::bigint)
     RETURNING id::text`,
    [buyer.rows[0].id],
  );
  const orderId = order.rows[0].id;
  await pool.query(
    `INSERT INTO order_items (qty, unit_price, order_id, product_id)
     VALUES (1, $1, $2::bigint, $3::bigint)`,
    [product.rows[0].price, orderId, product.rows[0].id],
  );

  const quote = freezeQuote(orderId, product.rows[0].price);
  const key = idempotencyKeyFor(orderId);
  console.log(`order_id=${orderId}`);
  console.log(`subtotal=${quote.subtotalMinor}`);
  console.log(`discount=${quote.discountMinor}`);
  console.log(`total=${quote.totalMinor}`);
  console.log(`idempotency_key=${key.slice(0, 16)}…`);

  // Intent + outbox в одній транзакції
  const client = await pool.connect();
  let providerRef = '';
  try {
    await client.query('BEGIN');
    const intent = provider.createIntent({
      orderId,
      amountMinor: quote.totalMinor,
      idempotencyKey: key,
    });
    providerRef = intent.providerRef;
    await client.query(
      `INSERT INTO payments (order_id, provider_id, provider_ref, currency, total_minor, quote, state)
       VALUES ($1, 'stub', $2, $3, $4, $5::jsonb, 'pending')`,
      [orderId, intent.providerRef, quote.currency, quote.totalMinor, JSON.stringify(quote)],
    );
    await client.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, type, payload)
       VALUES ('Payment', $1, 'payment.intent_created', $2::jsonb)`,
      [
        orderId,
        JSON.stringify({
          eventId: `payment.intent:${orderId}`,
          type: 'payment.intent_created',
          data: { orderId, providerRef, totalMinor: quote.totalMinor },
        }),
      ],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`intent_created=${providerRef}`);

  const event = {
    eventId: `evt_pay_${orderId}_1`,
    orderId,
    status: 'succeeded' as const,
    amountMinor: quote.totalMinor,
    occurredAt: new Date().toISOString(),
    providerRef,
  };
  const { raw, signature } = provider.signWebhook(event);

  // Перший вебхук — apply
  const first = await applyWebhook(pool, provider, raw, signature);
  console.log(`webhook_1=${first.outcome}`);

  const bal1 = await balance(pool, orderId);
  console.log(`ledger_after_1=${bal1}`);

  // Повтор того самого eventId — duplicate, баланс не змінився
  const second = await applyWebhook(pool, provider, raw, signature);
  console.log(`webhook_2=${second.outcome}`);
  const bal2 = await balance(pool, orderId);
  console.log(`ledger_after_2=${bal2}`);

  // Підроблений підпис
  const bad = await applyWebhook(pool, provider, raw, 'deadbeef');
  console.log(`webhook_bad_sig=${bad.outcome}`);

  // Інцидент: інша сума
  const wrong = {
    ...event,
    eventId: `evt_pay_${orderId}_wrong`,
    amountMinor: quote.totalMinor + 1,
  };
  const signedWrong = provider.signWebhook(wrong);
  const incident = await applyWebhook(
    pool,
    provider,
    signedWrong.raw,
    signedWrong.signature,
  );
  console.log(`webhook_amount_mismatch=${incident.outcome}`);

  await pool.end();

  const expectedTotal =
    product.rows[0].price - Math.floor((product.rows[0].price * 10) / 100);
  const ok =
    first.outcome === 'applied' &&
    second.outcome === 'duplicate' &&
    bal1 === quote.totalMinor &&
    bal2 === bal1 &&
    bad.outcome === 'incident' &&
    incident.outcome === 'incident' &&
    quote.totalMinor === expectedTotal;
  process.exit(ok ? 0 : 1);
}

async function applyWebhook(
  pool: ReturnType<typeof createPool>,
  provider: StubProvider,
  raw: Buffer,
  signature: string,
) {
  let evt;
  try {
    evt = provider.parseWebhook(raw, { 'x-stub-signature': signature });
  } catch (e) {
    return {
      outcome: 'incident',
      note: e instanceof Error ? e.message : 'sig',
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `INSERT INTO processed_messages (consumer, event_id)
       VALUES ('payments-webhook', $1)
       ON CONFLICT DO NOTHING RETURNING event_id`,
      [evt.eventId],
    );
    if (claimed.rowCount === 0) {
      await client.query('COMMIT');
      return { outcome: 'duplicate' };
    }
    const pay = await client.query<{ total_minor: string }>(
      `SELECT total_minor::text FROM payments WHERE order_id = $1`,
      [evt.orderId],
    );
    if (!pay.rows[0]) {
      await client.query('ROLLBACK');
      return { outcome: 'unknown-order' };
    }
    const frozen = Number(pay.rows[0].total_minor);
    if (evt.amountMinor !== frozen) {
      await client.query('ROLLBACK');
      return { outcome: 'incident' };
    }
    await client.query(
      `INSERT INTO ledger_entries (order_id, kind, amount_minor, ref, at)
       VALUES ($1, 'capture', $2, $3, $4)
       ON CONFLICT (ref) DO NOTHING`,
      [evt.orderId, evt.amountMinor, evt.eventId, evt.occurredAt],
    );
    await client.query(
      `UPDATE payments SET state = $2, last_event_at = $3 WHERE order_id = $1`,
      [evt.orderId, evt.status, evt.occurredAt],
    );
    await client.query('COMMIT');
    return { outcome: 'applied' };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function balance(pool: ReturnType<typeof createPool>, orderId: string) {
  const { rows } = await pool.query<{ s: string }>(
    `SELECT COALESCE(SUM(amount_minor), 0)::text AS s FROM ledger_entries WHERE order_id = $1`,
    [orderId],
  );
  return Number(rows[0]?.s ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
