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

### ДЗ#31

Смуга запасна. D2, D3 і D4 на цій смузі не оцінюються. Ключів живого виміру в `evidence/demos.txt` немає навмисно: немає `az-before`, `az-after`, `failover-seconds`, `event`, `alb-dns`, `http-code`, `target-state`, `nat-minutes`, `nat-billed-hours`. Доказ знесення — прогін teardown у GitHub Actions, у логу якого шість ключів дорівнюють нулю. Локальний рядок `state-resources-left=0` лишається поруч.

```bash
REPO=FedorenkoVitaliy/marketplace-api

# A1
for d in infra/base infra/demo; do
  ( cd "$d" && npm ci >/dev/null 2>&1 && npx tsc --noEmit ); echo "$d exit=$?"
done

# A2
grep -qE '^vpc-id=vpc-[0-9a-f]+$' evidence/base.txt && echo "vpc-id OK"
for k in public-subnets=2 private-subnets=2 subnet-azs=2 private-default-route=0; do
  grep -qx "$k" evidence/base.txt && echo "$k OK" || echo "НЕМАЄ: $k"
done
awk -F= '/^security-groups=/{print ($2>=2) ? "security-groups OK ("$2")" : "SG мало: "$2}' evidence/base.txt

# A3
awk -F= '/^tagged-resources=/{print ($2>=8) ? "теги OK ("$2")" : "теги: "$2}' evidence/base.txt
jq -r '[.deployment.resources[]? | select(.type=="aws:ec2/subnet:Subnet") | .outputs.availabilityZone] | map(select(. != null)) | unique | length' evidence/base-state.json

# A4
jq '[.deployment.resources[]?.type | select(test("aws:rds/|aws:lb/|aws:ec2/natGateway|aws:ec2/instance:|aws:ec2/eip:|aws:elasticache/"))] | length' evidence/base-state.json

# B1
grep -c 'token.actions.githubusercontent.com' evidence/iam.json
grep -c 'sts.amazonaws.com' evidence/iam.json
grep -c "${REPO##*/}" evidence/iam.json
jq -r '[.. | objects | .Action? // empty] | flatten | map(select(. == "*")) | length' evidence/iam.json

# B2
grep -qx 'sim-allowed=allowed' evidence/iam.txt && echo "позитив OK"
grep -qE '^sim-denied=(implicitDeny|explicitDeny)$' evidence/iam.txt && echo "негатив OK"

# B3
git ls-files -z | xargs -0 grep -lE 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|aws_secret_access_key *='
grep -rlE 'AWS_SECRET_ACCESS_KEY|aws-secret-access-key' .github/workflows/
grep -cE 'id-token: *write' .github/workflows/teardown.yml
PKG=$(git ls-files 'package.json' '*/package.json' | grep -v node_modules | head -1)
echo "package.json: ${PKG:-НЕМАЄ}"
node -e "const s=require(require('path').resolve(process.argv[1])).scripts||{};const need=['up:base','up:demo','destroy:demo','destroy:base','demo:failover','demo:nat','demo:alb'];const bad=need.filter(k=>!/with-secrets\.sh/.test(s[k]||''));console.log(bad.length?('без обгортки: '+bad.join(', ')):'OK')" "$PKG"

# C1
B=$(git ls-files | xargs grep -lE 'budgets\.Budget' 2>/dev/null | head -1)
D=$(git ls-files | xargs grep -lE 'rds\.Instance|lb\.LoadBalancer' 2>/dev/null | head -1)
tb=$(git log --diff-filter=A --format=%ct -- "$B" | tail -1)
td=$(git log --diff-filter=A --format=%ct -- "$D" | tail -1)
echo "budget=$B($tb) paid=$D($td)"
[ -n "$tb" ] && [ -n "$td" ] && [ "$tb" -le "$td" ] && echo "порядок OK" || echo "ПРОВАЛ"

# C2
B=$(git ls-files | xargs grep -lE 'budgets\.Budget' 2>/dev/null | head -1)
grep -c 'ACTUAL' "$B"
grep -c 'FORECASTED' "$B"
grep -cE '(limitAmount|limit_amount)[^0-9]+5([^0-9]|$)' "$B"

# C3
grep -cE '^ *schedule:' .github/workflows/teardown.yml
grep -cE '^ *workflow_dispatch:' .github/workflows/teardown.yml
grep -cE 'pulumi +destroy' .github/workflows/teardown.yml

# D1
RF=$(git ls-files | xargs grep -lE 'rds\.Instance' 2>/dev/null | head -1)
grep -cE 'multiAz: *true' "$RF"
grep -cE 'db\.t4g\.micro|db\.t3\.micro' "$RF"
grep -cE 'storageEncrypted: *true' "$RF"
git grep -lE 'skipFinalSnapshot|registerResourceTransform' -- '*.ts' | wc -l
```

Запасна смуга. A — як на основній. B — по документу політики, не по симулятору: абзац вище і `evidence/localstack-iam.txt`. C — бюджет у коді; знесення = `pulumi destroy` і локальний `state-resources-left=0`; `file://` можна. D2–D4 не оцінюються. Код усе одно обовʼязковий: інстанс RDS (Multi-AZ instance), балансувальник з target group, `evidence/preview-demo.txt`, `evidence/501.txt`, абзац порівняння зі стеком #15.

