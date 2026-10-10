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
| `PACT_BROKER_URL` | сховище, локально дефолт `http://127.0.0.1:21620` | скрипт `can-i-deploy`, не новий env-файл |
| `PACT_BROKER_TOKEN` | сховище (у локального брокера порожньо) | заголовок брокера, у git його немає |

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
- **ДЗ#14.** `products.stock`, `users.balance`, checkout у `REPEATABLE READ` (атомарні `UPDATE … RETURNING` на stock і баланс + order + `jobs`), `withRetry` на `40001`/`40P01`, черга `jobs` через `FOR UPDATE SKIP LOCKED`. Підключення як у #13: `with-secrets.sh`, нових env немає.
- **ДЗ#15.** PgBouncer (`pool_mode = transaction`, порт хоста `6432`) перед Postgres. `scripts/backup.sh` знімає `pg_dump -Fc` у `backups/`, `backup.cron` запускає його о 03:00. `scripts/restore-drill.sh` піднімає чистий контейнер `restore`, звіряє `orders` і друкує `MATCH`. Нових env-файлів немає: у `.env.example` змінився лише порт.
- **ДЗ#16.** Jest-сюїти `test:integration`, `test:e2e`, `test:contract` і `verify:provider`. Postgres для тестів піднімає testcontainers; між тестами `TRUNCATE`. Pact публікується в брокер з compose, `can-i-deploy` у CI дивиться на тег `prod` версії провайдера. `PACT_BROKER_TOKEN` лише зі сховища.

## Data layer ops

Підняти стек: `docker compose up -d --wait`. Застосунок ходить у `127.0.0.1:6432` (PgBouncer), не в `5432`. Бекап: `export DATABASE_URL=…` і `bash scripts/with-secrets.sh dev bash scripts/backup.sh` — шлях до файлу з датою в імені. Відновлення: той самий `DATABASE_URL` і `bash scripts/restore-drill.sh`. Скрипт сам створює порожній контейнер, відновлює останній дамп і сам його прибирає.

Transaction mode: PgBouncer видає справжнє зʼєднання з Postgres лише на час однієї транзакції, тому сотня клієнтів ділить кілька процесів бази. Між транзакціями зʼєднання інше, тож не переживають три речі: `SET` (стан сесії), `LISTEN`/`NOTIFY` і session advisory lock. `BEGIN`…`COMMIT` checkout тримає одне зʼєднання до кінця, тому списання stock і балансу лишаються разом.

## Конкурентність

Одна транзакція checkout: `UPDATE products … stock >= $qty RETURNING` → `UPDATE users … balance >= $total RETURNING` → `INSERT` order і order_item → `INSERT` у `jobs` (`payload = order:<id>`). Нуль рядків у будь-якому `UPDATE` — `out of stock` або `insufficient funds` і rollback цілої транзакції: замовлень-сиріт немає, задачі без замовлення теж.

**Atomic UPDATE, не `SELECT … FOR UPDATE`.** Перевірка залишку і списання — один запит, тому вікна «прочитав → вирішив у JS → записав» немає. `FOR UPDATE` дав би той самий результат, але це два запити й лок, який тримається, поки Node думає між ними. Нам не треба показувати залишок користувачу до списання, тож досить умови в `WHERE`. `CHECK (stock >= 0)` і `CHECK (balance >= 0)` — страховка, якщо хтось обійде checkout.

**Чому retry ловить лише `40001` і `40P01`.** Checkout іде під `REPEATABLE READ`: знімок фіксується на першому `SELECT`, і якщо рядок змінила чужа закомічена транзакція, Postgres кидає `40001` (serialization_failure). `40P01` — deadlock, одну з транзакцій Postgres убиває сам. Обидва коди означають «транзакція правильна, повтори її цілком». Решта помилок (немає товару, немає грошей, порушений `CHECK`) при повторі дадуть те саме, тому `withRetry` їх одразу прокидає далі. Повтор іде з самого початку, разом із читанням, з експоненційним backoff і jitter.

Числа з прогону 26.09.2026:

| Демо | Результат |
|---|---|
| `demo:race` | спроб 50, успішних 10, фінальний stock 0, від’ємних 0; ~56 повторів `40001` за прогін |
| `demo:retry` | 1 спійманий `40001` і повтор; stock 2 → 0, баланс −2 × ціна, збігається |
| `demo:workers` | 12 задач × 100 мс: `SKIP LOCKED` 322 мс (3/3/3/3), `FOR UPDATE` 1269 мс (6/6), двічі оброблено 0 |

