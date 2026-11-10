import express from 'express';
import axios from 'axios';
import { createClient } from 'redis';
import cors from 'cors';
import dotenv from 'dotenv';
import { escSql, resolveWindow } from './helpers.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '30', 10);

// Redis client — the cache is best-effort. Startup doesn't wait for Redis, and
// while it's down commands fail fast instead of queueing, so requests fall
// through to ClickHouse. Reconnects back off to one attempt every 5s.
const redis = createClient({
  url: REDIS_URL,
  disableOfflineQueue: true,
  socket: { reconnectStrategy: (retries) => Math.min(retries * 500, 5000) },
});
redis.on('error', (err) => console.log('Redis Client Error', err.message));
redis.on('ready', () => console.log('✓ Redis connected'));
redis.connect().catch((err) => console.warn('Redis connect failed:', err.message));

// Middleware
app.use(express.json());
app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'query-api' });
});

/**
 * Helper: Execute ClickHouse query
 */
// Ensure CLICKHOUSE_URL always ends with '/' so the HTTP interface works correctly
const CLICKHOUSE_BASE = CLICKHOUSE_URL.endsWith('/') ? CLICKHOUSE_URL : `${CLICKHOUSE_URL}/`;

async function queryClickHouse(sql, format = 'JSON') {
  try {
    // POST the SQL as request body with FORMAT appended — works on all ClickHouse versions.
    // The ?format= URL parameter was removed in ClickHouse 24.x.
    // formatdatetime_parsedatetime_m_is_month_name=0 keeps %M meaning "minute" in
    // formatDateTime(); without it, this ClickHouse build renders %M as the full
    // month name (e.g. "22:July:14" instead of "22:07:14").
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
  } catch (error) {
    console.error('ClickHouse query error:', error.message);
    throw error;
  }
}

/**
 * Helper: Get from cache or execute query
 */
