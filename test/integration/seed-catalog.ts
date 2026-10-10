import type { Pool } from 'pg';

/** Buyer + seller + one product (id=1 on empty DB) for HTTP create/read. */
export async function seedCatalog(
  pool: Pool,
  opts: { buyerEmail?: string; sellerEmail?: string; price?: number } = {},
) {
  const buyerEmail = opts.buyerEmail ?? 'buyer@shop.test';
  const sellerEmail = opts.sellerEmail ?? 'seller@shop.test';
  const price = opts.price ?? 100;

  await pool.query(
    `INSERT INTO users (email, balance) VALUES ($1, 10000)
     ON CONFLICT (email) DO NOTHING`,
    [buyerEmail],
  );
  await pool.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO NOTHING`,
    [sellerEmail],
  );
  await pool.query(
    `INSERT INTO products (name, description, price, stock, seller_id)
     SELECT 'Blue Shirt', 'catalog seed', $1, 5, u.id
       FROM users u
      WHERE u.email = $2
        AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Blue Shirt')`,
    [price, sellerEmail],
  );
}
