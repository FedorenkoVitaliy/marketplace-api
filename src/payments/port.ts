/**
 * Порт платіжного провайдера. Домен знає лише цей контракт.
 * Stub / mono / stripe — адаптери; міняється один рядок у DI.
 *
 * Теза L#22: немає «списати», є «попросити і не дізнатися результату».
 */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'succeeded'
  | 'failed'
  | 'reverted'
  | 'expired';

export type CreateIntent = {
  orderId: string;
  amountMinor: number;
  /** Правило №3: похідний від order_id, не випадковий UUID. */
  idempotencyKey: string;
  currency: string;
  description?: string;
};

export type IntentCreated = {
  providerRef: string;
  checkoutUrl: string;
  status: PaymentStatus;
};

export type IntentSnapshot = {
  providerRef: string;
  orderId: string;
  status: PaymentStatus;
  amountMinor: number;
  paidMinor: number;
};

export type InboundEvent = {
  eventId: string;
  orderId: string;
  status: PaymentStatus;
  amountMinor: number;
  occurredAt: string;
  providerRef: string;
};

export type ProviderCapabilities = {
  nativeIdempotency: boolean;
  webhookReplayWindow: boolean;
};

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export interface PaymentProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  /** ПОПРОСИТИ намір — не «списати». */
  createIntent(cmd: CreateIntent): IntentCreated | Promise<IntentCreated>;

  /** ДІЗНАТИСЬ стан (вихід із «не знаю»). */
  getIntent(providerRef: string): IntentSnapshot | Promise<IntentSnapshot>;

  /**
   * Розібрати вебхук. Тільки Buffer: підпис над сирими байтами.
   * Розпарсене тіло сюди передати не можна.
   */
  parseWebhook(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): InboundEvent | Promise<InboundEvent>;
}

/** DI-токен: у модулі підставляється StubProvider (або mono/stripe). */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
