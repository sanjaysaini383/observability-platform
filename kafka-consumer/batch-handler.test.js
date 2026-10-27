import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatchHandler } from './batch-handler.js';

// Each message value is the number of rows its parser should return.
function makeBatch(topic, rowCounts) {
  return {
    topic,
    messages: rowCounts.map((n, i) => ({ offset: String(i), value: Buffer.from(String(n)) })),
  };
}

function parseCount(value) {
  return Array.from({ length: Number(value.toString()) }, () => ({}));
}

// Fake kafkajs eachBatch payload that records what the handler did.
function makePayload(batch, { runningFor = Infinity } = {}) {
  const calls = { resolved: [], heartbeats: 0, commits: 0 };
  let checks = 0;
  return {
    calls,
    payload: {
      batch,
      resolveOffset: (offset) => calls.resolved.push(offset),
      heartbeat: async () => { calls.heartbeats++; },
      isRunning: () => checks++ < runningFor,
      isStale: () => false,
      commitOffsetsIfNecessary: async () => { calls.commits++; },
    },
  };
}

function recordingInsert() {
  const inserts = [];
  const insert = async (rows) => { inserts.push(rows.length); };
  return { inserts, insert };
}

test('inserts all rows and resolves the last offset', async () => {
  const { inserts, insert } = recordingInsert();
  const handler = createBatchHandler({ batchSize: 100, handlers: { t: { parse: parseCount, insert } } });
  const { calls, payload } = makePayload(makeBatch('t', [1, 2, 3]));

  await handler(payload);

  assert.deepEqual(inserts, [6]);
  assert.deepEqual(calls.resolved, ['2']);
  assert.equal(calls.commits, 1);
});

test('inserts whenever batchSize rows are pending and resolves after each insert', async () => {
  const { inserts, insert } = recordingInsert();
  const handler = createBatchHandler({ batchSize: 2, handlers: { t: { parse: parseCount, insert } } });
  const { calls, payload } = makePayload(makeBatch('t', [1, 1, 1, 1, 1]));

  await handler(payload);

  assert.deepEqual(inserts, [2, 2, 1]);
  assert.deepEqual(calls.resolved, ['1', '3', '4']);
  assert.equal(calls.heartbeats, 2);
});

test('does not resolve offsets past a failed insert', async () => {
  let call = 0;
  const insert = async () => {
    if (++call === 2) throw new Error('ClickHouse unavailable');
  };
  const handler = createBatchHandler({ batchSize: 2, handlers: { t: { parse: parseCount, insert } } });
  const { calls, payload } = makePayload(makeBatch('t', [1, 1, 1, 1, 1]));

  await assert.rejects(handler(payload), /ClickHouse unavailable/);

  assert.deepEqual(calls.resolved, ['1']);
  assert.equal(calls.commits, 0);
});

test('resolves messages that parse to no rows without inserting', async () => {
  const { inserts, insert } = recordingInsert();
  const handler = createBatchHandler({ batchSize: 100, handlers: { t: { parse: parseCount, insert } } });
  const { calls, payload } = makePayload(makeBatch('t', [0, 0]));

  await handler(payload);

  assert.deepEqual(inserts, []);
  assert.deepEqual(calls.resolved, ['1']);
});

test('leaves pending messages unresolved when the consumer stops mid-batch', async () => {
  const { inserts, insert } = recordingInsert();
  const handler = createBatchHandler({ batchSize: 100, handlers: { t: { parse: parseCount, insert } } });
  const { calls, payload } = makePayload(makeBatch('t', [1, 1, 1]), { runningFor: 2 });

  await handler(payload);

  assert.deepEqual(inserts, []);
  assert.deepEqual(calls.resolved, []);
});

test('routes each batch to its topic handler', async () => {
  const traces = recordingInsert();
  const logs = recordingInsert();
  const handler = createBatchHandler({
    batchSize: 100,
    handlers: {
      'otel.traces': { parse: parseCount, insert: traces.insert },
      'otel.logs': { parse: parseCount, insert: logs.insert },
    },
  });

  await handler(makePayload(makeBatch('otel.logs', [4])).payload);

  assert.deepEqual(traces.inserts, []);
  assert.deepEqual(logs.inserts, [4]);
});
