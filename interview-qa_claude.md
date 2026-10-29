# TraceLens — Interview Q&A

A mock technical interview about this project, organized the way a real interviewer
would actually run it: broad → specific → tradeoffs → "what would you change." Answers
are grounded in the actual code (file paths included) so you can back up every claim by
pointing at a line of code, not just reciting a memorized answer.

---

## Part 1 — The 60-second pitch

### Q: Walk me through this project in a couple of sentences.
**A:** TraceLens is a self-hosted distributed tracing and observability platform — the
same architectural shape as Datadog or Honeycomb, built from scratch. It simulates a
5-service e-commerce checkout flow, instruments every service with OpenTelemetry,
streams the telemetry through Kafka into ClickHouse for storage/analytics, exposes it
through a REST API and React dashboard, and runs a background worker that uses an LLM
to automatically explain why failed requests failed. The point isn't the store — it's
the pipeline: ingestion → buffering → columnar storage → query → AI analysis.

### Q: Why did you build this instead of just using Grafana/Datadog?
**A:** The goal was to understand *how* those tools work internally, not to replace
them. Using a managed vendor would have taught me their UI, not why traces are stored
in a columnar database, why you need a message queue between the collector and storage,
or why percentile aggregation needs a two-stage materialized view. Building it forced
me to make (and defend) the same architectural decisions a real observability vendor's
engineering team makes.

---

## Part 2 — Architecture

### Q: Draw the data flow for me, end to end.
**A:**
```
5 services --OTLP/gRPC--> OTel Collector --Kafka(otlp_json)--> kafka-consumer
    --SQL INSERT--> ClickHouse --HTTP query--> query-api --REST--> React dashboard
                                     ^
                                     |
                          trace-analyser (LLM) --writes trace_insights-->
```
Full detail is in [`project-overview.md`](./project-overview.md) §1 and §7.

### Q: Why put a message queue (Kafka) between the collector and the database instead
of writing directly to ClickHouse?
**A:** Decoupling and backpressure. If ClickHouse is briefly slow, restarting, or the
consumer crashes, spans queue up in Kafka instead of being dropped (if the collector
tried to write directly and failed) or blocking the collector's batch processor (which
would eventually apply backpressure all the way back to the instrumented services and
add latency to real user requests). Kafka is the shock absorber — it lets ingestion and
storage fail and recover independently. This is exactly the pattern real vendors use to
survive traffic spikes without losing data (see `README.md`'s "Kafka & Backpressure"
section for the "thundering herd" framing).

### Q: What's the OTel Collector actually doing, and could you skip it and export
straight to Kafka from each service?
**A:** Technically yes, OTel exporters can write to Kafka directly, but the Collector
buys you: (1) a `memory_limiter` processor so a spike in span volume can't OOM the
services themselves, (2) `batch`ing (1000 spans / 5s) so you're not making one Kafka
produce call per span, and (3) a single place to add resource attributes
(`service.namespace`) or change the export destination without touching five codebases.
Config: [`collector/otelcol-config.yaml`](./collector/otelcol-config.yaml).

