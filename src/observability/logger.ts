import { trace } from '@opentelemetry/api';
import { pino, type DestinationStream, type Logger } from 'pino';
import { currentRequest } from './context.js';

const options = {
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const span = trace.getActiveSpan()?.spanContext();
    const store = currentRequest();
    return {
      ...(span?.traceId ? { trace_id: span.traceId, span_id: span.spanId } : {}),
      ...(store?.userId ? { userId: store.userId } : {}),
      ...(store?.tenant ? { tenant: store.tenant } : {}),
      ...(store?.idempotencyKey ? { idempotencyKey: store.idempotencyKey } : {}),
    };
  },
  redact: {
    paths: ['req.headers.authorization', 'password', 'body.password'],
    censor: '[redacted]',
  },
};

export function createLogger(stream?: DestinationStream): Logger {
  return stream ? pino(options, stream) : pino(options);
}

export const logger = createLogger();

export function layerLogger(base: Logger, layer: string): Logger {
  return base.child({ layer });
}
