import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPg } from './pg.js';

test('одноразовий Postgres зберігає той самий рядок', { timeout: 120_000 }, async () => {
  const pg = await startPg();
  try {
    const inserted = await pg.pool.query(
      `INSERT INTO orders (total_cents) VALUES ($1) RETURNING id::text, total_cents`,
      [0],
    );
    assert.deepEqual(inserted.rows, [{ id: '1', total_cents: 0 }]);

    const count = await pg.pool.query(`SELECT count(*)::int AS n FROM orders`);
    assert.equal(count.rows[0].n, 1);
  } finally {
    await pg.stop();
  }
});
