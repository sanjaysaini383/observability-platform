<div align="center">

# 🚀 Installation Guide

### *Step-by-Step Setup for TraceLens Observability Platform*

[![Docker](https://img.shields.io/badge/Docker-Required-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Docker Compose](https://img.shields.io/badge/Docker%20Compose-v2+-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Git](https://img.shields.io/badge/Git-Required-F05032?style=for-the-badge&logo=git&logoColor=white)](https://git-scm.com/)

*Verified installation instructions for local development and testing*

</div>

---

## 📑 Table of Contents

- [System Requirements](#system-requirements)
- [Pre-Installation Checklist](#pre-installation-checklist)
- [Installation Methods](#installation-methods)
- [Step-by-Step Installation](#step-by-step-installation)
- [Post-Installation Setup](#post-installation-setup)
- [Verification](#verification)
- [Troubleshooting Installation](#troubleshooting-installation)
- [Next Steps](#next-steps)

---

## 💻 System Requirements

### Minimum Requirements
| Component | Requirement | Notes |
|:-----------|:------------|:-------|
| **CPU** | 2 Cores (x86_64/ARM64) | 4 cores recommended for smooth operation |
| **RAM** | 6 GB | 8 GB strongly recommended (Kafka + ClickHouse are memory-intensive) |
| **Disk Space** | 15-20 GB free | Includes images, volumes, and build cache |
| **OS** | Windows 10/11, macOS, Linux | Docker Desktop supported on all platforms |
| **Network** | Internet connection | For initial image pulls and optional Groq API |

### Software Prerequisites

| Software | Minimum Version | Download Link |
|:-----------|:----------------|:--------------|
| **Docker Desktop** | 24.0.0+ | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop) |
| **Docker Compose** | v2.20+ | Included with Docker Desktop |
| **Git** | 2.30+ | [git-scm.com/downloads](https://git-scm.com/downloads) |
| **Terminal/Shell** | Any | PowerShell, Bash, Zsh, etc. |

> **Note:** No local Node.js, Python, or database installation required. Everything runs in containers.

---

## ✅ Pre-Installation Checklist

- [ ] Docker Desktop installed and running
- [ ] Docker Compose v2 available (`docker compose version`)
- [ ] At least 6GB RAM allocated to Docker (Settings → Resources)
- [ ] All required ports are free (see port table below)
- [ ] Git installed and configured
- [ ] (Optional) Free Groq API key from [console.groq.com](https://console.groq.com)

### Required Ports

Ensure these ports are not in use by other applications:

| Port | Service | Protocol | Purpose |
|:------|:---------|:----------|:--------|
| `2181` | Zookeeper | TCP | Kafka coordination |
| `3000` | API Gateway | HTTP | Demo traffic entry point |
| `3001` | Payment Service | HTTP | Payment service |
| `4000` | Query API | HTTP | REST API for dashboard |
| `4317` | OTel Collector | gRPC | OTLP trace/metric/log ingestion |
| `4318` | OTel Collector | HTTP | OTLP HTTP ingestion |
| `5000` | Order Service | HTTP | Order service |
| `5001` | Inventory Service | HTTP | Inventory service |
| `5002` | Notification Service | HTTP | Notification service |
| `5432` | PostgreSQL | TCP | Application database |
| `6379` | Redis | TCP | Cache |
| `8080` | Dashboard | HTTP | Web UI |
| `8123` | ClickHouse | HTTP | ClickHouse HTTP interface |
| `9000` | ClickHouse | Native TCP | ClickHouse native protocol |
| `9092` | Kafka | TCP | Message broker |

**Check port availability:**

```bash
# Windows (PowerShell)
Test-NetConnection -ComputerName localhost -Port 8080

# Linux/macOS
lsof -i :8080  # or netstat -tuln | grep 8080
```

---

## 📦 Installation Methods

### Method 1: Docker Compose (Recommended)
This is the standard way to run the entire stack locally with one command.

### Method 2: Individual Service Development
For developing specific services, see [Contributing Guide](./contributing.md).

---

## 🔧 Step-by-Step Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/sanjaysaini383/observability-platform.git
cd observability-platform
```

### Step 2: Navigate to Infrastructure Directory

All deployment configurations are in the `infra/` directory.

```bash
cd infra
```

### Step 3: Configure Environment Variables

Copy the example environment file and configure it.

```bash
# Linux/macOS
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env

# Windows (CMD)
copy .env.example .env
```

Edit `infra/.env` with your preferred text editor:

```env
# Required for AI-powered root cause analysis (optional but highly recommended)
# Get free key at: https://console.groq.com
GROQ_API_KEY=your_groq_api_key_here

# Optional: Real payment gateway integration (leave empty for simulation)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# Optional: Real email notifications (leave empty for simulation)
SMTP_USER=
SMTP_PASS=
```

> **Tip:** You can skip Groq API key initially. Set `LLM_PROVIDER=mock` in docker-compose.yml for the trace-analyser service to run without API calls.

### Step 4: Start the Stack

Build and start all services in detached mode:

```bash
docker compose up -d --build
```

**What happens:**
1. Pulls base images (Kafka, ClickHouse, PostgreSQL, Redis, etc.) - ~2-3 minutes
2. Builds custom images for services, consumer, API, dashboard - ~3-5 minutes
3. Initializes ClickHouse schema from `init.sql`
4. Starts all 15 containers in dependency order
5. Total first run: **5-10 minutes**

**Monitor progress:**

```bash
# Watch all logs
docker compose logs -f

# Watch specific service
docker compose logs -f api-gateway
```

### Step 5: Wait for Services to be Healthy

Check service health status:

```bash
docker compose ps
```

Expected output (healthy services marked):

```
NAME                                COMMAND                  SERVICE             STATUS              PORTS
infra-api-gateway-1                "docker-entrypoint.s…"   api-gateway        Up (healthy)        0.0.0.0:3000->3000/tcp
infra-clickhouse-1                 "/entrypoint.sh"         clickhouse         Up (healthy)        0.0.0.0:8123->8123/tcp, 0.0.0.0:9000->9000/tcp
infra-dashboard-1                  "docker-entrypoint.s…"   dashboard          Up                  0.0.0.0:8080->3000/tcp
infra-inventory-service-1          "docker-entrypoint.s…"   inventory-service  Up (healthy)        0.0.0.0:5001->5001/tcp
infra-kafka-1                      "start-kafka.sh"         kafka              Up (healthy)        0.0.0.0:9092->9092/tcp
infra-kafka-consumer-1             "docker-entrypoint.s…"   kafka-consumer     Up                  
infra-notification-service-1       "docker-entrypoint.s…"   notification-service Up (healthy)     0.0.0.0:5002->5002/tcp
infra-order-service-1              "docker-entrypoint.s…"   order-service      Up (healthy)        0.0.0.0:5000->5000/tcp
infra-otel-collector-1             "/otelcol-contrib --…"   otel-collector     Up                  0.0.0.0:4317->4317/tcp, 0.0.0.0:4318->4318/tcp
infra-payment-service-1            "docker-entrypoint.s…"   payment-service    Up (healthy)        0.0.0.0:3001->3001/tcp
infra-postgres-1                   "docker-entrypoint.s…"   postgres           Up (healthy)        0.0.0.0:5432->5432/tcp
infra-query-api-1                  "docker-entrypoint.s…"   query-api          Up (healthy)        0.0.0.0:4000->4000/tcp
infra-redis-1                      "docker-entrypoint.s…"   redis              Up (healthy)        0.0.0.0:6379->6379/tcp
infra-trace-analyser-1             "docker-entrypoint.s…"   trace-analyser     Up                  
infra-zookeeper-1                  "/etc/confluent/dock…"   zookeeper          Up (healthy)        0.0.0.0:2181->2181/tcp
```

**Note:** `dashboard`, `otel-collector`, `kafka-consumer`, `trace-analyser` may show `Up` without `(healthy)` - this is normal as they don't have health checks configured.

---

## 🎯 Post-Installation Setup

### Step 6: Initialize Application Databases

The microservices need their PostgreSQL tables created and seeded:

```bash
# Initialize order service database
curl -X POST http://localhost:5000/init

# Initialize inventory service database with sample products
curl -X POST http://localhost:5001/init
```

**Expected responses:**
```json
{"message": "Orders table created"}
{"message": "Products table created and seeded"}
```

### Step 7: Generate Sample Traffic

To see data in the dashboard, generate some traces:

#### Option A: Load Generator (Recommended)
Automated continuous traffic with realistic patterns:

```bash
# Linux/macOS/WSL/Git Bash
bash load-gen.sh

# Windows PowerShell
.\load-gen.ps1
```

This script will:
- Hit `/products` endpoint periodically
- Perform `/checkout` requests with random products
- Generate both successful and failed traces (10% failure rate)
- Run continuously until stopped (Ctrl+C)

#### Option B: Manual Testing
Make a few requests manually to see immediate results:

```bash
# List products
curl http://localhost:3000/products

# Perform a checkout
curl -X POST http://localhost:3000/checkout \
  -H "Content-Type: application/json" \
  -d '{"items":[{"productId":1,"qty":2}]}'
```

Run the checkout 3-5 times to potentially trigger error scenarios.

---

## ✅ Verification

### Verify All Endpoints

| Endpoint | Test Command | Expected |
|:-----------|:--------------|:----------|
| **Dashboard** | Open [http://localhost:8080](http://localhost:8080) | React UI loads |
| **Query API Health** | `curl http://localhost:4000/health` | `{"status":"healthy","service":"query-api"}` |
| **API Gateway Health** | `curl http://localhost:3000/health` | `{"status":"healthy","service":"api-gateway"}` |
| **ClickHouse** | `curl http://localhost:8123/ping` | `Ok.` |
| **Redis** | `docker compose exec redis redis-cli ping` | `PONG` |

### Verify Data Flow

```bash
# Check traces in ClickHouse
curl -s -u default:password --data "SELECT count() FROM traces FORMAT JSON" http://localhost:8123/

# Check Kafka topics (should auto-create)
docker compose exec kafka kafka-topics --list --bootstrap-server kafka:9092
```

Expected Kafka topics: `otel.traces`, `otel.metrics`, `otel.logs`

### Verify Dashboard Data

1. Open [http://localhost:8080](http://localhost:8080)
2. Navigate to **Traces** tab - should see recent traces
3. Navigate to **Services** tab - should see service dependency graph
4. Navigate to **Metrics** tab - should see latency charts
5. Navigate to **AI Insights** tab - may be empty initially, will populate after errors occur and AI analyzes them

---

## 🔍 Troubleshooting Installation

### Common Issues and Solutions

| Issue | Symptoms | Solution |
|:-------|:-----------|:----------|
| **Insufficient Memory** | Containers crashing, OOM errors | Increase Docker memory to 8GB in Docker Desktop Settings → Resources |
| **Port Conflicts** | "Port already in use" errors | Stop conflicting service or change port mappings in `docker-compose.yml` |
| **Slow First Build** | Takes >15 minutes | Normal on slow internet. Use cached layers on subsequent runs |
| **Kafka Not Starting** | `kafka` container unhealthy | Ensure Zookeeper is healthy first. Restart: `docker compose restart zookeeper kafka` |
| **ClickHouse Init Fails** | Schema not created | Remove volumes and restart: `docker compose down -v && docker compose up -d --build` |
| **Services Can't Connect** | Connection refused errors | Wait for dependencies. Check: `docker compose ps` and logs |
| **Dashboard Shows No Data** | Empty UI | Generate traffic (Step 7) and wait 30-60 seconds for pipeline |
| **AI Insights Empty** | No AI analysis | Need error traces + LLM configured. Generate errors or set `LLM_PROVIDER=mock` |

### Debug Commands

```bash
# Check all container status
docker compose ps -a

# View logs for specific service
docker compose logs --tail=50 <service-name>

# Restart a problematic service
docker compose restart <service-name>

# Rebuild single service
docker compose up -d --build <service-name>

# Check resource usage
docker stats

# Access container shell for debugging
docker compose exec <service-name> sh
```

### Clean Restart

If all else fails, do a complete clean restart:

```bash
# Stop and remove everything including volumes
docker compose down -v

# Remove dangling images (optional)
docker system prune -f

# Start fresh
docker compose up -d --build
```

> ⚠️ **Warning:** `docker compose down -v` deletes all data in ClickHouse, PostgreSQL, Redis, Kafka!

---

## 🚀 Next Steps

Now that installation is complete:

1. **[Configuration Guide](./configuration-guide.md)** - Learn about all configuration options
2. **[Observability Guide](./observability-guide.md)** - Understand tracing, metrics, and logs
3. **[Architecture Guide](./architecture.md)** - Deep dive into system design
4. **[Troubleshooting Guide](./troubleshooting.md)** - Common runtime issues
5. **[Contributing Guide](./contributing.md)** - How to contribute to the project

---

<div align="center">

**[← Back to README](../README.md)** | **[Configuration Guide →](./configuration-guide.md)**

</div>
