import type { Pool } from 'pg';
import { createPool } from '../db.js';

let pool: Pool | undefined;

function dbUrl(): string {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) {
    throw new Error('DATABASE_URL або DB_URL не задано (дедуп ефектів у Postgres)');
  }
  return url;
}

export function getEffectsPool(): Pool {
  if (!pool) pool = createPool(dbUrl());
  return pool;
}

export async function closeEffectsPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

/** Прибрати позначки й ефекти споживача(ів) перед демо. */
export async function resetState(...consumers: string[]): Promise<void> {
  const p = getEffectsPool();
  for (const consumer of consumers) {
    await p.query(`DELETE FROM message_effects WHERE consumer = $1`, [consumer]);
    await p.query(`DELETE FROM processed_messages WHERE consumer = $1`, [consumer]);
  }
}

export async function effectCount(consumer: string): Promise<number> {
  const { rows } = await getEffectsPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM message_effects WHERE consumer = $1`,
    [consumer],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function processedCount(consumer: string): Promise<number> {
  const { rows } = await getEffectsPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM processed_messages WHERE consumer = $1`,
    [consumer],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Позначка processed + ефект в одному COMMIT.
 * Дубль (ON CONFLICT) → 'duplicate' без нового ефекту.
 */
export async function claimAndApply(
  consumer: string,
  id: string,
  payload: unknown,
): Promise<'applied' | 'duplicate'> {
  const p = getEffectsPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `INSERT INTO processed_messages (consumer, event_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING event_id`,
      [consumer, id],
    );
    if (claimed.rowCount === 0) {
      await client.query('ROLLBACK');
      return 'duplicate';
    }
    await client.query(
      `INSERT INTO message_effects (consumer, event_id, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [consumer, id, JSON.stringify(payload)],
    );
    await client.query('COMMIT');
    return 'applied';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Ефект без дедупа (рідкісний шлях без CHILD_DEDUP). */
export async function applyEffect(
  consumer: string,
  id: string,
  payload: unknown,
): Promise<void> {
  await getEffectsPool().query(
    `INSERT INTO message_effects (consumer, event_id, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [consumer, id, JSON.stringify(payload)],
  );
}
