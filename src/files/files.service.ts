import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { Env } from '../config/env.schema.js';
import { MULTIPART_THRESHOLD, createS3Client, partSizeFor } from './s3.js';

type PartUrl = { partNumber: number; url: string };

export type IntentResult =
  | { key: string; url: string }
  | { key: string; uploadId: string; partSize: number; parts: PartUrl[] };

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const DEFAULT_EXPIRES = 120;

@Injectable()
export class FilesService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    config: ConfigService<Env, true>,
  ) {
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.s3 = createS3Client({
      endpoint: config.get('STORAGE_ENDPOINT', { infer: true }),
      accessKeyId: config.get('STORAGE_ACCESS_KEY', { infer: true }),
      secretAccessKey: config.get('STORAGE_SECRET_KEY', { infer: true }),
    });
  }

  async intent(
    userId: string,
    contentType: string,
    expiresIn: number | undefined,
    idempotencyKey: string | undefined,
    size?: number,
  ): Promise<IntentResult> {
    const ext = EXT[contentType];
    if (!ext) throw new BadRequestException('contentType not allowed');
    const ttl = this.ttl(expiresIn);
    if (size !== undefined && (!Number.isInteger(size) || size < 1)) {
      throw new BadRequestException('size must be a positive integer');
    }

    const key = await this.insertPending(userId, ext, idempotencyKey);
    if ((size ?? 0) <= MULTIPART_THRESHOLD) {
      const url = await getSignedUrl(
        this.s3,
        new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
        { expiresIn: ttl },
      );
      return { key, url };
    }

    const uploadId = await this.ensureUpload(key, contentType);
    const partSize = partSizeFor(size!);
    const partCount = Math.ceil(size! / partSize);
    if (partCount > 10_000) throw new BadRequestException('file needs more than 10000 parts');
    const parts = await this.signParts(key, uploadId, partCount, ttl);
    return { key, uploadId, partSize, parts };
  }

  async resume(userId: string, key: string, size: number, expiresIn?: number): Promise<{ parts: PartUrl[] }> {
    if (!Number.isInteger(size) || size <= MULTIPART_THRESHOLD) {
      throw new BadRequestException('size must be above the multipart threshold');
    }
    const uploadId = await this.ownedUpload(userId, key);
    const have = new Set((await this.listParts(key, uploadId)).map((part) => part.PartNumber));
    const partSize = partSizeFor(size);
    const partCount = Math.ceil(size / partSize);
    const missing: number[] = [];
    for (let n = 1; n <= partCount; n += 1) {
      if (!have.has(n)) missing.push(n);
    }
    const ttl = this.ttl(expiresIn);
    const parts: PartUrl[] = [];
    for (const partNumber of missing) {
      parts.push({ partNumber, url: await this.signPart(key, uploadId, partNumber, ttl) });
    }
    return { parts };
  }

  async complete(userId: string, key: string): Promise<{ key: string; etag: string }> {
    const uploadId = await this.ownedUpload(userId, key);
    const parts = await this.listParts(key, uploadId);
    if (parts.length === 0) throw new ConflictException('no parts uploaded');
    const done = await this.s3.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));
    return { key, etag: done.ETag ?? '' };
  }

  async commit(userId: string, key: string, size?: number): Promise<{ key: string; status: 'COMPLETED' }> {
    const { rows } = await this.pool.query<{ owner_id: string }>(
      `SELECT owner_id::text FROM files WHERE key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('file not found');
    if (row.owner_id !== userId) throw new ForbiddenException('not your file');

    let length: number | undefined;
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      length = head.ContentLength;
    } catch (err) {
      const name = (err as { name?: string }).name;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        throw new ConflictException('object missing');
      }
      throw err;
    }

    if (size !== undefined && length !== size) throw new ConflictException('size mismatch');

    await this.pool.query(
      `UPDATE files SET status = 'COMPLETED', size = $2 WHERE key = $1`,
      [key, length ?? null],
    );
    return { key, status: 'COMPLETED' };
  }

  private async insertPending(userId: string, ext: string, idempotencyKey?: string): Promise<string> {
    const objectKey = `uploads/${userId}/${randomUUID()}.${ext}`;
    if (!idempotencyKey) {
      await this.pool.query(
        `INSERT INTO files (key, owner_id, status) VALUES ($1, $2, 'PENDING')`,
        [objectKey, userId],
      );
      return objectKey;
    }

    const stored = `${userId}:${idempotencyKey}`;
    const inserted = await this.pool.query<{ key: string }>(
      `INSERT INTO files (key, owner_id, status, idempotency_key)
       VALUES ($1, $2, 'PENDING', $3)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING key`,
      [objectKey, userId, stored],
    );
    if (inserted.rows[0]) return inserted.rows[0].key;

    const existing = await this.pool.query<{ key: string }>(
      `SELECT key FROM files WHERE idempotency_key = $1 AND owner_id = $2`,
      [stored, userId],
    );
    const winner = existing.rows[0];
    if (!winner) throw new ConflictException('idempotency key taken');
    return winner.key;
  }

  private ttl(expiresIn: number | undefined): number {
    const ttl = expiresIn ?? DEFAULT_EXPIRES;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300) {
      throw new BadRequestException('expiresIn must be 1..300');
    }
    return ttl;
  }

  private async ensureUpload(key: string, contentType: string): Promise<string> {
    const { rows } = await this.pool.query<{ upload_id: string | null }>(
      `SELECT upload_id FROM files WHERE key = $1`,
      [key],
    );
    if (rows[0]?.upload_id) return rows[0].upload_id;
    const created = await this.s3.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    }));
    if (!created.UploadId) throw new ConflictException('multipart upload was not created');
    await this.pool.query(`UPDATE files SET upload_id = $2 WHERE key = $1`, [key, created.UploadId]);
    return created.UploadId;
  }

  private async ownedUpload(userId: string, key: string): Promise<string> {
    const { rows } = await this.pool.query<{ owner_id: string; upload_id: string | null }>(
      `SELECT owner_id::text, upload_id FROM files WHERE key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('file not found');
    if (row.owner_id !== userId) throw new ForbiddenException('not your file');
    if (!row.upload_id) throw new BadRequestException('not a multipart upload');
    return row.upload_id;
  }

  private async signParts(key: string, uploadId: string, partCount: number, ttl: number): Promise<PartUrl[]> {
    const parts: PartUrl[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      parts.push({ partNumber, url: await this.signPart(key, uploadId, partNumber, ttl) });
    }
    return parts;
  }

  private signPart(key: string, uploadId: string, partNumber: number, ttl: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: ttl },
    );
  }

  private async listParts(key: string, uploadId: string): Promise<{ PartNumber: number; ETag: string }[]> {
    const parts: { PartNumber: number; ETag: string }[] = [];
    let marker: string | undefined;
    do {
      const page = await this.s3.send(new ListPartsCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }));
      for (const part of page.Parts ?? []) {
        if (part.PartNumber && part.ETag) parts.push({ PartNumber: part.PartNumber, ETag: part.ETag });
      }
      marker = page.IsTruncated && page.NextPartNumberMarker ? String(page.NextPartNumberMarker) : undefined;
    } while (marker);
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    return parts;
  }
}
