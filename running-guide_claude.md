# Running TraceLens — Full Setup Guide

This is the detailed companion to the [Quick Start](./README.md#-quick-start) in the
main README. Follow it top to bottom for a first run, or jump to the section you need.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Docker Desktop ≥ 24** | Must have Docker Compose v2 (`docker compose`, not `docker-compose`) |
| **6 GB RAM allocated to Docker** | 15 containers run concurrently — Kafka, Zookeeper, and ClickHouse are the heaviest |
| **Ports free on the host** | See the port table in §3 — nothing else on your machine should be bound to them |
| **Git** | To clone the repo |
| A **free Groq API key** (optional but recommended) | For real LLM-powered root cause analysis — see §5 |

No local Node.js/Python install is required to run the stack — everything builds inside
Docker. You only need Node locally if you want to run the test suites (§8) outside a
container.

---

## 2. Clone and configure environment variables

```bash
git clone https://github.com/sanjaysaini383/observability-platform.git
cd observability-platform/infra
cp .env.example .env
```

Edit `infra/.env`:

```bash
# Required for real AI-generated root cause analysis (see §5 for alternatives)
GROQ_API_KEY=gsk_your_key_here

# Optional — only needed if you want real payments/emails instead of simulated ones
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
SMTP_USER=
SMTP_PASS=
```

`infra/.env` is git-ignored — never commit it. If you leave `RAZORPAY_KEY_ID`/`SMTP_USER`
blank, `payment-service` and `notification-service` simulate success with a short delay
instead of calling real external APIs, so the demo works end to end with zero external
credentials besides Groq.

---

## 3. Start the stack

From `infra/`:

```bash
docker compose up -d --build
```

- `-d` runs it detached (in the background); drop it if you want to watch logs stream in
  the foreground.
- First run: **5–10 minutes** (pulling 8 base images + building 6 custom ones).
- Subsequent runs: **under a minute**, Docker reuses cached layers.

### Confirm everything is healthy

```bash
docker compose ps
```

You should see 15 containers, most marked `(healthy)`:

```
infra-api-gateway-1            Up   (healthy)
infra-clickhouse-1              Up   (healthy)
infra-dashboard-1                Up
infra-inventory-service-1       Up   (healthy)
infra-kafka-1                    Up   (healthy)
infra-kafka-consumer-1           Up
infra-notification-service-1    Up   (healthy)
infra-order-service-1            Up   (healthy)
infra-otel-collector-1           Up
infra-payment-service-1         Up   (healthy)
infra-postgres-1                 Up   (healthy)
infra-query-api-1                Up   (healthy)
infra-redis-1                    Up   (healthy)
infra-trace-analyser-1           Up
infra-zookeeper-1                Up   (healthy)
```

`dashboard`, `otel-collector`, `kafka-consumer`, and `trace-analyser` don't define a
Docker healthcheck, so they'll just show `Up` — that's expected, not a problem.

### Endpoints

| Service | URL | Purpose |
|---|---|---|
| **Dashboard** | http://localhost:8080 | Main UI — start here |
| Query API | http://localhost:4000 | REST API the dashboard calls |
| API Gateway | http://localhost:3000 | Entry point for demo traffic (checkout flow) |
| Order Service | http://localhost:5000 | |
| Payment Service | http://localhost:3001 | |
| Inventory Service | http://localhost:5001 | |
| Notification Service | http://localhost:5002 | |
| ClickHouse HTTP | http://localhost:8123 | Raw SQL access (see §7) |
| Kafka | localhost:9092 | Internal broker, not typically accessed directly |

---

## 4. Seed data and generate traffic

The `order-service` and `inventory-service` databases start empty — initialize them once:

```bash
curl -X POST http://localhost:5000/init   # creates the orders table
curl -X POST http://localhost:5001/init   # creates + seeds the products table
```

### Option A — run the load generator (recommended)

```bash
# from infra/
bash load-gen.sh          # macOS/Linux/WSL/Git Bash
# or
./load-gen.ps1            # native PowerShell
```

This continuously hits `/products` and `/checkout` with randomized traffic, which is
what produces the traces, metrics, and occasional error spans that populate the
dashboard.

### Option B — manual requests

```bash
# List products
curl http://localhost:3000/products

# Place an order — note the payload shape: items is an array of {productId, qty}
curl -X POST http://localhost:3000/checkout \
  -H "Content-Type: application/json" \
  -d '{"items":[{"productId":1,"qty":1}]}'
```

Each of `payment-service`, `inventory-service`, and `notification-service` has a built-in
**~10% simulated failure rate** (intentional chaos injection for realistic error traces —
not a bug). Run the checkout call a handful of times if you want to see an error path.

---

## 5. Configure the AI Root Cause Analysis worker

The `trace-analyser` service polls ClickHouse every 60 seconds for new error traces and
asks an LLM to explain the root cause. Set `LLM_PROVIDER` in `infra/docker-compose.yml`
(under the `trace-analyser` service) to one of:

| Provider | Setup | Notes |
|---|---|---|
| `groq` (default) | Set `GROQ_API_KEY` in `infra/.env` | Free tier, ~1–2s inference, uses `llama-3.1-8b-instant` |
| `ollama` | Requires a running Ollama instance reachable at `OLLAMA_URL` (not included in this compose file) | Fully local, no API key, slower |
| `mock` | No setup | Returns a deterministic fake analysis — useful for demos/CI with zero external dependencies |

To switch, edit the `trace-analyser` environment block in `infra/docker-compose.yml`:

```yaml
environment:
  LLM_PROVIDER: mock   # or groq / ollama
```

then:

```bash
docker compose up -d --build trace-analyser
```

Check it's picking up error traces:

```bash
docker compose logs -f trace-analyser
```

You should see `Found N unanalysed error traces` followed by `✓ Stored analysis for
trace ...` roughly once a minute (only when error traces exist from the last 5 minutes).
Results appear on the **AI Insights** page and via `GET http://localhost:4000/api/insights`.

---

## 6. Using the dashboard

Open **http://localhost:8080**:

- **Dashboard** — live KPIs (requests, error rate, P99 latency), a requests-per-minute
  sparkline, the 5 most recent AI insights, and a recent-errors feed.
- **Traces** — filterable trace table; click a row to see the span waterfall for that
  trace.
- **Services** — a live service dependency graph (ReactFlow); click a node for its
  request volume, error rate, and P99 latency.
- **Metrics** — per-service latency percentiles (P50/P95/P99), requests/sec, and error
  rate over a selectable time window (1h/6h/24h), plus an anomaly alert list.
- **AI Insights** — full list of LLM root-cause analyses, filterable by severity and
  service.

All pages poll their data every 10–15 seconds — leave a tab open while running the load
generator to watch it update live.

---

## 7. Querying ClickHouse directly

Useful for debugging or exploring the raw schema. Credentials are `default` / `password`
(set in `infra/docker-compose.yml`, database `default`):

```bash
# Row counts
curl -s -u default:password --data "SELECT count() FROM traces FORMAT JSON" http://localhost:8123/
curl -s -u default:password --data "SELECT count() FROM metrics FORMAT JSON" http://localhost:8123/
curl -s -u default:password --data "SELECT count() FROM logs FORMAT JSON" http://localhost:8123/

# Recent error traces
curl -s -u default:password --data "
  SELECT ServiceName, OperationName, StartTime, StatusMessage
  FROM traces WHERE StatusCode = 2
  ORDER BY StartTime DESC LIMIT 10
  FORMAT PrettyCompact
" http://localhost:8123/
```

Tables: `traces`, `metrics`, `logs`, `trace_insights`. Views: `service_latency`,
`service_dependencies`, `error_traces`. Schema lives in
[`infra/clickhouse/init.sql`](./infra/clickhouse/init.sql).

---

## 8. Running the test suite

Two packages have unit tests (Node's built-in test runner, no extra dependencies):

```bash
cd kafka-consumer && npm install && npm test
cd ../query-api && npm install && npm test
```

These cover the SQL-escaping and OTLP-parsing logic — the highest-risk hand-written code
in the pipeline. There's no browser/UI test suite; verify dashboard changes visually.

---

## 9. Rebuilding after code changes

Rebuild just the service(s) you changed rather than the whole stack:

```bash
docker compose up -d --build <service-name>
# e.g.
docker compose up -d --build query-api
docker compose up -d --build api-gateway order-service payment-service inventory-service notification-service
```

Service names match the keys in `infra/docker-compose.yml` (`api-gateway`,
`order-service`, `payment-service`, `inventory-service`, `notification-service`,
`query-api`, `kafka-consumer`, `trace-analyser`, `dashboard`, `otel-collector`).

Watch logs for a specific service:

```bash
docker compose logs -f <service-name>
```

---

## 10. Stopping and cleaning up

```bash
docker compose stop          # stop containers, keep data volumes
docker compose down          # stop + remove containers, keep data volumes
docker compose down -v       # stop + remove containers AND wipe ClickHouse/Postgres data
```

Use `down -v` if you want a completely fresh start (e.g. after a schema change to
`init.sql`, which only runs on first container creation).

---

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker compose ps` shows a container stuck `unhealthy` | Check `docker compose logs <service>` — usually a dependency (Kafka/ClickHouse) wasn't ready yet; wait, or restart with `docker compose restart <service>` |
| Dashboard loads but shows no data | Run §4's seed + traffic steps — an empty system has nothing to show |
| `/api/insights` always empty | Confirm `trace-analyser` logs show `Found N unanalysed error traces` — if it's always `No unanalysed error traces found`, generate some errors first (checkout a few times); if it finds traces but the LLM call fails, check `GROQ_API_KEY` is set and valid |
| ClickHouse insert errors in `kafka-consumer` logs | Usually indicates a schema mismatch after editing `init.sql` — try `docker compose down -v` for a clean schema re-init |
| Port already in use | Something else on your host is bound to one of the ports in §3's table — stop it or edit the port mapping in `infra/docker-compose.yml` |
| First `docker compose up` takes forever | Normal — it's pulling ~8 base images (Kafka, ClickHouse, Postgres, Redis, Zookeeper, OTel Collector) plus building 6 custom Node/React images |

---

## 12. Related docs

- [`README.md`](./README.md) — architecture, design rationale, engineering tradeoffs
- [`observability-platform-roadmap.md`](./observability-platform-roadmap.md) — planned future work
- [`infra/clickhouse/init.sql`](./infra/clickhouse/init.sql) — ClickHouse schema
- [`collector/otelcol-config.yaml`](./collector/otelcol-config.yaml) — OTel Collector pipeline config
