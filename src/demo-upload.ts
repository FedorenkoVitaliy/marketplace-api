/**
 * demo:upload — байти доїжджають у сховище, коли API вимкнено.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createPool } from './db.js';
import { seedAuthUsers, DEMO_PASSWORD } from './auth/demo-users.js';
import { createHttpApp } from './main.js';
import { createS3Client, ensureBucket, resetBucket } from './files/s3.js';
import { report } from './files/demo-report.js';

const BUYER = 'buyer@shop.test';
const PORT_A = 3301;
const PORT_B = 3302;

type Http = Awaited<ReturnType<typeof createHttpApp>>;
type Reply = { status: number; body: Record<string, unknown> | null };

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

async function waitClosed(port: number): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (!(await portOpen(port))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`port ${port} still open`);
}

function putWithoutKeys(url: string, body: Buffer, contentType: string): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...process.env, PUT_URL: url, PUT_TYPE: contentType };
  for (const key of Object.keys(env)) {
    if (key.startsWith('STORAGE_') || key.startsWith('AWS_')) delete env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const res = await fetch(process.env.PUT_URL, {
        method: 'PUT',
        headers: { 'content-type': process.env.PUT_TYPE },
        body: Buffer.concat(chunks),
      });
      console.log(res.status);
    `], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      const status = Number(out.trim().split('\n').at(-1));
      if (!Number.isInteger(status)) reject(new Error(`put child exit ${code}: ${out}`));
      else resolve(status);
    });
    child.stdin.end(body);
  });
}

async function call(port: number, method: string, path: string, token?: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) as Record<string, unknown> : null };
}

async function main(): Promise<Record<string, number>> {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const bucket = process.env.STORAGE_BUCKET;
  const dbUrl = process.env.DATABASE_URL || process.env.DB_URL;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !dbUrl) {
    throw new Error('STORAGE_* and DATABASE_URL are required');
  }
  process.env.DATABASE_URL = dbUrl;
  process.env.DB_URL = dbUrl;
  process.env.LOG_LEVEL = 'error';

  const s3 = createS3Client({ endpoint, accessKeyId, secretAccessKey });
  await ensureBucket(s3, bucket);
  await resetBucket(s3, bucket);
  const pool = createPool(dbUrl);
  await pool.query(`DELETE FROM files`);
  await seedAuthUsers(pool);
  await pool.end();

  let http: Http | undefined;
  const shutdown = () => {
    void http?.close().finally(() => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  const boot = async (port: number) => {
    process.env.PORT = String(port);
    http = await createHttpApp();
    await http.listen(port);
  };
  const stop = async (port: number) => {
    await http?.close();
    http = undefined;
    await waitClosed(port);
  };

  await boot(PORT_A);
  const login = await call(PORT_A, 'POST', '/auth/login', undefined, {
    email: BUYER,
    password: DEMO_PASSWORD,
  });
  const token = String(login.body?.accessToken ?? '');
  const intent = await call(PORT_A, 'POST', '/uploads/intent', token, {
    contentType: 'image/png',
    filename: '../../etc/passwd',
  });
  const key = String(intent.body?.key ?? '');
  const url = String(intent.body?.url ?? '');
  const keyFromServer = key.endsWith('.png') && !key.includes('passwd') && !key.includes('..') ? 1 : 0;

  await stop(PORT_A);
  const apiAlive = (await portOpen(PORT_A)) ? 1 : 0;
  const putOffline = await putWithoutKeys(url, Buffer.from('avatar-bytes'), 'image/png');

  await boot(PORT_B);
  const commit = await call(PORT_B, 'POST', '/uploads/commit', token, { key, size: Buffer.from('avatar-bytes').length });
  const empty = await call(PORT_B, 'POST', '/uploads/intent', token, { contentType: 'image/png', filename: 'skip.png' });
  const commitWithout = await call(PORT_B, 'POST', '/uploads/commit', token, { key: empty.body?.key });

  const tamperIntent = await call(PORT_B, 'POST', '/uploads/intent', token, { contentType: 'image/png' });
  const tamperedUrl = new URL(String(tamperIntent.body?.url ?? ''));
  tamperedUrl.pathname = tamperedUrl.pathname.replace(/[^/]+$/, 'nope.png');
  const tampered = await putWithoutKeys(tamperedUrl.toString(), Buffer.from('x'), 'image/png');

  const short = await call(PORT_B, 'POST', '/uploads/intent', token, { contentType: 'image/png', expiresIn: 2 });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const expired = await putWithoutKeys(String(short.body?.url ?? ''), Buffer.from('late'), 'image/png');
  await stop(PORT_B);

  return {
    intent: intent.status,
    'key-from-server': keyFromServer,
    'api-alive': apiAlive,
    'put-offline': putOffline,
    commit: commit.status,
    'commit-without-bytes': commitWithout.status,
    tampered,
    expired,
  };
}

main()
  .then((got) => report({
    intent: 200,
    'key-from-server': 1,
    'api-alive': 0,
    'put-offline': 200,
    commit: 200,
    'commit-without-bytes': 409,
    tampered: 403,
    expired: 403,
  }, got))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
