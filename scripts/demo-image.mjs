import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const image = 'marketplace-api:hw28';
const token = readFileSync('.npm_token', 'utf8').trim();
if (!token) {
  console.error('.npm_token is empty');
  process.exit(1);
}

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8' });
}

function hits(text) {
  return text.split(token).length - 1;
}

const stages = readFileSync('docker/Dockerfile', 'utf8')
  .split('\n')
  .filter((line) => /^FROM /.test(line))
  .length;

const shell = run('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', 'exit 0']);
const shellInside = shell.status === 0 ? 1 : 0;

const uidRun = run('docker', ['run', '--rm', image, '-e', 'console.log(process.getuid())']);
const runtimeUid = uidRun.stdout.trim();

const history = run('docker', ['history', '--no-trunc', image]).stdout;
const inspect = run('docker', ['image', 'inspect', image]).stdout;

const dir = mkdtempSync(join(tmpdir(), 'hw28-image-'));
let layers = 0;
try {
  const saved = run('bash', ['-c', `docker save ${image} | tar -x -C ${dir}`]);
  if (saved.status !== 0) process.exit(1);
  const listing = run('bash', ['-c', `find ${dir} -type f`]).stdout.split('\n').filter(Boolean);
  for (const file of listing) {
    const isTar = run('tar', ['-tf', file]);
    if (isTar.status !== 0) continue;
    const packed = run('tar', ['-xO', '-f', file]);
    if (packed.stdout.includes(token)) layers += 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`stages=${stages}`);
console.log(`shell-inside=${shellInside}`);
console.log(`runtime-uid=${runtimeUid}`);
console.log(`token-in-history=${hits(history)}`);
console.log(`token-in-config=${hits(inspect)}`);
console.log(`token-in-layers=${layers}`);

const ok = stages >= 2
  && shellInside === 0
  && runtimeUid !== ''
  && runtimeUid !== '0'
  && hits(history) === 0
  && hits(inspect) === 0
  && layers === 0
  && uidRun.status === 0;
process.exit(ok ? 0 : 1);
