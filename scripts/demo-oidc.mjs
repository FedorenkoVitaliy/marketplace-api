import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate } from './oidc-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = crypto.randomBytes(8).toString('hex');
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const iss = `http://127.0.0.1:${port}`;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (payload) => {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64(payload);
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
};

const now = Math.floor(Date.now() / 1000);
const allowed = 'repo:FedorenkoVitaliy@32368311/marketplace-api@1349719963:pull_request';
const base = { iss, aud: 'sts.amazonaws.com', iat: now, exp: now + 300 };
const green = sign({ ...base, sub: allowed });
const foreign = sign({ ...base, sub: 'repo:other@1/other-repo@2:pull_request' });
const [head, body, signature] = green.split('.');
const flipped = signature[10] === 'A' ? 'B' : 'A';
const bad = `${head}.${body}.${signature.slice(0, 10)}${flipped}${signature.slice(11)}`;

const options = {
  jwksUrl: `${iss}/jwks`,
  iss,
  policyFile: path.join(root, 'oidc/policy.json'),
  issuerHost: 'token.actions.githubusercontent.com',
};

let failed = false;
for (const [name, token] of [['green', green], ['foreign-sub', foreign], ['bad-signature', bad]]) {
  const result = await gate(token, options);
  console.log(`case=${name}`);
  console.log(`sig-verified=${result.sigVerified}`);
  console.log(`policy-allow=${result.policyAllow}`);
  const expectAllow = name === 'green' ? 1 : 0;
  const expectSig = name === 'bad-signature' ? 0 : 1;
  if (result.sigVerified !== expectSig || result.policyAllow !== expectAllow) failed = true;
}
server.close();
process.exit(failed ? 1 : 0);
