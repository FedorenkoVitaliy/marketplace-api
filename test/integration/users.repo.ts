import type { Pool } from 'pg';

export class UsersRepo {
  constructor(private readonly pool: Pool) {}

  async insert(user: { email: string }) {
    const { rows } = await this.pool.query(
      'INSERT INTO users (email) VALUES ($1) RETURNING id::text, email',
      [user.email],
    );
    return rows[0] as { id: string; email: string };
  }

  async findByEmail(email: string) {
    const { rows } = await this.pool.query(
      'SELECT id::text, email FROM users WHERE email = $1',
      [email],
    );
    return (rows[0] as { id: string; email: string } | undefined) ?? null;
  }

  async insertOrIgnore(user: { email: string }) {
    await this.pool.query(
      'INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [user.email],
    );
    return this.findByEmail(user.email);
  }
}
