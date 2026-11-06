import { generateKeyPairSync, randomBytes } from 'node:crypto';

/** Тестові ES256-ключі в env (у CI сховища немає): лише для testcontainers-прогонів. */
export function useTestJwtEnv(): void {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const b64 = (pem: string | Buffer) => Buffer.from(pem).toString('base64');
  process.env.JWT_PRIVATE_KEY = b64(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  process.env.JWT_PUBLIC_KEY = b64(publicKey.export({ type: 'spki', format: 'pem' }));
  process.env.JWT_KID = 'test';
  process.env.REFRESH_TOKEN_PEPPER = randomBytes(32).toString('hex');
  process.env.STORAGE_ENDPOINT = 'http://127.0.0.1:9';
  process.env.STORAGE_ACCESS_KEY = 'test-access-key';
  process.env.STORAGE_SECRET_KEY = 'test-secret-key';
  process.env.STORAGE_BUCKET = 'test-bucket';
}
