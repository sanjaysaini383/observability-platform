<div align="center">

# ⚙️ Configuration Guide

### *Complete Reference for TraceLens Configuration*

[![Config](https://img.shields.io/badge/Configuration-Environment%20%2B%20Files-6366F1?style=for-the-badge&logo=gear&logoColor=white)](.)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-Collector%20Config-425CC7?style=for-the-badge&logo=opentelemetry&logoColor=white)](https://opentelemetry.io/)
[![Docker](https://img.shields.io/badge/Docker%20Compose-Orchestration-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)

*Detailed configuration options for all components*

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Environment Variables](#-environment-variables)
- [Docker Compose Configuration](#-docker-compose-configuration)
- [OpenTelemetry Collector Configuration](#-opentelemetry-collector-configuration)
- [ClickHouse Configuration](#-clickhouse-configuration)
- [Kafka Configuration](#-kafka-configuration)
- [Service-Specific Configuration](#-service-specific-configuration)
- [AI/LLM Configuration](#-aillm-configuration)
- [Dashboard Configuration](#-dashboard-configuration)
- [Advanced Tuning](#-advanced-tuning)
- [Configuration Best Practices](#-configuration-best-practices)

---

## 🎯 Overview

TraceLens uses a layered configuration approach:
- **Environment Variables** (`.env`) - Secrets and environment-specific settings
- **Docker Compose** (`infra/docker-compose.yml`) - Service orchestration and networking
- **Component Configs** - Service-specific YAML/JS configurations
- **Application Defaults** - Hardcoded fallbacks in code

---

## 🌍 Environment Variables

### Core Environment File

Location: `infra/.env` (copy from `infra/.env.example`)

```env
# AI/LLM Configuration
GROQ_API_KEY=your_groq_api_key_here

# Payment Gateway (Optional - simulates if empty)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# Email Service (Optional - simulates if empty)
SMTP_USER=
SMTP_PASS=
```

### Service Environment Variables

#### API Gateway
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `SERVICE_NAME` | `api-gateway` | Service identifier for tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | Collector endpoint |
| `PORT` | `3000` | Service listening port |
| `ORDER_SERVICE_URL` | `http://order-service:5000` | Order service endpoint |
| `PAYMENT_SERVICE_URL` | `http://payment-service:3001` | Payment service endpoint |
| `INVENTORY_SERVICE_URL` | `http://inventory-service:5001` | Inventory service endpoint |
| `NOTIFICATION_SERVICE_URL` | `http://notification-service:5002` | Notification service endpoint |

#### Order Service
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `SERVICE_NAME` | `order-service` | Service identifier |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | Collector endpoint |
| `PORT` | `5000` | Service port |
| `ORDER_DB_URL` | `postgresql://default:password@postgres:5432/orders` | PostgreSQL connection string |
| `INVENTORY_SERVICE_URL` | `http://inventory-service:5001` | Inventory service URL |

#### Payment Service
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `SERVICE_NAME` | `payment-service` | Service identifier |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | Collector endpoint |
| `PORT` | `3001` | Service port |
| `RAZORPAY_KEY_ID` | `rzp_test_dummy` | Razorpay API key (dummy if not set) |
| `RAZORPAY_KEY_SECRET` | `dummy` | Razorpay secret (dummy if not set) |

#### Inventory Service
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `SERVICE_NAME` | `inventory-service` | Service identifier |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | Collector endpoint |
| `PORT` | `5001` | Service port |
| `INVENTORY_DB_URL` | `postgresql://default:password@postgres:5432/orders` | PostgreSQL connection string |

#### Notification Service
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `SERVICE_NAME` | `notification-service` | Service identifier |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | Collector endpoint |
| `PORT` | `5002` | Service port |
| `SMTP_USER` | `dummy@gmail.com` | SMTP username (dummy if not set) |
| `SMTP_PASS` | `dummy` | SMTP password (dummy if not set) |

#### Kafka Consumer
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `KAFKA_BROKERS` | `kafka:9092` | Kafka broker addresses (comma-separated) |
| `CLICKHOUSE_URL` | `http://default:password@clickhouse:8123` | ClickHouse HTTP endpoint (includes credentials) |
| `BATCH_SIZE` | `100` | Messages per batch before insert |
| `FLUSH_INTERVAL` | `5000` | Flush interval in milliseconds |

#### Query API
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `PORT` | `4000` | API listening port |
| `CLICKHOUSE_URL` | `http://default:password@clickhouse:8123` | ClickHouse endpoint (includes credentials) |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `CACHE_TTL` | `30` | Parsed but unused; cached routes pass hard-coded TTLs (300s trace detail, 30s service graph) |

#### Trace Analyzer
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `CLICKHOUSE_URL` | `http://default:password@clickhouse:8123` | ClickHouse endpoint (includes credentials) |
| `LLM_PROVIDER` | `groq` | Provider: `groq`, `ollama`, or `mock` |
| `GROQ_API_KEY` | (from .env) | Groq API key |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | Groq model name |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama endpoint |
| `MODEL` | `tinyllama` | Ollama model name |
| `ANALYSIS_INTERVAL` | `60000` | Polling interval in ms (60s) |
| `ANALYSIS_MAX_ATTEMPTS` | `3` | Max retry attempts before giving up |

#### Dashboard
| Variable | Default | Description |
|:-----------|:---------|:-------------|
| `VITE_API_URL` | `http://localhost:4000` | Query API URL for frontend |

---

## 🐳 Docker Compose Configuration

### Network Configuration

```yaml
networks:
  observability:
    driver: bridge
```

All services communicate on the `observability` bridge network. Internal DNS resolution allows service-to-service communication by service name.

### Volume Configuration

```yaml
volumes:
  clickhouse_data:
```

Persists ClickHouse data across container restarts. PostgreSQL has **no named volume** in the current compose file: orders/inventory data lives in the container writable layer and is deleted by `docker compose down`. Use `docker compose stop` for restarts, and add a named volume before relying on this for production.

### Health Checks

Critical services have health checks to ensure proper startup order:

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget --spider -q http://localhost:3000/health"]
  interval: 10s
  timeout: 5s
  retries: 5
```

Services with dependencies wait for healthy state:
```yaml
depends_on:
  postgres:
    condition: service_healthy
```

### Resource Considerations

For production-like local runs, ensure Docker has sufficient resources:
- **Memory**: 8 GB minimum recommended
- **CPUs**: 4 cores minimum recommended
- **Swap**: Enabled if needed

---

## 📡 OpenTelemetry Collector Configuration

Location: `collector/otelcol-config.yaml`

### Receivers
```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
```

### Processors
```yaml
processors:
  memory_limiter:
    check_interval: 5s
    limit_mib: 256      # Hard limit
    spike_limit_mib: 128 # Spike allowance
  batch:
    timeout: 5s
    send_batch_size: 1000
  resource:
    attributes:
      - key: service.namespace
        value: observability-platform
        action: insert
```

**Tuning Recommendations:**
- Increase `limit_mib` for high-throughput environments
- Adjust `send_batch_size` based on network conditions
- Reduce `timeout` for lower latency

### Exporters
```yaml
exporters:
  kafka/traces:
    brokers:
      - kafka:9092
    topic: otel.traces
    encoding: otlp_json
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 300s
```

### Pipelines
```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch, resource]
      exporters: [kafka/traces, logging]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch, resource]
      exporters: [kafka/metrics, logging]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch, resource]
      exporters: [kafka/logs, logging]
```

---

## 🗄️ ClickHouse Configuration

Location: `infra/clickhouse/init.sql`

### Table Configurations

#### Traces Table
```sql
CREATE TABLE traces (
  TraceId        String,
  SpanId         String,
  ParentSpanId   String,
  ServiceName    LowCardinality(String),
  OperationName  String,
  StartTime      DateTime64(9, 'UTC'),
  EndTime        DateTime64(9, 'UTC'),
  Duration       UInt64,  -- nanoseconds
  StatusCode     UInt8,   -- 0=unset, 1=ok, 2=error
  StatusMessage  String,
  Attributes     Map(String, String),
  ResourceAttributes Map(String, String)
) ENGINE = MergeTree()
ORDER BY (ServiceName, StartTime)
PARTITION BY toYYYYMMDD(StartTime)
TTL toDateTime(StartTime) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

**Tuning:**
- `index_granularity`: Lower (4096) = faster point lookups, higher storage; Higher (16384) = less memory, slower
- TTL: Adjust based on retention requirements
- ORDER BY: Most selective filter first for optimal pruning

#### Materialized View for Percentiles
```sql
CREATE MATERIALIZED VIEW service_latency_mv
ENGINE = AggregatingMergeTree()
ORDER BY (ServiceName, Minute)
PARTITION BY toYYYYMMDD(Minute)
POPULATE AS
SELECT
  ServiceName,
  toStartOfMinute(StartTime) AS Minute,
  quantileState(0.50)(Duration) AS p50_state,
  quantileState(0.95)(Duration) AS p95_state,
  quantileState(0.99)(Duration) AS p99_state,
  countState() AS request_count_state,
  sumState(if(StatusCode = 2, 1, 0)) AS error_count_state
FROM traces
GROUP BY ServiceName, Minute;
```

### Connection Settings
- **User**: `default`
- **Password**: `password`
- **Database**: `default`
- **HTTP Port**: `8123`
- **Native Port**: `9000`

> ⚠️ Change these in production deployments!

---

## 📨 Kafka Configuration

### Broker Settings (docker-compose)
```yaml
environment:
  KAFKA_BROKER_ID: 1
  KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
  KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
  KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
  KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'true'
```

### Topic Configuration
Topics are auto-created by Kafka. For production, consider:
- **Replication Factor**: 3 for HA
- **Partitions**: Based on consumer parallelism needs
- **Retention**: Adjust based on backlog requirements

### Consumer Settings
```javascript
const consumer = kafka.consumer({ 
  groupId: 'otel-consumer-group',
  sessionTimeout: 30000,
  heartbeatInterval: 3000
});
```

---

## 🔧 Service-Specific Configuration

### Tracing SDK (`services/tracing.js`)

```javascript
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';
const serviceName = process.env.SERVICE_NAME || 'unknown-service';
const environment = process.env.OTEL_RESOURCE_ATTRIBUTES || 'deployment.environment=dev';
```

**Customization:**
- Add custom resource attributes
- Configure sampling (currently no sampling - all traces collected)
- Add custom instrumentations

### API Gateway JWT (`services/api-gateway/app.js`)

```javascript
jwt.verify(token, 'secret_key', (err, user) => { ... })
// Mock fallback if no token
req.user = { email: 'customer@example.com', name: 'Test User' };
```

> ⚠️ **Change for production:** Use environment variable for JWT secret, remove mock fallback

---

## 🧠 AI/LLM Configuration

### Provider Selection

Edit `infra/docker-compose.yml` under `trace-analyser`:

```yaml
environment:
  LLM_PROVIDER: groq  # Options: groq | ollama | mock
```

### Groq Configuration (Recommended)
- **Free Tier**: Available at [console.groq.com](https://console.groq.com)
- **Model**: `llama-3.1-8b-instant` (fast, good quality)
- **Rate Limits**: Free tier has rate limits, but sufficient for demo
- **Latency**: ~1-2 seconds per analysis

```yaml
GROQ_API_KEY: ${GROQ_API_KEY}
GROQ_MODEL: llama-3.1-8b-instant
```

### Ollama Configuration (Local)
Fully local, no API costs, works offline.

**Setup:**
1. Add Ollama service to docker-compose or run separately
2. Pull model: `ollama pull tinyllama` or `ollama pull llama3`
3. Configure:

```yaml
LLM_PROVIDER: ollama
OLLAMA_URL: http://host.docker.internal:11434
MODEL: tinyllama
```

**Models:**
- `tinyllama` - Smallest, fastest, lower quality (~637MB)
- `llama3` - Better quality, slower (~4.7GB)
- `llama3.1` - Latest, best quality (~4.7GB)

### Mock Configuration (Testing)
No LLM required, deterministic responses:

```yaml
LLM_PROVIDER: mock
```

### Tuning Parameters
```yaml
ANALYSIS_INTERVAL: 60000      # Poll every 60 seconds
ANALYSIS_MAX_ATTEMPTS: 3      # Give up after 3 failed attempts
```

---

## 🖥️ Dashboard Configuration

### Build-time Configuration
In `infra/docker-compose.yml`:

```yaml
dashboard:
  build:
    context: ../dashboard
    args:
      VITE_API_URL: http://localhost:4000
```

### Runtime Configuration
The dashboard is a static SPA built with Vite. API URL is baked in at build time.

**For remote deployment:**
1. Change `VITE_API_URL` to your API endpoint
2. Rebuild: `docker compose up -d --build dashboard`

### Polling Intervals
Hardcoded in components:
- Dashboard: ~10-15 seconds
- Traces list: ~10 seconds
- Metrics: ~15 seconds
- Service graph: ~30 seconds

---

## 🔧 Advanced Tuning

### For Higher Throughput

#### Kafka Consumer
```yaml
BATCH_SIZE: 500        # Larger batches
FLUSH_INTERVAL: 10000  # Less frequent flushes
```

#### ClickHouse
- Increase memory allocation
- Add more CPU cores
- Tune MergeTree settings
- Consider partitioning strategy

#### OTel Collector
```yaml
batch:
  timeout: 2s
  send_batch_size: 2000
```

### For Lower Latency

#### Redis Cache
`CACHE_TTL` is not currently used. Cached routes pass fixed TTLs (300s for trace detail, 30s for the service graph), so changing this variable will not lengthen caching. Edit `query-api/index.js` if you need different TTLs.

#### ClickHouse Queries
- Ensure proper indexes
- Use materialized views
- Optimize WHERE clauses

### Memory Optimization

#### OTel Collector
```yaml
memory_limiter:
  limit_mib: 512
  spike_limit_mib: 256
```

#### Docker Resources
Allocate more memory in Docker Desktop for production-like testing.

---

## ✅ Configuration Best Practices

### Security
- [ ] Never commit `.env` files
- [ ] Change default passwords (ClickHouse, PostgreSQL)
- [ ] Use strong JWT secrets
- [ ] Restrict network access in production
- [ ] Rotate API keys regularly

### Performance
- [ ] Tune batch sizes based on traffic
- [ ] Monitor ClickHouse disk usage
- [ ] Adjust TTL policies
- [ ] Use Redis caching effectively
- [ ] Scale consumers horizontally

### Reliability
- [ ] Configure health checks properly
- [ ] Set restart policies
- [ ] Enable logging
- [ ] Monitor resource usage
- [ ] Have backup strategy

### Maintainability
- [ ] Document custom configurations
- [ ] Use version control for configs
- [ ] Keep dependencies updated
- [ ] Test configuration changes in dev first

---

<div align="center">

**[← Back to Installation Guide](./installation-guide.md)** | **[Observability Guide →](./observability-guide.md)**

</div>
