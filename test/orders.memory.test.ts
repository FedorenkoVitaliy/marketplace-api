import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrdersService } from '../src/orders/orders.service.js';

test('create повертає замовлення, не чіпаючи таблицю', () => {
  const orders = new OrdersService();
  assert.deepEqual(orders.create(), { id: 1, total_cents: 0 });
});
