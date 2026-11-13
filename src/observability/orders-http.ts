import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { runWithRequest } from './context.js';
import { createLogger, layerLogger } from './logger.js';
import { httpDuration, httpRequests, metricsRegistry, routeTemplate } from './metrics.js';

const tracer = trace.getTracer('marketplace-api');

export function makeLogSink(): { lines: string[]; stream: { write: (chunk: string) => boolean } } {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(chunk: string) {
        for (const line of String(chunk).split('\n')) {
          if (line.trim()) lines.push(line);
        }
        return true;
      },
    },
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createOrdersServer(sink: { write: (chunk: string) => boolean }): Server {
  const log = createLogger(sink);
  const controllerLog = layerLogger(log, 'orders.controller');
  const serviceLog = layerLogger(log, 'orders.service');
  const repoLog = layerLogger(log, 'orders.repo');

  async function selectOrder(id: string): Promise<{ id: string }> {
    const span = tracer.startSpan('db.query');
    try {
      repoLog.info({ id }, 'select order');
      if (id === 'slow') await new Promise((resolve) => setTimeout(resolve, 200));
      if (id === '500') {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw Object.assign(new Error('orders table is locked'), { statusCode: 500 });
      }
      return { id };
    } finally {
      span.end();
    }
  }

  async function loadOrder(id: string): Promise<{ id: string }> {
    serviceLog.info({ id }, 'load order');
    return selectOrder(id);
  }

  async function handle(req: IncomingMessage, res: ServerResponse, span: import('@opentelemetry/api').Span): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/login' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) as { password?: string } : {};
      controllerLog.info(
        { req: { headers: { authorization: req.headers.authorization } }, body, password: body.password },
        'login attempt',
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    const id = url.pathname.split('/')[2] ?? '';
    const route = routeTemplate(url.pathname);
    const started = process.hrtime.bigint();
    controllerLog.info({ id, method: req.method }, 'request');
    let status = 200;
    try {
      const order = await loadOrder(id);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(order));
    } catch (error) {
      status = (error as { statusCode?: number }).statusCode ?? 500;
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      controllerLog.error({ status }, 'request failed');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: status }));
    } finally {
      if (url.pathname.startsWith('/orders/')) {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const labels = { method: req.method ?? 'GET', route, status: String(status) };
        httpRequests.inc(labels);
        httpDuration.observe(labels, seconds);
      }
    }
  }

  return createServer((req, res) => {
    if ((req.url ?? '').split('?')[0] === '/metrics') {
      void metricsRegistry.metrics().then((body) => {
        res.writeHead(200, { 'content-type': metricsRegistry.contentType });
        res.end(body);
      });
      return;
    }
    const parent = propagation.extract(context.active(), req.headers);
    const route = routeTemplate(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    const span = tracer.startSpan(`${req.method ?? 'GET'} ${route}`, { kind: SpanKind.SERVER }, parent);
    const store = {
      userId: header(req, 'x-user-id'),
      tenant: header(req, 'x-tenant'),
      idempotencyKey: header(req, 'idempotency-key'),
    };
    runWithRequest(store, () => {
      context.with(trace.setSpan(parent, span), () => {
        void handle(req, res, span).finally(() => span.end());
      });
    });
  });
}
