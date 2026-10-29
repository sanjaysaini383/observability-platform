# TraceLens — Real-World Usage, Tradeoffs, and Tech Stack Rationale

This document steps back from "how does the code work" (see
[`project-overview.md`](./project-overview.md)) and "what would an interviewer ask"
(see [`interview-qa.md`](./interview-qa.md)) to answer three different questions: **who
actually uses a system shaped like this, in production, and for what?** **What are the
real pros and cons of this architecture?** And **why was each specific technology
chosen over its alternatives?**

---

## 1. Who actually runs a system like this, and why

Every company running more than a handful of services in production hits the same
wall: a request fails, and nobody can answer "which of our 20 services caused it, and
why" fast enough. That's the problem this entire architecture — instrument → buffer →
store → query → analyze — exists to solve. It's not a toy pattern; it's the same shape
as:

- **Datadog, Honeycomb, New Relic, Grafana Tempo/Loki/Mimir** — commercial/OSS APM
  platforms built on this exact ingestion → buffer → OLAP store → query pipeline.
- **Uber's Jaeger + M3**, **Netflix's Mantis**, **Pinterest's OpenTelemetry rollout** —
  in-house observability stacks at companies with too much traffic and too much
  compliance sensitivity to send raw telemetry to a third-party SaaS.
- Any company that has been burned by a **multi-hour, multi-service incident where the
  root cause was a single slow database call three hops downstream** — which is
  essentially every company operating microservices at scale.

### Concretely, this architecture gets used for:

| Real-time use case | How this project's pieces map to it |
|---|---|
| **Incident response / MTTR reduction** | The trace waterfall + service graph is exactly what an on-call engineer opens first during a P1 — "show me every span in this failing request, in order, across every service." The AI root-cause worker automates the *first* triage question ("what's the most likely cause?") so a human starts investigating with a hypothesis instead of a blank dashboard. |
| **SLA/SLO monitoring** | The `service_latency` materialized view (P50/P95/P99 per service per minute) is precisely the data an SLO burn-rate alert is computed from — "are we spending our error budget faster than expected." |
| **Capacity planning** | The RPS and latency-under-load metrics (`total_requests`, `p99_ns` per minute) are what you'd graph against infrastructure cost to decide when to scale a service horizontally. |
| **Dependency risk analysis** | The service dependency graph answers "if `payment-service` goes down, what else breaks, and how many requests/minute does that affect?" — critical input for architecture reviews and disaster-recovery planning. |
| **Cost attribution** | Real companies at this scale use trace volume per service as an input to internal chargeback models — "which team's service is generating the most telemetry/infra cost." |
| **Security/forensics** | Traces with full request metadata (who called what, when, with what parameters) are a first-class input to post-incident security reviews — "was this failure an outage or an attack." |
| **Automated root cause / AIOps** | This is a fast-growing real category — Datadog Watchdog, Honeycomb BubbleUp, and various in-house "why did this fail" LLM tools at large tech companies all do what `trace-analyser` does here, at much larger scale. |

---

## 2. Pros of this architecture

- **Vendor-agnostic instrumentation.** Because every service uses vanilla
  OpenTelemetry (not a vendor SDK), the *entire backend* — Collector, Kafka, ClickHouse,
  query-api — could be swapped for Datadog or Honeycomb by changing one exporter
  endpoint, with zero application code changes. This is the actual reason OpenTelemetry
  won as an industry standard: it decouples "how you instrument" from "where the data
  goes."
- **Decoupled, resilient ingestion.** Kafka as a buffer means a storage outage doesn't
  cause telemetry loss or (worse) back-pressure into production request paths. This is
  a battle-tested pattern, not a novel one.
- **Cheap analytical queries at scale.** ClickHouse's columnar storage + partitioning +
  materialized views mean the dashboard's "P99 latency over the last hour" query stays
  fast even as trace volume grows into the billions of rows — a row-store like Postgres
  degrades far sooner on this access pattern.
