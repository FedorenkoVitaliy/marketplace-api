import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { SigningKeys } from './keys.js';

const ALG = 'ES256';
const ISSUER = 'marketplace-api';
const AUDIENCE = 'marketplace-api';
const ACCESS_TTL = '10m';

export type AccessClaims = {
  sub: string;
  jti: string;
  exp: number;
  fid: string;
  role: string;
};

/** `role` — підказка для клієнта; рішення приймається за роллю з БД. */
export function signAccess(
  keys: SigningKeys,
  userId: string,
  role: string,
  familyId: string,
): Promise<string> {
  return new SignJWT({ role, fid: familyId })
    .setProtectedHeader({ alg: ALG, kid: keys.kid })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(keys.privateKey);
}

/** Алгоритм — з allowlist, не із заголовка токена; `kid` лише вибирає вже відомий ключ. */
export async function verifyAccess(keys: SigningKeys, token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(
    token,
    (header) => {
      if (header.kid !== keys.kid) throw new Error(`unknown kid ${header.kid}`);
      return keys.publicKey;
    },
    { algorithms: [ALG], issuer: ISSUER, audience: AUDIENCE },
  );
  const { sub, jti, exp, fid, role } = payload as Record<string, unknown>;
  if (
    typeof sub !== 'string' ||
    typeof jti !== 'string' ||
    typeof exp !== 'number' ||
    typeof fid !== 'string' ||
    typeof role !== 'string'
  ) {
    throw new Error('invalid access claims');
  }
  return { sub, jti, exp, fid, role };
}
