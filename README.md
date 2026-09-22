# Marketplace API

Курсовий сервіс Node.js PRO (дефолтний домен лекцій: товари + замовлення + пізніше платежі й сповіщення). Для покупця — зібрати кошик і оформити замовлення без подвійного списання. Для продавця — каталог і залишок, за який конкурують покупці.

## 1. Що це за сервіс

HTTP API маркетплейсу. Клієнт (вітрина, мобілка, інший сервіс) ходить у контракт з `openapi/openapi.yaml`; рантайм звіряє запит і відповідь через `express-openapi-validator` (варіант Б, без Pact).

User stories:

- Як покупець, я гортаю каталог порціями (`limit` / непрозорий `cursor`), щоб не тягнути всю вітрину.
- Як покупець, я бачу картку товару за id; якщо його немає — `404` у `application/problem+json`.
- Як покупець, я створюю замовлення з `Idempotency-Key`: повтор того самого ключа й тіла не створює друге списання.
- Як продавець, я тримаю обмежений залишок; два одночасні checkout не повинні продати більше, ніж є (ДЗ#14).
- Як покупець, я очікую подію «замовлення прийнято / оплачено» — пізніше realtime і черга (ДЗ#18–19).

## 2. Домен

Звʼязки: **User** (покупець / продавець) розміщує **Product** з **Stock**; покупець створює **Order** з позиціями товарів; **Payment** фіксує незворотну оплату; **Notification** — подія для клієнта. Фото товару — вкладення до Product (S3 на ДЗ#26). Каталог читають часто, змінюють рідко (кеш на ДЗ#23).

Зараз у OpenAPI живі ресурси **Product** і **Order**. User, Stock, Payment, Notification — іменовані тут, у спеку зайдуть наступними ДЗ, не вигаданими пізніше.

| Вимога | Як закрито | Де в курсі |
|---|---|---|
| ≥ 2 ролі з різними правами | покупець vs продавець | ДЗ#24 RBAC |
| Обмежений ресурс під конкуренцією | `Stock` (залишок одиниці товару) | ДЗ#14 транзакція |
| Незворотна операція | оформлення замовлення + `Payment` | ДЗ#22 outbox + idempotency |
| Подія для сповіщення | статус замовлення / оплати → `Notification` | ДЗ#18, #19 |
| Сутність із файлами | фото товару | ДЗ#26 S3 |
| Часто читають, рідко пишуть | каталог `Product` | ДЗ#23 Redis |
| 4–6 сутностей і важкий запит | User, Product, Stock, Order, Payment, Notification; звіт «замовлення продавця за період» | ДЗ#12–13 |

## 3. Архітектурні рішення

**Compute.** Один Node-процес: NestJS 11 як композиція модулів, Express 4 як HTTP-адаптер (`bodyParser: false`, щоб не було другого парсера). Спека — джерело правди на кордоні; DTO + `ValidationPipe` паралельно не додаю, щоб не мати двох контрактів.

**База.** Postgres 16 у Docker Compose. Адмін `admin` лише для bootstrap (`init.sql` створює `app_user`). Застосунок ходить як `app_user`; пароль не з `process.env`, а з файла `secrets/db_password` на кожне нове зʼєднання пулу.

**Асинхронність.** Поки синхронний request/response. Черги й outbox зʼявляться, коли зʼявиться Payment / Notification — не раніше, щоб не тягнути брокер «про запас».

**Auth.** У спеці `security: []`. Ролі закладені в домені; JWT/RBAC — ДЗ#24, не зараз.

**Deploy.** Локально: Compose для Postgres, `npm start` = `tsc && node dist/src/main.js`. Образ збирається Dockerfile без `.env` і `secrets/` (див. `.dockerignore`). Хмара / K8s — пізніші лекції.

## 4. Trade-offs

Не став Infisical стіною секретів: у LMS цього ДЗ це бонус без балів, а обовʼязковий прийом — файл + `password: async () => readFile()`. Сховище можна додати, не викидаючи файл: env як і раніше замерзне на старті, пароль БД — ні.

Не переніс каталог у Postgres на ДЗ#11: тоді треба було довести пул і секрет. Схема й seed ≥100k — у `db/` цього ДЗ#12.

Не віддав пароль у `DB_URL`. Рядок підключення в env заморожується разом із процесом; ротація тоді вимагала б рестарту. Файл перечитується драйвером на handshake.

Не тримаю Swagger UI. Спека вже примушує валідатор; UI без контракт-тестів знову робить yaml «документацією для людини».

Свідомо немає другого HTTP-фреймворка і Fastify-схем: курс уже стоїть на Nest + цьому адаптері. Eventual consistency на залишку не беру — овербукінг тут дорожчий за транзакцію.

## Configuration

Zod-схема `src/config/env.schema.ts` — єдине місце, яке читає сирий env. `ConfigModule.forRoot({ validate })` падає на старті одним `Error` зі всіма issues. У хендлерах `process.env` немає: лише `ConfigService<Env, true>`.

**Чому env замерзає.** `dotenv` / `ConfigModule` читають файл один раз під час bootstrap. Змінив `.env` на диску — процес цього не бачить, поки його не перезапустиш. Тому секрет, який має переживати ротацію без рестарту, не кладуть в env: кладуть у файл і читають знову (`pg.Pool` `password` — функція).

| Змінна / секрет | Джерело | На старті / на зʼєднання |
|---|---|---|
| `PORT` | `.env` (приклад у `.env.example`) | старт, Zod coerce number 1024–65535 |
| `DB_URL` | `.env` | старт, host/user/db з URL; пароль з URL **не** йде в `pg.Pool` (інакше затре функцію з файла) |
| `LOG_LEVEL` | `.env`, дефолт `info` | старт |
| пароль `app_user` | файл `secrets/db_password` (gitignored) | кожне **нове** зʼєднання пулу |

`.env` і `secrets/` не в git і не в Docker-образі. Перевірка ключів прикладу: `npm run check:env` (має надрукувати `sync`).

### Підняти Postgres

Свіжий клон, без `.env` і без `secrets/db_password`. Пароль `admin` уже в `docker-compose.yml`.

```bash
docker compose up -d --wait
```

```bash
docker compose exec -T db psql -U admin -d marketplace -Atc "SELECT 1"
```

Має надрукувати `1`.

Головна таблиця обсягу — `orders` (≥100 000 рядків). Повнотекстовий пошук — таблиця `products` (`search_vector` + GIN). Схема/дані/запити: `db/schema.sql`, `db/seed.sql`, `db/queries/`, `db/indexes.sql`. Підключення застосунку як і в ДЗ#11: `DB_URL` у `.env` (зразок `.env.example`), окремого env-файла немає.

### Запуск

```bash
cp .env.example .env
mkdir -p secrets
printf 'app-v1-password' > secrets/db_password

docker compose up -d
npm install
npm start
```

`printf` без `\n`: той самий стартовий пароль, що в `init.sql`. Файл gitignored — на чистому клоні його немає, поки не створиш. Після `docker compose down -v` Postgres знову `app-v1-password`; якщо файл уже ротований — поверни його так само, інакше `password authentication failed`.

- `GET /health` — `uptime` процесу (поза OpenAPI, `ignorePaths`).
- `GET /db` — `SELECT 1` через пул.

Fail-fast (dotenv інакше підхопить змінну з файла):

```bash
mv .env /tmp/marketplace.env
env -u DB_URL npm run start
echo $?
mv /tmp/marketplace.env .env
```

Процес має завершитись з кодом ≠ 0, у виводі — імʼя зламаної змінної (`DB_URL`).

### Ротація пароля БД

```bash
./rotate.sh
curl -s localhost:3000/db
```

Скрипт: `ALTER ROLE` → запис у `secrets/db_password` → `pg_terminate_backend` для `app_user`. Застосунок не рестартують: старі idle-зʼєднання падають, пул відкриває нові й знову читає файл.

## Запуск API (контракт ДЗ#9)

```bash
npm install
npm start
```

http://localhost:3000

### Lint / обсяг

```bash
npx @redocly/cli@2.46.0 lint openapi/openapi.yaml

npx @redocly/cli@2.46.0 bundle openapi/openapi.yaml -o spec.json

node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"

grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```

`spec.json` не комітити.

### POST /orders

Без ключа → 400 problem+json. Порожній `items` → 400. Нормальний запит → 201.

```bash
curl -sS -D - -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[1]}'

curl -sS -D - -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[]}'

curl -sS -D - -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k2' \
  -d '{"items":[1]}'
```

## Журнал рішень

- **ДЗ#9.** Spec-first, варіант Б (`express-openapi-validator`), in-memory Product/Order, cursor + Idempotency-Key + problem+json. Swagger UI прибрано: валідатор лишився єдиним примусом.
- **ДЗ#11.** Nest як оболонка, Zod env fail-fast, пароль БД з файла, Compose Postgres, `rotate.sh`. Infisical не підключав (бонус LMS). Таблиці домену ще не в Postgres — свідомо до ДЗ#12.
- **ДЗ#12.** Сирий SQL у `db/`: схема, seed ≥100k на `orders` і `products`, q1–q4, індекси, `OPTIMIZATIONS.md`. `DB_URL` той самий, що в ДЗ#11.
- **ДЗ#13.** TypeORM entities + міграція `InitSchema` (`synchronize: false`). Ідемпотентний `seed`, демо N+1, звіт QueryBuilder. Грейдер ставить схему через `npm run migrate`, не `psql -f db/schema.sql`. Ціна в entity — integer копійки.
- **ДЗ#14.** `products.stock`, checkout у транзакції (атомарний `UPDATE … RETURNING`), `withRetry` на `40001`/`40P01`, черга `jobs` через `FOR UPDATE SKIP LOCKED`. Підключення як у #13: `with-secrets.sh`, нових env немає.

## Grading

Грейдер клонує гілку `hw-14`. Infisical у раннері немає — `SKIP_VAULT=1` лише прокидає вже виставлені `DB_*`. Нових env-файлів немає.

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run seed
npm run demo:lost-update
npm run demo:concurrent
npm run demo:skip-locked
```

`products.stock` — integer, `CHECK (stock >= 0)`, міграція `AddProductStock` (`DEFAULT 0` для вже існуючих рядків). Seed: кросівки `2`, решта `10`.

Checkout: `QueryRunner` + атомарний `UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty RETURNING *`. Нуль рядків → `out of stock`, rollback. `withRetry` ловить лише Postgres `40001` / `40P01`.

`npm run demo:lost-update` (два паралельні checkout, `stock=2`):

```
фінал stock = 0 (очікували 0)
```

`npm run demo:concurrent` (10 покупців, 5 пар):

```
успіхів 5, відмов 5, фінал stock = 0
```

`npm run demo:skip-locked` (12 задач × 100 мс, 4 воркери; ідеал 300 мс, послідовно 1200 мс):

```
FOR UPDATE  1279 мс · w1=6 w4=6 · оброблено двічі: 0
SKIP LOCKED 327 мс · w1=3 w2=3 w3=3 w4=3 · оброблено двічі: 0
```

Мілісекунди плавають; знак ефекту стабільний: SKIP LOCKED швидший, дублів немає, розподіл рівний.

У DataSource `synchronize: false`. Схему ставить лише `migration:run`.
