import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Express, NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { logger as rootLogger } from './logger.js';
import { httpDuration, httpRequests, metricsRegistry, routeFromRequest } from './metrics.js';

const tracer = trace.getTracer('marketplace-api');

export function observeHttp(app: Express, log: Logger = rootLogger): void {
  app.get('/metrics', (_req, res) => {
    void metricsRegistry.metrics().then((body) => {
      res.setHeader('content-type', metricsRegistry.contentType);
      res.end(body);
    });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const parent = propagation.extract(context.active(), req.headers);
    const span = tracer.startSpan(`${req.method ?? 'GET'} ${req.path}`, {
      kind: SpanKind.SERVER,
    }, parent);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const route = routeFromRequest(req);
      const status = res.statusCode || 500;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const labels = { method: req.method ?? 'GET', route, status: String(status) };
      httpRequests.inc(labels);
      httpDuration.observe(labels, seconds);
      context.with(trace.setSpan(parent, span), () => {
        if (status >= 500) {
          const reason = String(res.locals.errorDetail ?? 'error');
          span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
          log.error({ status, route, reason }, 'request failed');
        }
        span.updateName(`${req.method ?? 'GET'} ${route}`);
        span.end();
      });
    });
    context.with(trace.setSpan(parent, span), () => next());
  });
}
