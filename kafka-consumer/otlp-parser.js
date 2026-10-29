/**
 * Pure parsing/escaping helpers for OTLP JSON (otlp_json Kafka encoding).
 * No side effects — kept separate from index.js so it can be unit tested
 * without connecting to Kafka/ClickHouse.
 */

import { escSql } from '../shared/sql-utils.js';
export { escSql };

function otlpValueToString(value) {
  if (value == null) return '';
  if ('stringValue' in value) return value.stringValue;
  if ('string_value' in value) return value.string_value;
  if ('intValue' in value) return String(value.intValue);
  if ('int_value' in value) return String(value.int_value);
  if ('doubleValue' in value) return String(value.doubleValue);
  if ('double_value' in value) return String(value.double_value);
  if ('boolValue' in value) return String(value.boolValue);
  if ('bool_value' in value) return String(value.bool_value);
  return JSON.stringify(value);
}

/**
 * Convert an OTLP `attributes` array ([{key, value: {...}}]) into a
 * ClickHouse map(...) SQL expression. Always uses the map(...) function
 * form (never the bare '{}' literal) — ClickHouse's VALUES-clause fast
 * parser compiles a per-batch template from the first row's expression
 * shapes, and mixing '{}' literals with map(...) calls across rows in the
 * same INSERT causes a SYNTAX_ERROR (Cannot parse expression of type Map).
 */
export function attributesToMapSql(attrs) {
  if (!attrs || attrs.length === 0) return 'map()';

  const pairs = attrs
    .filter((a) => a && a.key != null)
    .map((a) => `'${escSql(a.key)}','${escSql(otlpValueToString(a.value))}'`);

  if (pairs.length === 0) return 'map()';
  return `map(${pairs.join(',')})`;
}

/**
 * Parse OTLP JSON trace message and flatten to individual spans.
 * The collector encodes as otlp_json so messages are plain JSON strings.
 */
export function parseTraceMessage(buffer) {
  try {
    const decoded = JSON.parse(buffer.toString('utf8'));
    const spans = [];

    const resourceSpans = decoded.resourceSpans || decoded.resource_spans || [];
    for (const resourceSpan of resourceSpans) {
      const resourceAttrs = resourceSpan.resource?.attributes || [];
      const serviceAttr = resourceAttrs.find((a) => a.key === 'service.name');
      const serviceName = serviceAttr?.value?.stringValue ||
        serviceAttr?.value?.string_value || 'unknown';

      const scopeSpans = resourceSpan.scopeSpans || resourceSpan.scope_spans || [];
      for (const scopeSpan of scopeSpans) {
        const rawSpans = scopeSpan.spans || [];
        for (const span of rawSpans) {
          spans.push({
            traceId:      span.traceId      || span.trace_id      || '',
            spanId:       span.spanId       || span.span_id       || '',
            parentSpanId: span.parentSpanId || span.parent_span_id || '',
            serviceName,
            operationName: span.name || 'unknown',
            startTimeUnixNano: BigInt(span.startTimeUnixNano || span.start_time_unix_nano || 0),
            endTimeUnixNano:   BigInt(span.endTimeUnixNano   || span.end_time_unix_nano   || 0),
            durationNano:
              BigInt(span.endTimeUnixNano   || span.end_time_unix_nano   || 0) -
              BigInt(span.startTimeUnixNano || span.start_time_unix_nano || 0),
            statusCode:    span.status?.code    || 0,
            statusMessage: span.status?.message || '',
            attributes:         span.attributes || span.attributes_ || [],
            resourceAttributes: resourceAttrs,
          });
        }
      }
    }

    return spans;
  } catch (error) {
    console.error('Failed to parse trace message:', error.message);
    return [];
  }
}

function metricNameFromDataPoint(baseName, suffix) {
  return suffix ? `${baseName}.${suffix}` : baseName;
}

/**
 * Parse OTLP JSON metric message and flatten to individual data points.
 * gauge/sum -> one row per data point.
 * histogram -> sum/count/min/max rows per data point (bucket detail skipped).
 */
