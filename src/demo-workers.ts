import dataSource from './data-source.js'

const JOBS = 12
const WORKERS = 4
const WORK_MS = 100

async function seedJobs(): Promise<void> {
  await dataSource.query('DELETE FROM jobs')
  await dataSource.query(
    `INSERT INTO jobs (payload) SELECT 'task-' || g FROM generate_series(1, $1) g`,
    [JOBS],
  )
}

async function claimOne(worker: string, skipLocked: boolean): Promise<'done' | 'empty'> {
  const qr = dataSource.createQueryRunner()
  await qr.connect()
  await qr.startTransaction()
  try {
    const lock = skipLocked ? 'FOR UPDATE SKIP LOCKED' : 'FOR UPDATE'
    const rows: { id: string }[] = await qr.manager.query(
      `SELECT id FROM jobs WHERE status = 'new' ORDER BY id LIMIT 1 ${lock}`,
    )
    if (rows.length === 0) {
      await qr.commitTransaction()
      return 'empty'
    }
    await new Promise((r) => setTimeout(r, WORK_MS))
    await qr.manager.query(
      `UPDATE jobs SET status = 'done', worker = $1, processed = processed + 1 WHERE id = $2`,
      [worker, rows[0].id],
    )
    await qr.commitTransaction()
    return 'done'
  } catch (e) {
    await qr.rollbackTransaction()
    throw e
  } finally {
    await qr.release()
  }
}

async function runPool(skipLocked: boolean): Promise<void> {
  await seedJobs()
  const t0 = Date.now()
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => `w${i + 1}`).map(async (w) => {
      for (;;) {
        const res = await claimOne(w, skipLocked)
        if (res === 'empty') {
          const left: { n: string }[] = await dataSource.query(
            `SELECT count(*) AS n FROM jobs WHERE status = 'new'`,
          )
          if (Number(left[0]?.n) === 0) return
          await new Promise((r) => setTimeout(r, 20))
        }
      }
    }),
  )
  const elapsed = Date.now() - t0
  const stats: { worker: string; n: string }[] = await dataSource.query(
    `SELECT worker, count(*) AS n FROM jobs GROUP BY worker ORDER BY worker`,
  )
  const twice: { n: string }[] = await dataSource.query(
    `SELECT count(*) AS n FROM jobs WHERE processed <> 1`,
  )
  const label = skipLocked ? 'SKIP LOCKED' : 'FOR UPDATE '
  const dist = stats.map((r) => `${r.worker}=${r.n}`).join(' ')
  console.log(`${label} ${elapsed} мс · ${dist} · оброблено двічі: ${Number(twice[0]?.n)}`)
}

await dataSource.initialize()
console.log(`${JOBS} задач × ${WORK_MS} мс, ${WORKERS} воркери · ідеал ${JOBS / WORKERS * WORK_MS} мс · послідовно ${JOBS * WORK_MS} мс`)
await runPool(false)
await runPool(true)
await dataSource.destroy()
