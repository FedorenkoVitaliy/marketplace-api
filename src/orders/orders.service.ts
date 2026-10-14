import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { getCurrentCursor, getNextCursor } from '../cursor.js';
import { publishOrderPlacedIfConfigured } from '../messaging/publisher.js';
import { OrderEventsService } from './order-events.service.js';

type OrderRow = { id: number; total_cents: number };

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

  async isOwnedBy(orderId: number, userId: string) {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM orders WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [orderId, userId],
    );
    return rows.length > 0;
  }

  async create(items: number[]) {
    if (!items.length) {
      throw new BadRequestException('items required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

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

      await client.query('COMMIT');
      const result = { id: Number(orderId), total_cents: total, user_id: Number(userId) };
      // Подія після COMMIT: брокер і БД без спільного COMMIT (outbox — ДЗ#22).
      await publishOrderPlacedIfConfigured({
        orderId: result.id,
        userId: result.user_id,
        totalCents: result.total_cents,
      });
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
