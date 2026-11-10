import { Kafka, logLevel } from 'kafkajs';
import axios from 'axios';
import dotenv from 'dotenv';
import {
  escSql,
  attributesToMapSql,
  parseTraceMessage,
  parseMetricsMessage,
  parseLogsMessage,
} from './otlp-parser.js';
import { createBatchHandler } from './batch-handler.js';

dotenv.config();

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);

const kafka = new Kafka({
  clientId: 'otel-consumer',
  brokers: KAFKA_BROKERS,
  logLevel: logLevel.ERROR,
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
});

const consumer = kafka.consumer({ groupId: 'otel-consumer-group' });

/**
 * Insert spans into ClickHouse
 */
async function insertTraces(spans) {
  if (spans.length === 0) return;

  const sql = `
    INSERT INTO traces (
      TraceId, SpanId, ParentSpanId, ServiceName, OperationName,
      StartTime, EndTime, Duration, StatusCode, StatusMessage,
      Attributes, ResourceAttributes
    ) VALUES
  `;

  const values = spans
    .map(
      (span) => `(
      '${escSql(span.traceId)}',
      '${escSql(span.spanId)}',
      '${escSql(span.parentSpanId || '')}',
      '${escSql(span.serviceName || 'unknown')}',
      '${escSql(span.operationName || 'unknown')}',
      ${span.startTimeUnixNano},
      ${span.endTimeUnixNano},
      ${span.durationNano},
      ${span.statusCode},
      '${escSql(span.statusMessage || '')}',
      ${attributesToMapSql(span.attributes)},
      ${attributesToMapSql(span.resourceAttributes)}
    )`
    )
    .join(',\n');

  try {
    await axios.post(CLICKHOUSE_URL, sql + values, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 5000,
    });
    console.log(`✓ Inserted ${spans.length} traces into ClickHouse`);
  } catch (error) {
    console.error(`✗ Failed to insert traces: ${error.message}`);
    if (error.response?.data) console.error('ClickHouse response:', error.response.data);
    // Rethrow to trigger retry mechanism
    throw error;
  }
}

/**
 * Insert metric data points into ClickHouse
 */
async function insertMetrics(rows) {
  if (rows.length === 0) return;

  const sql = `
    INSERT INTO metrics (
      ServiceName, MetricName, MetricType, Timestamp, Value, Attributes
    ) VALUES
  `;

  const values = rows
    .map(
      (row) => `(
      '${escSql(row.serviceName || 'unknown')}',
      '${escSql(row.metricName || 'unknown')}',
      '${escSql(row.metricType || 'unknown')}',
      ${row.timestampUnixNano},
      ${Number.isFinite(row.value) ? row.value : 0},
      ${attributesToMapSql(row.attributes)}
    )`
    )
    .join(',\n');

  try {
    await axios.post(CLICKHOUSE_URL, sql + values, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 5000,
    });
    console.log(`✓ Inserted ${rows.length} metrics into ClickHouse`);
  } catch (error) {
    console.error(`✗ Failed to insert metrics: ${error.message}`);
    throw error;
  }
}

/**
 * Insert log records into ClickHouse
 */
async function insertLogs(rows) {
  if (rows.length === 0) return;

  const sql = `
    INSERT INTO logs (
      ServiceName, Timestamp, SeverityText, SeverityNumber, Body,
      TraceId, SpanId, Attributes
    ) VALUES
  `;

  const values = rows
    .map(
      (row) => `(
      '${escSql(row.serviceName || 'unknown')}',
      ${row.timestampUnixNano},
      '${escSql(row.severityText || '')}',
      ${row.severityNumber || 0},
      '${escSql(row.body || '')}',
      '${escSql(row.traceId || '')}',
      '${escSql(row.spanId || '')}',
      ${attributesToMapSql(row.attributes)}
    )`
    )
    .join(',\n');

  try {
    await axios.post(CLICKHOUSE_URL, sql + values, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 5000,
    });
    console.log(`✓ Inserted ${rows.length} logs into ClickHouse`);
  } catch (error) {
    console.error(`✗ Failed to insert logs: ${error.message}`);
    throw error;
  }
}

/**
 * Setup message handlers
 */
async function setupConsumer() {
  await consumer.subscribe({ topics: ['otel.traces', 'otel.metrics', 'otel.logs'] });

  await consumer.run({
    // Offsets are resolved by the handler only after ClickHouse accepts the
    // rows; a failed insert makes kafkajs retry and re-deliver the batch.
    eachBatchAutoResolve: false,
    eachBatch: createBatchHandler({
      batchSize: BATCH_SIZE,
      handlers: {
        'otel.traces': { parse: parseTraceMessage, insert: insertTraces },
        'otel.metrics': { parse: parseMetricsMessage, insert: insertMetrics },
        'otel.logs': { parse: parseLogsMessage, insert: insertLogs },
      },
    }),
  });
}

/**
 * Start consumer
 */
async function start() {
  try {
    console.log('🚀 Starting Kafka consumer...');
    console.log(`📊 Kafka brokers: ${KAFKA_BROKERS.join(', ')}`);
    console.log(`📦 ClickHouse: ${CLICKHOUSE_URL}`);

    await consumer.connect();
    console.log('✓ Connected to Kafka');

    await setupConsumer();
    console.log('✓ Consumer ready, listening for messages...');
  } catch (error) {
    console.error('Failed to start consumer:', error.message);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down consumer...');
  await consumer.disconnect();
  console.log('✓ Consumer stopped');
  process.exit(0);
});

start();
