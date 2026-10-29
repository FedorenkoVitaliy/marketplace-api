import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser } from '../auth/auth.service.js';
import { getCurrentCursor, getNextCursor } from '../cursor.js';
import { buildOrderPlaced } from '../messaging/events.js';
import { insertOutbox } from '../messaging/outbox.js';
import { OrderEventsService } from './order-events.service.js';

type OrderRow = { id: number; total_cents: number; user_id?: number };
type CreateOrderResult = { id: number; total_cents: number; user_id: number };

const STATUSES = new Set(['pending', 'completed', 'cancelled']);

@Injectable()
export class OrdersService {
  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    private readonly events: OrderEventsService,
  ) {}

  async list(limit?: string, cursor?: string) {
    const orders = await this.loadAll();
    const parsedLimit = Number(limit) || orders.length;
    const start = getCurrentCursor(cursor);
    const end = start + parsedLimit;
    return {
      items: orders.slice(start, end),
      next_cursor: getNextCursor(end, orders.length),
    };
  }

  async findById(id: number) {
    const { rows } = await this.pool.query<OrderRow & { user_id: number }>(
      `SELECT o.id::int AS id,
              o.user_id::int AS user_id,
              COALESCE(SUM(i.qty * i.unit_price), 0)::int AS total_cents
         FROM orders o
         LEFT JOIN order_items i ON i.order_id = o.id
        WHERE o.id = $1
        GROUP BY o.id, o.user_id`,
      [id],
    );
    const order = rows[0];
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async findOwned(id: number, user: AuthUser) {
    const order = await this.findById(id);
    if (user.role !== 'admin' && String(order.user_id) !== user.id) {
      throw new ForbiddenException('not your order');
    }
    return order;
  }

  async isOwnedBy(orderId: number, userId: string) {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM orders WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [orderId, userId],
    );
    return rows.length > 0;
  }

  /**
   * Idempotency-Key → api_requests: той самий ключ повертає той самий order.
   * Ключ без тіла в таблиці — OpenAPI вимагає ключ; колізія ключів між різними
   * клієнтами — Conflict (23505).
   */
  async create(items: number[], idempotencyKey?: string): Promise<CreateOrderResult> {
    if (!items.length) {
      throw new BadRequestException('items required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (idempotencyKey) {
        const cached = await this.readApiRequestOrder(client, `order:${idempotencyKey}`);
        if (cached) {
          await client.query('COMMIT');
          return cached;
        }
      }

      const buyer = await client.query<{ id: string }>(
        'SELECT id FROM users ORDER BY id ASC LIMIT 1',
      );
      if (!buyer.rows[0]) {
        throw new BadRequestException('buyer required');
      }

      const products = await client.query<{ id: string; price: number }>(
        'SELECT id::text, price FROM products WHERE id = ANY($1::bigint[])',
        [items],
      );
      const byId = new Map(products.rows.map((row) => [row.id, row.price]));
      for (const productId of items) {
        if (!byId.has(String(productId))) {
          throw new BadRequestException(`unknown product ${productId}`);
        }
      }

      const inserted = await client.query<{ id: string; user_id: string }>(
        `INSERT INTO orders (status, created_at, user_id)
         VALUES ('pending', now(), $1)
         RETURNING id::text, user_id::text`,
        [buyer.rows[0].id],
      );
      const orderId = inserted.rows[0].id;
      const userId = inserted.rows[0].user_id;

      let total = 0;
      for (const productId of items) {
        const price = byId.get(String(productId))!;
        total += price;
        await client.query(
          `INSERT INTO order_items (qty, unit_price, order_id, product_id)
           VALUES (1, $1, $2, $3)`,
          [price, orderId, productId],
        );
      }

      // Подія в тій самій транзакції: dual-write COMMIT↔publish закритий.
      // Винос у брокер — окремий relay (at-least-once).
      const event = buildOrderPlaced({
        orderId,
        userId,
        totalCents: total,
      });
      await insertOutbox(client, {
        aggregateType: 'Order',
        aggregateId: String(orderId),
        type: 'order.placed',
        payload: event,
      });

      const result: CreateOrderResult = {
        id: Number(orderId),
        total_cents: total,
        user_id: Number(userId),
      };

      if (idempotencyKey) {
        // Паралельні запити з тим самим ключем: переможець один INSERT,
        // другий — ON CONFLICT DO NOTHING і повертає вже збережене замовлення.
        const claimed = await client.query(
          `INSERT INTO api_requests (idempotency_key, order_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING
           RETURNING order_id`,
          [`order:${idempotencyKey}`, orderId],
        );
        if ((claimed.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          const winner = await this.loadByIdempotencyKey(`order:${idempotencyKey}`);
          if (!winner) {
            throw new ConflictException('Idempotency-Key race without winner');
          }
          return winner;
        }
      }

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadByIdempotencyKey(key: string): Promise<CreateOrderResult | null> {
    const { rows } = await this.pool.query<{ order_id: string }>(
      `SELECT order_id::text FROM api_requests WHERE idempotency_key = $1`,
      [key],
    );
    if (!rows[0]) return null;
    return this.findById(Number(rows[0].order_id)) as Promise<CreateOrderResult>;
  }

  private async readApiRequestOrder(
    client: PoolClient,
    key: string,
  ): Promise<CreateOrderResult | null> {
    const { rows } = await client.query<{ order_id: string }>(
      `SELECT order_id::text FROM api_requests WHERE idempotency_key = $1`,
      [key],
    );
    if (!rows[0]) return null;
    const order = await client.query<CreateOrderResult>(
      `SELECT o.id::int AS id,
              o.user_id::int AS user_id,
              COALESCE(SUM(i.qty * i.unit_price), 0)::int AS total_cents
         FROM orders o
         LEFT JOIN order_items i ON i.order_id = o.id
        WHERE o.id = $1
        GROUP BY o.id, o.user_id`,
      [rows[0].order_id],
    );
    return order.rows[0] ?? null;
  }

  async updateStatus(id: number, status: string) {
    if (!STATUSES.has(status)) {
      throw new BadRequestException('invalid status');
    }

     const { rows } = await this.pool.query<{ id: string; status: string }>(
      `UPDATE orders SET status = $2
        WHERE id = $1
        RETURNING id::text, status`,
      [id, status],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Order not found');
    }

    this.events.publish(row.id, row.status);

    return { id: Number(row.id), status: row.status };
  }

  private async loadAll() {
    const { rows } = await this.pool.query<OrderRow>(
      `SELECT o.id::int AS id,
              COALESCE(SUM(i.qty * i.unit_price), 0)::int AS total_cents
         FROM orders o
         LEFT JOIN order_items i ON i.order_id = o.id
        GROUP BY o.id
        ORDER BY o.id`,
    );
    return rows;
  }
}
