import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import type { Env } from '../config/env.schema.js';

export type SigningKeys = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  pepper: string;
  fingerprint: string;
};

type KeyEnv = Pick<Env, 'JWT_PRIVATE_KEY' | 'JWT_PUBLIC_KEY' | 'JWT_KID' | 'REFRESH_TOKEN_PEPPER'>;

const pem = (base64: string) => Buffer.from(base64, 'base64').toString('utf8');

/** PEM у сховищі лежить як base64; у лог іде лише відбиток публічного ключа. */
export function loadKeys(env: KeyEnv): SigningKeys {
  const publicKey = createPublicKey(pem(env.JWT_PUBLIC_KEY));
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return {
    kid: env.JWT_KID,
    privateKey: createPrivateKey(pem(env.JWT_PRIVATE_KEY)),
    publicKey,
    pepper: env.REFRESH_TOKEN_PEPPER,
    fingerprint: createHash('sha256').update(der).digest('hex').slice(0, 16),
  };
}
