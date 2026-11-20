import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

function docker(args) {
  return run('docker', args);
}

const typesOk = run('npx', ['tsc', '--noEmit']);
const typesBroken = run('npx', [
  'tsc', '--noEmit', '--ignoreConfig', '--strict', '--pretty', 'false',
  '--target', 'ES2022', '--module', 'nodenext', '--moduleResolution', 'nodenext',
  'scripts/gates/fixtures/types-broken.ts',
]);

const specDir = mkdtempSync(path.join(tmpdir(), 'hw32-oas-'));
const base = path.join(specDir, 'base.yaml');
const same = path.join(specDir, 'same.yaml');
const broken = path.join(specDir, 'broken.yaml');
const source = readFileSync(path.join(root, 'openapi/openapi.yaml'), 'utf8');
writeFileSync(base, source);
writeFileSync(same, source);
writeFileSync(broken, source.replace(/\n {2}\/auth\/logout:[\s\S]*?\n(?=components:)/, '\n'));
const oas = (head) => docker([
  'run', '--rm',
  '-v', `${specDir}:/spec`,
  'tufin/oasdiff:v1.32.1',
  'breaking', '/spec/base.yaml', `/spec/${head}`, '--fail-on', 'ERR',
]);
const contractOk = oas('same.yaml');
const contractBroken = oas('broken.yaml');
rmSync(specDir, { recursive: true, force: true });

const archOk = run('npx', ['depcruise', '--no-progress', '--validate', '.dependency-cruiser.cjs', 'src']);
const archBroken = run('npx', ['depcruise', '--no-progress', '--validate', '.dependency-cruiser.cjs', 'scripts/gates/fixtures/arch']);

const image = process.env.IMAGE ?? 'marketplace-api:hw28';
if (run('docker', ['image', 'inspect', image]) !== 0) {
  writeFileSync(path.join(root, '.npm_token'), 'dummy-npm-token');
  const built = run('npm', ['run', 'image:build']);
  if (built !== 0) {
    console.log(`scan-ok=1`);
    console.log(`scan-broken=0`);
    process.exit(1);
  }
}
const scanOk = run('npm', ['run', 'scan'], { IMAGE: image, SCAN_MAX: '99999' });
const scanBroken = run('npm', ['run', 'scan'], { IMAGE: image, SCAN_MAX: '-1' });

const rows = {
  'types-ok': typesOk,
  'types-broken': typesBroken,
  'contract-ok': contractOk,
  'contract-broken': contractBroken,
  'arch-ok': archOk,
  'arch-broken': archBroken,
  'scan-ok': scanOk,
  'scan-broken': scanBroken,
};
for (const [key, value] of Object.entries(rows)) console.log(`${key}=${value}`);

const names = ['types', 'contract', 'arch', 'scan'];
const bad = names.some((name) => rows[`${name}-ok`] !== 0 || rows[`${name}-broken`] === 0);
process.exit(bad ? 1 : 0);
