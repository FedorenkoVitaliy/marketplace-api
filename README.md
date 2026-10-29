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

**Асинхронність.** Transactional outbox (`outbox` + relay `SKIP LOCKED`) → RabbitMQ; споживач — `claimAndApply` (позначка + ефект в одному COMMIT). Платіж — порт `PaymentProvider` (зараз `StubProvider`), вебхук HMAC, леджер append-only. HTTP-ідемпотентність create/pay — таблиця `api_requests`.

**Auth.** У спеці `security: []`. Ролі закладені в домені; JWT/RBAC — ДЗ#24, не зараз.

**Deploy.** Локально: Compose для Postgres, `npm start` = `tsc && node dist/src/main.js`. Образ збирається Dockerfile без `.env` і `secrets/` (див. `.dockerignore`). Хмара / K8s — пізніші лекції.

## 4. Архітектурні компроміси

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
- **ДЗ#16.** Jest-сюїти `test:integration`, `test:e2e`, `test:contract` і `verify:provider`. Postgres для тестів піднімає testcontainers; між тестами `TRUNCATE`. Pact публікується в брокер з compose; `providerVersion` = `GITHUB_SHA`; у CI після verify тег `prod` на цю версію, потім `can-i-deploy` для консюмера `marketplace-web`. `PACT_BROKER_TOKEN` лише зі сховища.

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

`can-i-deploy` питає **консюмера** (`marketplace-web` → `prod`): чи є перевірений контракт із версією `marketplace-api`, позначеною `prod`. Питання про провайдера без prod-консюмера дає «no missing dependencies» і exit 0 навіть до тега — це не гейт.

Брокер з compose новий у кожному CI-прогоні, тож тег з минулої джоби не доживає. У workflow після `verify` ставимо `prod` на **цю** версію провайдера (`GITHUB_SHA`, той самий `providerVersion` у Verifier) і лише тоді ганяємо `scripts/can-i-deploy.sh`.

Локально (ручний демо обох станів). Контракт опубліковано (`201`), провайдер перевірено (`providerVersion` = коміт або `1.0.0` без `GITHUB_SHA`). Поки версію провайдера не позначено `prod`:

```bash
curl -s "$PACT_BROKER_URL/can-i-deploy?pacticipant=marketplace-web&version=1.0.0&to=prod"
```

```json
{"summary":{"deployable":null,"reason":"There is no verified pact between version 1.0.0 of marketplace-web and the latest version of marketplace-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}}
```

Після `PUT /pacticipants/marketplace-api/versions/<providerVersion>/tags/prod` (`201`) той самий запит:

```json
{"summary":{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}}
```

### ДЗ#16

Грейдер клонує гілку `hw-16`. Сховища немає: токен брокера порожній, локальний брокер на `21620`. Команди і обидва стани гейта — у розділі «Тестування».

## Realtime (ДЗ#18)