Під `FOR UPDATE` без `SKIP LOCKED` воркери стоять у черзі за одним рядком: час ≈ послідовний. `SKIP LOCKED` бере наступну вільну задачу, тому час ≈ ідеал 300 мс. Транзакція воркера відкрита на час обробки: `done` і `processed + 1` комітяться разом. Порожній `SKIP LOCKED` означає «вільних зараз немає», тому воркер перепитує `count(*) WHERE status = 'new'` перед виходом.

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
npm run demo:retry
npm run demo:race
npm run demo:workers
```

`products.stock` і `users.balance` — integer з `CHECK (>= 0)`, міграції `AddProductStock` і `AddUserBalance` (`DEFAULT 0` для вже існуючих рядків). Seed: кросівки `2`, решта `10`; баланс кожного користувача `100 000 000` копійок, свідомо надлишковий — обмежує лише stock.

`npm run demo:retry` (два паралельні checkout, `stock=2`; exit ≠ 0, якщо stock або баланс не зійшлися):

```
спроба 1 впала: 40001 → retry через 70 мс
фінал stock = 0 (очікували 0)
баланс 97402000 → 97142200 (очікували 97142200)
```

`npm run demo:race` (50 паралельних, `stock=10`; exit ≠ 0 при oversell, від’ємному stock або успіхах ≠ 10). Рядки `спроба N впала: 40001` — штатні повтори:

```
спроб 50, успіхів 10, відмов 40, фінал stock = 0, негативних 0
```

`npm run demo:workers` (12 задач × 100 мс, 4 воркери; ідеал 300 мс, послідовно 1200 мс):

```
FOR UPDATE  1269 мс · w1=6 w2=6 · оброблено двічі: 0
SKIP LOCKED 322 мс · w1=3 w2=3 w3=3 w4=3 · оброблено двічі: 0
```

Мілісекунди плавають; знак ефекту стабільний: SKIP LOCKED швидший, дублів немає, розподіл рівний.

У DataSource `synchronize: false`. Схему ставить лише `migration:run`.

### ДЗ#15

Грейдер клонує гілку `hw-15`. Сховища немає: `SKIP_VAULT=1` і дев-креденшели з compose. `DATABASE_URL` дивиться на PgBouncer (`6432`), не на прямий Postgres.

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

`backup.sh` друкує шлях `backups/marketplace-YYYY-MM-DD-HHMMSS.dump`. Другий запуск того ж дня пише новий файл, не затирає попередній. `pg_restore --list` по цьому файлу показує TOC. `restore-drill.sh` друкує `MATCH` і код 0; повторний запуск теж. Числа RTO/RPO — у `RESTORE-DRILL.md`.

## Тестування

```bash
npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
```

`test:integration` піднімає `postgres:16-alpine` з тесту і проганяє міграції. Кожен файл має свій контейнер, а перед кожним тестом таблиці чистить `TRUNCATE … RESTART IDENTITY CASCADE`. Відкат однієї транзакції тут не підходить: репозиторій бере пул, і наступний запит може піти іншим з'єднанням. Окремий контейнер на кожен тест лише помножив би старт Postgres. Другий `npm run test:integration` одразу після першого зелений сам, бо контейнери нові і тести їх гасять.

`pacts/` у `.gitignore`. Контракт з'являється з `npm run test:contract`; у CI той самий крок пише файл перед публікацією.

Брокер піднімається разом із рештою compose, без профілю:

```bash
docker compose up -d --wait
```

Він слухає `http://127.0.0.1:21620`. Healthcheck усередині контейнера б'є в `127.0.0.1`, не в `localhost`.

Локально адреса і токен приїжджають зі сховища:

```bash
bash scripts/with-secrets.sh dev npm run verify:provider
```

`SKIP_VAULT=1` нічого не читає і просто виконує команду далі. Грейдер сховища не має, тому передає адресу змінною. Це та сама команда:

```bash
export PACT_BROKER_URL=http://127.0.0.1:21620
npm run verify:provider
```

Код читає лише `process.env.PACT_BROKER_URL` і `process.env.PACT_BROKER_TOKEN`. `DATABASE_URL` тестам видає контейнер, не сховище.

Гейт на свіжому брокері. Контракт опубліковано (`201`), провайдер `1.0.0` перевірено. Поки версію провайдера не позначено `prod`, відповідь така:

```json
{"summary":{"deployable":null,"reason":"There is no verified pact between version 1.0.0 of marketplace-web and the latest version of marketplace-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}}
```

Після `PUT /pacticipants/marketplace-api/versions/1.0.0/tags/prod` (`201`) та сама адреса `can-i-deploy?pacticipant=marketplace-web&version=1.0.0&to=prod` відповідає:

```json
{"summary":{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}}
```

### ДЗ#16

Грейдер клонує гілку `hw-16`. Сховища немає: токен брокера порожній, локальний брокер на `21620`. Команди і обидва стани гейта — у розділі «Тестування».
