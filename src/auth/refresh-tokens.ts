import { createHmac, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

const REFRESH_TTL_SEC = 14 * 24 * 3600;

export type Rotation =
  | { status: 'ok'; userId: string; familyId: string; refreshToken: string }
  | { status: 'reuse'; userId: string; familyId: string }
  | { status: 'invalid' };

const newToken = () => randomBytes(32).toString('base64url');

/** У БД — лише HMAC(pepper, token): витік таблиці не дає робочих токенів. */
export const hashRefresh = (pepper: string, token: string) =>
  createHmac('sha256', pepper).update(token).digest('hex');

export async function issueFamily(pool: Pool, pepper: string, userId: string) {
  const refreshToken = newToken();
  const { rows } = await pool.query<{ family_id: string }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1, gen_random_uuid(), $2, now() + make_interval(secs => $3))
     RETURNING family_id`,
    [userId, hashRefresh(pepper, refreshToken), REFRESH_TTL_SEC],
  );
  return { familyId: rows[0]!.family_id, refreshToken };
}

/**
 * Позначка «використаний» — одним UPDATE … WHERE used_at IS NULL: з двох
 * паралельних рефрешів виграє рівно один, другий іде в гілку reuse.
 * Новий токен успадковує expires_at сімʼї — ротація не подовжує сесію.
 */
export async function rotate(pool: Pool, pepper: string, presented: string): Promise<Rotation> {
  const hash = hashRefresh(pepper, presented);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ user_id: string; family_id: string; expires_at: Date }>(
      `UPDATE refresh_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING user_id::text, family_id, expires_at`,
      [hash],
    );
    const row = claimed.rows[0];
    if (row) {
      const refreshToken = newToken();
      await client.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [row.user_id, row.family_id, hashRefresh(pepper, refreshToken), row.expires_at],
      );
      await client.query('COMMIT');
      return { status: 'ok', userId: row.user_id, familyId: row.family_id, refreshToken };
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const revoked = await pool.query<{ user_id: string; family_id: string }>(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE family_id = (SELECT family_id FROM refresh_tokens
                          WHERE token_hash = $1 AND used_at IS NOT NULL)
        AND revoked_at IS NULL
      RETURNING user_id::text, family_id`,
    [hash],
  );
  const hit = revoked.rows[0];
  return hit ? { status: 'reuse', userId: hit.user_id, familyId: hit.family_id } : { status: 'invalid' };
}

export async function revokeFamily(pool: Pool, familyId: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}
