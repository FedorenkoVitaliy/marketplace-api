import { Counter, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: 'marketplace' });

const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets,
  registers: [metricsRegistry],
});

type RoutedRequest = {
  baseUrl?: string;
  route?: { path?: string | string[] };
};

export function routeFromRequest(req: RoutedRequest): string {
  const raw = req.route?.path;
  const path = Array.isArray(raw) ? raw[0] : raw;
  if (!path) return 'unmatched';
  if (path.startsWith('/')) return path;
  return `${req.baseUrl ?? ''}/${path}`.replace(/\/{2,}/g, '/');
}

export type MetricLine = { name: string; labels: string; value: number };

export function parseMetrics(text: string): MetricLine[] {
  const lines: MetricLine[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(.+)$/.exec(line);
    if (!match) continue;
    lines.push({ name: match[1] ?? '', labels: match[2] ?? '', value: Number(match[3]) });
  }
  return lines;
}

export function sumMetric(
  lines: MetricLine[],
  name: string,
  pred: (line: MetricLine) => boolean = () => true,
): number {
  return lines.filter((line) => line.name === name && pred(line)).reduce((sum, line) => sum + line.value, 0);
}