```bash
grep -ciE '^ *смуга: *запасна' README.md
grep -c 'not included within your LocalStack license' evidence/501.txt
grep -cE 'aws:rds/instance:Instance' evidence/preview-demo.txt
for k in deny-all=200 fake-key=200 enforce-iam-log-lines=0; do
  grep -qx "$k" evidence/localstack-iam.txt && echo "$k OK" || echo "НЕМАЄ: $k"
done
grep -qx 'state-resources-left=0' evidence/demos.txt && echo "знесено OK"
```

Шість команд порожнечі, які джоба основної смуги друкує в лог. На цій смузі доказом є локальний рядок, не цей лог.

```bash
pulumi stack export | jq '[.deployment.resources[]|select(.type|startswith("aws:"))]|length'

aws resourcegroupstaggingapi get-resources --region "$R" \
  --tag-filters Key=Project,Values=nodejs-pro-hw31 --query 'length(ResourceTagMappingList)'

aws rds describe-db-instances --region "$R" --query 'length(DBInstances)'

aws elbv2 describe-load-balancers --region "$R" --query 'length(LoadBalancers)'

aws ec2 describe-nat-gateways --region "$R" --filter Name=state,Values=available \
                                  --query 'length(NatGateways)'

aws ec2 describe-addresses   --region "$R" --query 'length(Addresses)'
```

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
npm run build
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

### ДЗ#26

Грейдер клонує `hw-26`. Сховища немає — `SKIP_VAULT=1` і експорт нижче. Нових `.env` немає. `package.json` у корені репо, `cd` не потрібен.

```bash
docker compose up -d --wait
export STORAGE_ENDPOINT=http://127.0.0.1:22650
export STORAGE_ACCESS_KEY=hw26user
export STORAGE_SECRET_KEY=hw26secretpass
export STORAGE_BUCKET=hw26-files
export REDIS_URL=redis://127.0.0.1:16379
export REDIS_QUEUE_URL=redis://127.0.0.1:16380
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DB_URL="$DATABASE_URL"
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export JWT_PRIVATE_KEY=$(openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt | base64 | tr -d '\n')
export JWT_PUBLIC_KEY=$(echo "$JWT_PRIVATE_KEY" | base64 -d | openssl ec -pubout 2>/dev/null | base64 | tr -d '\n')
export JWT_KID=hw24
export REFRESH_TOKEN_PEPPER=$(openssl rand -hex 32)
export SKIP_VAULT=1
npm ci
npm run build
npx tsc --noEmit
npm run migrate
npm run seed
npm run demo:upload
npm run demo:multipart
npm run demo:multipart
npm run demo:cdn
```

`npm run build` перед `migrate` обов'язковий: інакше немає `dist/src/data-source.js`. `--wait` чекає healthcheck MinIO.

Прогін 06.11.2026, обидва multipart підряд:

```
intent=200
key-from-server=1
api-alive=0
put-offline=200
commit=200
commit-without-bytes=409
tampered=403
expired=403

head-before-complete=404
resumed-parts=1
complete=200
size-match=1
etag-multipart=1

direct=403
edge-miss=200
edge-hit=200
cache-hit=1
new-name=1
new-url=200
content-changed=1
```

### ДЗ#28

Грейдер клонує `hw-28`. Сховища немає — `SKIP_VAULT=1` і експорт нижче. Нових `.env` немає. Бекенд Pulumi лише локальний файл, інакше `pulumi` піде в логін.

```bash
export SKIP_VAULT=1
export APP_DB_PASSWORD=grader-secret
export PULUMI_CONFIG_PASSPHRASE=hw28-grading
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"
export PACT_BROKER_URL=http://127.0.0.1:21620
export PACT_BROKER_TOKEN=grader-pact-token
export JWT_PRIVATE_KEY=grader-jwt-private
export JWT_PUBLIC_KEY=grader-jwt-public
export JWT_KID=grader-kid
export REFRESH_TOKEN_PEPPER=grader-pepper
export STORAGE_ENDPOINT=http://127.0.0.1:22650
export STORAGE_ACCESS_KEY=hw26user
export STORAGE_SECRET_KEY=hw26secretpass
export STORAGE_BUCKET=hw26-files
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:22918
export PROMETHEUS_URL=http://127.0.0.1:22911
export TRACE_API_URL=http://127.0.0.1:22904
printf 'dummy-npm-token' > .npm_token
npm --prefix infra ci
cd infra && npx tsc --noEmit
cd ..
npm run image:build
npm run cluster:up
npm run up
npm run demo:image
npm run demo:rollout
npm run demo:pdb
```

Після перевірки: `npm run destroy && npm run cluster:down`.

Прогін 06.11.2026:

```
stages=2
shell-inside=0
runtime-uid=65532
token-in-history=0
token-in-config=0
token-in-layers=0

profile=good
requests=7721
ok=7721
failed=0
rollout-seconds=15

healthy=2
minAvailable=1
evict-1=201
evict-2=429
```

