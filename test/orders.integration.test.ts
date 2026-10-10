import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPg } from './pg.js';

test('міграції створюють orders, куди можна вставити рядок', { timeout: 120_000 }, async () => {
  const pg = await startPg();
  try {
    const user = await pg.pool.query(
      `INSERT INTO users (email) VALUES ('buyer@example.com') RETURNING id::text`,
    );
    const inserted = await pg.pool.query(
      `INSERT INTO orders (status, created_at, user_id)
       VALUES ($1, now(), $2)
       RETURNING id::text, status`,
      ['pending', user.rows[0].id],
    );
    assert.deepEqual(inserted.rows, [{ id: '1', status: 'pending' }]);
  } finally {
    await pg.stop();
  }
});
