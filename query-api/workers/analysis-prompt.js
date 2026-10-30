// Prompt builder for the LLM trace analyser.
//
// ClickHouse returns each groupArray tuple as a JSON array, so the span
// fields live at fixed 0-based indexes:
// [SpanId, ServiceName, OperationName, DurationMs, Status, StatusMessage].
export function buildPrompt(trace) {
  const spanList = trace.spans
    .map((span, idx) =>
      `${idx + 1}. [${span[1]}] ${span[2]} | Duration: ${span[3]}ms | Status: ${span[4]}${
        span[5] ? ` | Error: ${span[5]}` : ''
      }`
    )
    .join('\n');

  return `You are a distributed systems expert. Analyze this error trace from a microservices system and identify the root cause.

Trace ID: ${trace.TraceId}
Service: ${trace.ServiceName}
Operation: ${trace.OperationName}
Error: ${trace.StatusMessage || 'Unknown error'}

Spans (oldest to newest):
${spanList}

Respond in JSON only, no markdown, no explanation:
{
  "root_cause": "one sentence description of what went wrong",
  "impacted_services": ["service1", "service2"],
  "severity": "low|medium|high|critical",
  "recommendation": "one sentence actionable fix"
}`;
}
