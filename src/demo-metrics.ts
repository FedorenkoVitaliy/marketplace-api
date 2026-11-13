import './observability/otel.js';
import { request as httpRequest } from 'node:http';
import { createOrdersServer, makeLogSink } from './observability/orders-http.js';
import { metricsRegistry, parseMetrics, sumMetric } from './observability/metrics.js';

const port = 22921;

function call(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

async function scrape(): Promise<string> {
  return metricsRegistry.metrics();
}

function counterSeries(text: string): number {
  return parseMetrics(text).filter((line) => line.name === 'http_requests_total').length;
}

function topBucketGap(text: string): number {
  const lines = parseMetrics(text).filter((line) => line.labels.includes('route="/orders/:id"'));
  const count = sumMetric(lines, 'http_request_duration_seconds_count');
  const finite = lines.filter((line) => line.name === 'http_request_duration_seconds_bucket' && !line.labels.includes('le="+Inf"'));
  const limits = [...new Set(finite.map((line) => /le="([^"]+)"/.exec(line.labels)?.[1] ?? '0'))]
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const top = Math.max(...limits);
  const covered = sumMetric(
    lines,
    'http_request_duration_seconds_bucket',
    (line) => line.labels.includes(`le="${top}"`),
  );
  return count - covered;
}

const server = createOrdersServer(makeLogSink().stream);
await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));

try {
  await call('/orders/warm');
  await call('/orders/500');
  const beforeText = await scrape();
  const seriesBefore = counterSeries(beforeText);
  const before = parseMetrics(beforeText);
  const beforeTotal = sumMetric(before, 'http_requests_total');
  const beforeErrors = sumMetric(before, 'http_requests_total', (line) => line.labels.includes('status="500"'));

  const sentOk = 40;
  const sentFail = 15;
  for (let i = 0; i < sentOk; i += 1) {
    await call(i === 0 ? '/orders/slow' : `/orders/ok-${i}`);
  }
  for (let i = 0; i < sentFail; i += 1) await call('/orders/500');

  const afterRed = parseMetrics(await scrape());
  const counterDelta = sumMetric(afterRed, 'http_requests_total') - beforeTotal;
  const errorsDelta = sumMetric(afterRed, 'http_requests_total', (line) => line.labels.includes('status="500"')) - beforeErrors;

  for (let i = 0; i < 100; i += 1) await call(`/orders/id-${i}`);
  const afterText = await scrape();
  const seriesAfter = counterSeries(afterText);
  const above = topBucketGap(afterText);

  console.log(`sent-ok=${sentOk}`);
  console.log(`sent-fail=${sentFail}`);
  console.log(`counter-delta=${counterDelta}`);
  console.log(`errors-delta=${errorsDelta}`);
  console.log(`above-top-bucket=${above}`);
  console.log(`series-before=${seriesBefore}`);
  console.log(`series-after=${seriesAfter}`);

  const ok = sentOk + sentFail >= 50
    && counterDelta === sentOk + sentFail
    && errorsDelta === sentFail
    && above === 0
    && seriesAfter === seriesBefore;
  process.exitCode = ok ? 0 : 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
