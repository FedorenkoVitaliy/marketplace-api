import { createServer } from 'node:http'
import pg from 'pg'

const CLIENTS = Number(process.env.STORM_CLIENTS ?? 100)
const WORK_MS = Number(process.env.STORM_WORK_MS ?? 4000)

function client(port: number) {
  return new pg.Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionTimeoutMillis: 15_000,
  })
}

type Bucket = { ok: number; fail: number; done: number }
const buckets = new Map<number, Bucket>()
const bucket = (port: number): Bucket => {
  let b = buckets.get(port)
  if (!b) buckets.set(port, (b = { ok: 0, fail: 0, done: 0 }))
  return b
}

async function runStorm(port: number): Promise<void> {
  const b = bucket(port)
  await Promise.all(
    Array.from({ length: CLIENTS }, async () => {
      const c = client(port)
      try {
        await c.connect()
        b.ok += 1
        await c.query('SELECT pg_sleep($1)', [WORK_MS / 1000])
      } catch {
        b.fail += 1
      } finally {
        b.done += 1
        await c.end().catch(() => undefined)
      }
    }),
  )
}

let lastPools: Record<string, number> = {}
let poolsBusy = false
async function refreshPools(): Promise<void> {
  const c = client(6432)
  c.database = 'pgbouncer'
  try {
    await c.connect()
    const r = await c.query(
      `SHOW POOLS`,
    )
    const row = r.rows.find((x: { database: string }) => x.database === 'marketplace')
    lastPools = row ?? {}
  } catch {
    lastPools = {}
  } finally {
    poolsBusy = false
    await c.end().catch(() => undefined)
  }
}

const page = `<!doctype html>
<meta charset="utf-8">
<title>Шторм з'єднань</title>
<style>
  body { font: 16px -apple-system, sans-serif; margin: 32px; background: #111; color: #eee; }
  h1 { font-size: 20px; font-weight: 600; }
  .card { border: 1px solid #333; border-radius: 12px; padding: 16px 20px; margin: 16px 0; }
  .bar { height: 28px; border-radius: 6px; background: #222; overflow: hidden; display: flex; margin: 6px 0; }
  .bar > div { height: 100%; }
  .ok { background: #3ddc84; } .fail { background: #ff5c5c; } .pending { background: #333; }
  .active { background: #4da3ff; } .wait { background: #f5a623; }
  .legend { display: flex; gap: 16px; font-size: 13px; color: #aaa; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; }
  .big { font-size: 28px; font-weight: 700; }
  .muted { color: #888; font-size: 13px; }
</style>
<h1>100 клієнтів одночасно стукають у базу</h1>
<p class="muted">Кожен тримає запит 4 с. Postgres пускає лише 20 з'єднань. PgBouncer пропускає їх по 5 за раз.</p>
<button id="go" onclick="go()">Запустити шторм</button>
<style>button { font-size: 16px; padding: 10px 18px; border-radius: 8px; border: 0; background: #4da3ff; color: #111; font-weight: 700; cursor: pointer; }</style>

<div class="card">
  <div>Напряму в Postgres <span class="muted">:5432</span></div>
  <div class="big" id="d-text">…</div>
  <div class="bar"><div class="ok" id="d-ok"></div><div class="fail" id="d-fail"></div></div>
</div>

<div class="card">
  <div>Через PgBouncer <span class="muted">:6432 · pool 5</span></div>
  <div class="big" id="p-text">…</div>
  <div class="bar"><div class="ok" id="p-ok"></div><div class="fail" id="p-fail"></div></div>
</div>

<div class="card">
  <div>Що бачить PgBouncer просто зараз</div>
  <div class="bar" style="height:36px">
    <div class="active" id="sv"></div><div class="wait" id="cw"></div>
  </div>
  <div class="legend">
    <span><i class="active"></i>працюють у Postgres: <b id="sv-n">0</b> / 5</span>
    <span><i class="wait"></i>стоять у черзі: <b id="cw-n">0</b></span>
  </div>
  <p class="muted" id="note"></p>
</div>
<div class="legend"><span><i class="ok"></i>пройшли</span><span><i class="fail"></i>відмова «too many clients»</span></div>
<script>
const N = ${CLIENTS};
const set = (id, w) => { document.getElementById(id).style.width = w + '%'; };
async function tick() {
  const s = await (await fetch('/state')).json();
  for (const [key, id] of [['direct','d'], ['bouncer','p']]) {
    const b = s[key];
    set(id + '-ok', b.ok / N * 100);
    set(id + '-fail', b.fail / N * 100);
    document.getElementById(id + '-text').textContent =
      b.done ? b.ok + ' / ' + N + ' пройшло за ' + (b.ms/1000).toFixed(1) + ' с'
              : 'йде… ' + (b.ok + b.fail) + ' / ' + N;
  }
  const a = Number(s.pools.sv_active ?? 0), w = Number(s.pools.cl_waiting ?? 0);
  set('sv', a / 5 * 30); set('cw', Math.min(w, 100) / 100 * 70);
  document.getElementById('sv-n').textContent = a;
  document.getElementById('cw-n').textContent = w;
  document.getElementById('note').textContent = w
    ? 'черга є: PgBouncer тримає рівно 5 місць у Postgres і віддає їх по черзі'
    : '';
}
async function go() {
  document.getElementById('go').disabled = true;
  await fetch('/start', { method: 'POST' });
  document.getElementById('go').disabled = false;
}
setInterval(tick, 400); tick();
</script>`

const started = new Map<number, number>()
let running = false
const state = (port: number) => {
  const b = bucket(port)
  const t0 = started.get(port)
  return { ...b, ms: t0 ? Date.now() - t0 : 0 }
}

createServer(async (req, res) => {
  if (req.url === '/start' && req.method === 'POST') {
    if (!running) {
      running = true
      buckets.clear()
      started.set(5432, Date.now())
      void runStorm(5432).then(() => {
        started.set(6432, Date.now())
        return runStorm(6432)
      }).finally(() => { running = false })
    }
    res.end('ok')
    return
  }
  if (req.url === '/state') {
    res.setHeader('content-type', 'application/json')
    if (!poolsBusy) { poolsBusy = true; void refreshPools() }
    res.end(JSON.stringify({ direct: state(5432), bouncer: state(6432), pools: lastPools }))
    return
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(page)
}).listen(3000, () => console.log('http://localhost:3000'))
