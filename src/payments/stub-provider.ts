import { createHmac, timingSafeEqual } from 'node:crypto';
import { idempotencyKeyFor } from './pricing.js';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'reverted';

export type InboundEvent = {
  eventId: string;
  orderId: string;
  status: PaymentStatus;
  amountMinor: number;
  occurredAt: string;
  providerRef: string;
};

/**
 * Локальний стенд провайдера: HMAC над сирим тілом.
 * Не Stripe/mono — порт для демо без мережі.
 */
export class StubProvider {
  readonly id = 'stub';

  constructor(private readonly secret: string) {}

  createIntent(cmd: {
    orderId: string;
    amountMinor: number;
    idempotencyKey: string;
  }): { providerRef: string; checkoutUrl: string; status: PaymentStatus } {
    const expected = idempotencyKeyFor(cmd.orderId);
    if (cmd.idempotencyKey !== expected) {
      throw new Error('idempotency key must be derived from order_id');
    }
    const providerRef = `stub_${cmd.orderId}`;
    return {
      providerRef,
      checkoutUrl: `https://pay.stub.local/${providerRef}`,
      status: 'pending',
    };
  }

  /** Підписати подію як провайдер (для демо). */
  signWebhook(body: object): { raw: Buffer; signature: string } {
    const raw = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', this.secret).update(raw).digest('hex');
    return { raw, signature };
  }

  parseWebhook(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): InboundEvent {
    const sig = headers['x-stub-signature'] ?? '';
    const expected = createHmac('sha256', this.secret).update(raw).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('invalid webhook signature');
    }
    const parsed = JSON.parse(raw.toString()) as InboundEvent;
    if (!parsed.eventId || !parsed.orderId) {
      throw new Error('malformed webhook body');
    }
    return parsed;
  }
}
