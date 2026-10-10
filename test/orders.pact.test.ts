import 'reflect-metadata';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MatchersV3, PactV3, Verifier } from '@pact-foundation/pact';
import { startPg } from './pg.js';

const { like } = MatchersV3;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pactDir = path.join(root, 'pacts');
const pactFile = path.join(pactDir, 'marketplace-web-marketplace-api.json');

test('consumer: POST /orders як у OpenAPI', async () => {
  const provider = new PactV3({
    consumer: 'marketplace-web',
    provider: 'marketplace-api',
    dir: pactDir,
  });

  provider
    .uponReceiving('створення замовлення')
    .withRequest({
      method: 'POST',
      path: '/orders',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'hw16-pact' },
      body: { items: [1] },
    })
    .willRespondWith({
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: { id: like(1), total_cents: like(0) },
    });

  await provider.executeTest(async (mock) => {
    const res = await fetch(`${mock.url}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'hw16-pact' },
      body: JSON.stringify({ items: [1] }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { id: number; total_cents: number };
    assert.equal(typeof body.id, 'number');
    assert.equal(typeof body.total_cents, 'number');
  });
});

test('provider: живий API збігається з контрактом', { timeout: 120_000 }, async () => {
  const pg = await startPg();
  process.env.PORT = '3217';
  process.env.DB_URL = pg.uri;
  process.env.LOG_LEVEL = 'error';
  const { createHttpApp } = await import('../src/main.js');
  const http = await createHttpApp();
  await http.listen(0);
  try {
    await new Verifier({
      provider: 'marketplace-api',
      providerBaseUrl: http.url(),
      pactUrls: [pactFile],
      logLevel: 'warn',
    }).verifyProvider();
  } finally {
    await http.close();
    await pg.stop();
  }
});
