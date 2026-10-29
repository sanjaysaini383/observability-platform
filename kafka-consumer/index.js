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

dotenv.config();

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);
const FLUSH_INTERVAL = parseInt(process.env.FLUSH_INTERVAL || '5000', 10);

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

let tracesBatch = [];
let metricsBatch = [];
let logsBatch = [];

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
 * Flush batches to ClickHouse
 */
async function flushBatches() {
  try {
    if (tracesBatch.length > 0) {
      const batch = tracesBatch;
      tracesBatch = [];
      await insertTraces(batch);
    }
    if (metricsBatch.length > 0) {
      const batch = metricsBatch;
      metricsBatch = [];
      await insertMetrics(batch);
    }
    if (logsBatch.length > 0) {
      const batch = logsBatch;
      logsBatch = [];
      await insertLogs(batch);
    }
  } catch (error) {
    console.error('Error flushing batches:', error.message);
  }
}

/**
 * Setup message handlers
 */
async function setupConsumer() {
  await consumer.subscribe({ topics: ['otel.traces', 'otel.metrics', 'otel.logs'] });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        if (topic === 'otel.traces') {
          const spans = parseTraceMessage(message.value);
          tracesBatch.push(...spans);

          if (tracesBatch.length >= BATCH_SIZE) {
            const batch = tracesBatch;
            tracesBatch = [];
            await insertTraces(batch);
          }
        } else if (topic === 'otel.metrics') {
          const rows = parseMetricsMessage(message.value);
          metricsBatch.push(...rows);

          if (metricsBatch.length >= BATCH_SIZE) {
            const batch = metricsBatch;
            metricsBatch = [];
            await insertMetrics(batch);
          }
        } else if (topic === 'otel.logs') {
          const rows = parseLogsMessage(message.value);
          logsBatch.push(...rows);

          if (logsBatch.length >= BATCH_SIZE) {
            const batch = logsBatch;
            logsBatch = [];
            await insertLogs(batch);
          }
        }
      } catch (error) {
        console.error(`Error processing message from ${topic}:`, error.message);
      }
    },
  });

  // Flush batches periodically
  setInterval(flushBatches, FLUSH_INTERVAL);
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
  await flushBatches();
  await consumer.disconnect();
  console.log('✓ Consumer stopped');
  process.exit(0);
});

start();
