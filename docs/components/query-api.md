<div align="center">

# 🧩 Query API Component Deep Dive

### *Internal Architecture & Implementation Details*

[![Component](https://img.shields.io/badge/Component-Query%20API-4F46E5?style=for-the-badge&logo=node.js&logoColor=white)](.)
[![Express](https://img.shields.io/badge/Express.js-Framework-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Redis](https://img.shields.io/badge/Redis-Caching-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)

*Technical documentation of Query API internals*

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [File Structure](#-file-structure)
- [Core Modules](#-core-modules)
- [Caching Strategy](#-caching-strategy)
- [SQL Generation](#-sql-generation)
- [Error Handling](#-error-handling)
- [Configuration](#-configuration)
- [Performance Optimization](#-performance-optimization)
- [Security Considerations](#-security-considerations)
- [Testing](#-testing)
- [Extending the API](#-extending-the-api)

---

## 🎯 Overview

The Query API is a RESTful service that acts as the data access layer between the dashboard and ClickHouse. It provides abstraction over raw SQL queries, implements caching, and formats data for frontend consumption.

**Location:** `query-api/`  
**Port:** 4000  
**Language:** Node.js (ES Modules)  
**Framework:** Express.js  

---

## 🏗️ Architecture

```mermaid
graph LR
    A[Dashboard] --> B[Query API]
    B --> C{Cache Check}
    C -->|Hit| D[Redis]
    C -->|Miss| E[ClickHouse]
    D --> B
    E --> B
    B --> A
```

**Request Flow:**
1. Dashboard sends HTTP request
2. API validates/escapes parameters
3. Check Redis cache
4. If miss, query ClickHouse via HTTP
5. Cache result (if applicable)
6. Format and return JSON response

---

## 📁 File Structure

```
query-api/
├── index.js           # Main application, routes, server setup
├── helpers.js         # Re-exports escSql, resolveWindow
├── helpers.test.js    # Unit tests for helpers
├── package.json       # Dependencies
├── Dockerfile         # Container build
└── workers/
    ├── trace-analyser.js  # AI analysis worker
    └── Dockerfile        # Worker container

shared/
└── sql-utils.js       # Single source of truth for escSql()
```

---

## 🔧 Core Modules

### index.js

Main entry point containing:
- Server initialization
- Redis connection
- ClickHouse client
- Route definitions
- Caching logic

#### Server Setup
```javascript
import express from 'express';
import { createClient } from 'redis';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

const redis = createClient({ url: REDIS_URL });
await redis.connect();
```

> **Note:** Redis is required at startup. `await redis.connect()` runs at module top level, so `query-api` exits instead of starting if Redis is unavailable. There is no graceful fallback to ClickHouse in that state.

#### ClickHouse Query Function
```javascript
async function queryClickHouse(sql, format = 'JSON') {
  const query = `${sql.trim()} FORMAT ${format}`;
  const response = await axios.post(
    `${CLICKHOUSE_BASE}?formatdatetime_parsedatetime_m_is_month_name=0`,
    query,
    {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 10000,
    }
  );
  return response.data;
}
```

**Key Features:**
- POST body with SQL (ClickHouse 24.x compatible)
- Special parameter for date formatting
- 10 second timeout
- Returns parsed JSON

#### Cached Query Function
```javascript
async function cachedQuery(key, query, ttl = CACHE_TTL) {
  try {
    const cached = await redis.get(key);
    if (cached) {
      console.log(`✓ Cache hit: ${key}`);
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn('Redis get error:', err.message);
  }

  const result = await queryClickHouse(query);
  
  try {
    await redis.setEx(key, ttl, JSON.stringify(result));
  } catch (err) {
    console.warn('Redis set error:', err.message);
  }
  
  return result;
}
```

**Behavior:**
- Logs cache hits
- JSON serialization
- Per-route TTLs (the `CACHE_TTL` environment variable is parsed but not used by the cached routes)
- Does **not** degrade gracefully if Redis is unavailable: startup fails, and after a disconnect node-redis queues commands, so cached routes can hang instead of falling back to ClickHouse

### helpers.js

Utility functions for query building. The authoritative implementations live in [`shared/sql-utils.js`](../../shared/sql-utils.js) and [`query-api/helpers.js`](../../query-api/helpers.js); this page intentionally does not copy them so the docs cannot drift.

#### escSql(value)
Escapes backslashes first, then single quotes, for safe ClickHouse string literals. It stringifies non-string values. See [`shared/sql-utils.js`](../../shared/sql-utils.js).

**Usage:** `where += ` AND ServiceName = '${escSql(service)}'``

#### resolveWindow(window)
Converts a window string (`1h`, `6h`, `24h`, `7d`) to a ClickHouse interval and falls back to `1 HOUR` for unknown values. See [`query-api/helpers.js`](../../query-api/helpers.js).

---

## 💾 Caching Strategy

### Cache Keys
| Key Pattern | TTL | Purpose |
|:------------|:----|:---------|
| `trace:{traceId}` | 300s (5 min, hard-coded) | Individual trace details |
| `services:graph` | 30s (hard-coded) | Service dependency graph |

### Cache Behavior
- **Cache-Aside Pattern**: Check cache first, query on miss
- **TTL-based Expiration**: Automatic expiry
- **Fixed TTLs**: Both cached routes pass literal TTLs, so `CACHE_TTL` currently has no effect
- **Redis Required**: The API does not start if Redis is down, and queued commands can hang cached routes after a disconnect
- **JSON Serialization**: Store parsed ClickHouse results

### When to Cache
- Expensive aggregations (service graph self-join)
- Frequently accessed data (trace details)
- Relatively static data

### When NOT to Cache
- Real-time metrics (though we cache MV queries briefly)
- User-specific data
- Frequently changing data

---

## 🔨 SQL Generation

### Security: SQL Injection Prevention

All user inputs are escaped via `escSql()`:

```javascript
if (service) {
  where += ` AND ServiceName = '${escSql(service)}'`;
}

where += ` AND StartTime BETWEEN '${escSql(from)}' AND '${escSql(to)}'`;
```

**Note:** While this prevents basic injection, for production consider parameterized queries. ClickHouse HTTP interface with POST body is used; true parameterization support varies.

### Query Patterns

#### Distinct Traces
```sql
SELECT DISTINCT
  TraceId,
  ServiceName,
  OperationName,
  formatDateTime(StartTime, '%Y-%m-%d %H:%M:%S') as StartTimeStr,
  Duration / 1000000 as DurationMs,
  StatusCode
FROM traces
WHERE ${where}
ORDER BY StartTime DESC
LIMIT ${limit}
```

#### Trace Details
```sql
SELECT
  TraceId, SpanId, ParentSpanId, ServiceName, OperationName,
  toInt64(StartTime) as StartTimeNano,
  toInt64(EndTime) as EndTimeNano,
  Duration, Duration / 1000000 as DurationMs,
  StatusCode, StatusMessage, Attributes
FROM traces
WHERE TraceId = '${escSql(traceId)}'
ORDER BY StartTime ASC
```

#### Service Graph
```sql
SELECT
  source_service as source,
  target_service as target,
  call_count,
  avg_latency_ns,
  error_count
FROM service_dependencies
ORDER BY call_count DESC
```

#### Metrics
```sql
SELECT
  ServiceName,
  formatDateTime(Minute, '%Y-%m-%d %H:%M:%S') as MinuteStr,
  p50_ns / 1000000 as p50_ms,
  p95_ns / 1000000 as p95_ms,
  p99_ns / 1000000 as p99_ms,
  total_requests,
  error_count,
  error_rate_pct
FROM service_latency
WHERE ${where} AND Minute > now() - INTERVAL ${interval}
ORDER BY Minute ASC
```

---

## ⚠️ Error Handling

### ClickHouse Errors
```javascript
async function queryClickHouse(sql, format = 'JSON') {
  try {
    // ...
    return response.data;
  } catch (error) {
    console.error('ClickHouse query error:', error.message);
    throw error;
  }
}
```

Routes catch and return 503:
```javascript
} catch (error) {
  console.error('Error fetching traces:', error.message);
  res.status(503).json({ error: 'Failed to query traces', details: error.message });
}
```

### Redis Errors
The try/catch blocks only catch errors that surface; they do not provide graceful degradation. Because `await redis.connect()` runs at startup, the process will not start without Redis. After a disconnect, node-redis queues commands by default, so cached routes may hang rather than fall through to ClickHouse. Configure a connect timeout / disable the offline queue if you need fail-fast behavior.

### Validation
- Limit capped at 1000 for traces, 100 for error traces
- Parse integers safely
- Check for empty results

---

## ⚙️ Configuration

### Environment Variables
```bash
PORT=4000
CLICKHOUSE_URL=http://default:password@clickhouse:8123
REDIS_URL=redis://redis:6379
# Parsed but currently unused: cached routes pass hard-coded TTLs (300s / 30s).
CACHE_TTL=30
```

### Dependencies
See [`query-api/package.json`](../../query-api/package.json) for the authoritative dependency list and versions.

---

## 🚀 Performance Optimization

### Implemented
- **Redis Caching**: Reduces ClickHouse load
- **Materialized Views**: Pre-aggregated percentiles
- **Connection Pooling**: Axios reuses connections
- **Query Optimization**: Specific column selection
- **Timeouts**: Prevent hanging requests
- **Limit Constraints**: Prevent large result sets

### Recommendations
- Add response compression
- Implement pagination
- Add query result size limits
- Use ClickHouse query caching
- Add metrics for API performance
- Implement request logging

---

## 🔒 Security Considerations

### Current State
- CORS enabled for all origins
- SQL injection mitigated via escaping
- No authentication
- No rate limiting
- No input validation library

### Production Recommendations
- [ ] Add JWT/API key authentication
- [ ] Implement rate limiting (express-rate-limit)
- [ ] Restrict CORS to specific origins
- [ ] Add input validation (joi/zod)
- [ ] Use parameterized queries if possible
- [ ] Add request logging/audit trail
- [ ] Implement API versioning
- [ ] Add HTTPS/TLS
- [ ] Use security headers (helmet)

---

## 🧪 Testing

### Unit Tests
`helpers.test.js` tests utility functions. These expectations match the shared helper:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { escSql, resolveWindow } from './helpers.js';

test('escSql escapes single quotes and backslashes', () => {
  assert.strictEqual(escSql("O'Reilly"), "O\\'Reilly");
  assert.strictEqual(escSql('\\'), '\\\\');
});

test('escSql stringifies non-string values', () => {
  assert.strictEqual(escSql(42), '42');
  assert.strictEqual(escSql(null), 'null');
});

test('resolveWindow returns correct intervals', () => {
  assert.strictEqual(resolveWindow('1h'), '1 HOUR');
  assert.strictEqual(resolveWindow('6h'), '6 HOUR');
  assert.strictEqual(resolveWindow('24h'), '24 HOUR');
  assert.strictEqual(resolveWindow('7d'), '7 DAY');
});
```

### Running Tests
```bash
cd query-api
npm test
```

### Manual Testing
```bash
# Health check
curl http://localhost:4000/health

# Traces
curl http://localhost:4000/api/traces?limit=5

# Services
curl http://localhost:4000/api/services
```

---

## 🔌 Extending the API

### Adding a New Endpoint

1. **Define route** in `index.js`:
```javascript
app.get('/api/custom', async (req, res) => {
  try {
    const sql = `SELECT * FROM custom_table WHERE ...`;
    const result = await queryClickHouse(sql);
    res.json({ data: result.data || [] });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(503).json({ error: 'Failed to query' });
  }
});
```

2. **Add caching if needed**:
```javascript
const result = await cachedQuery('custom:key', sql, 60);
```

3. **Update API reference documentation**
4. **Test endpoint**
5. **Update dashboard if consumed**

### Adding a New Helper

1. Add to `helpers.js`:
```javascript
export function customHelper(param) {
  // logic
}
```

2. Add tests in `helpers.test.js`
3. Export and use

---

<div align="center">

**[← Back to API Reference](../api/query-api-reference.md)** | **[Architecture Guide →](../architecture.md)**

</div>
