import { SpanStatusCode, trace } from '@opentelemetry/api';
import express from 'express';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { runWithRequest } from './context.js';
import { observeHttp } from './http.js';
import { createLogger, layerLogger } from './logger.js';

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

export function createOrdersServer(sink: { write: (chunk: string) => boolean }): Server {
  const log = createLogger(sink);
  const controllerLog = layerLogger(log, 'orders.controller');
  const serviceLog = layerLogger(log, 'orders.service');
  const repoLog = layerLogger(log, 'orders.repo');
  const app = express();
  observeHttp(app, log);

  app.use((req, _res, next) => {
    runWithRequest({
      userId: header(req, 'x-user-id'),
      tenant: header(req, 'x-tenant'),
      idempotencyKey: header(req, 'idempotency-key'),
    }, () => next());
  });

  async function selectOrder(id: string): Promise<{ id: string }> {
    return tracer.startActiveSpan('db.query', async (span) => {
      try {
        repoLog.info({ id }, 'select order');
        if (id === 'slow') await new Promise((resolve) => setTimeout(resolve, 200));
        if (id === '500') {
          const reason = 'orders table is locked';
          span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
          throw Object.assign(new Error(reason), { statusCode: 500 });
        }
        return { id };
      } finally {
        span.end();
      }
    });
  }

  app.get('/orders/:id/status', (req, res) => {
    res.json({ id: req.params.id, status: 'pending' });
  });

  app.get('/orders/:id', async (req, res) => {
    const id = String(req.params.id);
    controllerLog.info({ id, method: req.method }, 'request');
    try {
      serviceLog.info({ id }, 'load order');
      const order = await selectOrder(id);
      res.json(order);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      const reason = error instanceof Error ? error.message : 'error';
      res.locals.errorDetail = reason;
      res.status(status).json({ error: status });
    }
  });

  app.post('/login', (req, res) => {
    req.resume();
    controllerLog.info({ method: req.method }, 'login attempt');
    res.json({ ok: true });
  });

  return createServer(app);
}
