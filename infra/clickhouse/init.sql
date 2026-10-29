-- Traces table: optimized for distributed trace queries
CREATE TABLE IF NOT EXISTS traces (
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

-- Metrics table: for metrics aggregation
CREATE TABLE IF NOT EXISTS metrics (
  ServiceName    LowCardinality(String),
  MetricName     LowCardinality(String),
  MetricType     LowCardinality(String),
  Timestamp      DateTime64(9, 'UTC'),
  Value          Float64,
  Attributes     Map(String, String)
) ENGINE = MergeTree()
ORDER BY (ServiceName, MetricName, Timestamp)
PARTITION BY toYYYYMMDD(Timestamp)
TTL toDateTime(Timestamp) + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;

-- Logs table: for structured logging
CREATE TABLE IF NOT EXISTS logs (
  ServiceName    LowCardinality(String),
  Timestamp      DateTime64(9, 'UTC'),
  SeverityText   LowCardinality(String),
  SeverityNumber UInt8,
  Body           String,
  TraceId        String,
  SpanId         String,
  Attributes     Map(String, String)
) ENGINE = MergeTree()
ORDER BY (ServiceName, Timestamp)
PARTITION BY toYYYYMMDD(Timestamp)
TTL toDateTime(Timestamp) + INTERVAL 14 DAY
SETTINGS index_granularity = 8192;

-- Materialised view: p50, p95, p99 latency per service per minute
CREATE MATERIALIZED VIEW IF NOT EXISTS service_latency_mv
ENGINE = AggregatingMergeTree()
ORDER BY (ServiceName, Minute)
PARTITION BY toYYYYMMDD(Minute)
SETTINGS index_granularity = 8192
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

-- View to query the materialised view with final aggregation
CREATE VIEW IF NOT EXISTS service_latency AS
SELECT
  ServiceName,
  Minute,
  quantileMerge(0.50)(p50_state)    AS p50_ns,
  quantileMerge(0.95)(p95_state)    AS p95_ns,
  quantileMerge(0.99)(p99_state)    AS p99_ns,
  countMerge(request_count_state)   AS total_requests,
  sumMerge(error_count_state)       AS error_count,
  (sumMerge(error_count_state) * 100.0) / countMerge(request_count_state) AS error_rate_pct
FROM service_latency_mv
GROUP BY ServiceName, Minute
ORDER BY Minute DESC;

-- Trace insights table: stores LLM-generated root cause analysis
CREATE TABLE IF NOT EXISTS trace_insights (
  TraceId        String,
  ServiceName    LowCardinality(String),
  OperationName  String,
  AnalysedAt     DateTime64(9, 'UTC'),
  RootCause      String,
  ImpactedSpans  Array(String),
  Recommendation String,
  Severity       LowCardinality(String)  -- low / medium / high / critical
) ENGINE = MergeTree()
ORDER BY (ServiceName, AnalysedAt)
PARTITION BY toYYYYMMDD(AnalysedAt)
TTL toDateTime(AnalysedAt) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;

-- Analysis attempts: append-only log of failed LLM analysis attempts, so
-- trace-analyser can cap retries on a trace that keeps failing (bad prompt,
-- persistent rate limit) instead of re-attempting it forever on every poll.
CREATE TABLE IF NOT EXISTS analysis_attempts (
  TraceId     String,
  AttemptedAt DateTime64(3, 'UTC')
) ENGINE = MergeTree()
ORDER BY (TraceId, AttemptedAt)
TTL toDateTime(AttemptedAt) + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;

-- Service dependency view: joins spans to track call paths
CREATE VIEW IF NOT EXISTS service_dependencies AS
SELECT
  source.ServiceName AS source_service,
  source.OperationName AS source_operation,
  target.ServiceName AS target_service,
  target.OperationName AS target_operation,
  count() AS call_count,
  avg(target.Duration) AS avg_latency_ns,
  max(target.Duration) AS max_latency_ns,
  min(target.Duration) AS min_latency_ns,
  sum(if(target.StatusCode = 2, 1, 0)) AS error_count
FROM traces AS source
JOIN traces AS target ON 
  source.SpanId = target.ParentSpanId AND
  source.TraceId = target.TraceId
WHERE source.StartTime > now() - INTERVAL 1 HOUR
GROUP BY source_service, source_operation, target_service, target_operation
ORDER BY call_count DESC;

-- Error trace summary: quickly identify problematic traces
CREATE VIEW IF NOT EXISTS error_traces AS
SELECT
  TraceId,
  ServiceName,
  OperationName,
  StartTime,
  Duration,
  StatusMessage,
  arrayDistinct(
    groupArray(if(StatusCode = 2, ServiceName, ''))
  ) AS services_with_errors
FROM traces
WHERE StatusCode = 2
GROUP BY TraceId, ServiceName, OperationName, StartTime, Duration, StatusMessage
ORDER BY StartTime DESC
LIMIT 1000;
