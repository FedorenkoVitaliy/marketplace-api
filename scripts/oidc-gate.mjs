import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const b64json = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

export async function fetchJwks(jwksUrl) {
  const response = await fetch(jwksUrl);
  if (!response.ok) throw new Error(`jwks ${response.status}`);
  return response.json();
}

export function verifySignature(token, jwks, { iss, now = Math.floor(Date.now() / 1000) }) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[2]) return { ok: false, reason: 'no-signature' };
  const header = b64json(parts[0]);
  const payload = b64json(parts[1]);
  if (header.alg !== 'RS256') return { ok: false, reason: `alg-${header.alg}` };
  const jwk = (jwks.keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown-kid' };
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signed = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!signed) return { ok: false, reason: 'bad-signature' };
  if (payload.iss !== iss) return { ok: false, reason: 'iss' };
  if (!(payload.exp > now)) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

const like = (value, pattern) => new RegExp(
  `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
).test(value);

export function evaluatePolicy(policy, payload, issuerHost) {
  const claim = (key) => payload[key.slice(issuerHost.length + 1)];
  return policy.Statement.some((statement) => {
    if (statement.Effect !== 'Allow' || statement.Action !== 'sts:AssumeRoleWithWebIdentity') return false;
    const equals = statement.Condition?.StringEquals ?? {};
    const likeRules = statement.Condition?.StringLike ?? {};
    const equalsOk = Object.entries(equals).every(([key, expected]) => [].concat(expected).includes(claim(key)));
    const likeOk = Object.entries(likeRules).every(([key, expected]) => {
      const actual = claim(key);
      return [].concat(expected).some((pattern) => typeof actual === 'string' && like(actual, pattern));
    });
    return equalsOk && likeOk;
  });
}

export async function gate(token, { jwksUrl, iss, policyFile, issuerHost }) {
  const jwks = await fetchJwks(jwksUrl);
  const signature = verifySignature(token, jwks, { iss });
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  const allow = signature.ok && evaluatePolicy(policy, signature.payload, issuerHost);
  return {
    sigVerified: signature.ok ? 1 : 0,
    policyAllow: allow ? 1 : 0,
    reason: signature.ok ? (allow ? 'ok' : 'policy') : signature.reason,
    payload: signature.ok ? signature.payload : undefined,
  };
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const isEntry = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  const tokenFile = arg('--token-file');
  const jwksUrl = arg('--jwks-url');
  const iss = arg('--iss');
  const policyFile = arg('--policy');
  const issuerHost = arg('--issuer-host');
  if (!tokenFile || !jwksUrl || !iss || !policyFile || !issuerHost) {
    throw new Error('oidc gate needs --token-file --jwks-url --iss --policy --issuer-host');
  }
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const result = await gate(token, { jwksUrl, iss, policyFile, issuerHost });
  const payload = result.payload ?? {};
  console.log(`oidc-iss=${payload.iss ?? ''}`);
  console.log(`oidc-aud=${payload.aud ?? ''}`);
  console.log(`oidc-sub=${payload.sub ?? ''}`);
  console.log(`oidc-sig-verified=${result.sigVerified}`);
  console.log(`policy-allow=${result.policyAllow}`);
  process.exit(result.sigVerified === 1 && result.policyAllow === 1 ? 0 : 1);
}
