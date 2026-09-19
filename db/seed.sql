TRUNCATE order_items, orders, products, users RESTART IDENTITY CASCADE;

INSERT INTO users (email)
SELECT 'User' || i || '@Shop.test'
FROM generate_series(1, 1000) AS s(i);

INSERT INTO products (seller_id, name, description, price)
SELECT (i % 1000) + 1,
  CASE
    WHEN i <= 2000 THEN 'Шкіряні кросівки ' || i
    WHEN i <= 7000 THEN 'Кросівки ' || i
    WHEN i % 3 = 0 THEN 'Сумка ' || i
    WHEN i % 3 = 1 THEN 'Ноутбук ' || i
    ELSE 'Чашка ' || i
  END,
  CASE
    WHEN i <= 2000 THEN 'опис: шкіряні кросівки'
    WHEN i <= 7000 THEN 'опис: кросівки'
    WHEN i % 3 = 0 THEN 'опис: сумка'
    WHEN i % 3 = 1 THEN 'опис: ноутбук'
    ELSE 'опис: чашка'
  END,
  10 + (i % 90)
FROM generate_series(1, 100000) AS s(i);

INSERT INTO orders (user_id, status, created_at)
SELECT
  CASE
    WHEN i <= 4000 THEN 1
    ELSE (i % 1000) + 1
  END,
  CASE
    WHEN i % 100 < 93 THEN 'completed'
    WHEN i % 100 < 98 THEN 'pending'
    ELSE 'cancelled'
  END,
  CASE
    WHEN i <= 4000 THEN timestamptz '2024-01-01+00' + (i % 28) * interval '1 day'
    ELSE timestamptz '2023-01-01+00' + (i % 1000) * interval '1 day'
  END
FROM generate_series(1, 100000) AS s(i);

INSERT INTO order_items (order_id, product_id, qty, unit_price)
SELECT
  i,
  (i % 100000) + 1,
  1 + (i % 3),
  10 + (i % 90)
FROM generate_series(1, 100000) AS s(i);

VACUUM (ANALYZE);
