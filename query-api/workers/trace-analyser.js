import axios from 'axios';
import dotenv from 'dotenv';
import { escSql } from '../../shared/sql-utils.js';
import { buildPrompt } from './analysis-prompt.js';

dotenv.config();

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
const ANALYSIS_INTERVAL = parseInt(process.env.ANALYSIS_INTERVAL || '60000', 10);
// Cap retries on traces whose LLM analysis keeps failing (bad prompt, persistent
// rate limit, etc.) so they don't get re-attempted forever on every poll cycle.
const MAX_ANALYSIS_ATTEMPTS = parseInt(process.env.ANALYSIS_MAX_ATTEMPTS || '3', 10);

// ── LLM Provider configuration ──────────────────────────────────────────────
// Set LLM_PROVIDER to "groq", "ollama", or "mock" in your environment.
// "mock" is useful for development when you have no LLM available.
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';

// Ollama config (local, free, needs ~600MB-4GB disk)
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.MODEL || 'tinyllama';

// Groq config (cloud, free tier, zero local storage — needs API key)
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

console.log(`🧠 LLM Provider: ${LLM_PROVIDER.toUpperCase()}`);
if (LLM_PROVIDER === 'ollama') console.log(`   Model: ${OLLAMA_MODEL} @ ${OLLAMA_URL}`);
if (LLM_PROVIDER === 'groq')   console.log(`   Model: ${GROQ_MODEL} (Groq Cloud)`);
if (LLM_PROVIDER === 'mock')   console.log(`   Using mock responses (no LLM)`);

// ── ClickHouse helpers ───────────────────────────────────────────────────────

// Ensure CLICKHOUSE_URL always ends with '/' so the HTTP interface works correctly
const CLICKHOUSE_BASE = CLICKHOUSE_URL.endsWith('/') ? CLICKHOUSE_URL : `${CLICKHOUSE_URL}/`;

async function queryClickHouse(sql) {
  try {
    // POST the SQL as request body with FORMAT appended — the ?query=...&format=
    // URL-param style was removed in ClickHouse 24.x (matches query-api/index.js).
    const query = `${sql.trim()} FORMAT JSON`;
    const response = await axios.post(CLICKHOUSE_BASE, query, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 5000,
    });
    return response.data.data || [];
  } catch (error) {
    console.error('Error querying ClickHouse:', error.message);
    return [];
  }
}

async function execClickHouse(sql) {
  await axios.post(CLICKHOUSE_BASE, sql.trim(), {
    headers: { 'Content-Type': 'text/plain' },
    timeout: 5000,
  });
}

async function getUnanalysedErrorTraces() {
  const sql = `
    SELECT
      t.TraceId,
      t.ServiceName,
      t.OperationName,
      t.StartTime,
      t.StatusMessage,
      groupArray(
        tuple(
          t.SpanId,
          t.ServiceName,
          t.OperationName,
          t.Duration / 1000000,
          if(t.StatusCode = 2, 'ERROR', 'OK'),
          t.StatusMessage
        )
      ) as spans
    FROM traces t
    WHERE t.StatusCode = 2
      AND t.StartTime > now() - INTERVAL 5 MINUTE
      AND t.TraceId NOT IN (SELECT TraceId FROM trace_insights)
      AND t.TraceId NOT IN (
        SELECT TraceId FROM analysis_attempts
        GROUP BY TraceId HAVING count() >= ${MAX_ANALYSIS_ATTEMPTS}
      )
    GROUP BY t.TraceId, t.ServiceName, t.OperationName, t.StartTime, t.StatusMessage
    ORDER BY t.StartTime DESC
    LIMIT 10
  `;
  return queryClickHouse(sql);
}

async function recordAnalysisAttempt(traceId) {
  const sql = `
    INSERT INTO analysis_attempts (TraceId, AttemptedAt)
    VALUES ('${escSql(traceId)}', now())
  `;
  try {
    await execClickHouse(sql);
  } catch (error) {
    console.error('Error recording analysis attempt:', error.message);
  }
}

