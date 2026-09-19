# Оптимізації запитів

Плани зняті циклом грейдера: `down -v` → schema → seed → EXPLAIN «до» → indexes + `ANALYZE` → EXPLAIN «після». Для q4 у «після» — третій прогін. Після ревʼю: `idx_orders_pending` має `INCLUDE (id, user_id)`, `search_vector` будується через `setweight` (name `A`, description `B`).

## q1

### До

```
Seq Scan on orders  (cost=0.00..2582.00 rows=309 width=33) (actual time=0.004..3.225 rows=4000 loops=1)
  Filter: ((created_at >= '2024-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-02-01 00:00:00+00'::timestamp with time zone) AND (user_id = 1))
  Rows Removed by Filter: 96000
  Buffers: shared hit=832
Planning:
  Buffers: shared hit=77
Planning Time: 0.594 ms
Execution Time: 3.399 ms
```

### Після

```
Bitmap Heap Scan on orders  (cost=8.36..629.63 rows=319 width=33) (actual time=0.083..0.295 rows=4000 loops=1)
  Recheck Cond: ((user_id = 1) AND (created_at >= '2024-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-02-01 00:00:00+00'::timestamp with time zone))
  Heap Blocks: exact=34
  Buffers: shared hit=37 read=5
  ->  Bitmap Index Scan on idx_orders_user_created  (cost=0.00..8.28 rows=319 width=0) (actual time=0.077..0.077 rows=4000 loops=1)
        Index Cond: ((user_id = 1) AND (created_at >= '2024-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-02-01 00:00:00+00'::timestamp with time zone))
        Buffers: shared hit=3 read=5
Planning:
  Buffers: shared hit=128 read=2
Planning Time: 0.450 ms
Execution Time: 0.410 ms
```

`Bitmap Index Scan on idx_orders_user_created`. Seq Scan зник. Buffers: було shared hit=832, стало shared hit=37 read=5.

## q2

### До

```
Seq Scan on orders  (cost=0.00..2082.00 rows=5083 width=33) (actual time=0.005..3.904 rows=5000 loops=1)
  Filter: (status = 'pending'::text)
  Rows Removed by Filter: 95000
  Buffers: shared hit=832
Planning:
  Buffers: shared hit=69
Planning Time: 0.227 ms
Execution Time: 4.058 ms
```

### Після

```
Bitmap Heap Scan on orders  (cost=134.99..1030.58 rows=5087 width=33) (actual time=0.764..2.826 rows=5000 loops=1)
  Recheck Cond: (status = 'pending'::text)
  Heap Blocks: exact=832
  Buffers: shared hit=832 read=26
  ->  Bitmap Index Scan on idx_orders_pending  (cost=0.00..133.72 rows=5087 width=0) (actual time=0.627..0.627 rows=5000 loops=1)
        Buffers: shared read=26
Planning:
  Buffers: shared hit=113
Planning Time: 1.268 ms
Execution Time: 3.095 ms
```

`Bitmap Index Scan on idx_orders_pending`. Seq Scan зник. Індекс covering (`INCLUDE (id, user_id)`), тож листя індексу ширше (read=26). Heap Blocks лишились 832: 5000 pending розкидані по всіх сторінках `orders`, планер бере Bitmap Heap Scan, не Index Only Scan.

## q3

### До

```
Seq Scan on users  (cost=0.00..24.00 rows=5 width=25) (actual time=0.013..0.140 rows=1 loops=1)
  Filter: (lower(email) = 'user1@shop.test'::text)
  Rows Removed by Filter: 999
  Buffers: shared hit=9
Planning:
  Buffers: shared hit=81
Planning Time: 0.221 ms
Execution Time: 0.165 ms
```

### Після

```
Index Scan using idx_users_email_lower on users  (cost=0.28..8.29 rows=1 width=25) (actual time=0.028..0.029 rows=1 loops=1)
  Index Cond: (lower(email) = 'user1@shop.test'::text)
  Buffers: shared hit=1 read=2
Planning:
  Buffers: shared hit=100 read=1
Planning Time: 0.658 ms
Execution Time: 0.074 ms
```

`Index Scan using idx_users_email_lower`. Seq Scan зник. Buffers: було shared hit=9, стало shared hit=1 read=2.

## q4

### До

```
Limit  (cost=3276.81..3276.86 rows=20 width=30) (actual time=9.475..9.476 rows=20 loops=1)
  Buffers: shared hit=2029
  ->  Sort  (cost=3276.81..3277.14 rows=131 width=30) (actual time=9.473..9.474 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=2029
        ->  Seq Scan on products  (cost=0.00..3273.33 rows=131 width=30) (actual time=0.015..9.292 rows=2000 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 98000
              Buffers: shared hit=2023
Planning:
  Buffers: shared hit=96
Planning Time: 0.597 ms
Execution Time: 9.512 ms
```

### Після

```
Limit  (cost=454.56..454.61 rows=20 width=30) (actual time=2.266..2.273 rows=20 loops=1)
  Buffers: shared hit=72
  ->  Sort  (cost=454.56..454.89 rows=133 width=30) (actual time=2.263..2.267 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=72
        ->  Bitmap Heap Scan on products  (cost=30.75..451.02 rows=133 width=30) (actual time=0.411..1.898 rows=2000 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=58
              Buffers: shared hit=66
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.72 rows=133 width=0) (actual time=0.370..0.371 rows=2000 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=8
Planning:
  Buffers: shared hit=121
Planning Time: 0.995 ms
Execution Time: 2.419 ms
```

`Bitmap Index Scan on idx_products_search_vector`. Seq Scan зник. Buffers: було shared hit=2029, стало shared hit=72. `setweight` на name (`A`) і description (`B`) дає `ts_rank` різні ваги полів; сортування більше не зводиться лише до `id`, якщо збіг у назві vs в описі.

## Морфологія

кросівки: 7000
кросівок: 0

Конфіг simple ріже токени без української морфології, тому «кросівок» не збігається з «кросівки». У pg_ts_config цього стенда немає uk-словника.
