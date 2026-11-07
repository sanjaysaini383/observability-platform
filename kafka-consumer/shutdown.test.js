import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShutdown } from './shutdown.js';

function harness(overrides = {}) {
  const calls = [];
  const deps = {
    stopTimer: () => calls.push('stopTimer'),
    consumer: {
      stop: async () => { calls.push('stop'); },
      disconnect: async () => { calls.push('disconnect'); },
    },
    flush: async () => { calls.push('flush'); },
    exit: (code) => calls.push(`exit:${code}`),
    log: () => {},
    ...overrides,
  };
  return { calls, shutdown: createShutdown(deps) };
}

test('stops intake, flushes buffered data, then disconnects and exits 0', async () => {
  const { calls, shutdown } = harness();
  await shutdown('SIGTERM');
  assert.deepEqual(calls, ['stopTimer', 'stop', 'flush', 'disconnect', 'exit:0']);
});

test('a second signal while shutting down does nothing', async () => {
  const { calls, shutdown } = harness();
  await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
  assert.equal(calls.filter((c) => c === 'flush').length, 1);
  assert.equal(calls.filter((c) => c.startsWith('exit')).length, 1);
});

test('still disconnects and exits non-zero when the flush fails', async () => {
  const { calls, shutdown } = harness({
    flush: async () => { throw new Error('clickhouse down'); },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    await shutdown('SIGTERM');
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(calls, ['stopTimer', 'stop', 'disconnect', 'exit:1']);
});
