/**
 * ДЗ#23 demo:ratelimit — спільний ліміт на 2 процеси (два «поди»), 429 + Retry-After.
 * Кожен процес має свій Redis-клієнт; лічильник спільний у ZSET.
 * Контракт: instances limit requests allowed blocked status retry-after
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { closeRedis, queueRedis } from './redis/clients.js';
import { slidingWindowLimit } from './redis/rate-limit.js';

const LIMIT = 5;
const WINDOW_MS = 2000;
const INSTANCES = 2;
const TOTAL = 12;
const PER_POD = TOTAL / INSTANCES;
const RL_KEY = 'rl:slide:demo-client';
const WHO = 'demo-client';

type PodResult = {
  allowed: number;
  blocked: number;
  status: number;
  retryAfter: number;
};

async function hitLimit(n: number): Promise<PodResult> {
  const redis = queueRedis();
  let allowed = 0;
  let blocked = 0;
  let status = 200;
  let retryAfter = 0;
  try {
    for (let i = 0; i < n; i++) {
      const res = await slidingWindowLimit(redis, WHO, LIMIT, WINDOW_MS);
      if (res.allowed) {
        allowed += 1;
      } else {
        blocked += 1;
        status = res.status;
        retryAfter = res.retryAfterSec > 0 ? 1 : 0;
      }
    }
  } finally {
    await closeRedis(redis);
  }
  return { allowed, blocked, status, retryAfter };
}

function runChildPod(): Promise<PodResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child: ChildProcess = fork(fileURLToPath(import.meta.url), [], {
      env: { ...process.env, DEMO_RATELIMIT_CHILD: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const done = (err: Error | null, value?: PodResult) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value!);
    };
    child.on('message', (m) => done(null, m as PodResult));
    child.on('error', (e) => done(e));
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        done(new Error(`ratelimit child exit ${code}`));
      }
    });
    setTimeout(() => done(new Error('ratelimit child timeout')), 15_000);
  });
}

async function parentMain(): Promise<void> {
  const setup = queueRedis();
  await setup.unlink(RL_KEY);
  await closeRedis(setup);

  // Другий процес стартує паралельно з першим — обидва свої клієнти, один ZSET.
  const childPromise = runChildPod();
  // невелика пауза, щоб child встиг підключитись до Redis до перших запитів батька
  await new Promise((r) => setTimeout(r, 80));
  const parent = await hitLimit(PER_POD);
  const child = await childPromise;

  const allowed = parent.allowed + child.allowed;
  const blocked = parent.blocked + child.blocked;
  const lastStatus = parent.status === 429 || child.status === 429 ? 429 : parent.status;
  const retryAfter =
    parent.retryAfter === 1 || child.retryAfter === 1 ? 1 : 0;

  console.log(`instances=${INSTANCES}`);
  console.log(`limit=${LIMIT}`);
  console.log(`requests=${TOTAL}`);
  console.log(`allowed=${allowed}`);
  console.log(`blocked=${blocked}`);
  console.log(`status=${lastStatus}`);
  console.log(`retry-after=${retryAfter}`);

  if (INSTANCES < 2 || allowed !== LIMIT || blocked !== TOTAL - LIMIT) process.exit(1);
  if (lastStatus !== 429 || retryAfter !== 1) process.exit(1);
}

async function childMain(): Promise<void> {
  const result = await hitLimit(PER_POD);
  if (process.send) process.send(result);
  else throw new Error('IPC недоступний');
  process.exit(0);
}

const run = process.env.DEMO_RATELIMIT_CHILD === '1' ? childMain : parentMain;
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
