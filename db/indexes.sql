CREATE INDEX idx_orders_user_created
  ON orders (user_id, created_at);

CREATE INDEX idx_orders_pending
  ON orders (created_at)
  INCLUDE (id, user_id)
  WHERE status = 'pending';

CREATE INDEX idx_users_email_lower
  ON users (lower(email));

CREATE INDEX idx_products_search_vector
  ON products USING GIN (search_vector);
