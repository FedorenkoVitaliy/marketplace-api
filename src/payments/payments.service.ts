import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { insertOutbox } from '../messaging/outbox.js';
import {
  PAYMENT_PROVIDER,
  type InboundEvent,
  type PaymentProvider,
  WebhookSignatureError,
} from './port.js';
import { freezeQuote, idempotencyKeyFor } from './pricing.js';
import { StubProvider } from './stub-provider.js';

type PayResponse = {
  orderId: string;
  state: string;
  providerRef: string;
  checkoutUrl?: string;
  totalMinor: number;
  idempotencyKey: string;
  reused: boolean;
};

@Injectable()
export class PaymentsService {
  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Створити платіжний намір + outbox (+ api_requests) в одній транзакції.
   * Idempotency-Key: той самий ключ → той самий намір; інший ключ на той самий
   * order — Conflict (правило №3: ключ = sha256(order_id)).
   */
  async createIntent(orderId: string, idempotencyKey?: string): Promise<PayResponse> {
    const expectedKey = idempotencyKeyFor(orderId);
    if (idempotencyKey && idempotencyKey !== expectedKey) {
      throw new BadRequestException(
        'Idempotency-Key must equal sha256(order_id) (rule #3)',
      );
    }
    const key = idempotencyKey ?? expectedKey;
    const apiKey = `pay:${key}`;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const cachedId = await this.readApiRequestOrderId(client, apiKey);
      if (cachedId) {
        const payload = await this.loadPayResponse(client, cachedId, key, true);
        await client.query('COMMIT');
        return payload;
      }

      const order = await client.query<{
        id: string;
        total: string;
      }>(
        `SELECT o.id::text AS id,
                COALESCE(SUM(i.qty * i.unit_price), 0)::text AS total
           FROM orders o
           LEFT JOIN order_items i ON i.order_id = o.id
          WHERE o.id = $1
          GROUP BY o.id`,
        [orderId],
      );
      if (!order.rows[0]) throw new NotFoundException('Order not found');

      const existing = await client.query(
        `SELECT order_id, state, provider_ref, total_minor
           FROM payments WHERE order_id = $1`,
        [orderId],
      );
      if (existing.rows[0]) {
        await this.writeApiRequest(client, apiKey, orderId);
        const payload = await this.loadPayResponse(client, orderId, key, true);
        await client.query('COMMIT');
        return payload;
      }

      const quote = freezeQuote(orderId, Number(order.rows[0].total));
      const intent = await this.provider.createIntent({
        orderId,
        amountMinor: quote.totalMinor,
        idempotencyKey: key,
        currency: quote.currency,
      });

      await client.query(
        `INSERT INTO payments (order_id, provider_id, provider_ref, currency, total_minor, quote, state)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          orderId,
          this.provider.id,
          intent.providerRef,
          quote.currency,
          quote.totalMinor,
          JSON.stringify(quote),
          'pending',
        ],
      );

      await insertOutbox(client, {
        aggregateType: 'Payment',
        aggregateId: orderId,
        type: 'payment.intent_created',
        payload: {
          eventId: `payment.intent:${orderId}`,
          type: 'payment.intent_created',
          occurredAt: new Date().toISOString(),
          data: {
            orderId,
            providerRef: intent.providerRef,
            totalMinor: quote.totalMinor,
          },
        },
      });

      await this.writeApiRequest(client, apiKey, orderId);
      await client.query('COMMIT');
      return {
        orderId,
        state: 'pending',
        providerRef: intent.providerRef,
        checkoutUrl: intent.checkoutUrl,
        totalMinor: quote.totalMinor,
        idempotencyKey: key,
        reused: false,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Idempotency-Key already used');
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Вебхук: підпис → дедуп → звірка суми → леджер + стан + inbox в одному COMMIT.
   */
  async handleWebhook(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ outcome: string; httpStatus: number; note: string }> {
    let evt: InboundEvent;
    try {
      evt = await this.provider.parseWebhook(raw, headers);
    } catch (e) {
      const note =
        e instanceof WebhookSignatureError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'bad signature';
      return { outcome: 'incident', httpStatus: 400, note };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const claimed = await client.query(
        `INSERT INTO processed_messages (consumer, event_id)
         VALUES ('payments-webhook', $1)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [evt.eventId],
      );
      if (claimed.rowCount === 0) {
        await client.query('COMMIT');
        return { outcome: 'duplicate', httpStatus: 200, note: `дубль ${evt.eventId}` };
      }

      const pay = await client.query<{
        total_minor: string;
        state: string;
        last_event_at: Date | null;
      }>(`SELECT total_minor::text, state, last_event_at FROM payments WHERE order_id = $1`, [
        evt.orderId,
      ]);
      if (!pay.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'unknown-order', httpStatus: 200, note: 'немає платежу' };
      }

