import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { startPg } from './pg.js';

test('happy path: POST /orders створює замовлення', { timeout: 120_000 }, async () => {
  const pg = await startPg();
  process.env.PORT = '3216';
  process.env.DB_URL = pg.uri;
  process.env.LOG_LEVEL = 'error';
  const { createHttpApp } = await import('../src/main.js');
  const http = await createHttpApp();
  await http.listen(0);
  try {
    const created = await request(http.app)
      .post('/orders')
      .set('Idempotency-Key', 'hw16-happy')
      .send({ items: [1] });
    assert.equal(created.status, 201);
    assert.equal(typeof created.body.id, 'number');
    assert.equal(typeof created.body.total_cents, 'number');
  } finally {
    await http.close();
    await pg.stop();
  }
});
