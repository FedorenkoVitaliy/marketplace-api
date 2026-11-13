import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const MiB = 1024 * 1024;

export const MULTIPART_THRESHOLD = 5 * MiB;

export function partSizeFor(bytes: number): number {
  return Math.max(5 * MiB, Math.ceil(bytes / 10_000));
}

export function createS3Client(env: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: env.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

export async function resetBucket(s3: S3Client, bucket: string): Promise<void> {
  let uploadMarker: string | undefined;
  let keyMarker: string | undefined;
  do {
    const listed = await s3.send(new ListMultipartUploadsCommand({
      Bucket: bucket,
      KeyMarker: keyMarker,
      UploadIdMarker: uploadMarker,
    }));
    for (const upload of listed.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId) continue;
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: upload.Key,
        UploadId: upload.UploadId,
      }));
    }
    keyMarker = listed.IsTruncated ? listed.NextKeyMarker : undefined;
    uploadMarker = listed.IsTruncated ? listed.NextUploadIdMarker : undefined;
  } while (keyMarker || uploadMarker);

  let token: string | undefined;
  do {
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    const keys = (objects.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    }
    token = objects.IsTruncated ? objects.NextContinuationToken : undefined;
  } while (token);
}

export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
  }
}

export async function publishAsset(
  s3: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}
