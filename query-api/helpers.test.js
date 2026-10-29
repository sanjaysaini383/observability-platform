import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escSql, resolveWindow } from './helpers.js';

test('escSql escapes backslashes and single quotes', () => {
  assert.equal(escSql("O'Brien"), "O\\'Brien");
  assert.equal(escSql('C:\\path'), 'C:\\\\path');
  assert.equal(escSql("back\\'both"), "back\\\\\\'both");
});

test('escSql stringifies non-string values', () => {
  assert.equal(escSql(42), '42');
  assert.equal(escSql(null), 'null');
  assert.equal(escSql(undefined), 'undefined');
});

test('resolveWindow maps known windows to ClickHouse intervals', () => {
  assert.equal(resolveWindow('1h'), '1 HOUR');
  assert.equal(resolveWindow('6h'), '6 HOUR');
  assert.equal(resolveWindow('24h'), '24 HOUR');
  assert.equal(resolveWindow('7d'), '7 DAY');
});

test('resolveWindow defaults to 1 HOUR for unknown input', () => {
  assert.equal(resolveWindow('30d'), '1 HOUR');
  assert.equal(resolveWindow(undefined), '1 HOUR');
  assert.equal(resolveWindow(''), '1 HOUR');
});
