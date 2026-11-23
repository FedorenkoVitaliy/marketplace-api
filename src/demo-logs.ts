import './observability/otel.js';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createOrdersServer, makeLogSink } from './observability/orders-http.js';

const port = 22920;
const burst = 8;

function traceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

function call(path: string, headers: Record<string, string>, method = 'GET', body?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    if (body) req.end(body);
    else req.end();
  });
}

function parsed(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

const sink = makeLogSink();
const server = createOrdersServer(sink.stream);
await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));

try {
  const mark = sink.lines.length;
  const header = traceparent();
  const headerTraceId = header.split('-')[1] ?? '';
  await call('/orders/42', { traceparent: header, 'x-user-id': '7', 'x-tenant': 'shop', 'idempotency-key': 'order-42' });
  const one = parsed(sink.lines.slice(mark));
  const layers = new Set(one.map((row) => String(row.layer))).size;
  const ids = new Set(one.map((row) => String(row.trace_id)));
  const distinct = ids.size;
  const matches = one.length > 0 && one.every((row) => row.trace_id === headerTraceId) ? 1 : 0;

  const burstMark = sink.lines.length;
  const headers = Array.from({ length: burst }, () => traceparent());
  await Promise.all(headers.map((value) => call('/orders/7', { traceparent: value })));
  const burstRows = parsed(sink.lines.slice(burstMark));
  const groups = new Map<string, number>();
  for (const row of burstRows) {
    const id = String(row.trace_id);
    groups.set(id, (groups.get(id) ?? 0) + 1);
  }
  const sizes = [...groups.values()];
  const uneven = sizes.length ? Math.max(...sizes) - Math.min(...sizes) : 1;

  const secretMark = sink.lines.length;
  const headerMarker = `hdr-${randomBytes(8).toString('hex')}`;
  const bodyMarker = `pwd-${randomBytes(8).toString('hex')}`;
  await call('/login', {
    'content-type': 'application/json',
    authorization: `Bearer ${headerMarker}`,
    traceparent: traceparent(),
  }, 'POST', JSON.stringify({ password: bodyMarker }));
  const secretText = sink.lines.slice(secretMark).join('\n');
  const secretLogged = sink.lines.length > secretMark ? 1 : 0;
  const secretInLogs = secretText.includes(headerMarker) || secretText.includes(bodyMarker) ? 1 : 0;

  const measured = sink.lines.slice(mark);
  const nonJson = measured.filter((line) => {
    try {
      JSON.parse(line);
      return false;
    } catch {
      return true;
    }
  }).length;

  console.log(`non-json-lines=${nonJson}`);
  console.log(`layers=${layers}`);
  console.log(`distinct-trace-ids=${distinct}`);
  console.log(`trace-id-matches-header=${matches}`);
  console.log(`burst=${burst}`);
  console.log(`burst-trace-ids=${groups.size}`);
  console.log(`burst-uneven=${uneven}`);
  console.log(`secret-req-logged=${secretLogged}`);
  console.log(`secret-in-logs=${secretInLogs}`);

  const ok = nonJson === 0
    && layers >= 3
    && distinct === 1
    && matches === 1
    && burst >= 8
    && groups.size === burst
    && uneven === 0
    && secretLogged === 1
    && secretInLogs === 0;
  process.exitCode = ok ? 0 : 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
