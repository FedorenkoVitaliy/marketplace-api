/**
 * demo:multipart — після обриву доливається одна частина з трьох.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { createPool } from './db.js';
import { seedAuthUsers, DEMO_PASSWORD } from './auth/demo-users.js';
import { createHttpApp } from './main.js';
import { createS3Client, ensureBucket, resetBucket } from './files/s3.js';
import { report } from './files/demo-report.js';

const PORT = 3304;
const MiB = 1024 * 1024;

type Reply = { status: number; body: Record<string, unknown> | null };

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
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

function uploadParts(urls: string[], files: string[]): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PART_URLS: urls.join('\n'),
    PART_FILES: files.join('\n'),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { readFile } from 'node:fs/promises';
      const urls = process.env.PART_URLS.split('\\n');
      const files = process.env.PART_FILES.split('\\n');
      for (let i = 0; i < urls.length; i += 1) {
        const res = await fetch(urls[i], { method: 'PUT', body: await readFile(files[i]) });
        if (!res.ok) {
          console.error(res.status);
          process.exit(1);
        }
      }
    `], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`part upload exit ${code}`))));
  });
}

async function headStatus(s3: ReturnType<typeof createS3Client>, bucket: string, key: string): Promise<number> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return 200;
  } catch (err) {
    return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 500;
  }
}

async function wipe(s3: ReturnType<typeof createS3Client>, bucket: string, dbUrl: string): Promise<void> {
  await resetBucket(s3, bucket);
  const pool = createPool(dbUrl);
  await pool.query(`DELETE FROM files`);
  await pool.end();
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
  process.env.PORT = String(PORT);
  process.env.LOG_LEVEL = 'error';

  const s3 = createS3Client({ endpoint, accessKeyId, secretAccessKey });
  await ensureBucket(s3, bucket);
  await wipe(s3, bucket, dbUrl);

  const pool = createPool(dbUrl);
  await seedAuthUsers(pool);
  await pool.end();

  const file = Buffer.alloc(MiB * 5 * 2 + 1024, 7);
  const dir = await mkdtemp(join(tmpdir(), 'hw26-parts-'));
  const http = await createHttpApp();
  const shutdown = () => {
    void http.close().finally(() => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await http.listen(PORT);
    const login = await call('POST', '/auth/login', undefined, { email: 'buyer@shop.test', password: DEMO_PASSWORD });
    const token = String(login.body?.accessToken ?? '');
    const intent = await call('POST', '/uploads/intent', token, {
      contentType: 'image/png',
      filename: '../../etc/passwd',
      size: file.length,
    });
    const key = String(intent.body?.key ?? '');
    const partSize = Number(intent.body?.partSize);
    const parts = intent.body?.parts as { partNumber: number; url: string }[];
    const slices = [file.subarray(0, partSize), file.subarray(partSize, partSize * 2)];
    const paths = [join(dir, '1'), join(dir, '2')];
    await writeFile(paths[0]!, slices[0]!);
    await writeFile(paths[1]!, slices[1]!);
    await uploadParts(parts.slice(0, 2).map((part) => part.url), paths);

    const headBefore = await headStatus(s3, bucket, key);
    const resume = await call('POST', '/uploads/resume', token, { key, size: file.length });
    const missing = resume.body?.parts as { partNumber: number; url: string }[];
    const rest = file.subarray(partSize * 2);
    const restPath = join(dir, 'rest');
    await writeFile(restPath, rest);
    await uploadParts(missing.map((part) => part.url), missing.map(() => restPath));

    const complete = await call('POST', '/uploads/complete', token, { key });
    const committed = await call('POST', '/uploads/commit', token, { key, size: file.length });
    if (committed.status !== 200) throw new Error(`commit ${committed.status}`);
    let sizeMatch = 0;
    let etagMultipart = 0;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const etag = (head.ETag ?? '').replaceAll('"', '');
      const md5 = createHash('md5').update(file).digest('hex');
      sizeMatch = head.ContentLength === file.length ? 1 : 0;
      etagMultipart = etag.endsWith('-3') && etag !== md5 ? 1 : 0;
    } catch {
      sizeMatch = 0;
      etagMultipart = 0;
    }

    return {
      'head-before-complete': headBefore,
      'resumed-parts': missing.length,
      complete: complete.status,
      'size-match': sizeMatch,
      'etag-multipart': etagMultipart,
    };
  } finally {
    await http.close();
    await rm(dir, { recursive: true, force: true });
  }
}

main()
  .then((got) => report({
    'head-before-complete': 404,
    'resumed-parts': 1,
    complete: 200,
    'size-match': 1,
    'etag-multipart': 1,
  }, got))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