- **"Add a service, get observability for free."** Because instrumentation lives in one
  shared `tracing.js` module every service imports, a new service is fully traced,
  metered, and logged the moment it starts up — no per-service dashboard wiring.
- **Fast first-pass triage via AI.** Even an imperfect LLM explanation ("likely a
  payment gateway timeout, check connectivity") is faster than a human reading five
  services' logs cold, and it runs unattended, 24/7, on every error trace.
- **It's genuinely runnable in one command.** `docker compose up --build` gives anyone
  the full pipeline with zero cloud account, zero paid SaaS tier, and (with the `mock`
  LLM provider) zero external API keys at all.

## 3. Cons / limitations of this architecture (and of this specific build)

- **Operational cost of running it yourself.** Kafka + Zookeeper + ClickHouse +
  Postgres + Redis is five stateful systems to operate, patch, and scale — which is
  precisely why most companies eventually *do* pay a SaaS vendor once the engineering
  cost of running this in-house exceeds the subscription cost. Self-hosting only wins
  at a certain scale or for certain compliance/data-residency requirements.
- **No sampling means unbounded storage growth.** Every span from every request is
  stored (until TTL expiry). At real production traffic, that's enormous and
  expensive — tail-based sampling (keep errors, sample successes) is a hard requirement
  before this could handle non-trivial load, and it's explicitly not implemented yet.
- **Hand-built SQL string concatenation.** Escaping is consistent (`escSql`
  everywhere) but duplicated across three files instead of centralized, which is a
  real maintainability and audit-surface concern — a proper query builder or
  parameterization layer would be a prerequisite for production hardening.
- **Single-node everything.** One ClickHouse node, one Kafka broker, one Postgres
  instance — no replication, no failover. A production deployment needs a ClickHouse
  cluster, a multi-broker Kafka cluster, and HA Postgres at minimum.
- **AI analysis has no retry/backoff ceiling.** A trace whose LLM call fails
  (malformed response, rate limit) is retried indefinitely on every poll cycle since
  nothing marks an attempt as final — a real cost/reliability risk at scale.
- **No auth/multi-tenancy.** `api-gateway`'s JWT check is permissive-by-design for a
  demo; a real internal tool serving multiple teams would need real authn/authz, and a
  SaaS-facing product would need full multi-tenant data isolation, neither of which
  exists here.
- **Polling instead of push.** 10–15 second dashboard staleness is fine for a demo,
  but a real incident-response UI usually wants sub-second updates during an active
  outage — that would mean WebSockets or SSE, which this doesn't have.

---

## 4. Why this project (the portfolio/learning rationale)

This project was built specifically to go deep on a system design pattern that shows
up in almost every "design a monitoring system" or "design a distributed logging
pipeline" system-design interview — and to have *real, defensible answers* backed by
actual running code and actual bugs debugged, not just diagram-level familiarity. A few
reasons this particular project, specifically, over other portfolio options:

- **It touches almost every hard distributed-systems topic in one cohesive system**:
  message queues and backpressure, columnar storage and aggregation strategy,
  service-to-service context propagation, cache invalidation/TTL design, and
  now (with the AI worker) LLM-integration engineering — instead of a shallow demo of
  any single one.
- **It's end-to-end, not a fragment.** Five real instrumented services with a genuine
  multi-hop transaction (the checkout saga), not a single Hello World service with fake
  traces injected — the trace data is real, produced by real (if simulated) business
  logic and real intentional failure injection.
- **The bugs were real.** The ClickHouse map-literal batch-insert bug and the
  `%M`-as-month-name formatting bug (documented in `interview-qa.md`) only surfaced
  under live end-to-end testing, not from reading the code — which is a stronger
  demonstration of debugging ability than a rehearsed, seeded bug would be.
- **It has a natural roadmap.** Tail-based sampling, Kubernetes/Helm, ClickHouse
  clustering, an alerting engine — the project has an honest, prioritized "what's next"
  list (see the README's Future Improvements table) rather than pretending to be a
  finished product, which is a more credible signal in an interview than an overclaimed
  toy project.

## 5. Why this tech stack, specifically (component by component)

| Component | Chosen | Real alternatives | Why this one |
|---|---|---|---|
| **Instrumentation** | OpenTelemetry (Node SDK) | Vendor SDKs (Datadog `dd-trace`, New Relic agent) | OTel is the vendor-neutral, CNCF-backed industry standard — instrumenting against it means the backend is swappable without touching application code. Vendor SDKs lock you in immediately. |
| **Transport** | OTLP over gRPC | OTLP/HTTP, StatsD, custom JSON over REST | gRPC is what OTel's own tooling defaults to and is more efficient (binary protobuf, multiplexed streams) than repeated HTTP/JSON calls per batch. |
| **Buffer/queue** | Apache Kafka | RabbitMQ, AWS Kinesis, Redis Streams | Kafka is the de facto standard for high-throughput, ordered, replayable event streams — and it's genuinely what most real observability pipelines (including OTel Collector's own Kafka exporter, used unmodified here) use for this exact role. |
| **Analytical store** | ClickHouse | Elasticsearch, Apache Druid, TimescaleDB, plain Postgres | ClickHouse's columnar engine + native `AggregatingMergeTree`/quantile functions make percentile-heavy time-series analytics both fast and simple to express in SQL, without needing a separate stream-processing layer (unlike Druid) or accepting Postgres's row-store overhead on this access pattern. It's also what a number of real companies (including large-scale logging/observability teams) have migrated to specifically for this workload. |
| **Cache** | Redis | In-memory Node cache, Memcached | Redis is the simplest, most battle-tested shared cache with TTL support out of the box — needed here because `query-api` runs as (potentially) multiple stateless instances that must share cache state, which an in-process cache can't do. |
| **Transactional store (orders/inventory)** | PostgreSQL | MySQL, SQLite | Postgres is the default, well-understood choice for relational, transactional workloads (row locks via `SELECT ... FOR UPDATE`, ACID transactions) — this isn't the analytics side of the system, so a general-purpose RDBMS is exactly right, not a columnar store. |
| **Services runtime** | Node.js + Express | Go, Python/FastAPI, Java/Spring | Node has first-class, mature OpenTelemetry auto-instrumentation (`getNodeAutoInstrumentations()` covers Express, `pg`, HTTP, DNS, etc. with zero manual span code), and Express is minimal enough to keep the actual business logic of five services legible rather than buried in framework boilerplate. |
| **Dashboard** | React + Vite + TypeScript + TailwindCSS + Recharts + ReactFlow | Next.js, Grafana plugin, Streamlit | Vite gives instant dev feedback for a pure client-side SPA (no need for Next's server-rendering, since this is an internal tool behind a REST API, not a public site needing SEO). Recharts and ReactFlow are the two most direct, low-ceremony libraries for "time series chart" and "node/edge graph," respectively — both core to what this UI needs to render. |
| **AI provider** | Groq (default), Ollama, mock | OpenAI, Anthropic, local llama.cpp | Groq's free tier and extremely fast inference (~1–2s) make the AI worker feel responsive without requiring a paid API key, which matters for anyone cloning the repo. Ollama is offered as a fully local/offline alternative, and `mock` ensures the whole pipeline is demonstrable with zero external dependency at all. |
| **Orchestration** | Docker Compose | Kubernetes/Helm, bare-metal scripts | Compose is the right tool for "run this whole stack on one laptop with one command" — Kubernetes would add real value at actual production scale (autoscaling, rolling deploys) but zero value for a single-node local demo, and would raise the barrier to entry for anyone trying to run this. |

### The general principle behind every choice above

Pick the tool that's **the real industry-standard choice for that specific role**, not
the flashiest option — the goal was for someone to look at this stack and recognize
"yes, that's what I'd reach for too," rather than see an unusual choice that needs
defending. The one deliberate exception is orchestration (Compose instead of
Kubernetes), which trades production realism for approachability — a tradeoff explicitly
made and explicitly documented, not an oversight.
