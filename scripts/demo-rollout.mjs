import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const context = 'kind-hw28';
const namespace = 'marketplace';
const url = 'http://127.0.0.1:22980/';
const dir = mkdtempSync(join(tmpdir(), 'hw28-roll-'));
const out = join(dir, 'codes.txt');
const duration = 40;
const workers = 4;
let load;

function kubectl(args) {
  const result = spawnSync('kubectl', ['--context', context, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'kubectl failed').trim());
  }
  return result.stdout.trim();
}

function finish(code) {
  if (load && load.exitCode === null) load.kill();
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

process.on('SIGINT', () => finish(1));
process.on('SIGTERM', () => finish(1));

try {
  kubectl(['-n', namespace, 'rollout', 'status', 'deploy/api', '--timeout=180s']);
  const current = kubectl([
    '-n', namespace, 'get', 'deploy', 'api',
    '-o', 'jsonpath={.spec.template.spec.containers[0].env[?(@.name=="REV")].value}',
  ]);
  const next = String((Number(current) || 1) + 1);
  load = spawn('bash', ['scripts/load.sh', url, String(duration), String(workers), out, '200'], {
    stdio: 'ignore',
  });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const started = Date.now();
  const up = spawnSync('bash', ['scripts/pulumi.sh', 'up'], {
    encoding: 'utf8',
    env: { ...process.env, REV: next },
  });
  spawnSync('kubectl', ['--context', context, '-n', namespace, 'rollout', 'status', 'deploy/api', '--timeout=180s'], {
    encoding: 'utf8',
  });
  const rolloutSeconds = Math.round((Date.now() - started) / 1000);
  const closed = await new Promise((resolve) => load.on('exit', resolve));
  if (up.status !== 0 || closed !== 0) finish(1);
  const lines = readFileSync(out, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
  const requests = lines.length;
  const ok = lines.filter((line) => line === '200').length;
  const failed = requests - ok;
  const maxUnavailable = kubectl([
    '-n', namespace, 'get', 'deploy', 'api',
    '-o', 'jsonpath={.spec.strategy.rollingUpdate.maxUnavailable}',
  ]);
  console.log(`profile=${maxUnavailable === '0' ? 'good' : 'bad'}`);
  console.log(`requests=${requests}`);
  console.log(`ok=${ok}`);
  console.log(`failed=${failed}`);
  console.log(`rollout-seconds=${rolloutSeconds}`);
  finish(failed === 0 && requests >= 5000 ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  finish(1);
}
