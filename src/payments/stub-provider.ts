import { createHmac, timingSafeEqual } from 'node:crypto';
import { idempotencyKeyFor } from './pricing.js';
import {
  type CreateIntent,
  type InboundEvent,
  type IntentCreated,
  type IntentSnapshot,
  type PaymentProvider,
  WebhookSignatureError,
} from './port.js';

/**
 * Локальний адаптер порту: HMAC над сирим тілом, без мережі.
 * У проді сюди встає MonoAdapter / StripeAdapter — порт не змінюється.
 */
export class StubProvider implements PaymentProvider {
  readonly id = 'stub';
  readonly capabilities = {
    nativeIdempotency: true,
    webhookReplayWindow: false,
  } as const;

  private readonly intents = new Map<string, IntentSnapshot>();

  constructor(private readonly secret: string) {}

  createIntent(cmd: CreateIntent): IntentCreated {
    const expected = idempotencyKeyFor(cmd.orderId);
    if (cmd.idempotencyKey !== expected) {
      throw new Error('idempotency key must be derived from order_id');
    }
    const providerRef = `stub_${cmd.orderId}`;
    this.intents.set(providerRef, {
      providerRef,
      orderId: cmd.orderId,
      status: 'pending',
      amountMinor: cmd.amountMinor,
      paidMinor: 0,
    });
    return {
      providerRef,
      checkoutUrl: `https://pay.stub.local/${providerRef}`,
      status: 'pending',
    };
  }

  getIntent(providerRef: string): IntentSnapshot {
    const snap = this.intents.get(providerRef);
    if (!snap) throw new Error(`unknown intent ${providerRef}`);
    return snap;
  }

  /** Підписати подію як провайдер (лише для демо). */
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
      throw new WebhookSignatureError('invalid webhook signature');
    }
    const parsed = JSON.parse(raw.toString()) as InboundEvent;
    if (!parsed.eventId || !parsed.orderId) {
      throw new WebhookSignatureError('malformed webhook body');
    }
    const snap = this.intents.get(parsed.providerRef);
    if (snap && parsed.status === 'succeeded') {
      this.intents.set(parsed.providerRef, {
        ...snap,
        status: 'succeeded',
        paidMinor: parsed.amountMinor,
      });
    }
    return parsed;
  }
}