Підняти стек і дані (потрібні buyer/product для `POST /orders`). Сховища немає — як у ДЗ#15: `SKIP_VAULT=1` і дев-креденшели з compose. `DATABASE_URL` / `DB_*` дивляться на PgBouncer (`6432`).

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev npm run migrate
bash scripts/with-secrets.sh dev npm run seed
npm start
```

Без `SKIP_VAULT=1` `with-secrets.sh` падає з `run infisical init`. Міграції йдуть від `admin`; рантайм може лишитись на `DATABASE_URL` вище або перейти на `app_user` + `secrets/db_password` (див. «Запуск») — у `init.sql` для `app_user` є GRANT на таблиці/послідовності.

SSE (інший термінал). Потік вимагає власника замовлення (`x-user-id` або `?userId=`), як join у Socket.IO:

```bash
ORDER=$(curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: hw18-sse' \
  -d '{"items":[1]}')
OID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$ORDER")
UID=$(node -e "console.log(JSON.parse(process.argv[1]).user_id)" "$ORDER")

curl -sN --max-time 2 -D - -o /dev/null -H "x-user-id: $UID" \
  "http://localhost:3000/orders/$OID/events" | grep -i '^content-type'
# змінити статус і дивитись потік:
curl -sN --max-time 5 -H "x-user-id: $UID" "http://localhost:3000/orders/$OID/events"
curl -s -X PATCH "http://localhost:3000/orders/$OID/status" \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed"}'
```

Ізоляція кімнат (застосунок уже слухає `:3000`):

```bash
node scripts/realtime-demo.mjs
# A_RECEIVED=1
# B_RECEIVED=0

node scripts/realtime-demo.mjs --same-room
# A_RECEIVED=1
# B_RECEIVED=1
```

При двох інстансах застосунку in-memory кімнати Socket.IO і буфер SSE не спільні — клієнт на інстансі B не почує emit з інстансу A; лікується Redis-адаптером Socket.IO (і спільним store для SSE-буфера), як у кроці 7 лекції 18.

## Trade-offs: WebSocket vs SSE

Для нотифікацій «статус замовлення змінився» у проді я лишив би **SSE**: канал односторонній (сервер→клієнт), `Last-Event-ID` і реконект уже в `EventSource`, менше рухомих частин за проксі/балансувальниками, ніж у Socket.IO. WebSocket лишив би там, де потрібен двосторонній чат або ack з клієнта.

| Критерій | WebSocket (Socket.IO) | SSE |
|---|---|---|
| Напрям каналу | full-duplex (клієнт↔сервер) | server→client (клієнт лише HTTP) |
| Реконект / відновлення | свій протокол + ack; буфер кімнат in-memory | `Last-Event-ID` + `retry` з коробки EventSource |
| Вимоги до інфраструктури | sticky sessions або Redis-адаптер при >1 інстансі | звичайний HTTP; буфер подій теж треба шарити при >1 інстансі |
| Ціна на подію | кадри Engine.IO / WS + кімнати | один long-lived HTTP-відповідь, менше обгортки |

### ДЗ#18

Грейдер клонує гілку `hw-18`. Застосунок піднятий за розділом «Realtime (ДЗ#18)».

## Async-події через RabbitMQ

Між оформленням замовлення і «хтось почув» стоїть брокер: повідомлення живе, поки споживач не візьме відповідальність. Exchange `shop.events` (topic), черга `shop.orders.placed` (quorum) з `x-dead-letter-exchange: shop.dlx`, binding `order.placed`. Топологію оголошує бутстрап/споживач, не HTTP-продюсер.

Публікація `order.placed` після `COMMIT` створення замовлення — confirm-канал + `mandatory`. Контракт тіла: `eventId`, `type`, `occurredAt`, `data` (не ORM-сутність). `eventId = order.placed:<orderId>` — стабільний ключ дедупа.

Споживач: `noAck: false`, ack **після** ефекту; `prefetch=10` (10 × ~50 мс ≪ 30 хв `consumer_timeout`). Позначка `eventId` і рядок ефекту — у Postgres (`processed_messages` + `message_effects`) **в одному COMMIT** (`claimAndApply`): спільні між репліками, без щілини «позначив → впав → ефекту немає». Публікація в демо — `mandatory: true`, як у `publisher.ts`.

**Це at-least-once доставка, не exactly-once.** Брокер може віддати те саме повідомлення двічі (падіння після ефекту до ack). Exactly-once **результат** дає ідемпотентний ефект: повтор з тим самим `eventId` не додає другий рядок ефекту. Формулювання «RabbitMQ дає exactly-once» — хибне.

`demo:duplicate` відтворює дубль через **SIGKILL** дочірнього споживача в щілині між ефектом і ack (окремий процес), далі другий споживач дочищає чергу.

Числа з прогону 14.10.2026:

| Демо | Вивід |
|---|---|
| `demo:publish` | `published=5 delivered=5 effect=5 acked=5 dlq=0 prefetch=10` |
| `demo:dlq` | `rejected=1 work=0 dlq=1 dlq-reason=rejected effect=0` |
| `demo:duplicate` | `deliveries=2 effect=1 skipped=1` |

### ДЗ#19

Грейдер клонує гілку `hw-19`. Сховища немає — `SKIP_VAULT=1` і креденшели з compose. Дедуп ефектів у Postgres (PgBouncer `6432`) — потрібні `DATABASE_URL` / `DB_*` і міграція.

```bash
docker compose up -d --wait
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1
npm ci
npx tsc --noEmit
npm run migrate
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
```

Management UI: http://127.0.0.1:15672 (app/app). AMQP — лише порт **5672**.

## Distributed patterns (ДЗ#22)

Dual-write `COMMIT` → `publish` закритий **transactional outbox**: `INSERT orders` + `INSERT outbox` в одній транзакції. Relay читає `WHERE published_at IS NULL … FOR UPDATE SKIP LOCKED`, публікує в RabbitMQ, потім ставить `published_at`. Між publish і UPDATE — щілина at-least-once: `SIGKILL` → подія вже в брокері, база «не знає» → рестарт публікує вдруге. Exactly-once **результат** дає `claimAndApply` (позначка + ефект в одному COMMIT).

**Чому не навпаки (спочатку `UPDATE published_at`, потім publish).** Якщо процес помре між ними — рядок позначений «винесеним», а в брокера його немає: подія **втрачена**, релей її більше не візьме. Дубль лікується ідемпотентним споживачем; втрату — ні. Тому спочатку publish (можна повторити), і лише потім позначка.

Платіжний шар: заморожений quote (копійки-integer, знижка один раз), ключ ідемпотентності `sha256("order:"+id)`, намір + outbox в одній транзакції, вебхук stub з HMAC над сирим тілом, леджер append-only (`SUM`, не `UPDATE` суми).

| Демо | Що доводить | Числа прогону |
|---|---|---|
| `demo:crash-write` | SIGKILL до COMMIT → ні order, ні outbox | `write-failed=1 orders=0 outbox=0` |
| `demo:crash-relay` | SIGKILL між publish і `published_at` (1 подія) | `deliveries=2 applied=1 processed=1 effect=1` |
| `demo:outbox` | happy path + Idempotency-Key | `requests=2 orders=1 outbox=1 published=1 deliveries=1 effect=1 processed=1` |
| `demo:pay` | quote → intent → HMAC / duplicate / incident | `webhook_2=duplicate` |

### ДЗ#22

```bash
docker compose up -d --wait
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1
npm ci
npm run build
npx tsc --noEmit
npm run migrate
npm run seed
npm run demo:crash-write
npm run demo:crash-relay
npm run demo:outbox
npm run demo:pay
```

## Redis: кеш, сесії, ліміти, черга

Два інстанси Redis у `docker-compose.yml` — не дублювання «про запас». Кеш потребує `maxmemory` + `allkeys-lru`; BullMQ у документації вимагає `noeviction` («cannot work properly if Redis evicts keys arbitrarily»). `maxmemory-policy` одна на весь процес, `SELECT 1` її не розводить → потрібні два контейнери: `redis-cache:16379` і `redis-queue:16380` (+ AOF everysec).

Сесії й rate-limit живуть на **черга-інстансі** (`REDIS_QUEUE_URL`, noeviction): `allkeys-lru` колись викине сесію → «магічне» розлогінення. Кеш — лише для cache-aside карток товару.

| Модель | Вибір | Чому |
|---|---|---|
| Rate-limit | ковзне вікно (Lua/ZSET) | не дозволяємо 2× сплеск на межі фіксованого вікна; спільний лічильник для подів |
| Stampede | `SET lock NX PX` + Lua compare-and-delete | один SELECT на холодний ключ; голий `DEL` знімає чужий лок |

**Що буде, якщо stampede-лок зламається.** Два (або N) одночасні SELECT тієї самої картки товару — зайві походи в базу й кілька центів latency. Стан не псується: читання ідемпотентне. Саме тому лок тут — оптимізація, а не захист бізнес-інваріанта. Інваріант «не списати склад двічі» локом у Redis не захищаємо — для цього транзакція / унікальний ключ / fencing у сховищі запису.

Числа з локального прогону 23.10.2026:

| Демо | Вивід |
|---|---|
| `demo:cache` | `cache-lru=1 cache-maxmemory=1 warmed=60 ttl-distinct=40 concurrent=24 db-calls=1 db-calls-warm=0` |
| `demo:session` | `requests=3 sessions=1 in-redis=1 ttl-renewed=1` |
| `demo:ratelimit` | `instances=2 limit=5 requests=12 allowed=5 blocked=7 status=429 retry-after=1` |
| `demo:queue` | `queue-noeviction=1 attempts=3 completed=1 added=2 queued=1 schedulers=1 scheduled-runs=2` |

### ДЗ#23

```bash
docker compose up -d --wait
export REDIS_URL=redis://127.0.0.1:16379
export REDIS_QUEUE_URL=redis://127.0.0.1:16380
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1
npm ci
npm run build
npx tsc --noEmit
npm run migrate
npm run seed
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue
```

### ДЗ#24

Грейдер клонує `hw-24`. Сховища немає — `SKIP_VAULT=1` і експорт імен змінних нижче. Нових `.env` немає. Демо-пароль акаунтів: `shop-demo-24` (`buyer@shop.test` / `seller@shop.test`).

```bash
docker compose up -d --wait
export REDIS_URL=redis://127.0.0.1:16379
export REDIS_QUEUE_URL=redis://127.0.0.1:16380
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
# ES256 P-256: PEM → base64 (приватні ключі в git не класти)
export JWT_PRIVATE_KEY=$(openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt | base64 | tr -d '\n')
export JWT_PUBLIC_KEY=$(echo "$JWT_PRIVATE_KEY" | base64 -d | openssl ec -pubout 2>/dev/null | base64 | tr -d '\n')
export JWT_KID=hw24
export REFRESH_TOKEN_PEPPER=$(openssl rand -hex 32)
export SKIP_VAULT=1
npm ci
npx tsc --noEmit
npm run migrate
npm run seed
npm run demo:auth
npm run demo:reuse
npm run demo:rbac
```

Очікувані рядки:

```
# demo:auth
login=200
no-token=401
with-token=200
refresh=200
logout=204
after-logout=401
refresh-after-logout=401

# demo:reuse
login=200
r1-refresh=200
r1-reuse=401
r2-after-reuse=401

# demo:rbac
anon=401
own=200
foreign=403
role-denied=403
role-allowed=201
tampered=401
```

## Auth

Access — короткоживучий JWT **ES256** (P-256) через `jose`; refresh — opaque 32 B, у PG лише `HMAC-SHA256(pepper ‖ token)`.

| Змінна | Джерело | Навіщо |
|---|---|---|
| `JWT_PRIVATE_KEY` | **сховище** | base64 PKCS#8 PEM, підпис access |
| `JWT_PUBLIC_KEY` | **сховище** | base64 SPKI PEM, verify |
| `JWT_KID` | **сховище** | активний `kid` у заголовку; overlap-ротація ключів — кілька публічних + один активний kid |
| `REFRESH_TOKEN_PEPPER` | **сховище** | pepper для `token_hash` refresh |

Чому **ES256**, не RS256: OWASP JWT Cheat Sheet позначає RS256 (PKCS#1 v1.5) як «Not recommended»; EC дає коротші ключі й менші токени при тому ж рівні безпеки. Verify завжди з явним `algorithms: ['ES256']` — алгоритм не береться з заголовка токена.

**Denylist `jti`** живе в **queueRedis** (`REDIS_QUEUE_URL`, `noeviction`): це сесійна семантика, як і login-сесії з #23. `allkeys-lru` на cacheRedis міг би викинути denylist-ключ раніше за `exp` токена → access знову «оживе».

**Logout = дві дії:** (1) `revoked_at` на всю `family_id` refresh у Postgres; (2) `SET auth:deny:<jti> EX <залишок до exp>` у queueRedis. Без денилиста access живе до `exp` навіть після logout.

При старті декодуємо base64 → PEM → `KeyObject` і пишемо в лог **fingerprint** публічного ключа (sha256 SPKI, 16 hex), не сам PEM. Голий `npm start` без vault/експорту падає на Zod **до** DB і називає відсутню змінну (`JWT_*` / `REFRESH_TOKEN_PEPPER`).

