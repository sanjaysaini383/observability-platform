import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from './analysis-prompt.js';

// ClickHouse groupArray tuples arrive as JSON arrays:
// [SpanId, ServiceName, OperationName, DurationMs, Status, StatusMessage]
const trace = {
  TraceId: 'tr-1',
  ServiceName: 'checkout',
  OperationName: 'POST /pay',
  StatusMessage: 'connection refused',
  spans: [
    ['sp-1', 'checkout', 'POST /pay', 42, 'OK', ''],
    ['sp-2', 'payments', 'chargeCard', 15, 'ERROR', 'upstream timeout'],
  ],
};

test('buildPrompt reads span tuple fields at their 0-based indexes', () => {
  const prompt = buildPrompt(trace);
  assert.match(prompt, /1\. \[checkout\] POST \/pay \| Duration: 42ms \| Status: OK\n/);
  assert.match(
    prompt,
    /2\. \[payments\] chargeCard \| Duration: 15ms \| Status: ERROR \| Error: upstream timeout/
  );
});

test('buildPrompt keeps the trace header fields', () => {
  const prompt = buildPrompt(trace);
  assert.match(prompt, /Trace ID: tr-1/);
  assert.match(prompt, /Service: checkout/);
  assert.match(prompt, /Operation: POST \/pay/);
  assert.match(prompt, /Error: connection refused/);
});

test('buildPrompt omits the error segment when a span has no status message', () => {
  const prompt = buildPrompt({ ...trace, spans: [trace.spans[0]] });
  assert.doesNotMatch(prompt, /\| Error:/);
});
