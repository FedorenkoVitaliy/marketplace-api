import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';

const { like } = MatchersV3;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('marketplace-web → marketplace-api', () => {
  const provider = new PactV3({
    consumer: 'marketplace-web',
    provider: 'marketplace-api',
    dir: path.join(root, 'pacts'),
  });

  it('POST /orders коли buyer exists', async () => {
    provider
      .given('buyer exists')
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
      expect(res.status).toBe(201);
      const body = await res.json() as { id: number; total_cents: number };
      expect(typeof body.id).toBe('number');
      expect(typeof body.total_cents).toBe('number');
    });
  });
});
