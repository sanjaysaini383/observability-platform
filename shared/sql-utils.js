/**
 * Shared SQL escaping helper — the single source of truth used by every
 * service that hand-builds ClickHouse SQL (kafka-consumer, query-api,
 * trace-analyser). Kept dependency-free and pure so it can be copied into
 * any container image without pulling in extra npm packages.
 */
export function escSql(value) {
  if (typeof value !== 'string') return String(value);
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
