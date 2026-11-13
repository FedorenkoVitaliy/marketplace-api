import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client } from './s3.js';

const PORT = 22660;

type Cached = { body: Buffer; headers: Record<string, string> };

function cacheable(cacheControl: string | undefined): boolean {
  if (!cacheControl) return false;
  return /public|max-age=\d+/i.test(cacheControl);
}

export function startEdge(): void {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const bucket = process.env.STORAGE_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET are required');
  }
  const s3 = createS3Client({ endpoint, accessKeyId, secretAccessKey });
  const cache = new Map<string, Cached>();

  const server = createServer(async (req, res) => {
    const key = decodeURIComponent((req.url ?? '/').replace(/^\//, ''));
    const hit = cache.get(key);
    if (hit) {
      res.writeHead(200, { ...hit.headers, 'X-Cache': 'HIT' });
      res.end(hit.body);
      return;
    }
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = Buffer.from(await obj.Body!.transformToByteArray());
      const headers: Record<string, string> = {};
      if (obj.ContentType) headers['Content-Type'] = obj.ContentType;
      if (obj.CacheControl) headers['Cache-Control'] = obj.CacheControl;
      if (cacheable(obj.CacheControl)) cache.set(key, { body, headers });
      res.writeHead(200, { ...headers, 'X-Cache': 'MISS' });
      res.end(body);
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 404;
      res.writeHead(status === 404 ? 404 : status);
      res.end();
    }
  });
  server.listen(PORT, '127.0.0.1');
}

const isEntry = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) startEdge();