### Q: Why ClickHouse instead of Postgres or Elasticsearch for trace storage?
**A:** Traces are an append-only, time-ordered, read-heavy analytical workload —
exactly what columnar OLAP stores are built for. `traces` is `ORDER BY (ServiceName,
StartTime)` and `PARTITION BY toYYYYMMDD(StartTime)`, so a query like "P99 latency for
`payment-service` in the last hour" only reads the columns and partitions it actually
needs, instead of scanning whole rows like Postgres would. Elasticsearch would work too
(it's what a lot of real APM tools use for search), but ClickHouse's percentile
aggregation functions (`quantileState`/`quantileMerge`) map more directly onto the
metrics use case here.

### Q: Explain the two-stage materialized view for percentiles. Why not just `quantile()`
on the raw table?
**A:** `service_latency_mv` is an `AggregatingMergeTree` that maintains partial
aggregation *states* (`quantileState`, `countState`, `sumState`) per service per minute,
incrementally, as rows are inserted — not on read. `service_latency` is a thin view
that `quantileMerge`s those states into final numbers when queried. If you just ran
`quantile(0.99)(Duration)` directly on `traces` every time the dashboard polled, you'd
re-scan and re-sort every raw span in the window on every single request. The
state/merge split means the expensive part (touching raw spans) happens once at insert
time, and reads are cheap merges of pre-aggregated state.
See [`infra/clickhouse/init.sql`](./infra/clickhouse/init.sql) lines ~51–82.

### Q: How does the service dependency graph get built? Is there a separate
"service registry"?
**A:** No registry — it's derived purely from span parent/child relationships.
`service_dependencies` is a self-join of `traces` on `source.SpanId =
target.ParentSpanId AND source.TraceId = target.TraceId`, windowed to the last hour.
It's recomputed from raw trace data every time it's queried (with a 30s Redis cache in
front of it), which means the graph is always a live reflection of *actual* traffic
patterns, not a manually maintained diagram that goes stale.

---

## Part 3 — Distributed tracing specifics

### Q: How does trace context propagate across five separate Node.js processes?
**A:** W3C Trace Context — the standard `traceparent` HTTP header
(`00-<trace-id>-<span-id>-<flags>`). OpenTelemetry's auto-instrumentation
(`getNodeAutoInstrumentations()` in [`services/tracing.js`](./services/tracing.js))
injects it automatically on outgoing HTTP calls and reads it on incoming ones for most
cases, but this project also propagates it *explicitly* in application code — e.g.
`api-gateway`'s checkout handler passes `req.headers['traceparent']` through manually
to each downstream `axios` call (see
[`services/api-gateway/app.js`](./services/api-gateway/app.js)) — because relying
solely on auto-instrumentation's context propagation across the specific async
boundaries in a saga-style handler isn't always guaranteed, and being explicit here
removes any doubt.

### Q: What's a span, concretely, in this system's schema?
**A:** A row in the `traces` ClickHouse table: `TraceId`, `SpanId`, `ParentSpanId`,
`ServiceName`, `OperationName`, `StartTime`/`EndTime` (nanosecond `DateTime64`),
`Duration`, `StatusCode` (0=unset, 1=ok, 2=error), `StatusMessage`, and two
`Map(String,String)` columns for span attributes and resource attributes. Both manual
spans (`tracer.startSpan('process_payment')`) and auto-instrumented spans (raw
`POST`/`GET`, `pg-pool.connect`, `dns.lookup`, `tcp.connect`) end up as rows in the same
table — the trace waterfall UI just renders every span sharing a `TraceId`, ordered by
`StartTime`.

### Q: Why do some spans have names like `dns.lookup` and `tcp.connect`? Isn't that noise?
**A:** That's OpenTelemetry's Node auto-instrumentation capturing the network layer
underneath every HTTP call — DNS resolution, TCP handshake, TLS, the actual
request/response. It's genuinely useful for diagnosing "is this slow because of the
app or the network," but yes, at high trace volume it's a lot of low-value span
volume. This is exactly why the README's roadmap lists **tail-based sampling** as the
top-priority future improvement: drop the fine-grained spans for the 95%+ of requests
that succeed and keep full fidelity only for errors.

### Q: How would you correlate a log line back to the trace that produced it?
**A:** Every log record carries `TraceId`/`SpanId` columns (see the `logs` table
schema). The `logError()` helper in `services/tracing.js` reads
`trace.getActiveSpan()?.spanContext()` and attaches `traceId`/`spanId` to every emitted
log record, so a log and the span it happened inside share an ID you can join on. This
is the same mechanism production observability platforms use for "click a log line, see
its trace."

---

## Part 4 — The AI root cause worker

### Q: Why an LLM instead of, say, a rules engine for root cause analysis?
**A:** A rules engine (`if payment span failed and previous span was a DB connect,
say "DB issue"`) only covers failure modes you anticipated in advance. An LLM given the
full span waterfall — service, operation, duration, status, error message per span —
can reason about novel combinations of failures without anyone having hand-written a
rule for that exact pattern. The tradeoff is it's non-deterministic and needs prompt
engineering to keep it honest (see `buildPrompt()` in
[`query-api/workers/trace-analyser.js`](./query-api/workers/trace-analyser.js) forcing
strict JSON output with an explicit schema).

### Q: What happens if the LLM returns garbage or invalid JSON?
**A:** `callGroq()`/`callOllama()` regex-extract the first `{...}` block from the
response and `JSON.parse` it; if that throws, `analyzeTraceWithLLM`'s try/catch logs
the error and returns `null`, and the calling loop just skips storing anything for that
trace — it'll be retried on read, wait no, actually it won't be retried automatically
in the current implementation, since nothing marks it as "attempted." **This is a real
gap**: a trace whose LLM call fails once will be retried forever (it stays "not yet in
`trace_insights`"), consuming Groq quota indefinitely, without ever succeeding if the
failure is deterministic (e.g. a consistently malformed prompt). A production version
would need a `attempts`/`last_attempted_at` column to cap retries.

### Q: Why poll every 60 seconds instead of consuming errors off Kafka in real time?
**A:** Simplicity, and because root cause analysis isn't latency-critical the way
trace storage is — a 60-second delay before an incident gets an AI explanation is
completely acceptable, and polling ClickHouse directly avoids running yet another Kafka
consumer group and duplicating the "what counts as an error trace" query logic that
already lives in SQL. The real cost is: at high error volume, this worker could fall
behind (it processes traces serially with a throttle delay between LLM calls
specifically to respect Groq's rate limits).

### Q: What LLM providers does it support and why three?
**A:** `groq` (cloud, free tier, ~1–2s inference — the default), `ollama` (fully local,
zero API key, needs it own GPU/CPU budget, slower), and `mock` (deterministic canned
response, zero external dependency — used for CI/offline demos). Having `mock` matters
for a project like this: anyone cloning the repo without a Groq key can still see the
full pipeline work end-to-end.

---

## Part 5 — Bugs actually found and fixed (great material — these show real debugging, not textbook knowledge)

### Q: What's the trickiest bug you hit building this?
**A:** ClickHouse's `INSERT ... VALUES` clause has a "fast path" parser that compiles a
per-batch template from the expression shapes it sees. When `kafka-consumer` built a
multi-row insert where some rows used the bare `{}` map literal (for spans with no
attributes) and other rows in the *same batch* used `map('k','v')` function calls (for
spans with attributes), ClickHouse threw `Cannot parse expression of type Map(String,
String)` — a `SYNTAX_ERROR` — and **silently failed the entire batch insert**, not just
the malformed row. The visible symptom was bizarre: every span that happened to be
error-tagged (`StatusCode=2`) was systematically missing from ClickHouse, which looked
at first like a filtering bug, when it was actually a batch-level insert failure caused
by row-shape inconsistency. Fix: always emit `map(...)`, never `{}`, so every row in a
batch has the same expression shape. See the code comment above `attributesToMapSql` in
[`kafka-consumer/otlp-parser.js`](./kafka-consumer/otlp-parser.js).

### Q: Any bugs from ClickHouse version differences?
**A:** Two. First, the `?query=...&format=JSON` URL-parameter convention for the HTTP
API was rejected on ClickHouse 24.x (`UNKNOWN_SETTING` on `format`) — the fix is
POSTing the SQL as the raw request body with `FORMAT JSON` appended to the query text
itself, which works across versions. Second — more subtle — `formatDateTime(x,
'%Y-%m-%d %H:%M:%S')` rendered `%M` as the full month name ("July") instead of minutes
on this ClickHouse build, producing timestamps like `2026-07-25 22:July:14`. Root cause
is a ClickHouse compatibility setting
(`formatdatetime_parsedatetime_m_is_month_name`) for MySQL-style format-string
semantics; fixed by pinning that setting to `0` on every query from `query-api`.

### Q: How did you even find these bugs?
**A:** By actually running the stack end-to-end and querying ClickHouse directly rather
than trusting that "the code looks right." The map-literal bug in particular only
showed up under live traffic — unit tests on the parsing logic alone wouldn't have
caught it, because the bug was in how *multiple* rows interacted inside one SQL
statement, not in any single row's generated SQL being wrong. That's a good argument for
integration/smoke testing against the real database, not just unit tests on pure
functions.

### Q: The Groq model `llama3-8b-8192` — what happened there?
**A:** It was decommissioned by Groq at some point after this project was originally
built (`model_decommissioned` error on every call). This isn't really a "bug" so much
as a reminder that **hardcoded third-party model names are a maintenance liability** —
anything that depends on an external vendor's currently-supported model list needs
either a version-pinned fallback list or a startup health check that fails loudly
instead of silently returning empty results forever.

---

## Part 6 — Testing and quality

### Q: What's actually tested, and what would you test if you had more time?
**A:** Two `node:test` suites, deliberately targeting the highest-risk hand-written
code: [`kafka-consumer/otlp-parser.test.js`](./kafka-consumer/otlp-parser.test.js)
(OTLP JSON parsing for traces/metrics/logs, SQL escaping, attribute-map building) and
[`query-api/helpers.test.js`](./query-api/helpers.test.js) (SQL escaping, time-window
resolution). Both target pure functions extracted specifically so they're importable
without a live Kafka/ClickHouse/Redis connection — see how `otlp-parser.js` and
`helpers.js` were split out from files that otherwise connect to external services at
module load time. What's *not* tested: no integration tests against a real ClickHouse
(which is exactly the class of bug that bit us above), no frontend tests, no CI
pipeline running any of this automatically on push.

### Q: Why extract pure functions into separate files instead of testing the main
`index.js` files directly?
**A:** `kafka-consumer/index.js` and `query-api/index.js` both do real work at import
time — connecting to Kafka, connecting to Redis, calling `app.listen()`. Importing
either file in a test process would try to open real network connections immediately,
which is slow, flaky, and requires the whole stack running just to test a string-escaping
function. Splitting the pure logic into `otlp-parser.js`/`helpers.js` means the tests
import zero side effects.

---

## Part 7 — Frontend / dashboard

### Q: How does the dashboard stay "live" — WebSockets?
**A:** No, plain polling — every page does `setInterval(fetchData, 10000-15000)`. For
a demo/single-tenant dashboard this is simpler than WebSockets and avoids a whole class
of connection-management complexity, at the cost of a 10–15 second staleness window
and slightly higher baseline request volume than push-based updates would need.

### Q: The API returns `TraceId`, `ServiceName` (PascalCase) — how does that become
`traceId`, `serviceName` in React?
**A:** [`dashboard/src/lib/api.ts`](./dashboard/src/lib/api.ts) has explicit mapper
functions (`mapTrace`, `mapInsight`, `mapMetricPoint`, `mapAlert`) that read both
possible casings (`row.TraceId ?? row.traceId`) and normalize to camelCase. This is a
deliberate seam: ClickHouse's column-naming convention (PascalCase, matching OTel
semantic conventions loosely) never leaks past `api.ts` into the component layer.

### Q: How were the dashboard's colors chosen — was it just picking something that
looked nice?
**A:** No — the categorical chart palette and status colors were run through a
color-vision-deficiency validator (checking OKLab ΔE separation for protanopia/
deuteranopia/tritanopia, plus WCAG contrast against the actual dark-navy surface color
the app uses) before being adopted, not eyeballed. The validated 8-hue categorical
order and the fixed good/warning/serious/critical status palette both passed every
adjacent-pair CVD-separation and contrast check specifically against this app's
`#171922` dark surface.

---

## Part 8 — Production readiness / what's missing

### Q: Would you deploy this as-is?
**A:** No — it's a single-node Docker Compose demo, not a production system. Concretely
missing: no CI/CD pipeline, no tests beyond two unit-test files, single ClickHouse node
(no replication/HA), no Kubernetes manifests, no auth beyond a permissive mock JWT
middleware, hand-built SQL string concatenation everywhere instead of parameterized
queries (mitigated by consistent `escSql` escaping, but still a larger attack surface
than a query builder), and no tail-based sampling — every span from every request is
stored forever (well, until the 30-day TTL), which doesn't scale past a demo's traffic
volume.

### Q: If traffic increased 100x tomorrow, what's the first thing that breaks?
**A:** Almost certainly ClickHouse insert throughput from `kafka-consumer`, since it's
a single process doing synchronous batched HTTP POSTs to a single ClickHouse node —
there's no horizontal scaling of the consumer (Kafka consumer groups support multiple
consumer instances per partition, but the topics here likely have few partitions by
default, and the code doesn't handle partition-level parallelism explicitly). The
second thing would be trace volume itself — with no sampling, 100x traffic is 100x
more `traces` rows, and query latency on unbounded growth eventually degrades even with
good partitioning.

### Q: What's the single highest-leverage change you'd make next?
**A:** Tail-based sampling at the Collector — keep 100% of error traces (the ones that
actually matter for debugging and feed the AI worker) and probabilistically drop most
successful traces. That's a 10-20x storage reduction with near-zero loss of debugging
value, and it's a config-only change at the Collector, not an application code change.

### Q: Why no Kubernetes / Helm chart?
**A:** Scope — Docker Compose is enough to demonstrate the architecture and is far
easier for anyone cloning the repo to run locally with zero cloud account. Kubernetes
adds real value (horizontal pod autoscaling, rolling deploys, proper service mesh) but
none of that is demonstrable on a laptop, and it's explicitly called out as a future
improvement rather than something silently skipped.

---

## Part 9 — Curveballs / "gotcha" questions

### Q: Isn't hand-writing SQL strings instead of using an ORM/parameterized queries a
security risk?
**A:** Yes, in principle — it's a real SQL injection surface if `escSql` were ever
wrong or bypassed anywhere. It's mitigated by a single consistent escaping function
used everywhere strings are interpolated (backslash + single-quote escaping), applied
in three separate files (`kafka-consumer`, `query-api`, `trace-analyser`) — which is
itself a maintenance smell (duplicated logic, no shared package) I'd flag in a real code
review. The better fix isn't just parameterized queries (ClickHouse's HTTP interface
doesn't support them as naturally as Postgres's protocol does) but consolidating the
escaping helper into one shared module instead of three copies.

### Q: Why does `order-service` and `inventory-service` use the *same* Postgres
container but different databases?
**A:** `ORDER_DB_URL` and `INVENTORY_DB_URL` in `docker-compose.yml` point at the same
Postgres instance with different database names (`orders`, `inventory`) — this is just
resource economy for a demo (one Postgres container instead of two), not a real
microservices pattern; in production these would be genuinely separate databases (or
even different database technologies) to preserve service independence.

### Q: If I asked you to add a sixth service tomorrow, what would you have to touch?
**A:** Add its `app.js` importing `../tracing.js` the same way the other five do
(instant tracing/metrics/logs for free), add its `command: ["node", "--import",
"./tracing.js", "new-service/app.js"]` block to `docker-compose.yml`, and nothing else
— the Collector, Kafka, `kafka-consumer`, `query-api`, and the dashboard's service graph
all derive the new service automatically from its OTel resource attributes and span
data. That "add a service, observability comes for free" property is the whole value
proposition of this architecture.

### Q: What was the actual failure rate you observed from the intentional chaos
injection, and does it match the 10% in the code?
**A:** Yes — verified directly while testing this session: 30 real `/pay` requests
produced 3 real 500s (10%), and 5 checkout attempts through the full saga (which
compounds failure probability across order/inventory/payment/notification, each with
their own 10% chance) produced roughly the expected higher combined failure rate.
Chaos injection working as designed is easy to verify empirically, not just by reading
the `Math.random() < 0.1` line.

---

## How to use this doc in an actual interview

- If asked to whiteboard the architecture, start from §2's diagram and narrate outward.
- If asked "tell me about a bug you fixed," Part 5 is real, specific, and non-generic —
  use it. Interviewers can tell the difference between a memorized bug story and one you
  actually debugged.
- If asked "what would you do differently," Part 8 is honest about the gaps — don't
  oversell this as production-ready; the maturity to say "this is a demo and here's
  specifically what's missing for prod" reads better than pretending it's finished.
