<div align="center">

# 📡 API Reference Documentation

### *Complete REST API Specification for Query API*

[![API](https://img.shields.io/badge/API-REST%20v1.0-06B6D4?style=for-the-badge&logo=swagger&logoColor=white)](.)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0%20Compliant-85EA2D?style=for-the-badge&logo=openapiinitiative&logoColor=black)](.)

*Comprehensive documentation of all endpoints, request/response schemas, and usage examples*

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Base URL](#-base-url)
- [Authentication](#-authentication)
- [Response Format](#-response-format)
- [Error Handling](#-error-handling)
- [Endpoints](#-endpoints)
- [Rate Limiting](#-rate-limiting)
- [Examples](#-examples)
- [SDK Usage](#-sdk-usage)

---

## 🎯 Overview

The Query API serves as the data access layer for TraceLens, providing RESTful endpoints to query traces, metrics, service dependencies, and AI-generated insights from ClickHouse and Redis.

**Service Details:**
- **Port:** 4000
- **Framework:** Express.js
- **Data Sources:** ClickHouse (primary), Redis (cache)
- **Caching:** Redis with per-route TTLs (5 min trace detail, 30s service graph)

---

## 🌐 Base URL

```
http://localhost:4000
```

For production deployments, replace with your domain.

---

## 🔐 Authentication

**Current State:** No authentication required (development/demo mode)

> ⚠️ **Production Warning:** Add authentication before exposing to public networks. See [Security Guide](../security/security-hardening.md).

---

## 📦 Response Format

All responses are JSON with standard HTTP status codes.

### Success Response
```json
{
  "data": [...],
  "count": 10
}
```

### Error Response
```json
{
  "error": "Error message",
  "details": "Additional details"
}
```

---

## ⚠️ Error Handling

| Status Code | Meaning | Description |
|:------------|:---------|:-------------|
| `200` | OK | Request successful |
| `404` | Not Found | Resource not found |
| `503` | Service Unavailable | Database/cache query failed |
| `500` | Internal Server Error | Unexpected server error |

---

## 🛣️ Endpoints

### Health Check

#### `GET /health`
Check API health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "query-api"
}
```

---

### Traces

#### `GET /api/traces`
List recent traces with optional filtering.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|:-----------|:------|:---------|:---------|:-------------|
| `service` | string | No | - | Filter by service name |
| `status` | string | No | - | Filter by status: `ok` or `error` |
| `from` | string | No* | - | Start time, `YYYY-MM-DD HH:MM:SS` (UTC) |
| `to` | string | No* | - | End time, `YYYY-MM-DD HH:MM:SS` (UTC) |
| `limit` | integer | No | 100 | Max results (max 1000) |

> **Both `from` and `to` are required together.** They are only applied when both are present. The values are compared as raw strings against `DateTime64`, so use UTC in `YYYY-MM-DD HH:MM:SS` form. ISO-8601 values such as `2026-10-28T10:00:00.000Z` (what `toISOString()` returns) can fail to parse and cause a `503`.

**Response:**
```json
{
  "traces": [
    {
      "TraceId": "a1b2c3d4e5f6...",
      "ServiceName": "api-gateway",
      "OperationName": "POST /checkout",
      "StartTimeStr": "2026-10-28 10:30:45",
      "DurationMs": 1234.56,
      "StatusCode": 1
    }
  ],
  "count": 50
}
```

**Example:**
```bash
curl "http://localhost:4000/api/traces?service=payment-service&status=error&limit=10"
```

#### `GET /api/traces/:traceId`
Get full trace tree with all spans for a specific trace.

**Path Parameters:**

| Parameter | Type | Required | Description |
|:-----------|:------|:---------|:-------------|
| `traceId` | string | Yes | Trace identifier |

**Response:**
```json
{
  "traceId": "a1b2c3d4e5f6...",
  "spanCount": 15,
  "spans": [
    {
      "TraceId": "a1b2c3d4e5f6...",
      "SpanId": "123456...",
      "ParentSpanId": "",
      "ServiceName": "api-gateway",
      "OperationName": "POST /checkout",
      "StartTimeNano": 1698496245000000000,
      "EndTimeNano": 1698496246234560000,
      "Duration": 1234560000,
      "DurationMs": 1234.56,
      "StatusCode": 1,
      "StatusMessage": "",
      "Attributes": {"http.method": "POST", "http.url": "/checkout"}
    }
  ]
}
```

**Caching:** 5 minutes TTL

**Example:**
```bash
curl "http://localhost:4000/api/traces/a1b2c3d4e5f6..."
```

---

### Services

#### `GET /api/services`
Get service dependency graph.

**Response:**
```json
{
  "nodes": [
    {"id": "api-gateway", "label": "api-gateway"},
    {"id": "order-service", "label": "order-service"},
    {"id": "payment-service", "label": "payment-service"}
  ],
  "edges": [
    {
      "source": "api-gateway",
      "target": "order-service",
      "callCount": 150,
      "avgLatencyMs": 45.2,
      "errorCount": 3
    }
  ]
}
```

**Caching:** 30 seconds TTL  
**Time Window:** Last 1 hour

**Example:**
```bash
curl "http://localhost:4000/api/services"
```

---

### Metrics

#### `GET /api/metrics`
Get latency and error rate metrics per service.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|:-----------|:------|:---------|:---------|:-------------|
| `service` | string | No | - | Filter by service name |
| `window` | string | No | `1h` | Time window: `1h`, `6h`, `24h`, `7d` (unknown values fall back to `1h`) |

**Response:**
```json
{
  "metrics": [
    {
      "ServiceName": "api-gateway",
      "MinuteStr": "2026-10-28 10:30:00",
      "p50_ms": 45.2,
      "p95_ms": 123.4,
      "p99_ms": 245.6,
      "total_requests": 150,
      "error_count": 3,
      "error_rate_pct": 2.0
    }
  ],
  "count": 60
}
```

**Data Source:** `service_latency` view (over `service_latency_mv`); latency columns are nanoseconds in the view and converted to milliseconds by the API

**Example:**
```bash
curl "http://localhost:4000/api/metrics?service=api-gateway&window=6h"
```

---

### Alerts

#### `GET /api/alerts`
Get active anomalies (high error rate or latency).

**Response:**
```json
{
  "alerts": [
    {
      "ServiceName": "payment-service",
      "MinuteStr": "2026-10-28 10:30:00",
      "p99_ms": 5234.5,
      "total_requests": 45,
      "error_count": 12,
      "error_rate_pct": 26.7,
      "severity": "critical"
    }
  ],
  "count": 5
}
```

**Alert Criteria:**
- Error rate > 5% OR P99 latency > 500ms
- Time window: Last 1 hour
- Severity: `critical` (>10% error), `high` (>5% and ≤10% error), `medium` (≤5% error, e.g. the latency-only case where P99 > 500ms but error rate is ≤5%)

**Example:**
```bash
curl "http://localhost:4000/api/alerts"
```

---

### AI Insights

#### `GET /api/insights`
Get most recent LLM-generated root cause analyses.

**Response:**
```json
{
  "insights": [
    {
      "TraceId": "a1b2c3d4e5f6...",
      "ServiceName": "payment-service",
      "OperationName": "POST /pay",
      "RootCause": "Payment service timed out calling external payment gateway",
      "ImpactedSpans": ["payment-service", "api-gateway"],
      "Recommendation": "Implement circuit breaker with timeout",
      "Severity": "high",
      "AnalysedAt": "2026-10-28 10:35:22"
    }
  ],
  "count": 10
}
```

**Limit:** 10 most recent

**Example:**
```bash
curl "http://localhost:4000/api/insights"
```

#### `GET /api/insights/:traceId`
Get AI analysis for a specific trace.

**Path Parameters:**

| Parameter | Type | Required | Description |
|:-----------|:------|:---------|:-------------|
| `traceId` | string | Yes | Trace identifier |

**Response:**
```json
{
  "insight": {
    "TraceId": "a1b2c3d4e5f6...",
    "ServiceName": "payment-service",
    "OperationName": "POST /pay",
    "RootCause": "Payment service timed out calling external payment gateway",
    "ImpactedSpans": ["payment-service", "api-gateway"],
    "Recommendation": "Implement circuit breaker with timeout",
    "Severity": "high",
    "AnalysedAt": "2026-10-28 10:35:22"
  }
}
```

**404 if not found**

**Example:**
```bash
curl "http://localhost:4000/api/insights/a1b2c3d4e5f6..."
```

---

### Error Traces

#### `GET /api/error-traces`
List recent error traces.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|:-----------|:------|:---------|:---------|:-------------|
| `limit` | integer | No | 50 | Max results (max 100) |

**Response:**
```json
{
  "errorTraces": [
    {
      "TraceId": "a1b2c3d4e5f6...",
      "ServiceName": "payment-service",
      "OperationName": "POST /pay",
      "StartTimeStr": "2026-10-28 10:30:45",
      "DurationMs": 5001.2,
      "StatusMessage": "Gateway timeout",
      "services_with_errors": ["payment-service"]
    }
  ],
  "count": 25
}
```

**Data Source:** `error_traces` view

**Example:**
```bash
curl "http://localhost:4000/api/error-traces?limit=20"
```

---

## 🚦 Rate Limiting

**Current:** No rate limiting implemented

> ⚠️ **Production:** Implement rate limiting before public exposure.

---

## 💡 Examples

### Get traces for last hour errors
```bash
curl "http://localhost:4000/api/traces?status=error&limit=50"
```

### Investigate a failed trace
```bash
# Get trace details
curl "http://localhost:4000/api/traces/ABC123..."

# Get AI analysis
curl "http://localhost:4000/api/insights/ABC123..."
```

### Monitor service health
```bash
# Get metrics
curl "http://localhost:4000/api/metrics?window=1h"

# Get alerts
curl "http://localhost:4000/api/alerts"
```

### View service dependencies
```bash
curl "http://localhost:4000/api/services" | jq '.'
```

---

## 🔧 SDK Usage

### JavaScript/Node.js
```javascript
const API_BASE = 'http://localhost:4000';

async function getTraces(filters = {}) {
  const params = new URLSearchParams(filters);
  const res = await fetch(`${API_BASE}/api/traces?${params}`);
  return res.json();
}

async function getTraceDetails(traceId) {
  const res = await fetch(`${API_BASE}/api/traces/${traceId}`);
  return res.json();
}

// Usage
const { traces } = await getTraces({ status: 'error', limit: 10 });
const trace = await getTraceDetails(traces[0].TraceId);
```

### Python
```python
import requests

API_BASE = 'http://localhost:4000'

def get_traces(status=None, limit=100):
    params = {'status': status, 'limit': limit}
    response = requests.get(f'{API_BASE}/api/traces', params=params)
    return response.json()

# Usage
traces = get_traces(status='error', limit=10)
```

---

<div align="center">

**[← Back to Docs Index](../../README.md)** | **[Components Guide →](../components/query-api.md)**

</div>
