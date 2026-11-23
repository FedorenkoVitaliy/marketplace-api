import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CPU_HOUR_USD = 0.04048;
const GB_HOUR_USD = 0.004445;
const HOURS = 730;

function cpuCores(value: unknown): number {
  if (typeof value !== 'string' || value === '') return Number.NaN;
  if (value.endsWith('m')) return Number(value.slice(0, -1)) / 1000;
  return Number(value);
}

function memoryGb(value: unknown): number {
  if (typeof value !== 'string' || value === '') return Number.NaN;
  if (value.endsWith('Ki')) return Number(value.slice(0, -2)) / 1024 / 1024;
  if (value.endsWith('Mi')) return Number(value.slice(0, -2)) / 1024;
  if (value.endsWith('Gi')) return Number(value.slice(0, -2));
  return Number(value);
}

type Container = {
  resources?: { requests?: { cpu?: string; memory?: string } };
};

type Spec = {
  replicas?: number;
  template?: { spec?: { containers?: Container[] } };
};

export function planUsd(plan: unknown): number {
  const seen = new Set<string>();
  let total = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const spec = (node as { spec?: Spec }).spec;
    const containers = spec?.template?.spec?.containers;
    if (containers) {
      const replicas = Number(spec?.replicas ?? 1);
      for (const container of containers) {
        const cpu = container.resources?.requests?.cpu;
        const memory = container.resources?.requests?.memory;
        if (!cpu && !memory) continue;
        const key = JSON.stringify({ replicas, cpu, memory });
        if (seen.has(key)) continue;
        seen.add(key);
        const cores = cpu ? cpuCores(cpu) : 0;
        const gb = memory ? memoryGb(memory) : 0;
        if (!Number.isFinite(cores) || !Number.isFinite(gb) || !Number.isFinite(replicas)) continue;
        total += replicas * (cores * CPU_HOUR_USD + gb * GB_HOUR_USD) * HOURS;
      }
    }
    for (const value of Object.values(node as Record<string, unknown>)) visit(value);
  };
  visit(plan);
  return total;
}

function readPlan(file: string): unknown {
  const text = readFileSync(file, 'utf8');
  const nodes: unknown[] = [];
  try {
    nodes.push(JSON.parse(text));
  } catch {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        nodes.push(JSON.parse(trimmed));
      } catch {
        // preview --json mixes engine events; skip a line that is not one object
      }
    }
  }
  return nodes;
}

const isEntry = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  const file = process.env.PLAN_JSON;
  const budgetRaw = process.env.COST_BUDGET_USD;
  if (!file) throw new Error('PLAN_JSON is required');
  if (budgetRaw === undefined || budgetRaw === '') throw new Error('COST_BUDGET_USD is required');
  const budget = Number(budgetRaw);
  const usd = planUsd(readPlan(file));
  const approved = process.env.COST_APPROVED === 'true';
  const pass = approved || usd <= budget;
  console.log(`budget-usd=${budget}`);
  console.log(`plan-usd=${usd.toFixed(2)}`);
  console.log(`gate=${pass ? 'pass' : 'fail'}`);
  process.exit(pass ? 0 : 1);
}