`scan` на цьому ж образі порахував `found=7` при `severity=CRITICAL,HIGH`: з `SCAN_MAX=-1` вийшло `gate=fail` і код 1, з `SCAN_MAX=99999` — `gate=pass` і код 0. Другий викот підряд теж дав `failed=0`.

### ДЗ#29

Грейдер клонує `hw-29`. Сховища немає — `SKIP_VAULT=1` і експорт нижче. Стенд спостережуваності окремий від кореневого compose: повний `--wait` там чекав би ще й Rabbit.

```bash
export SKIP_VAULT=1
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:22918
export PROMETHEUS_URL=http://127.0.0.1:22911
export TRACE_API_URL=http://127.0.0.1:22904
docker compose -f observability/compose.yml up -d --wait
npm ci
npx tsc --noEmit
npm run demo:logs
npm run demo:metrics
npm run demo:trace
```

Прогін 13.11.2026, кожне демо двічі підряд з тим самим виводом:

```
non-json-lines=0
layers=3
distinct-trace-ids=1
trace-id-matches-header=1
burst=8
burst-trace-ids=8
burst-uneven=0
secret-req-logged=1
secret-in-logs=0

sent-ok=40
sent-fail=15
counter-delta=55
errors-delta=15
above-top-bucket=0
series-before=2
series-after=2

spans=2
orphan-spans=0
trace-matches-header=1
trace-matches-log=1
span-status-error=1
```

### ДЗ#32

```
git clone https://github.com/FedorenkoVitaliy/marketplace-api.git && cd marketplace-api && git checkout hw-32

npm ci

export SKIP_VAULT=1
export APP_DB_PASSWORD=grader-secret

npm run demo:gates
npm run demo:oidc
PLAN_JSON=/tmp/hw32/plan.json COST_BUDGET_USD=0 npm run gate:cost
```

`demo:gates`, `demo:oidc` і `gate:cost` не ходять у GitHub і не піднімають кластер. `plan.json` береться з артефакту `pipeline-evidence`, у репозиторій він не комітиться.

## Auth

Access — короткоживучий JWT **ES256** (P-256) через `jose`; refresh — opaque 32 B, у PG лише `HMAC-SHA256(pepper ‖ token)`.

| Змінна | Джерело | Навіщо |
|---|---|---|
| `JWT_PRIVATE_KEY` | **сховище** | base64 PKCS#8 PEM, підпис access |
| `JWT_PUBLIC_KEY` | **сховище** | base64 SPKI PEM, verify |
| `JWT_KID` | **сховище** | активний `kid` у заголовку; overlap-ротація ключів — кілька публічних + один активний kid |
| `REFRESH_TOKEN_PEPPER` | **сховище** | pepper для `token_hash` refresh |

