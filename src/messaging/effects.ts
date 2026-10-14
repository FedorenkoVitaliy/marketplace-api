import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const STATE_DIR = join(ROOT, '.state');

export function statePath(name: string): string {
  mkdirSync(STATE_DIR, { recursive: true });
  return join(STATE_DIR, name);
}

export function resetState(...names: string[]): void {
  for (const n of names) rmSync(statePath(n), { force: true });
}

/** Неідемпотентний запис ефекту: повтор додає другий рядок. */
export function applyEffect(file: string, id: string, payload: unknown): void {
  appendFileSync(
    statePath(file),
    `${JSON.stringify({ id, payload, at: Date.now() })}\n`,
  );
}

export function readEffects(file: string): { id: string }[] {
  const p = statePath(file);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: string });
}

export function effectCount(file: string): number {
  return readEffects(file).length;
}

/** Сховище оброблених eventId на диску — переживає рестарт процесу. */
export function seen(file: string, id: string): boolean {
  const p = statePath(file);
  if (!existsSync(p)) return false;
  return readFileSync(p, 'utf8').split('\n').includes(id);
}

export function remember(file: string, id: string): void {
  appendFileSync(statePath(file), `${id}\n`);
}
