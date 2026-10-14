import type { Pool } from 'pg';

export class OrdersRepo {
  constructor(private readonly pool: Pool) {}

  async insert(order: { userId: string; status: string }) {
    const { rows } = await this.pool.query(
      `INSERT INTO orders (status, created_at, user_id)
       VALUES ($1, now(), $2)
       RETURNING id::text, status, user_id::text`,
      [order.status, order.userId],
    );
    return rows[0] as { id: string; status: string; user_id: string };
  }

  async findById(id: string) {
    const { rows } = await this.pool.query(
      'SELECT id::text, status FROM orders WHERE id = $1',
      [id],
    );
    return (rows[0] as { id: string; status: string } | undefined) ?? null;
  }

  async findWithBuyer(id: string) {
    const { rows } = await this.pool.query(
      `SELECT o.id::text, u.email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [id],
    );
    return (rows[0] as { id: string; email: string } | undefined) ?? null;
  }
}