Чому **ES256**, не RS256: OWASP JWT Cheat Sheet позначає RS256 (PKCS#1 v1.5) як «Not recommended»; EC дає коротші ключі й менші токени при тому ж рівні безпеки. Verify завжди з явним `algorithms: ['ES256']` — алгоритм не береться з заголовка токена.

**Відбитки публічних ключів** (sha256 SPKI → 16 hex; у лог при старті, не PEM):

| Оточення | `kid` | fingerprint |
|---|---|---|
| dev | `dev` | `bf56919e28a251b2` |
| prod | `prod` | `0def4ec5177e62c4` |

Різні відбитки = різні пари ключів: токен, підписаний у prod, не пройде verify у dev і навпаки. Overlap-ротація: новий `kid` підписує, старий публічний лишається в наборі verify, доки живі access зі старим `kid`.

**Denylist `jti`** живе в **queueRedis** (`REDIS_QUEUE_URL`, `noeviction`): це сесійна семантика, як і login-сесії з #23. `allkeys-lru` на cacheRedis міг би викинути denylist-ключ раніше за `exp` токена → access знову «оживе».

**Logout = дві дії, у такому порядку:** (1) `SET auth:deny:<jti> EX <залишок до exp>` у queueRedis; (2) `revoked_at` на всю `family_id` refresh у Postgres. Денилист першим: якщо Redis падає, сімʼя ще жива і логаут можна повторити; навпаки лишило б access живим до `exp` при вже мертвій сімʼї. Без денилиста взагалі access живе до `exp` навіть після logout.

**Гонка рефрешу на клієнті.** `UPDATE … SET used_at WHERE used_at IS NULL` робить другий паралельний рефреш тим самим токеном гілкою reuse → валить усю сімʼю. Це виглядає як компрометація, хоча це два запити одного фронта. **Обір:** серіалізація на клієнті — один спільний Promise на refresh для всіх 401; сервер навмисно без вікна благодаті, щоб `demo:reuse` лишався однозначним.

**Межа власності.** Guard лише відповідає «хто це?» (Bearer + denylist). Чиє замовлення — у `OrdersService.findOwned` після `findById`: якщо не admin і `order.user_id ≠ user.id` → `403`. Гард ресурсу не тягне, бо йому ще немає рядка з БД.

**Роль.** Для рішень (`role-allowed` / `role-denied`) `authenticate` читає `users.role` з БД на кожен запит, не claim з JWT. Розжалуваний адмін втрачає права **одразу**, не чекаючи `exp`. Claim `role` у токені — лише відбиток на момент видачі; якби авторизація йшла з нього, розжалування жило б до `exp` — свідомий компроміс короткого TTL, якого тут уникаємо саме читанням з БД.

При старті декодуємо base64 → PEM → `KeyObject` і пишемо в лог fingerprint публічного ключа, не сам PEM. Голий `npm start` без vault/експорту падає на Zod **до** DB і називає відсутню змінну (`JWT_*` / `REFRESH_TOKEN_PEPPER`).

## Files

Шлях файла: `POST /uploads/intent` (гард із ДЗ #24, ключ `uploads/{userId}/{uuid}.ext` з allowlist contentType) → клієнт кладе байти за presigned URL → `POST /uploads/commit` робить `HeadObject` і лише тоді ставить `COMPLETED`. Ім'я файла від клієнта в ключ не потрапляє.

Сховище — MinIO (`bitnamilegacy/minio:2025.7.23-debian-12-r5`) у наявному compose, API на `22650`. Офіційний `minio/minio` з Docker Hub знятий. Бакет приватний: анонімний GET дає 403. Публічні ассети віддає локальний edge на SDK (порт `22660`, заголовок `X-Cache: HIT|MISS`), не CloudFront і не nginx. До сховища ходить edge своїми креденшелами. Це локальна форма OAC.

| Змінна | Джерело | Навіщо |
|---|---|---|
| `STORAGE_ENDPOINT` | **сховище** | S3 API; порожньо було б AWS, у стенді `http://127.0.0.1:22650` |
| `STORAGE_ACCESS_KEY` | **сховище** | access key підпису і edge |
| `STORAGE_SECRET_KEY` | **сховище** | secret key. Дев-пароль MinIO в compose — креденшел стенда, не секрет репо |
| `STORAGE_BUCKET` | **сховище** | ім'я бакета, у стенді `hw26-files` |

Строк presigned для аватарки з форми — **120 секунд**. Відкликати виданий URL нічим: немає `jti` і реєстру, лишається лише короткий строк. Сім діб не ставимо: SigV4 технічно живе до 7 діб, але в проді ключ майже завжди від STS і помирає за годину. Демо `expired` передає `expiresIn: 2`, щоб не спати хвилини; це не прод-строк.

Поріг одного `PutObject` — **5 МіБ** (мінімум частини, крім останньої). Вище нього intent робить multipart. Розмір частини — `max(5 МіБ, ceil(файл / 10000))`, бо частин не більше 10 000. Остання частина може бути меншою. ETag після multipart має суфікс `-N` і не є MD5 файла.

`Cache-Control: public, max-age=31536000, immutable` ставиться на об'єкт при публікації. Ім'я ассета містить хеш вмісту (`app.{hash}.css`), тож новий вміст — новий URL, інвалідацій нуль.

Bucket policy для AWS + OAC (у цій здачі дистрибуцію не піднімаємо; без `Condition` доступ отримала б будь-яка дистрибуція у світі):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::111122223333:distribution/E1234567890ABC"
        }
      }
    }
  ]
}
```

Незавершені multipart тарифікуються, хоча об'єкта ще немає. Lifecycle `AbortIncompleteMultipartUpload` через 7 днів прибирає їх; правило «видалити все старше 30 днів» ці хвости не чіпає. На бакет стенда правило не вішаємо.

Рядки `PENDING` старші за добу мала б добивати джоба BullMQ: `AbortMultipartUpload`, потім `DeleteObject`, потім видалити рядок. Інакше лишаються файли-сироти, про які база не знає. Джобу в цій здачі не запускаємо.

Дамп із ДЗ #15 лишається в локальній теці `backups/`: призначення для нього — об'єктне сховище, але перенос у цій здачі зламав би restore-drill. Glacier — це не повільний S3, бо об'єкт спершу треба відновити, і lifecycle сам по собі не замінює `MATCH` із того drill.

Приватний контент дистрибуції (не цей публічний edge) далі закривався б signed URL або signed cookies CloudFront на хвилину, з гардом на кожен запит. У коді цього немає.

Числа прогону — у блоці `### ДЗ#26` вище.

## Kubernetes

