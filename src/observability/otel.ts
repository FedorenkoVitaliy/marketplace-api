import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';

propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const processors = endpoint
  ? [new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }))]
  : [];

export const tracerProvider = new NodeTracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'marketplace-api' }),
  spanProcessors: processors,
});

tracerProvider.register();
