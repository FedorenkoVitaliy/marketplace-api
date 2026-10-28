import { createPool } from '../db.js';
import { createHttpApp } from '../main.js';
import { DEMO_PASSWORD, seedAuthUsers } from './demo-users.js';

type Reply = { status: number; body: Record<string, unknown> | null };
type Tokens = { accessToken: string; refreshToken: string };

export type DemoKit = {
  call(method: string, path: string, opts?: { token?: string; body?: unknown }): Promise<Reply>;
  login(email: string): Promise<{ status: number } & Tokens>;
  refresh(refreshToken: string): Promise<{ status: number } & Tokens>;
  orderOf(email: string): Promise<number>;
  trackProduct(id: number): void;
};

/**
 * Піднімає API на своєму порту, ганяє сценарій, друкує key=value і завжди
 * прибирає за собою (orders/products/refresh_tokens демо). Exit 1, якщо хоч
 * один рядок не збігся з очікуваним. Trap на EXIT/сигнали — як у bash-демо.
 */
export async function runDemo(
  port: number,
  expected: Record<string, number>,
  scenario: (kit: DemoKit) => Promise<Record<string, number>>,
): Promise<never> {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error('DATABASE_URL або DB_URL не задано');
  process.env.DATABASE_URL = url;
  process.env.DB_URL = url;
  process.env.PORT = String(port);
  process.env.LOG_LEVEL = 'error';

  const pool = createPool(url);
  await seedAuthUsers(pool);
  const startedAt = new Date();
  const orders: number[] = [];
  const products: number[] = [];

  const http = await createHttpApp();
  await http.listen(port);
  const base = `http://127.0.0.1:${port}`;

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await pool.query(`DELETE FROM orders WHERE id = ANY($1::bigint[])`, [orders]);
    await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [products]);
    await pool.query(
      `DELETE FROM refresh_tokens
        WHERE created_at >= $1
          AND user_id IN (SELECT id FROM users WHERE email IN ('buyer@shop.test', 'seller@shop.test'))`,
      [startedAt],
    );
    await http.close();
    await pool.end();
  };
  const onSignal = () => {
    void cleanup().finally(() => process.exit(1));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const call: DemoKit['call'] = async (method, path, { token, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const tokens = (r: Reply) => ({ status: r.status, ...(r.body as Tokens) });

  const kit: DemoKit = {
    call,
    login: async (email) =>
      tokens(await call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } })),
    refresh: async (refreshToken) =>
      tokens(await call('POST', '/auth/refresh', { body: { refreshToken } })),
    orderOf: async (email) => {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO orders (status, created_at, user_id)
         SELECT 'pending', now(), id FROM users WHERE email = $1
         RETURNING id::int`,
        [email],
      );
      orders.push(rows[0]!.id);
      return rows[0]!.id;
    },
    trackProduct: (id) => products.push(id),
  };

  let ok = false;
  try {
    const results = await scenario(kit);
    ok = Object.entries(expected).every(([key, want]) => {
      console.log(`${key}=${results[key]}`);
      return results[key] === want;
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanup();
  }
  process.exit(ok ? 0 : 1);
}
