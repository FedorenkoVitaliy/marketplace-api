import { createHash } from 'node:crypto';
import { CURRENCY, type CurrencyCode, type Minor, minor, uah } from './money.js';

export const DISCOUNT_THRESHOLD_MINOR = uah(1000);
export const DISCOUNT_PERCENT = 10;

export type Quote = {
  orderId: string;
  currency: CurrencyCode;
  subtotalMinor: Minor;
  discountMinor: Minor;
  totalMinor: Minor;
  frozenAt: string;
};

/** Правило №3: ключ похідний від order_id, не випадковий UUID. */
export function idempotencyKeyFor(orderId: string): string {
  return createHash('sha256').update(`order:${orderId}`).digest('hex');
}

/**
 * Заморозити суму замовлення (правила №1–2).
 * Знижка 10% лише якщо кошик СТРОГО понад 1000 грн; Math.floor.
 */
export function freezeQuote(orderId: string, subtotalMinor: number, now = new Date()): Quote {
  const sub = minor(subtotalMinor);
  let discount = minor(0);
  if (sub > DISCOUNT_THRESHOLD_MINOR) {
    discount = minor(Math.floor((sub * DISCOUNT_PERCENT) / 100));
  }
  return {
    orderId,
    currency: CURRENCY,
    subtotalMinor: sub,
    discountMinor: discount,
    totalMinor: minor(sub - discount),
    frozenAt: now.toISOString(),
  };
}
