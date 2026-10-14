import { fork, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ChildEvent =
  | { t: 'ready' }
  | { t: 'recv'; n: number; id?: string; redelivered?: boolean }
  | { t: 'effect'; n: number; id: string }
  | { t: 'acked'; n: number; id: string }
  | { t: 'skip'; n: number; id: string }
  | { t: 'rejected'; n: number; id: string };

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'consumer-child.js');

export class ConsumerProcess {
  private child?: ChildProcess;
  readonly events: ChildEvent[] = [];

  start(env: Record<string, string>): void {
    this.child = fork(CHILD, [], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.child.on('message', (m) => {
      this.events.push(m as ChildEvent);
    });
  }

  count(t: ChildEvent['t']): number {
    return this.events.filter((e) => e.t === t).length;
  }

  async until(
    pred: (events: ChildEvent[]) => boolean,
    timeoutMs = 15_000,
    label = 'умова',
  ): Promise<void> {
    const t0 = Date.now();
    while (!pred(this.events)) {
      if (Date.now() - t0 > timeoutMs) {
        throw new Error(`timeout: ${label}`);
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  kill(): void {
    this.child?.kill('SIGKILL');
    this.child = undefined;
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.child.send({ t: 'stop' });
    await new Promise<void>((resolve) => {
      const c = this.child!;
      c.once('exit', () => resolve());
      setTimeout(() => {
        c.kill('SIGKILL');
        resolve();
      }, 2000);
    });
    this.child = undefined;
  }
}
