# Marketplace API

Варіант Б: `express-openapi-validator` + `openapi/openapi.yaml`.

```bash
npm install
npm start
```

http://localhost:3000

## Lint / обсяг

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

## POST /orders

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