      const frozen = Number(pay.rows[0].total_minor);
      if (evt.amountMinor !== frozen) {
        await client.query('ROLLBACK');
        return {
          outcome: 'incident',
          httpStatus: 400,
          note: `сума ${evt.amountMinor} ≠ заморожена ${frozen}`,
        };
      }

      const at = new Date(evt.occurredAt);
      const amount =
        evt.status === 'reverted' ? -Math.abs(evt.amountMinor) : Math.abs(evt.amountMinor);
      const kind = evt.status === 'reverted' ? 'refund' : 'capture';

      if (evt.status === 'succeeded' || evt.status === 'reverted') {
        await client.query(
          `INSERT INTO ledger_entries (order_id, kind, amount_minor, ref, at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (ref) DO NOTHING`,
          [evt.orderId, kind, amount, evt.eventId, at.toISOString()],
        );
      }

      const last = pay.rows[0].last_event_at;
      if (!last || last.getTime() <= at.getTime()) {
        await client.query(
          `UPDATE payments SET state = $2, last_event_at = $3 WHERE order_id = $1`,
          [evt.orderId, evt.status, at.toISOString()],
        );
      }

      await client.query('COMMIT');
      return {
        outcome: 'applied',
        httpStatus: 200,
        note: `застосовано ${evt.status} для ${evt.orderId}`,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Хелпер для демо: підписати подію як провайдер. */
  signDemoEvent(evt: InboundEvent) {
    if (!(this.provider instanceof StubProvider)) {
      throw new Error('demo signing only available for StubProvider');
    }
    return this.provider.signWebhook(evt);
  }

  async ledgerBalance(orderId: string): Promise<number> {
    const { rows } = await this.pool.query<{ s: string }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS s
         FROM ledger_entries WHERE order_id = $1`,
      [orderId],
    );
    return Number(rows[0]?.s ?? 0);
  }

  private async readApiRequestOrderId(
    client: PoolClient,
    key: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ order_id: string }>(
      `SELECT order_id::text FROM api_requests WHERE idempotency_key = $1`,
      [key],
    );
    return rows[0]?.order_id ?? null;
  }

  private async writeApiRequest(
    client: PoolClient,
    key: string,
    orderId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO api_requests (idempotency_key, order_id) VALUES ($1, $2)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key, orderId],
    );
  }

  private async loadPayResponse(
    client: PoolClient,
    orderId: string,
    key: string,
    reused: boolean,
  ): Promise<PayResponse> {
    const { rows } = await client.query<{
      state: string;
      provider_ref: string;
      total_minor: string;
    }>(
      `SELECT state, provider_ref, total_minor::text FROM payments WHERE order_id = $1`,
      [orderId],
    );
    if (!rows[0]) throw new NotFoundException('Payment not found');
    return {
      orderId,
      state: rows[0].state,
      providerRef: rows[0].provider_ref,
      checkoutUrl: `https://pay.stub.local/${rows[0].provider_ref}`,
      totalMinor: Number(rows[0].total_minor),
      idempotencyKey: key,
      reused,
    };
  }
}
