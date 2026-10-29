import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { trace } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';
const serviceName = process.env.SERVICE_NAME || 'unknown-service';
const environment = process.env.OTEL_RESOURCE_ATTRIBUTES || 'deployment.environment=dev';

const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  'deployment.environment': environment.split('=')[1] || 'dev',
});

const traceExporter = new OTLPTraceExporter({ url: otelEndpoint });

const metricExporter = new OTLPMetricExporter({ url: otelEndpoint });

const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  intervalMillis: 10000,
});

const loggerProvider = new LoggerProvider({ resource });
loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(new OTLPLogExporter({ url: otelEndpoint }))
);
logs.setGlobalLoggerProvider(loggerProvider);

const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

console.log(`✓ OpenTelemetry tracing initialized for ${serviceName}`);
console.log(`✓ Endpoint: ${otelEndpoint}`);

/**
 * Emit an OTel log record (severity ERROR) tagged with the active
 * span's trace/span id, alongside the existing console.error calls.
 */
export function logError(message, err) {
  const logger = logs.getLogger(serviceName);
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan?.spanContext();

  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: err?.message ? `${message}: ${err.message}` : message,
    attributes: {
      'error.type': err?.name || 'Error',
    },
    ...(spanContext && {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    }),
  });
}

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((log) => console.error('Error terminating tracing', log))
    .finally(() => process.exit(0));
});
