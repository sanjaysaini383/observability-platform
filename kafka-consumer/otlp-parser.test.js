import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escSql,
  attributesToMapSql,
  parseTraceMessage,
  parseMetricsMessage,
  parseLogsMessage,
} from './otlp-parser.js';

test('escSql escapes backslashes and single quotes', () => {
  assert.equal(escSql("O'Brien"), "O\\'Brien");
  assert.equal(escSql('C:\\path'), 'C:\\\\path');
});

test('attributesToMapSql returns map() call for no attributes', () => {
  assert.equal(attributesToMapSql([]), 'map()');
  assert.equal(attributesToMapSql(undefined), 'map()');
  assert.equal(attributesToMapSql(null), 'map()');
});

test('attributesToMapSql builds a map() expression from OTLP attributes', () => {
  const attrs = [
    { key: 'http.method', value: { stringValue: 'GET' } },
    { key: 'http.status_code', value: { intValue: 200 } },
  ];
  assert.equal(
    attributesToMapSql(attrs),
    "map('http.method','GET','http.status_code','200')"
  );
});

test('attributesToMapSql escapes keys and values', () => {
  const attrs = [{ key: "weird'key", value: { stringValue: "O'Brien" } }];
  assert.equal(attributesToMapSql(attrs), "map('weird\\'key','O\\'Brien')");
});

function traceFixture({ attributes = [], resourceAttributes = [] } = {}) {
  return Buffer.from(
    JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'order-service' } },
              ...resourceAttributes,
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'trace-1',
                  spanId: 'span-1',
                  parentSpanId: '',
                  name: 'create_order',
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '2000000000',
                  status: { code: 0, message: '' },
                  attributes,
                },
              ],
            },
          ],
        },
      ],
    })
  );
}

test('parseTraceMessage flattens spans and carries attributes through', () => {
  const attrs = [{ key: 'order.id', value: { intValue: 42 } }];
  const spans = parseTraceMessage(traceFixture({ attributes: attrs }));

  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span.traceId, 'trace-1');
  assert.equal(span.serviceName, 'order-service');
  assert.equal(span.operationName, 'create_order');
  assert.equal(span.durationNano, 1000000000n);
  assert.deepEqual(span.attributes, attrs);
  assert.equal(span.resourceAttributes[0].key, 'service.name');
});

test('parseTraceMessage returns empty array on invalid JSON', () => {
  assert.deepEqual(parseTraceMessage(Buffer.from('not json')), []);
});

function metricsFixture() {
  return Buffer.from(
    JSON.stringify({
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'api-gateway' } }],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'process.heap.bytes',
                  gauge: { dataPoints: [{ timeUnixNano: '1000', asDouble: 123.4, attributes: [] }] },
                },
                {
                  name: 'http.requests',
                  sum: { dataPoints: [{ timeUnixNano: '1000', asInt: 5, attributes: [] }] },
                },
                {
                  name: 'http.server.duration',
                  histogram: {
                    dataPoints: [
                      { timeUnixNano: '1000', sum: 42.0, count: 3, min: 1.0, max: 20.0, attributes: [] },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    })
  );
}

test('parseMetricsMessage flattens gauge and sum data points', () => {
  const rows = parseMetricsMessage(metricsFixture());
  const gauge = rows.find((r) => r.metricName === 'process.heap.bytes');
  const sum = rows.find((r) => r.metricName === 'http.requests');

  assert.equal(gauge.metricType, 'gauge');
  assert.equal(gauge.value, 123.4);
  assert.equal(gauge.serviceName, 'api-gateway');

  assert.equal(sum.metricType, 'sum');
  assert.equal(sum.value, 5);
});

test('parseMetricsMessage expands histogram data points into sum/count/min/max rows', () => {
  const rows = parseMetricsMessage(metricsFixture());
  const histRows = rows.filter((r) => r.metricName.startsWith('http.server.duration'));
  const byName = Object.fromEntries(histRows.map((r) => [r.metricName, r.value]));

  assert.equal(byName['http.server.duration.sum'], 42);
  assert.equal(byName['http.server.duration.count'], 3);
  assert.equal(byName['http.server.duration.min'], 1);
  assert.equal(byName['http.server.duration.max'], 20);
});

test('parseMetricsMessage returns empty array on invalid JSON', () => {
  assert.deepEqual(parseMetricsMessage(Buffer.from('not json')), []);
});

function logsFixture() {
  return Buffer.from(
    JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'payment-service' } }],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: '5000',
                  severityText: 'ERROR',
                  severityNumber: 17,
                  body: { stringValue: 'Payment gateway timeout' },
                  traceId: 'trace-1',
                  spanId: 'span-1',
                  attributes: [{ key: 'error.type', value: { stringValue: 'Error' } }],
                },
              ],
            },
          ],
        },
      ],
    })
  );
}

test('parseLogsMessage flattens log records', () => {
  const rows = parseLogsMessage(logsFixture());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serviceName, 'payment-service');
  assert.equal(rows[0].severityText, 'ERROR');
  assert.equal(rows[0].body, 'Payment gateway timeout');
  assert.equal(rows[0].traceId, 'trace-1');
});

test('parseLogsMessage returns empty array on invalid JSON', () => {
  assert.deepEqual(parseLogsMessage(Buffer.from('not json')), []);
});
