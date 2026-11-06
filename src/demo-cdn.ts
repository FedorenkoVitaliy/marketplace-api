/**
 * demo:cdn — бакет закритий, оновлення приїжджає під новим ім'ям.
 */
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { createS3Client, ensureBucket, publishAsset, resetBucket } from './files/s3.js';
import { report } from './files/demo-report.js';

const EDGE = 22660;

function assetName(body: Buffer): string {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8);
  return `assets/app.${hash}.css`;
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitOpen(port: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`edge port ${port} did not open`);
}

async function main(): Promise<Record<string, number>> {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const bucket = process.env.STORAGE_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new Error('STORAGE_* are required');

  const s3 = createS3Client({ endpoint, accessKeyId, secretAccessKey });
  await ensureBucket(s3, bucket);
  await resetBucket(s3, bucket);

  const first = Buffer.from('body-v1');
  const second = Buffer.from('body-v2-different');
  const name1 = assetName(first);
  const name2 = assetName(second);
  await publishAsset(s3, bucket, name1, first, 'text/css');

  let edge: ChildProcess | undefined;
  const stop = () => {
    if (edge && !edge.killed) edge.kill();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    edge = spawn(process.execPath, ['dist/src/files/edge.js'], { stdio: 'inherit' });
    await waitOpen(EDGE);

    const direct = await fetch(`${endpoint}/${bucket}/${name1}`);
    const miss = await fetch(`http://127.0.0.1:${EDGE}/${name1}`);
    const hit = await fetch(`http://127.0.0.1:${EDGE}/${name1}`);
    await publishAsset(s3, bucket, name2, second, 'text/css');
    const fresh = await fetch(`http://127.0.0.1:${EDGE}/${name2}`);
    const freshBody = Buffer.from(await fresh.arrayBuffer());

    return {
      direct: direct.status,
      'edge-miss': miss.status,
      'edge-hit': hit.status,
      'cache-hit': hit.headers.get('x-cache') === 'HIT' ? 1 : 0,
      'new-name': name1 !== name2 ? 1 : 0,
      'new-url': fresh.status,
      'content-changed': freshBody.equals(second) && !freshBody.equals(first) ? 1 : 0,
    };
  } finally {
    stop();
  }
}

main()
  .then((got) => report({
    direct: 403,
    'edge-miss': 200,
    'edge-hit': 200,
    'cache-hit': 1,
    'new-name': 1,
    'new-url': 200,
    'content-changed': 1,
  }, got))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
