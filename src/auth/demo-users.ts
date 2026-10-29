import { hashPassword } from './password.js';

/** Пароль демо-акаунтів (не секрет застосунку): buyer@shop.test / seller@shop.test. */
export const DEMO_PASSWORD = 'shop-demo-24';

const DEMO_USERS = [
  { email: 'buyer@shop.test', role: 'buyer' },
  { email: 'seller@shop.test', role: 'seller' },
] as const;

type Queryable = { query(sql: string, params?: unknown[]): Promise<unknown> };

export async function seedAuthUsers(db: Queryable): Promise<void> {
  for (const user of DEMO_USERS) {
    await db.query(
      `INSERT INTO users (email, role, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash`,
      [user.email, user.role, await hashPassword(DEMO_PASSWORD)],
    );
  }
}
