SELECT id, user_id, status, created_at
FROM orders
WHERE status = 'pending'
