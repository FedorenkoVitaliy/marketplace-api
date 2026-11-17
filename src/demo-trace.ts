import './observability/otel.js';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { tracerProvider } from './observability/otel.js';
import { createOrdersServer, makeLogSink } from './observability/orders-http.js';

const endpoint = process.env.TRACE_API_URL;
if (!endpoint) throw new Error('TRACE_API_URL is required');
if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT is required');

const port = 22922;

function traceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

function call(path: string, header: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { traceparent: header } },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', reject);
    req.end();
  });
}

type RemoteSpan = { traceId: string; spanId: string; parentSpanId: string; error: boolean };

function idHex(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw) return '';
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) return raw.toLowerCase();
  return Buffer.from(raw, 'base64').toString('hex');
}

function collect(node: unknown, spans: RemoteSpan[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, spans);
    return;
  }
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.spans)) {
    for (const raw of record.spans) {
      if (!raw || typeof raw !== 'object') continue;
      const span = raw as Record<string, unknown>;
      const traceId = idHex(span.traceId ?? span.trace_id);
      const spanId = idHex(span.spanId ?? span.span_id);
      if (!traceId || !spanId) continue;
      const status = span.status as { code?: number | string } | undefined;
      const code = status?.code;
      spans.push({
        traceId,
        spanId,
        parentSpanId: idHex(span.parentSpanId ?? span.parent_span_id),
        error: code === 2 || code === 'STATUS_CODE_ERROR' || code === 'ERROR',
      });
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'spans') collect(value, spans);
  }
}

async function fetchTrace(traceId: string): Promise<RemoteSpan[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${endpoint}/api/traces/${traceId}`);
    if (response.status === 200) {
      const body: unknown = await response.json();
      const spans: RemoteSpan[] = [];
      collect(body, spans);
      const own = spans.filter((span) => span.traceId === traceId || span.traceId === '');
      if (own.length >= 2) return own.map((span) => ({ ...span, traceId: span.traceId || traceId }));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [];
}

const sink = makeLogSink();
const server = createOrdersServer(sink.stream);
await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));

try {
  const header = traceparent();
  const headerTraceId = header.split('-')[1] ?? '';
  const remoteParent = header.split('-')[2] ?? '';
  const mark = sink.lines.length;
  await call('/orders/500', header);
  await tracerProvider.forceFlush();
  const rows = sink.lines.slice(mark).map((line) => JSON.parse(line) as { trace_id?: string });
  const spans = await fetchTrace(headerTraceId);
  const ids = new Set(spans.map((span) => span.spanId));
  const orphans = spans.filter(
    (span) => span.traceId !== headerTraceId || (span.parentSpanId && span.parentSpanId !== remoteParent && !ids.has(span.parentSpanId)),
  ).length;
  const headerMatch = spans.length > 0 && spans.every((span) => span.traceId === headerTraceId) ? 1 : 0;
  const logMatch = rows.length > 0 && rows.every((row) => row.trace_id === headerTraceId) && headerMatch === 1 ? 1 : 0;
  const error = spans.some((span) => span.error) ? 1 : 0;

  console.log(`spans=${spans.length}`);
  console.log(`orphan-spans=${orphans}`);
  console.log(`trace-matches-header=${headerMatch}`);
  console.log(`trace-matches-log=${logMatch}`);
  console.log(`span-status-error=${error}`);

  const ok = spans.length >= 2 && orphans === 0 && headerMatch === 1 && logMatch === 1 && error === 1;
  process.exitCode = ok ? 0 : 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
