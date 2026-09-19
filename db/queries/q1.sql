SELECT id, user_id, status, created_at
FROM orders
WHERE user_id = 1
  AND created_at >= TIMESTAMPTZ '2024-01-01+00'
  AND created_at <  TIMESTAMPTZ '2024-02-01+00'
