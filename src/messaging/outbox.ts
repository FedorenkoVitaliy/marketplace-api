import type { Pool, PoolClient } from 'pg';
import { EXCHANGE, ROUTING_KEY } from './constants.js';
import { body, withConfirmChannel } from './amqp.js';

export type OutboxRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  type: string;
  payload: unknown;
};

/** INSERT у outbox у вже відкритій транзакції клієнта. */
export async function insertOutbox(
  client: PoolClient,
  input: {
    aggregateType: string;
    aggregateId: string;
    type: string;
    payload: unknown;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO outbox (aggregate_type, aggregate_id, type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id::text`,
    [
      input.aggregateType,
      input.aggregateId,
      input.type,
      JSON.stringify(input.payload),
    ],
  );
  return rows[0].id;
}

export type RelayOptions = {
  /** Після publish, до UPDATE published_at — вікно для SIGKILL у демо. */
  crashBeforeUpdate?: boolean;
  lagMs?: number;
  limit?: number;
  onPublished?: (n: number) => void;
};

/**
 * Один прохід релея: SELECT … FOR UPDATE SKIP LOCKED → publish → UPDATE published_at.
 * Між publish і UPDATE — щілина at-least-once (дизайн, не баг).
 */
export async function relayPass(
  pool: Pool,
  opts: RelayOptions = {},
): Promise<number> {
  const limit = opts.limit ?? 100;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<OutboxRow>(
      `SELECT id::text, aggregate_type, aggregate_id, type, payload
         FROM outbox
        WHERE published_at IS NULL
        ORDER BY created_at, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    await withConfirmChannel(async (ch) => {
      for (const row of rows) {
        const routing =
          row.type === 'order.placed' ? ROUTING_KEY : row.type;
        const payload = row.payload as { eventId?: string };
        const ok = ch.publish(EXCHANGE, routing, body(row.payload), {
          persistent: true,
          contentType: 'application/json',
          messageId: payload.eventId ?? row.id,
          type: row.type,
          mandatory: true,
        });
        if (!ok) throw new Error('publish buffer full');
      }
      await ch.waitForConfirms();
    });

    opts.onPublished?.(rows.length);

    if (opts.crashBeforeUpdate) {
      const lag = opts.lagMs ?? 400;
      await new Promise((r) => setTimeout(r, lag));
    }

    await client.query(
      `UPDATE outbox
          SET published_at = now(), attempts = attempts + 1
        WHERE id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)],
    );
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function unpublishedCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM outbox WHERE published_at IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function outboxCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM outbox`,
  );
  return Number(rows[0]?.n ?? 0);
}
