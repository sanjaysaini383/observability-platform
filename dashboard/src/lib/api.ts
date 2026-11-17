import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const api = axios.create({ baseURL: API_URL });

export interface TraceRow {
  traceId: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  statusCode: string;
  timestamp: string;
}

export interface InsightRow {
  traceId: string;
  serviceName: string;
  operationName: string;
  rootCause: string;
  recommendation: string;
  severity: string;
  timestamp: string;
}

export interface MetricPoint {
  time: string;
  p50: number;
  p95: number;
  p99: number;
  rps: number;
  errors: number;
}

export interface ServiceEdge {
  source: string;
  target: string;
  callCount: number;
  avgLatencyMs: number;
  errorCount: number;
}

export interface AlertRow {
  serviceName: string;
  minute: string;
  p99Ms: number;
  totalRequests: number;
  errorCount: number;
  errorRatePct: number;
  severity: string;
}

function statusLabel(code: number | string | undefined): string {
  const n = typeof code === 'string' ? parseInt(code, 10) : code;
  if (n === 2) return 'ERROR';
  if (n === 1) return 'OK';
  return 'OK';
}

export function mapTrace(row: Record<string, unknown>): TraceRow {
  return {
    traceId: String(row.TraceId ?? row.traceId ?? ''),
    serviceName: String(row.ServiceName ?? row.serviceName ?? ''),
    operationName: String(row.OperationName ?? row.operationName ?? ''),
    durationMs: Number(row.DurationMs ?? row.durationMs ?? 0),
    statusCode: statusLabel(row.StatusCode as number | string | undefined),
    timestamp: String(row.StartTimeStr ?? row.timestamp ?? row.AnalysedAt ?? ''),
  };
}

export function mapInsight(row: Record<string, unknown>): InsightRow {
  return {
    traceId: String(row.TraceId ?? row.traceId ?? ''),
    serviceName: String(row.ServiceName ?? row.serviceName ?? ''),
    operationName: String(row.OperationName ?? row.operationName ?? ''),
    rootCause: String(row.RootCause ?? row.rootCause ?? ''),
    recommendation: String(row.Recommendation ?? row.recommendation ?? ''),
    severity: String(row.Severity ?? row.severity ?? 'MEDIUM').toUpperCase(),
    timestamp: String(row.AnalysedAt ?? row.timestamp ?? ''),
  };
}

export function mapMetricPoint(row: Record<string, unknown>): MetricPoint {
  const totalRequests = Number(row.total_requests ?? 0);
  return {
    time: String(row.MinuteStr ?? row.time ?? ''),
    p50: Number(row.p50_ms ?? row.p50 ?? 0),
    p95: Number(row.p95_ms ?? row.p95 ?? 0),
    p99: Number(row.p99_ms ?? row.p99 ?? 0),
    rps: totalRequests / 60,
    errors: Number(row.error_rate_pct ?? row.errors ?? 0),
  };
}

export function mapAlert(row: Record<string, unknown>): AlertRow {
  return {
    serviceName: String(row.ServiceName ?? row.serviceName ?? ''),
    minute: String(row.MinuteStr ?? row.minute ?? ''),
    p99Ms: Number(row.p99_ms ?? row.p99Ms ?? 0),
    totalRequests: Number(row.total_requests ?? 0),
    errorCount: Number(row.error_count ?? 0),
    errorRatePct: Number(row.error_rate_pct ?? 0),
    severity: String(row.severity ?? 'medium'),
  };
}

export async function fetchTraces(params?: {
  service?: string;
  status?: string;
  limit?: number;
}): Promise<TraceRow[]> {
  const res = await api.get('/api/traces', { params });
  const rows = res.data?.traces ?? res.data ?? [];
  return Array.isArray(rows) ? rows.map(mapTrace) : [];
}

export async function fetchInsights(): Promise<InsightRow[]> {
  const res = await api.get('/api/insights');
  const rows = res.data?.insights ?? res.data ?? [];
  return Array.isArray(rows) ? rows.map(mapInsight) : [];
}

export async function fetchMetrics(service: string, window: string): Promise<MetricPoint[]> {
  const res = await api.get('/api/metrics', { params: { service, window } });
  const rows = res.data?.metrics ?? res.data ?? [];
  return Array.isArray(rows) ? rows.map(mapMetricPoint) : [];
}

export async function fetchServiceNames(): Promise<string[]> {
  const res = await api.get('/api/services/names');
  return Array.isArray(res.data?.services) ? res.data.services : [];
}

export async function fetchServices(): Promise<{
  nodes: { id: string; label: string }[];
  edges: ServiceEdge[];
}> {
  const res = await api.get('/api/services');
  return {
    nodes: res.data?.nodes ?? [],
    edges: res.data?.edges ?? [],
  };
}

export async function fetchAlerts(): Promise<AlertRow[]> {
  const res = await api.get('/api/alerts');
  const rows = res.data?.alerts ?? res.data ?? [];
  return Array.isArray(rows) ? rows.map(mapAlert) : [];
}

export async function fetchTraceDetail(traceId: string) {
  const res = await api.get(`/api/traces/${traceId}`);
  return res.data;
}
