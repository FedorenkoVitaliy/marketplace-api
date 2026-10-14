import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { getCurrentCursor, getNextCursor } from '../cursor.js';

type OrderRow = { id: number; total_cents: number };

@Injectable()
export class OrdersService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

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
    const { rows } = await this.pool.query<OrderRow>(
      `SELECT o.id::int AS id,
              COALESCE(SUM(i.qty * i.unit_price), 0)::int AS total_cents
         FROM orders o
         LEFT JOIN order_items i ON i.order_id = o.id
        WHERE o.id = $1
        GROUP BY o.id`,
      [id],
    );
    const order = rows[0];
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
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

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO orders (status, created_at, user_id)
         VALUES ('pending', now(), $1)
         RETURNING id::text`,
        [buyer.rows[0].id],
      );
      const orderId = inserted.rows[0].id;

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
      return { id: Number(orderId), total_cents: total };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
