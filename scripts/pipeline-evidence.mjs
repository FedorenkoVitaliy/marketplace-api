import { readFileSync, writeFileSync } from 'node:fs';

function lines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }
}

function pick(file, key) {
  const prefix = `${key}=`;
  const line = lines(file).find((row) => row.startsWith(prefix));
  return line ? line.slice(prefix.length) : '';
}

const deployFile = process.env.DEPLOY_JSON ?? 'deployment.json';
let image = '';
try {
  const body = JSON.parse(readFileSync(deployFile, 'utf8'));
  image = body.spec?.template?.spec?.containers?.[0]?.image ?? '';
} catch {
  image = '';
}
const at = image.lastIndexOf('@');
const deployed = at === -1 ? '' : image.slice(at + 1);

const password = process.env.APP_DB_PASSWORD ?? '';
let secretHits = 0;
if (password) {
  const manifest = (() => {
    try {
      return readFileSync(deployFile, 'utf8');
    } catch {
      return '';
    }
  })();
  let from = 0;
  while (from <= manifest.length) {
    const found = manifest.indexOf(password, from);
    if (found === -1) break;
    secretHits += 1;
    from = found + password.length;
  }
}

const buildLog = process.env.BUILD_LOG ?? 'build.log';
const invocations = lines(buildLog).filter((row) => row.trim()).length;
const oidcFile = process.env.OIDC_TXT ?? 'oidc.txt';
const rolloutFile = process.env.ROLLOUT_TXT ?? 'rollout.txt';

const rows = [
  `run-id=${process.env.RUN_ID ?? ''}`,
  `head-sha=${process.env.HEAD_SHA ?? ''}`,
  `image-ref=${process.env.IMAGE_REF_TAG ?? ''}`,
  `built-digest=${process.env.BUILT_DIGEST ?? ''}`,
  `deployed-digest=${deployed}`,
  `build-invocations=${invocations}`,
  `creds-source=${pick(oidcFile, 'oidc-sig-verified') === '1' ? 'oidc' : ''}`,
  `oidc-iss=${pick(oidcFile, 'oidc-iss')}`,
  `oidc-aud=${pick(oidcFile, 'oidc-aud')}`,
  `oidc-sub=${pick(oidcFile, 'oidc-sub')}`,
  `oidc-sig-verified=${pick(oidcFile, 'oidc-sig-verified')}`,
  `rollout-requests=${pick(rolloutFile, 'requests')}`,
  `rollout-ok=${pick(rolloutFile, 'ok')}`,
  `rollout-failed=${pick(rolloutFile, 'failed')}`,
  `rollout-seconds=${pick(rolloutFile, 'rollout-seconds')}`,
  `secret-in-manifest=${secretHits}`,
  `gate-scan-exit=${process.env.SCAN_EXIT ?? ''}`,
];
writeFileSync(process.env.EVIDENCE ?? 'evidence.txt', `${rows.join('\n')}\n`);
