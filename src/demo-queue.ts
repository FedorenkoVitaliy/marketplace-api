/**
 * ДЗ#23 demo:queue — BullMQ retry, jobId-дедуп, upsertJobScheduler.
 * Контракт: queue-noeviction attempts completed added queued schedulers scheduled-runs
 */
import { Queue, Worker, type Job } from 'bullmq';
import { bullConnection, closeRedis, conf, queueRedis } from './redis/clients.js';

const QUEUE = 'hw23-jobs';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const redis = queueRedis();
  const policy = await conf(redis, 'maxmemory-policy');
  const queueNoeviction = policy === 'noeviction' ? 1 : 0;

  const connection = bullConnection();
  const queue = new Queue(QUEUE, { connection });
  await queue.obliterate({ force: true });

  // ── 1. retry з exponential backoff + jitter ──
  const attemptMarks: number[] = [];
  let completed = 0;
  const flakyWorker = new Worker(
    QUEUE,
    async (job: Job) => {
      attemptMarks.push(Date.now());
      if (job.attemptsMade < 2) throw new Error('transient');
      completed = 1;
      return 'ok';
    },
    { connection: bullConnection() },
  );

  await queue.add(
    'flaky',
    { n: 1 },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 200, jitter: 0.2 },
      removeOnComplete: { age: 3600 },
    },
  );

  const t0 = Date.now();
  while (completed < 1 && Date.now() - t0 < 15_000) await sleep(50);
  const attempts = attemptMarks.length;
  await flakyWorker.close();

  // ── 2. jobId дедуп: два add → одна задача в черзі (воркер ще не їсть) ──
  await queue.obliterate({ force: true });
  await queue.add('dedup', { x: 1 }, { jobId: 'same-id', removeOnComplete: { age: 3600 } });
  await queue.add('dedup', { x: 2 }, { jobId: 'same-id', removeOnComplete: { age: 3600 } });
  const added = 2;
  const counts = await queue.getJobCounts('wait', 'delayed', 'prioritized');
  const queued = (counts.wait ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);

  // ── 3. планувальник: два upsert → один scheduler, ≥2 спрацювання ──
  await queue.obliterate({ force: true });
  let scheduledRuns = 0;
  const schedWorker = new Worker(
    QUEUE,
    async () => {
      scheduledRuns += 1;
      return 'ok';
    },
    { connection: bullConnection() },
  );

  await queue.upsertJobScheduler('heartbeat', { every: 400 }, { name: 'tick' });
  await queue.upsertJobScheduler('heartbeat', { every: 400 }, { name: 'tick' });
  const schedulers = (await queue.getJobSchedulers()).length;

  const t1 = Date.now();
  while (scheduledRuns < 2 && Date.now() - t1 < 10_000) await sleep(50);

  console.log(`queue-noeviction=${queueNoeviction}`);
  console.log(`attempts=${attempts}`);
  console.log(`completed=${completed}`);
  console.log(`added=${added}`);
  console.log(`queued=${queued}`);
  console.log(`schedulers=${schedulers}`);
  console.log(`scheduled-runs=${scheduledRuns}`);

  await queue.removeJobScheduler('heartbeat').catch(() => undefined);
  await schedWorker.close();
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
  await closeRedis(redis);

  if (queueNoeviction !== 1) process.exit(1);
  if (completed !== 1 || added !== 2 || queued !== 1) process.exit(1);
  if (attempts < 3 || schedulers < 1 || scheduledRuns < 2) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
