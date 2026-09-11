# Оптимізації запитів

Плани зняті циклом грейдера: `down -v` → schema → seed → EXPLAIN «до» → indexes + `ANALYZE` → EXPLAIN «після». Для q4 у «після» — третій прогін.

## q1

### До

```
Seq Scan on orders  (cost=0.00..2582.00 rows=321 width=33) (actual time=0.004..3.122 rows=4000 loops=1)
  Filter: ((created_at >= '2024-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-02-01 00:00:00+00'::timestamp with time zone) AND (user_id = 1))
  Rows Removed by Filter: 96000
  Buffers: shared hit=832
Planning:
  Buffers: shared hit=77
Planning Time: 0.266 ms
Execution Time: 3.274 ms
```

### Після

```
Bitmap Heap Scan on orders  (cost=8.00..598.90 rows=291 width=33) (actual time=0.092..0.306 rows=4000 loops=1)
  Recheck Cond: ((user_id = 1) AND (created_at >= '2024-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-02-01 00:00:00+00'::timestamp with time zone))
  Heap Blocks: exact=34
  Buffers: shared hit=37 read=5
  ->  Bitmap Index Scan on idx_orders_user_created  (cost=0.00..7.93 rows=291 width=0) (actual time=0.087..0.087 rows=4000 loops=1)
        Index Cond: ((user_id = 1) AND (created_at >= '2024-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-02-01 00:00:00+00'::timestamp with time zone))
        Buffers: shared hit=3 read=5
Planning:
  Buffers: shared hit=122 read=2
Planning Time: 0.429 ms
Execution Time: 0.424 ms
```

`Bitmap Index Scan on idx_orders_user_created`. Seq Scan зник. Buffers: було shared hit=832, стало shared hit=37 read=5.

## q2

### До

```
Seq Scan on orders  (cost=0.00..2082.00 rows=4907 width=33) (actual time=0.005..3.268 rows=5000 loops=1)
  Filter: (status = 'pending'::text)
  Rows Removed by Filter: 95000
  Buffers: shared hit=832
Planning:
  Buffers: shared hit=69
Planning Time: 0.224 ms
Execution Time: 3.399 ms
```

### Після

```
Bitmap Heap Scan on orders  (cost=53.24..944.65 rows=4753 width=33) (actual time=0.193..1.111 rows=5000 loops=1)
  Recheck Cond: (status = 'pending'::text)
  Heap Blocks: exact=832
  Buffers: shared hit=832 read=6
  ->  Bitmap Index Scan on idx_orders_pending  (cost=0.00..52.05 rows=4753 width=0) (actual time=0.140..0.140 rows=5000 loops=1)
        Buffers: shared read=6
Planning:
  Buffers: shared hit=107
Planning Time: 0.355 ms
Execution Time: 1.267 ms
```

`Bitmap Index Scan on idx_orders_pending`. Seq Scan зник. Buffers: було shared hit=832, стало shared hit=832 read=6 (heap усе ще розкиданий, але фільтр 95k рядків уже не йде Seq Scan).

## q3

### До

```
Seq Scan on users  (cost=0.00..24.00 rows=5 width=25) (actual time=0.045..0.172 rows=1 loops=1)
  Filter: (lower(email) = 'user1@shop.test'::text)
  Rows Removed by Filter: 999
  Buffers: shared hit=9
Planning:
  Buffers: shared hit=81
Planning Time: 0.244 ms
Execution Time: 0.204 ms
```

### Після

```
Index Scan using idx_users_email_lower on users  (cost=0.28..8.29 rows=1 width=25) (actual time=0.016..0.016 rows=1 loops=1)
  Index Cond: (lower(email) = 'user1@shop.test'::text)
  Buffers: shared hit=1 read=2
Planning:
  Buffers: shared hit=100 read=1
Planning Time: 0.316 ms
Execution Time: 0.037 ms
```

`Index Scan using idx_users_email_lower`. Seq Scan зник. Buffers: було shared hit=9, стало shared hit=1 read=2.

## q4

### До

```
Limit  (cost=3277.02..3277.07 rows=20 width=30) (actual time=6.948..6.950 rows=20 loops=1)
  Buffers: shared hit=2029
  ->  Sort  (cost=3277.02..3277.36 rows=138 width=30) (actual time=6.947..6.948 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=2029
        ->  Seq Scan on products  (cost=0.00..3273.34 rows=138 width=30) (actual time=0.044..6.767 rows=2000 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 98000
              Buffers: shared hit=2023
Planning:
  Buffers: shared hit=96
Planning Time: 0.466 ms
Execution Time: 6.981 ms
```

### Після

```
Limit  (cost=466.16..466.21 rows=20 width=30) (actual time=1.750..1.755 rows=20 loops=1)
  Buffers: shared hit=72
  ->  Sort  (cost=466.16..466.51 rows=137 width=30) (actual time=1.747..1.749 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=72
        ->  Bitmap Heap Scan on products  (cost=30.77..462.52 rows=137 width=30) (actual time=0.315..1.436 rows=2000 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=58
              Buffers: shared hit=66
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.74 rows=137 width=0) (actual time=0.289..0.290 rows=2000 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=8
Planning:
  Buffers: shared hit=121
Planning Time: 0.861 ms
Execution Time: 1.850 ms
```

`Bitmap Index Scan on idx_products_search_vector`. Seq Scan зник. Buffers: було shared hit=2029, стало shared hit=72.

## Морфологія

кросівки: 7000
кросівок: 0

Конфіг simple ріже токени без української морфології, тому «кросівок» не збігається з «кросівки». У pg_ts_config цього стенда немає uk-словника.
