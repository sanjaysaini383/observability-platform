<div align="center">

# 🗺️ Project Structure Guide

### *Comprehensive Directory & File Reference*

[![Structure](https://img.shields.io/badge/Project%20Structure-Complete%20Reference-8B5CF6?style=for-the-badge&logo=files&logoColor=white)](.)
[![Codebase](https://img.shields.io/badge/Codebase-73%20Files%20Analyzed-10B981?style=for-the-badge)](.)

*In-depth mapping of every directory and file in the repository*

</div>

---

## 📑 Table of Contents

- [Overview](#overview)
- [Root Directory](#root-directory)
- [collector/](#collector)
- [dashboard/](#dashboard)
- [docs/](#docs)
- [infra/](#infra)
- [kafka-consumer/](#kafka-consumer)
- [query-api/](#query-api)
- [services/](#services)
- [shared/](#shared)
- [File Statistics](#file-statistics)

---

## 🎯 Overview

This guide provides a complete reference of the TraceLens codebase structure, explaining the purpose of each directory and key files.

---

## 📂 Root Directory

```
observability-platform/
├── .dockerignore
├── .gitignore
├── LICENSE
├── README.md
├── architecture_overview.md
├── hosting-guide.md
├── interview-qa_claude.md
├── observability-platform-roadmap.md
├── project-overview_claude.md
├── real-world-usage_claude.md
├── running-guide_claude.md
├── collector/
├── dashboard/
├── docs/
├── infra/
├── kafka-consumer/
├── query-api/
├── services/
└── shared/
```

| File | Purpose |
|:------|:---------|
| `README.md` | Main project documentation, quick start, architecture overview |
| `LICENSE` | MIT License |
| `.gitignore` | Git ignore patterns |
| `.dockerignore` | Docker build ignore patterns |
| `architecture_overview.md` | High-level architecture summary |
| `project-overview_claude.md` | Detailed project walkthrough |
| `running-guide_claude.md` | Comprehensive running instructions |
| `hosting-guide.md` | Deployment to remote servers |
| `observability-platform-roadmap.md` | Future enhancements |
| `interview-qa_claude.md` | Interview preparation Q&A |
| `real-world-usage_claude.md` | Real-world usage scenarios |

---

## 📡 collector/

OTel Collector configuration for telemetry ingestion.

```
collector/
└── otelcol-config.yaml
```

| File | Purpose |
|:------|:---------|
| `otelcol-config.yaml` | Collector pipelines: receivers (OTLP), processors (batch, memory_limiter), exporters (Kafka) |

**Key Configuration:**
- OTLP gRPC on 4317, HTTP on 4318
- Memory limit 256 MiB
- Batch size 1000 spans/5s
- Exports to Kafka topics

---

## 🎨 dashboard/

React frontend application.

```
dashboard/
├── Dockerfile
├── index.html
├── package.json
├── package-lock.json
├── public/
├── src/
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

### src/ Structure
```
src/
├── App.tsx
├── index.css
├── main.tsx
├── components/
│   ├── layout/
│   │   ├── Layout.tsx
│   │   └── Sidebar.tsx
│   └── ui/
├── lib/
│   └── api.ts
├── pages/
│   ├── AiInsights.tsx
│   ├── Dashboard.tsx
│   ├── Metrics.tsx
│   ├── Services.tsx
│   └── Traces.tsx
└── types/
```

| Directory/File | Purpose |
|:----------------|:---------|
| `App.tsx` | Root component, routing setup |
| `main.tsx` | Application entry point |
| `index.css` | Global styles (TailwindCSS) |
| `components/layout/` | App shell, navigation |
| `components/ui/` | Reusable UI components |
| `pages/` | Main view components (4 pages) |
| `lib/api.ts` | API client, data mappers |
| `types/` | TypeScript type definitions |
| `vite.config.ts` | Vite build configuration |

**Tech Stack:** React 19, TypeScript, Vite, TailwindCSS 4, Recharts, React Flow, Dagre

---

## 📚 docs/

Comprehensive documentation (newly created).

```
docs/
├── architecture.md
├── installation-guide.md
├── configuration-guide.md
├── observability-guide.md
├── troubleshooting.md
├── contributing.md
├── api/
│   └── query-api-reference.md
├── components/
│   └── query-api.md
├── deployment/
├── development/
├── monitoring/
├── reference/
└── security/
```

| File | Purpose |
|:------|:---------|
| `architecture.md` | System architecture deep dive |
| `installation-guide.md` | Setup instructions |
| `configuration-guide.md` | All configuration options |
| `observability-guide.md` | Tracing/metrics/logs/AI |
| `troubleshooting.md` | Debugging guide |
| `contributing.md` | Contribution guidelines |
| `api/query-api-reference.md` | Complete API reference |
| `components/query-api.md` | Query API internals |

---

## 🏗️ infra/

Infrastructure orchestration.

```
infra/
├── docker-compose.yml
├── .env.example
├── clickhouse/
│   └── init.sql
├── load-gen.ps1
└── load-gen.sh
```

| File | Purpose |
|:------|:---------|
| `docker-compose.yml` | All services orchestration (15 containers) |
| `.env.example` | Environment template |
| `clickhouse/init.sql` | Database schema, tables, views, MVs |
| `load-gen.sh` | Load generator (Bash) |
| `load-gen.ps1` | Load generator (PowerShell) |

---

## 📨 kafka-consumer/

Kafka to ClickHouse bridge.

```
kafka-consumer/
├── Dockerfile
├── index.js
├── otlp-parser.js
├── otlp-parser.test.js
└── package.json
```

| File | Purpose |
|:------|:---------|
| `index.js` | Consumer logic, batching, ClickHouse inserts |
| `otlp-parser.js` | Parse OTLP JSON from Kafka, flatten structures |
| `otlp-parser.test.js` | Unit tests for parser |
| `package.json` | Dependencies (kafkajs, axios) |
| `Dockerfile` | Container build |

**Key Functions:**
- `parseTraceMessage()`, `parseMetricsMessage()`, `parseLogsMessage()`
- `insertTraces()`, `insertMetrics()`, `insertLogs()`
- `attributesToMapSql()`, `escSql()`

---

## 🔍 query-api/

REST API and background workers.

```
query-api/
├── Dockerfile
├── helpers.js
├── helpers.test.js
├── index.js
├── package.json
└── workers/
    ├── Dockerfile
    └── trace-analyser.js
```

| File | Purpose |
|:------|:---------|
| `index.js` | Express server, routes, caching, ClickHouse queries |
| `helpers.js` | SQL escaping, window resolution |
| `helpers.test.js` | Unit tests |
| `package.json` | Dependencies |
| `workers/trace-analyser.js` | AI root cause analysis worker |
| `workers/Dockerfile` | Worker container |

---

## ⚙️ services/

Microservices and shared instrumentation.

```
services/
├── Dockerfile
├── tracing.js
├── api-gateway/
├── inventory-service/
├── notification-service/
├── order-service/
└── payment-service/
```

### tracing.js
Shared OpenTelemetry SDK setup loaded via `--import`.

**Features:**
- Traces, Metrics, Logs exporters
- Auto-instrumentations
- `logError()` helper
- Graceful shutdown

### Service Directories
Each service has:
```
<service>/
└── app.js
```

| Service | Port | Purpose | Special Features |
|:----------|:------|:---------|:-----------------|
| `api-gateway` | 3000 | Entry point, orchestration | JWT middleware, saga coordination |
| `order-service` | 5000 | Order management | PostgreSQL, inventory calls |
| `payment-service` | 3001 | Payment processing | Razorpay integration or simulation, 10% failure |
| `inventory-service` | 5001 | Stock management | PostgreSQL, row locking, 10% failure |
| `notification-service` | 5002 | Notifications | SMTP or simulation, 10% failure |

---

## 🤝 shared/

Shared utilities across components.

```
shared/
└── sql-utils.js
```

| File | Purpose |
|:------|:---------|
| `sql-utils.js` | Shared SQL utilities (escSql) used by multiple components |

---

## 📊 File Statistics

| Category | Count | Description |
|:-----------|:-------|:-------------|
| **JavaScript** | ~25 | Services, API, consumer, workers |
| **TypeScript/TSX** | ~15 | Dashboard components |
| **YAML/JSON** | ~12 | Configs, package files |
| **SQL** | ~2 | Schema, init scripts |
| **Markdown** | ~30+ | Documentation |
| **Shell/PowerShell** | ~4 | Scripts |
| **Dockerfiles** | ~8 | Container builds |
| **Total** | **73+** | Analyzed files |

---

## 🔍 Quick Navigation

| Need to... | Look in... |
|:------------|:------------|
| **Understand architecture** | `docs/architecture.md`, `README.md` |
| **Set up locally** | `docs/installation-guide.md`, `infra/` |
| **Configure system** | `docs/configuration-guide.md`, `infra/.env.example` |
| **Debug issues** | `docs/troubleshooting.md` |
| **Understand API** | `docs/api/query-api-reference.md` |
| **Modify services** | `services/`, `docs/components/` |
| **Change schema** | `infra/clickhouse/init.sql` |
| **Update dashboard** | `dashboard/src/` |
| **Add features** | `docs/contributing.md` |

---

<div align="center">

**[← Back to Docs](../README.md)** | **[API Reference →](../api/query-api-reference.md)**</div>