async function storeAnalysis(trace, analysis) {
  const sql = `
    INSERT INTO trace_insights (
      TraceId, ServiceName, OperationName, AnalysedAt,
      RootCause, ImpactedSpans, Recommendation, Severity
    ) VALUES (
      '${escSql(trace.TraceId)}',
      '${escSql(trace.ServiceName)}',
      '${escSql(trace.OperationName)}',
      now(),
      '${escSql(analysis.rootCause)}',
      ['${(analysis.impactedServices || []).map(escSql).join("','")}'],
      '${escSql(analysis.recommendation)}',
      '${escSql(analysis.severity)}'
    )
  `;

  try {
    await execClickHouse(sql);
    console.log(`✓ Stored analysis for trace ${trace.TraceId}`);
  } catch (error) {
    console.error('Error storing analysis:', error.message);
  }
}

// ── LLM Providers ────────────────────────────────────────────────────────────

async function callOllama(prompt) {
  const response = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    {
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      temperature: 0.3,
    },
    { timeout: 60000 }
  );

  if (!response.data.response) throw new Error('Empty Ollama response');

  const jsonMatch = response.data.response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not extract JSON from Ollama response');
  return JSON.parse(jsonMatch[0]);
}

async function callGroq(prompt) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not set. Get a free key at console.groq.com');
  }

  const response = await axios.post(
    GROQ_API_URL,
    {
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a distributed systems expert. Always respond with valid JSON only, no markdown.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 512,
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const content = response.data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty Groq response');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not extract JSON from Groq response');
  return JSON.parse(jsonMatch[0]);
}

function callMock(trace) {
  // Returns a deterministic fake analysis — useful for demos without any LLM
  const severities = ['low', 'medium', 'high', 'critical'];
  const severity = severities[Math.floor(Math.random() * severities.length)];
  return {
    root_cause: `Simulated error in ${trace.ServiceName}: ${trace.StatusMessage || 'service returned an error'}`,
    impacted_services: [trace.ServiceName],
    severity,
    recommendation: 'Check service logs and retry the operation. This is a mock analysis.',
  };
}

// ── Main analysis loop ───────────────────────────────────────────────────────

async function analyzeTraceWithLLM(trace) {
  try {
    const prompt = buildPrompt(trace);
    console.log(`🧠 Analyzing trace ${trace.TraceId.substring(0, 8)}...`);

    let parsed;

    if (LLM_PROVIDER === 'groq') {
      parsed = await callGroq(prompt);
    } else if (LLM_PROVIDER === 'mock') {
      parsed = callMock(trace);
    } else {
      // Default: ollama
      parsed = await callOllama(prompt);
    }

    console.log(`✓ Analysis complete — severity: ${parsed.severity}`);

    return {
      rootCause:        parsed.root_cause        || 'Unknown cause',
      impactedServices: parsed.impacted_services || [trace.ServiceName],
      severity:         parsed.severity          || 'medium',
      recommendation:   parsed.recommendation    || 'Investigate service logs',
    };
  } catch (error) {
    console.error(`✗ LLM error for trace ${trace.TraceId.substring(0, 8)}: ${error.message}`);
    return null;
  }
}

async function analyzeErrorTraces() {
  try {
    const traces = await getUnanalysedErrorTraces();

    if (traces.length === 0) {
      console.log('ℹ No unanalysed error traces found');
      return;
    }

    console.log(`Found ${traces.length} unanalysed error traces`);

    for (const trace of traces) {
      const analysis = await analyzeTraceWithLLM(trace);
      if (analysis) {
        await storeAnalysis(trace, analysis);
      } else {
        await recordAnalysisAttempt(trace.TraceId);
      }
      // Throttle — Groq has rate limits; Ollama needs breathing room
      await new Promise((resolve) => setTimeout(resolve, LLM_PROVIDER === 'groq' ? 1000 : 2000));
    }
  } catch (error) {
    console.error('Error in analysis loop:', error.message);
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

async function start() {
  console.log('🚀 Starting LLM trace analyser...');
  console.log(`📊 ClickHouse: ${CLICKHOUSE_URL}`);
  console.log(`⏱️  Analysis interval: ${ANALYSIS_INTERVAL}ms`);

  await analyzeErrorTraces();
  setInterval(analyzeErrorTraces, ANALYSIS_INTERVAL);
}

process.on('SIGINT', () => {
  console.log('\n⏹️  Stopping analyser...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Stopping analyser...');
  process.exit(0);
});

start().catch((error) => {
  console.error('Failed to start analyser:', error.message);
  process.exit(1);
});
