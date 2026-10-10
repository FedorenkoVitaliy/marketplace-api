import pg from 'pg'

const port = Number(process.argv[2] ?? 6432)
const clients = Number(process.argv[3] ?? 100)
const workMs = Number(process.argv[4] ?? 500)

async function oneClient(): Promise<void> {
  const c = new pg.Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionTimeoutMillis: 10_000,
  })
  try {
    await c.connect()
    await c.query('SELECT pg_sleep($1)', [workMs / 1000])
  } finally {
    await c.end().catch(() => undefined)
  }
}

const via = port === 5432 ? 'напряму в Postgres' : 'через PgBouncer'
console.log(`${clients} клієнтів одночасно, ${via} (:${port}), кожен працює ${workMs} мс`)

const t0 = Date.now()
const results = await Promise.allSettled(Array.from({ length: clients }, oneClient))
const elapsed = Date.now() - t0

const ok = results.filter((r) => r.status === 'fulfilled').length
const errors = new Map<string, number>()
for (const r of results) {
  if (r.status === 'rejected') {
    const msg = (r.reason as Error).message
    errors.set(msg, (errors.get(msg) ?? 0) + 1)
  }
}

console.log(`пройшло ${ok}/${clients} за ${elapsed} мс`)
for (const [msg, n] of errors) console.log(`  впало ${n}: ${msg}`)