async function cachedQuery(key, query, ttl = CACHE_TTL) {
  if (redis.isReady) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        console.log(`✓ Cache hit: ${key}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('Redis get error:', err.message);
    }
  }

  try {
    const result = await queryClickHouse(query);
    if (redis.isReady) {
      try {
        await redis.setEx(key, ttl, JSON.stringify(result));
      } catch (err) {
        console.warn('Redis set error:', err.message);
      }
    }
    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * GET /api/traces
 * List recent traces with filtering
 */
app.get('/api/traces', async (req, res) => {
  try {
    const { service, status, from, to, limit = 100 } = req.query;

    let where = '1=1';

    if (service) {
      where += ` AND ServiceName = '${escSql(service)}'`;
    }

    if (status === 'ok') {
      // Show all spans that did NOT result in an error (UNSET=0 or OK=1)
      where += ` AND StatusCode != 2`;
    } else if (status === 'error') {
      where += ` AND StatusCode = 2`;
    }

    if (from && to) {
      where += ` AND StartTime BETWEEN '${escSql(from)}' AND '${escSql(to)}'`;
    }

    const sql = `
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
      LIMIT ${Math.min(parseInt(limit) || 100, 1000)}
    `;

    const result = await queryClickHouse(sql);
    res.json({
      traces: result.data || [],
      count: (result.data || []).length,
    });
  } catch (error) {
    console.error('Error fetching traces:', error.message);
    res.status(503).json({ error: 'Failed to query traces', details: error.message });
  }
});

/**
 * GET /api/traces/:traceId
 * Fetch full trace tree (all spans for a trace)
 */
app.get('/api/traces/:traceId', async (req, res) => {
  try {
    const { traceId } = req.params;

    const cacheKey = `trace:${traceId}`;
    const result = await cachedQuery(
      cacheKey,
      `
        SELECT
          TraceId,
          SpanId,
          ParentSpanId,
          ServiceName,
          OperationName,
          toInt64(StartTime) as StartTimeNano,
          toInt64(EndTime) as EndTimeNano,
          Duration,
          Duration / 1000000 as DurationMs,
          StatusCode,
          StatusMessage,
          Attributes
        FROM traces
        WHERE TraceId = '${escSql(traceId)}'
        ORDER BY StartTime ASC
      `,
      300 // Cache trace details for 5 minutes
    );

    if (!result.data || result.data.length === 0) {
      return res.status(404).json({ error: 'Trace not found' });
    }

    // Return flat list — frontend flattens for waterfall rendering
    res.json({
      traceId,
      spanCount: result.data.length,
      spans: result.data,
    });
  } catch (error) {
    console.error('Error fetching trace:', error.message);
    res.status(503).json({ error: 'Failed to query trace', details: error.message });
  }
});

/**
 * GET /api/services
 * Service dependency graph (cached, 30s TTL)
 */
app.get('/api/services', async (req, res) => {
  try {
    const result = await cachedQuery(
      'services:graph',
      `
        SELECT
          source_service as source,
          target_service as target,
          call_count,
          avg_latency_ns,
          error_count
        FROM service_dependencies
        ORDER BY call_count DESC
      `,
      30 // Cache service map for 30 seconds
    );

    const nodes = new Set();
    const edges = [];

    if (result.data) {
      for (const dep of result.data) {
        nodes.add(dep.source);
        nodes.add(dep.target);
        edges.push({
          source: dep.source,
          target: dep.target,
          callCount: dep.call_count,
          avgLatencyMs: (dep.avg_latency_ns || 0) / 1000000,
          errorCount: dep.error_count || 0,
        });
      }
    }

    res.json({
      nodes: Array.from(nodes).map((name) => ({ id: name, label: name })),
      edges,
    });
  } catch (error) {
    console.error('Error fetching service map:', error.message);
    res.status(503).json({ error: 'Failed to query service map', details: error.message });
  }
});

/**
 * GET /api/metrics
 * Latency and error rate per service
 */
app.get('/api/metrics', async (req, res) => {
  try {
    const { service, window = '1h' } = req.query;
    const interval = resolveWindow(window);

    let where = '1=1';
    if (service) {
      where += ` AND ServiceName = '${escSql(service)}'`;
    }

    const sql = `
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
    `;

    const result = await queryClickHouse(sql);
    res.json({
      metrics: result.data || [],
      count: (result.data || []).length,
    });
  } catch (error) {
    console.error('Error fetching metrics:', error.message);
    res.status(503).json({ error: 'Failed to query metrics', details: error.message });
  }
});

/**
 * GET /api/alerts
 * Active anomalies (high error rate or latency > 500ms)
 */
app.get('/api/alerts', async (req, res) => {
  try {
    const sql = `
      SELECT
        ServiceName,
        formatDateTime(Minute, '%Y-%m-%d %H:%M:%S') as MinuteStr,
        p99_ns / 1000000 as p99_ms,
        total_requests,
        error_count,
        error_rate_pct,
        if(error_rate_pct > 10, 'critical', if(error_rate_pct > 5, 'high', 'medium')) as severity
      FROM service_latency
      WHERE Minute > now() - INTERVAL 1 HOUR
        AND (error_rate_pct > 5 OR p99_ns > 500000000)
      ORDER BY Minute DESC
      LIMIT 20
    `;

    const result = await queryClickHouse(sql);
    res.json({
      alerts: result.data || [],
      count: (result.data || []).length,
    });
  } catch (error) {
    console.error('Error fetching alerts:', error.message);
    res.status(503).json({ error: 'Failed to query alerts', details: error.message });
  }
});

/**
 * GET /api/insights
 * Fetch 10 most recent LLM-generated root cause insights (for AI sidebar)
 */
app.get('/api/insights', async (req, res) => {
  try {
    const sql = `
      SELECT
        TraceId,
        ServiceName,
        OperationName,
        RootCause,
        ImpactedSpans,
        Recommendation,
        Severity,
        formatDateTime(AnalysedAt, '%Y-%m-%d %H:%M:%S') as AnalysedAt
      FROM trace_insights
      ORDER BY AnalysedAt DESC
      LIMIT 10
    `;

    const result = await queryClickHouse(sql);
    res.json({
      insights: result.data || [],
      count: (result.data || []).length,
    });
  } catch (error) {
    console.error('Error fetching insights:', error.message);
    res.status(503).json({ error: 'Failed to query insights', details: error.message });
  }
});

/**
 * GET /api/insights/:traceId
 * Fetch LLM-generated root cause analysis for a specific trace
 */
app.get('/api/insights/:traceId', async (req, res) => {
  try {
    const { traceId } = req.params;

    const sql = `
      SELECT
        TraceId,
        ServiceName,
        OperationName,
        RootCause,
        ImpactedSpans,
        Recommendation,
        Severity,
        formatDateTime(AnalysedAt, '%Y-%m-%d %H:%M:%S') as AnalysedAt
      FROM trace_insights
      WHERE TraceId = '${escSql(traceId)}'
      LIMIT 1
    `;

    const result = await queryClickHouse(sql);

    if (!result.data || result.data.length === 0) {
      return res.status(404).json({ error: 'No insights found for this trace' });
    }

    res.json({
      insight: result.data[0],
    });
  } catch (error) {
    console.error('Error fetching insights:', error.message);
    res.status(503).json({ error: 'Failed to query insights', details: error.message });
  }
});

/**
 * GET /api/error-traces
 * List recent error traces
 */
app.get('/api/error-traces', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const sql = `
      SELECT
        TraceId,
        ServiceName,
        OperationName,
        formatDateTime(StartTime, '%Y-%m-%d %H:%M:%S') as StartTimeStr,
        Duration / 1000000 as DurationMs,
        StatusMessage,
        services_with_errors
      FROM error_traces
      LIMIT ${Math.min(parseInt(limit) || 50, 100)}
    `;

    const result = await queryClickHouse(sql);
    res.json({
      errorTraces: result.data || [],
      count: (result.data || []).length,
    });
  } catch (error) {
    console.error('Error fetching error traces:', error.message);
    res.status(503).json({ error: 'Failed to query error traces', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Query API running on http://localhost:${port}`);
  console.log(`📊 ClickHouse: ${CLICKHOUSE_URL}`);
  console.log(`💾 Redis: ${REDIS_URL}`);
});
