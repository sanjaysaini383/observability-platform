import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchTraces, fetchTraceDetail, type TraceRow } from '@/lib/api';

export default function Traces() {
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceRow | null>(null);
  const [traceSpans, setTraceSpans] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadTraces = async () => {
    try {
      const params: { limit: number; service?: string; status?: string } = { limit: 50 };
      if (serviceFilter) params.service = serviceFilter;
      if (statusFilter) params.status = statusFilter;
      const rows = await fetchTraces(params);
      setTraces(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTraces();
    const interval = setInterval(loadTraces, 10000);
    return () => clearInterval(interval);
  }, [serviceFilter, statusFilter]);

  const handleSelectTrace = async (trace: TraceRow) => {
    setSelectedTrace(trace);
    try {
      const detail = await fetchTraceDetail(trace.traceId);
      setTraceSpans(detail.spans ?? []);
    } catch {
      setTraceSpans([]);
    }
  };

  return (
    <div className="flex h-full gap-6">
      <div className={`flex-1 flex flex-col transition-all ${selectedTrace ? 'w-2/3' : 'w-full'}`}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold tracking-tight">Traces Explorer</h2>
          <p className="text-sm text-muted-foreground mt-1">Search and inspect distributed traces across every service</p>
        </div>

        <Card className="flex-1 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border flex gap-4 bg-muted/20">
            <select
              className="bg-background border border-border text-sm rounded-md px-3 py-1.5 text-foreground"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
            >
              <option value="">All Services</option>
              <option value="api-gateway">api-gateway</option>
              <option value="order-service">order-service</option>
              <option value="payment-service">payment-service</option>
              <option value="inventory-service">inventory-service</option>
              <option value="notification-service">notification-service</option>
            </select>
            <select
              className="bg-background border border-border text-sm rounded-md px-3 py-1.5 text-foreground"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Status</option>
              <option value="error">Error</option>
              <option value="ok">OK</option>
            </select>
          </div>

          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Trace ID</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8">Loading traces...</TableCell></TableRow>
                ) : traces.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8">No traces found</TableCell></TableRow>
                ) : (
                  traces.map((trace) => (
                    <TableRow
                      key={trace.traceId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSelectTrace(trace)}
                    >
                      <TableCell className="font-mono text-xs">{trace.traceId.substring(0, 8)}</TableCell>
                      <TableCell className="font-medium">{trace.serviceName}</TableCell>
                      <TableCell>{trace.operationName}</TableCell>
                      <TableCell>{trace.durationMs ? `${Math.round(trace.durationMs)}ms` : '-'}</TableCell>
                      <TableCell>
                        <Badge variant={trace.statusCode === 'ERROR' ? 'destructive' : 'success'}>
                          {trace.statusCode}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{trace.timestamp}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {selectedTrace && (
        <Card className="w-1/3 flex flex-col animate-in slide-in-from-right-8 duration-300">
          <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
            <h3 className="font-semibold truncate">Trace Details</h3>
            <button
              className="text-muted-foreground hover:text-foreground px-2 py-1"
              onClick={() => { setSelectedTrace(null); setTraceSpans([]); }}
            >
              ✕
            </button>
          </div>
          <CardContent className="flex-1 overflow-auto p-4 space-y-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Trace ID</div>
              <div className="font-mono text-sm bg-muted p-2 rounded">{selectedTrace.traceId}</div>
            </div>

            <div>
              <h4 className="font-semibold mb-3">Span Waterfall</h4>
              <div className="space-y-2 border-l-2 border-border pl-4">
                {traceSpans.length > 0 ? traceSpans.map((span) => (
                  <div
                    key={String(span.SpanId)}
                    className="relative h-6 bg-primary/20 rounded w-full flex items-center px-2 text-xs text-primary font-medium"
                  >
                    {String(span.ServiceName)} : {String(span.OperationName)}
                    {span.DurationMs != null && (
                      <span className="ml-auto text-muted-foreground">{Math.round(Number(span.DurationMs))}ms</span>
                    )}
                  </div>
                )) : (
                  <div className="relative h-6 bg-primary/20 rounded w-full flex items-center px-2 text-xs text-primary font-medium">
                    {selectedTrace.serviceName} : {selectedTrace.operationName}
                  </div>
                )}
              </div>
            </div>

            {selectedTrace.statusCode === 'ERROR' && (
              <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg">
                <h4 className="text-destructive font-semibold mb-2">Error Trace</h4>
                <p className="text-sm text-destructive/80">
                  This trace contains error spans. Check AI Insights for root cause analysis.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
