import { spawnSync } from 'node:child_process';

const context = 'kind-hw28';
const namespace = 'marketplace';

function kubectl(args, input) {
  const result = spawnSync('kubectl', ['--context', context, ...args], {
    encoding: 'utf8',
    input,
  });
  if (result.status !== 0 && !String(result.stdout).includes('"code"')) {
    throw new Error((result.stderr || result.stdout || 'kubectl failed').trim());
  }
  return result.stdout.trim();
}

function readyPods() {
  const raw = kubectl(['-n', namespace, 'get', 'pods', '-l', 'app=api', '-o', 'json']);
  const body = JSON.parse(raw);
  return body.items.filter((pod) => {
    if (pod.metadata.deletionTimestamp) return false;
    const ready = (pod.status?.conditions ?? []).some((item) => item.type === 'Ready' && item.status === 'True');
    return ready;
  }).map((pod) => pod.metadata.name);
}

function evict(pod) {
  const result = spawnSync('kubectl', [
    '--context', context,
    'create', '--raw',
    `/api/v1/namespaces/${namespace}/pods/${pod}/eviction`,
    '-f', '-', '-v=6',
  ], {
    encoding: 'utf8',
    input: JSON.stringify({
      apiVersion: 'policy/v1',
      kind: 'Eviction',
      metadata: { name: pod, namespace },
    }),
  });
  const text = `${result.stdout}\n${result.stderr}`;
  const code = text.match(/status="(\d+)/) ?? text.match(/"code":\s*(\d+)/);
  if (!code) throw new Error(text.trim().split('\n').slice(-2).join(' '));
  return Number(code[1]);
}

try {
  let names = [];
  for (let i = 0; i < 40; i += 1) {
    const allowed = kubectl(['-n', namespace, 'get', 'pdb', 'api', '-o', 'jsonpath={.status.disruptionsAllowed}']);
    names = readyPods();
    if (allowed === '1' && names.length === 2) break;
    names = [];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (names.length < 2) process.exit(1);
  const healthy = kubectl(['-n', namespace, 'get', 'pdb', 'api', '-o', 'jsonpath={.status.currentHealthy}']);
  const minAvailable = kubectl(['-n', namespace, 'get', 'pdb', 'api', '-o', 'jsonpath={.spec.minAvailable}']);
  const first = evict(names[0]);
  const second = evict(names[1]);
  console.log(`healthy=${healthy}`);
  console.log(`minAvailable=${minAvailable}`);
  console.log(`evict-1=${first}`);
  console.log(`evict-2=${second}`);
  process.exit(first === 201 && second === 429 ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