export function parseMetricsMessage(buffer) {
  try {
    const decoded = JSON.parse(buffer.toString('utf8'));
    const rows = [];

    const resourceMetrics = decoded.resourceMetrics || decoded.resource_metrics || [];
    for (const resourceMetric of resourceMetrics) {
      const resourceAttrs = resourceMetric.resource?.attributes || [];
      const serviceAttr = resourceAttrs.find((a) => a.key === 'service.name');
      const serviceName = serviceAttr?.value?.stringValue ||
        serviceAttr?.value?.string_value || 'unknown';

      const scopeMetrics = resourceMetric.scopeMetrics || resourceMetric.scope_metrics || [];
      for (const scopeMetric of scopeMetrics) {
        const metrics = scopeMetric.metrics || [];
        for (const metric of metrics) {
          const metricName = metric.name || 'unknown';

          if (metric.gauge) {
            for (const dp of metric.gauge.dataPoints || metric.gauge.data_points || []) {
              rows.push(buildDataPointRow(serviceName, metricName, 'gauge', dp));
            }
          } else if (metric.sum) {
            for (const dp of metric.sum.dataPoints || metric.sum.data_points || []) {
              rows.push(buildDataPointRow(serviceName, metricName, 'sum', dp));
            }
          } else if (metric.histogram) {
            for (const dp of metric.histogram.dataPoints || metric.histogram.data_points || []) {
              const timestampUnixNano = BigInt(dp.timeUnixNano || dp.time_unix_nano || 0);
              const attributes = dp.attributes || [];

              if (dp.sum != null) {
                rows.push({
                  serviceName,
                  metricName: metricNameFromDataPoint(metricName, 'sum'),
                  metricType: 'histogram',
                  timestampUnixNano,
                  value: Number(dp.sum),
                  attributes,
                });
              }
              const count = dp.count != null ? Number(dp.count) : undefined;
              if (count != null) {
                rows.push({
                  serviceName,
                  metricName: metricNameFromDataPoint(metricName, 'count'),
                  metricType: 'histogram',
                  timestampUnixNano,
                  value: count,
                  attributes,
                });
              }
              if (dp.min != null) {
                rows.push({
                  serviceName,
                  metricName: metricNameFromDataPoint(metricName, 'min'),
                  metricType: 'histogram',
                  timestampUnixNano,
                  value: Number(dp.min),
                  attributes,
                });
              }
              if (dp.max != null) {
                rows.push({
                  serviceName,
                  metricName: metricNameFromDataPoint(metricName, 'max'),
                  metricType: 'histogram',
                  timestampUnixNano,
                  value: Number(dp.max),
                  attributes,
                });
              }
            }
          }
        }
      }
    }

    return rows;
  } catch (error) {
    console.error('Failed to parse metrics message:', error.message);
    return [];
  }
}

function buildDataPointRow(serviceName, metricName, metricType, dp) {
  const value = dp.asDouble ?? dp.as_double ?? dp.asInt ?? dp.as_int ?? 0;
  return {
    serviceName,
    metricName,
    metricType,
    timestampUnixNano: BigInt(dp.timeUnixNano || dp.time_unix_nano || 0),
    value: Number(value),
    attributes: dp.attributes || [],
  };
}

/**
 * Parse OTLP JSON log message and flatten to individual log records.
 */
export function parseLogsMessage(buffer) {
  try {
    const decoded = JSON.parse(buffer.toString('utf8'));
    const rows = [];

    const resourceLogs = decoded.resourceLogs || decoded.resource_logs || [];
    for (const resourceLog of resourceLogs) {
      const resourceAttrs = resourceLog.resource?.attributes || [];
      const serviceAttr = resourceAttrs.find((a) => a.key === 'service.name');
      const serviceName = serviceAttr?.value?.stringValue ||
        serviceAttr?.value?.string_value || 'unknown';

      const scopeLogs = resourceLog.scopeLogs || resourceLog.scope_logs || [];
      for (const scopeLog of scopeLogs) {
        const logRecords = scopeLog.logRecords || scopeLog.log_records || [];
        for (const record of logRecords) {
          const body = record.body?.stringValue ?? record.body?.string_value ?? '';
          rows.push({
            serviceName,
            timestampUnixNano: BigInt(record.timeUnixNano || record.time_unix_nano || 0),
            severityText:   record.severityText   || record.severity_text   || '',
            severityNumber: record.severityNumber ?? record.severity_number ?? 0,
            body,
            traceId: record.traceId || record.trace_id || '',
            spanId:  record.spanId  || record.span_id  || '',
            attributes: record.attributes || [],
          });
        }
      }
    }

    return rows;
  } catch (error) {
    console.error('Failed to parse logs message:', error.message);
    return [];
  }
}
