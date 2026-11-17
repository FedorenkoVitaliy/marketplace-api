import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestStore = {
  userId?: string;
  tenant?: string;
  idempotencyKey?: string;
};

const storage = new AsyncLocalStorage<RequestStore>();

export function currentRequest(): RequestStore | undefined {
  return storage.getStore();
}

export function runWithRequest<T>(store: RequestStore, fn: () => T): T {
  return storage.run(store, fn);
}
