/**
 * Pure helpers extracted from index.js so they're importable in tests
 * without connecting to Redis or starting the Express server.
 */

import { escSql } from '../shared/sql-utils.js';
export { escSql };

/**
 * Resolve time window string to ClickHouse interval expression
 */
export function resolveWindow(window) {
  const map = { '1h': '1 HOUR', '6h': '6 HOUR', '24h': '24 HOUR', '7d': '7 DAY' };
  return map[window] || '1 HOUR';
}