Кластер підіймав **kind** (один control-plane, `k8s/kind-config.yaml`, ім'я `hw28`). Окремого ліміта пам'яті, як у minikube `--memory`, у kind немає: вузол бере стільки, скільки дасть Docker. На цій машині Docker має 7,7 ГіБ; після `cluster:up` вузол `hw28-control-plane` займає близько 770 МіБ. minikube відсікає старт нижче 1800 МБ, тому його тут немає.

Образ `marketplace-api:hw28` — дві стадії: збірка на `node:22-slim`, запуск на `gcr.io/distroless/nodejs22-debian12:nonroot`. У фіналі немає shell, процес під uid 65532 (`USER 65532` і `runAsUser: 65532`). Повний Nest у цей под не їде: йому потрібні Postgres, Redis і Rabbit, а вимір дивиться на те, чи живе сокет під викочуванням. Процес у поді відповідає на `/healthz`, поки живий, на `/readyz` лише коли готовий, і на SIGTERM спершу гасить `/readyz`, тримає дренаж 8 с і лише потім закриває сокет. До `listen` він чекає 4 с. `terminationGracePeriodSeconds` — 30, це більше за дренаж.

Порт на хості `22980` → NodePort `30980`. Після кожної збірки `cluster:up` робить `kind load`: образ з хоста в кластері сам не з'являється.

| Змінна | Джерело | Навіщо |
|---|---|---|
| `APP_DB_PASSWORD` | сховище (#11) | пароль до БД, їде в Secret `app-db` і в под через `secretKeyRef` |
| `PULUMI_CONFIG_PASSPHRASE` | сховище (#11) | ключ шифрування стану Pulumi |
| `PACT_BROKER_URL` | сховище | адреса брокера; без неї `pulumi preview` падає до кластера |
| `PACT_BROKER_TOKEN` | сховище | токен брокера |
| `JWT_PRIVATE_KEY` | сховище | ключ підпису; у Deployment лише не потрапляє значенням |
| `JWT_PUBLIC_KEY` | сховище | ключ перевірки |
| `JWT_KID` | сховище | активний kid |
| `REFRESH_TOKEN_PEPPER` | сховище | pepper refresh-токена |
| `STORAGE_ENDPOINT` | сховище | S3 API |
| `STORAGE_ACCESS_KEY` | сховище | access key |
| `STORAGE_SECRET_KEY` | сховище | secret key |
| `STORAGE_BUCKET` | сховище | бакет |

Програма в `infra/` перевіряє кожну з цих змінних першою дією і кидає її ім'я, якщо значення порожнє. Дефолтів немає. У Deployment значення немає: лише `secretKeyRef` на `APP_DB_PASSWORD`. Решта потрібна, щоб розгортання без сховища назвало саме ту змінну, яку зняли.

`spec.replicas` лишається `2`, і поруч оголошений HPA `autoscaling/v2` (`minReplicas` 2, `maxReplicas` 4, CPU 70%). У kind немає metrics-server, тому HPA показує `cpu: <unknown>/70%` і репліки не чіпає — це очікувано, поле лишається за програмою. У бойовому кластері з metrics-server це вже конфлікт володіння: і Pulumi, і HPA пишуть `replicas`. Наступний `pulumi up` поверне число з програми і затре те, що виставив автоскейлер.

Секрет рантайму приїжджає з тієї самої обгортки `scripts/with-secrets.sh`, що й раніше: програма кладе його в Secret (`data`, base64, не `stringData`), под читає посиланням. base64 тут не шифрування — у etcd локального кластера значення лежить відкритим текстом. Промисловий шлях інший: External Secrets Operator синхронізує секрет зі сховища в Secret, або CSI-драйвер монтує його файлом у под, без копії в etcd. Оператор у цей кластер не ставив.

`startupProbe` на `/healthz`: `periodSeconds` 1 і `failureThreshold` 20 дають 20 с до першого рестарту, поки процес не почав слухати. Після першого успіху ця проба вимикається, і далі зависання ловить вже liveness (`periodSeconds` 10, `failureThreshold` 3 — близько 30 с). Якби той самий повільний старт прикривали лише `initialDelaySeconds` у liveness, довелося б тримати велику паузу і для мертвого процесу теж: перша перевірка зависання чекала б усю цю паузу, а не 30 с.

Секрет збірки — файл `.npm_token` (у git його немає), змонтований як `RUN --mount=type=secret`. Приватного npm-реєстру немає, токен — приманка. Поріг сканера рахує `scripts/scan.sh` з звіту Trivy: `SCAN_MAX=-1` дає `gate=fail`, `SCAN_MAX=99999` дає `gate=pass`. У PR той самий скрипт іде з `SCAN_MAX=20`. На distroless лічильник уже стрибав із 7 на 8 між двома прогонами, тож поріг тримає запас і зупиняє збірку, коли CRITICAL+HIGH стає більше двадцяти. Нічний `.github/workflows/scan.yml` лишає `99999`, бо база сканера їде щодоби. Зелений образ не обіцяємо.

## Observability

Один ключ — `trace_id` активного спана OpenTelemetry. `src/main.ts` імпортує ініціалізацію OTel першим рядком, до застосунку. Pino бере ключ у mixin через `trace.getActiveSpan()?.spanContext().traceId`, тож жодна функція не приймає `req`, щоб дописати корелятор. `userId`, `tenant` і `idempotencyKey` живуть окремо в `AsyncLocalStorage`. Шар записується як `logger.child({ layer })`: контролер, сервіс, репозиторій. Тіло логіну і решти auth-запитів у лог не пишеться. `redact` лишається для `req.headers.authorization`, `password` і `body.password`, якщо такий об'єкт усе ж передали.

RED — лічильник `http_requests_total` і гістограма `http_request_duration_seconds` з лейблами `method`, `route`, `status`. `route` береться зі збігу Express (`req.route.path`), той самий шаблон, що зареєстрував Nest: `/orders/:id`, `/orders/:id/status`. Шлях, якого немає в роутері, сідає в один лейбл `unmatched`, а не в сирий URL. Бакети: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10` секунд. Найповільніший запит демо спить 200 мс на `id=slow`; верхня скінченна межа 10 с лишає запас, щоб `histogram_quantile` не впирався в край саме тоді, коли запит повільний. Запит із 5xx закриває спан статусом ERROR і пише в лог `reason` — текст винятку.

Стенд — один контейнер `grafana/otel-lgtm:0.11.11` (`observability/compose.yml`). Prometheus скрейпить `/metrics` сервісу на `host.docker.internal:3000` (`observability/prometheus.yaml`, інтервал 5 с). Після двох прогонів `demo:trace` контейнер займав 723 МіБ з 7,7 ГіБ Docker. Кластер kind із ДЗ #28 на цей час не піднятий. Grafana на цьому стенді анонімна, окремого пароля немає. Ті самі три адреси перевіряє `infra/` до будь-якого виклику кластера: порожнє значення кидає ім'я змінної.

| Змінна | Джерело | Навіщо |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | сховище | OTLP HTTP колектора, у стенді `http://127.0.0.1:22918` |
| `PROMETHEUS_URL` | сховище | Prometheus, у стенді `http://127.0.0.1:22911` |
| `TRACE_API_URL` | сховище | Tempo HTTP, у стенді `http://127.0.0.1:22904` |

Дашборд `observability/grafana/dashboards/red.json` підхоплює `observability/grafana/dashboard-provider.yml`, датасорси провіжаться `observability/grafana/datasources.yml`. Три панелі:

| Питання | PromQL |
|---|---|
| Скільки запитів (Rate) | `sum by (route) (rate(http_requests_total{service="marketplace"}[1m]))` |
| Яка частка 5xx (Errors) | `sum by (route) (rate(http_requests_total{service="marketplace",status=~"5.."}[1m])) / sum by (route) (rate(http_requests_total{service="marketplace"}[1m]))` |
| Наскільки повільно (Duration) | `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{service="marketplace"}[1m])))` |

Вікно `[1m]`, бо демо коротке: `[5m]` на хвилинному прогоні майже нічого не покаже.

SLI — частка запитів `POST /orders` і `GET /orders/:id`, що завершились швидше за 500 мс і без 5xx. SLO — 99,5 % таких запитів за 30 днів. Бюджет помилок: 0,005 × 30 діб × 24 год × 60 хв = 216 хвилин на місяць.

Числа прогону — у блоці `### ДЗ#29` вище.

## AWS
смуга: запасна (LocalStack)
teardown-run: https://github.com/FedorenkoVitaliy/marketplace-api/actions/runs/44657276964

pinning to a prior version will opt you out of any future updates or security patches.

Програми Pulumi: `infra/base` (бюджет, мережа, роль знесення; погодинних ресурсів немає) і `infra/demo` (інстанс RDS, балансувальник, ціль; NAT лише за прапорцем). Файл, який бере B3, — `infra/base/package.json`: `git ls-files 'package.json' '*/package.json'` віддає його першим, не кореневий `package.json`. Регіон обох стеків — `eu-central-1` (`aws:region` у `infra/base/Pulumi.base.yaml` і `infra/demo/Pulumi.demo.yaml`). Образ `localstack/localstack:4.14.0`, порт `23166`. Прогін знесення — рядок `teardown-run` вище. У його логу `state-resources-left`, `tagged-resources-left`, `rds-left`, `alb-left`, `nat-left` і `eip-left` дорівнюють нулю. Регіон перевірок — `eu-central-1` і `us-east-1`.

### Ставка

Дата знімка в ТЗ — 24.08.2026. Курс НБУ в ТЗ — 44,7064 грн/$ на 25.08.2026. Місяць — 730 год. Рядки нижче взяті з того знімка в тексті завдання.

| Рядок | Ставка | За 730 год |
|---|---|---:|
| ALB | $0,027/год | $19,71 |
| RDS Multi-AZ instance | $0,037/год | $27,01 |
| gp3 20 ГіБ | $0,274/ГіБ-міс × 20 | $5,48 |
| Public IPv4 × 2 під балансувальником | $0,005/год × 2 | $7,30 |
| LCU (оцінка навчального навантаження) | | $0,29 |
| **Разом** | **$0,08191/год** | **$59,79** |

$59,79 за 730 год = $0,08191/год.

### Дозволи teardown

Кожен рядок — один `Action` із `teardownPolicy` у `infra/base/stack.ts`. У кожному statement `Resource` — `"*"`, бо ARN ресурсів `demo` ще невідомі, коли створюється `base`. В `Action` зірочки немає.

- `rds:DeleteDBInstance` — знести інстанс RDS.
- `rds:DescribeDBInstances` — прочитати інстанс перед знесенням.
- `rds:DeleteDBSubnetGroup` — знести групу підмереж бази.
- `rds:DescribeDBSubnetGroups` — прочитати цю групу.
- `rds:ListTagsForResource` — теги ресурсу RDS.
- `elasticloadbalancing:DeleteLoadBalancer` — знести балансувальник.
- `elasticloadbalancing:DeleteListener` — знести його слухач.
- `elasticloadbalancing:DeleteTargetGroup` — знести target group.
- `elasticloadbalancing:DeregisterTargets` — зняти цілі перед видаленням групи.
- `elasticloadbalancing:DescribeLoadBalancers` — прочитати балансувальник.
- `elasticloadbalancing:DescribeListeners` — прочитати слухачі.
- `elasticloadbalancing:DescribeTargetGroups` — прочитати target group.
- `elasticloadbalancing:DescribeTargetHealth` — стан цілей.
- `elasticloadbalancing:DescribeLoadBalancerAttributes` — атрибути балансувальника.
- `elasticloadbalancing:DescribeTargetGroupAttributes` — атрибути групи.
- `elasticloadbalancing:DescribeTags` — теги балансувальника і групи.
- `ec2:DeleteNatGateway` — знести NAT, якщо прапорець `hw31:withNat` його підняв.
- `ec2:DescribeNatGateways` — прочитати NAT.
- `ec2:ReleaseAddress` — відпустити адресу NAT.
- `ec2:DisassociateAddress` — відвʼязати адресу перед release.
- `ec2:DescribeAddresses` — прочитати адреси, включно з хвостом EIP.
- `lambda:DeleteFunction` — знести функцію-ціль балансувальника.
- `lambda:GetFunction` — прочитати функцію.
- `lambda:RemovePermission` — зняти дозвіл виклику з балансувальника.
- `lambda:GetPolicy` — прочитати політику функції.
- `iam:DeleteRole` — знести роль цілі.
- `iam:GetRole` — прочитати роль.
- `iam:DetachRolePolicy` — відчепити керовану політику логів.
- `iam:ListAttachedRolePolicies` — побачити причеплені політики.
- `iam:ListRolePolicies` — побачити inline-політики.
- `iam:DeleteRolePolicy` — знести inline-політику, якщо вона є.
- `iam:ListInstanceProfilesForRole` — перевірити, що роль не в instance profile, інакше `DeleteRole` не проходить.
- `tag:GetResources` — підрахунок ресурсів з тегом `Project=nodejs-pro-hw31`.
- `sts:GetCallerIdentity` — хто викликає знесення.

`sim-allowed` і `sim-denied` у `evidence/iam.txt` пише скрипт, який читає документ цієї політики. Це не вивід `aws iam simulate-principal-policy`. Позитив: у якомусь `Allow` є `rds:DeleteDBInstance`, рядок `sim-allowed=allowed`. Негатив: `s3:DeleteBucket` немає в жодному `Action` і немає `Action` `"*"`, рядок `sim-denied=implicitDeny`. Поруч скрипт ставить `sim-source=policy-document`.

LocalStack цю політику не застосовує. Я не перевіряв її локально, бо перевірити локально неможливо.

Транскрипт емулятора лягає в `evidence/localstack-iam.txt`. Це інший файл, ніж `evidence/iam.txt`.

### RDS Multi-AZ проти стека з #15

Сервіс `db` у `docker-compose.yml` — `postgres:16-alpine`, порт `5432`, `max_connections=20`. Окремої streaming-replica в compose немає. Сервіс `pgbouncer` — `edoburu/pgbouncer:v1.24.1-p1`, хост-порт `6432`, конфіг `pgbouncer/pgbouncer.ini` (`pool_mode = transaction`, `marketplace = host=db port=5432 dbname=marketplace`). Застосунок ходить у `127.0.0.1:6432` (`DB_URL` у `.env.example`). `scripts/backup.sh` знімає `pg_dump -Fc` у `backups/marketplace-YYYY-MM-DD-HHMMSS.dump`. Розклад `backup.cron` — 03:00. `scripts/restore-drill.sh` піднімає контейнер `restore` (профіль `drill`, порт `5433`) і друкує `MATCH`. Числа drill — у `RESTORE-DRILL.md`.

RDS забирає фейловер інстанса і сховище standby. Лишає пул зʼєднань PgBouncer, логічний бекап `backup.sh` і перевірку `restore-drill.sh`. Репліку для читання теж лишає: standby не читається. Відповідь не «усе».

### KMS

KMS тут — шар під `ENCRYPTION_KEY`, не заміна сховищу #11. Секрети як і раніше їдуть через `scripts/with-secrets.sh`. Власний customer-managed key не створювали. `storageEncrypted: true` лишає ключ AWS `aws/rds`.

### Бекенд стану

ДЗ #28 тримає стан у `file://${ROOT}/.pulumi` через `scripts/pulumi.sh` (програма `infra/index.ts`, `infra/Pulumi.yaml`, стек `hw28`). На основній смузі так не можна: воркер GitHub не бачить ноутбук. На запасній `file://` можна, бо білити нічого. Джоба тримає свій `file://` на диску раннера (`PULUMI_BACKEND_URL` = `file://` у `runner.temp`).

Якщо Free plan недоступний, бюджет і destroy — єдиний захист. На цій здачі запасна смуга, бо живими грошима не платимо і чужий SSO не чіпаємо.

### Бонус

Два NAT, по одному на зону, в орієнтирі ТЗ дають $142,72 на місяць. З них NAT разом зі своїми Public IPv4 — близько 58% (у ТЗ 58,3%, $82). На схемі цього рядка немає. У нашому `demo` NAT лише за прапорцем і в ставку $59,79 не входить.

`eu-north-1` проти `eu-central-1` за тим самим орієнтиром ТЗ: Стокгольм дешевший на 9,8%, нерівномірно. NAT −11,5%, ALB −11,3%, RDS −11%, Public IPv4 і егрес однакові. Різниця в погодинних ставках NAT, балансувальника і бази. Плоский відсоток на наш стек без NAT не переноситься. Регіон здачі — `eu-central-1`.

S3 gateway endpoint не бере погодинну плату і не бере плату за обробку даних. Він замінює NAT, коли з приватної підмережі потрібен лише трафік S3. Решту інтернету він не виводить: образи, API і будь-який не-S3 трафік як і раніше йдуть через NAT. У цьому стеку в приватній підмережі лише база, їй інтернет не потрібен. Обіцянка #26 (приватний бакет) закривається випадком «лише S3».

Бюджет — лист, не гальмо. Дані оновлюються з лагом 8–12 год. За 12 год стек намотує $0,08191 × 12 = $0,98. BudgetAction спіймала б поріг із тим самим лагом і могла б зупинити інстанс RDS. Ресурс BudgetAction не створювали. Зупиняють тип акаунта і destroy.

Емулятор кроку 7.4 ДЗ #26 — nginx: бреше в бік дозволу, як LocalStack. Прибрати `stale-while-revalidate` з `Cache-Control` недостатньо: `STALE` дає `proxy_cache_use_stale`.

## CI/CD

Конвеєр — два воркфлоу. `.github/workflows/pr.yml` на `pull_request`: джоба `gates` (типи, oasdiff, dependency-cruiser) → `build` (один `docker/build-push-action`, далі `npm run scan`) → `cluster` (`id-token: write` лише тут). `cluster` перевіряє підпис OIDC, піднімає kind `hw28`, робить `pulumi preview`, гейт вартості, `pulumi up` і `demo:rollout`. Артефакт `pipeline-evidence` вивантажується з `if: always()`.

`.github/workflows/deploy.yml` на `push` у `main` і на `workflow_dispatch`. Образ тут не збирається. Ручний запуск бере `digest` уже зібраного образу і ставить його в той самий kind. Push у `main` бере digest голови злитого PR (тег, яким образ зібрали на PR) і ставить його. Якщо такого образу немає, крок червоний.

Середовище preview — kind на раннері PR, контекст `kind-hw28`, порт `22980`. Середовище promote — той самий кластер із `workflow_dispatch`, образ за digest, не за тегом. Довгоживучого ключа хмари в репозиторії немає: реєстр через токен джоби, хмара через OIDC.

Модулі не лізуть один в одного. Сходинка `arch` у `demo:gates` ганяє dependency-cruiser: файл `*.service.ts` не має права імпортувати `*controller.ts`. Коректне дерево `src` проходить, фікстура `scripts/gates/fixtures/arch` — ні.

Умова довіри — `oidc/policy.json`. Гейт — `scripts/oidc-gate.mjs`. Той самий файл біжить у джобі `cluster` і в `demo:oidc`. `iss` — `https://token.actions.githubusercontent.com`, `aud` — `sts.amazonaws.com`, `sub` — лише цей репозиторій, у двох формах: `repo:FedorenkoVitaliy/marketplace-api:*` і `repo:FedorenkoVitaliy@32368311/marketplace-api@1349719963:*`. Чужий репозиторій із правильним підписом не проходить.

Образ збирається один раз у джобі `build` і їде як `ghcr.io/fedorenkovitaliy/marketplace-api@<digest>`. Тег — SHA голови PR, людині. Пакет GHCR виставляється публічним, щоб digest можна було звірити з реєстру без логіна. `provenance` і `sbom` вимкнені, бо інакше в реєстрі лежить індекс, а не той digest, який віддав крок збірки.

Секрети конвеєра, які воркфлоу читає як `secrets.*` (крім токена, який GitHub видає на час джоби сам):

| Ім'я | Навіщо |
| --- | --- |
| `PACT_BROKER_TOKEN` | `pact.yml`: verify і can-i-deploy. Це брокер контрактів, не хмара і не реєстр |

Реєстр логіниться токеном джоби (`github.token`, `packages: write` на збірці). У секретах репозиторія його немає. Змінні застосунку ті самі, що в таблицях зі словом «сховище» вище (`APP_DB_PASSWORD`, ключі JWT, брокер, бакет, OTLP). У джобу вони приїжджають як літерали грейдера через `scripts/ci-env.sh` і `SKIP_VAULT=1`, у под — через `secretKeyRef`, не текстом у маніфесті.

Маскування в лозі замінює лише точне входження значення. Воно не бачить те саме значення в base64, розрізаним на шматки чи надрукованим інструментом у власному форматі. Тому в кроках, які бачать секрет, немає `echo` цього значення, `env`, `printenv` і `set -x`. Це шосте місце витоку після git-історії, логу застосунку, шару образу, `docker inspect` і `docker history`: логи конвеєра.

`src/mapping.ts` перекладає `resources.requests` контейнерів із `pulumi preview --json` у долари на місяць. Ставка — публічний прайс Linux/x86 (us-east-1) на [сторінці Fargate](https://aws.amazon.com/fargate/pricing/): vCPU $0.04048/год, пам'ять $0.004445/ГБ-год, 730 год. Репліки множаться. Локальний kind сам нічого не коштує; рахується запит пода, щоб `plan-usd` був більший за нуль. Бюджет PR — $20. Обхід — лейбл на PR.

cost-gate-bypass-label: cost-approved

