import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, AlertTriangle, Clock, Server } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { fetchMetrics, fetchInsights, fetchTraces, fetchServices } from '@/lib/api';

export default function Dashboard() {
  const [data, setData] = useState({
    kpis: { totalRequests: 0, errorRate: 0, p99: 0, activeServices: 0 },
    sparkline: [] as { time: string; value: number }[],
    errors: [] as Awaited<ReturnType<typeof fetchTraces>>,
    insights: [] as Awaited<ReturnType<typeof fetchInsights>>,
  });

  const fetchData = async () => {
    try {
      const [metrics, insights, errors, services] = await Promise.all([
        fetchMetrics('api-gateway', '1h').catch(() => []),
        fetchInsights().catch(() => []),
        fetchTraces({ status: 'error', limit: 10 }).catch(() => []),
        fetchServices().catch(() => ({ nodes: [], edges: [] })),
      ]);

      const sparkline = metrics.map((m) => ({
        time: m.time,
        value: Math.round(m.rps * 60),
      }));

      const totalRequests = metrics.reduce((acc, m) => acc + m.rps * 60, 0);
      const latest = metrics[metrics.length - 1];

      setData({
        kpis: {
          totalRequests: Math.round(totalRequests),
          errorRate: latest?.errors ?? 0,
          p99: latest?.p99 ?? 0,
          activeServices: services.nodes.length,
        },
        sparkline,
        errors,
        insights,
      });
    } catch (error) {
      console.error('Failed to fetch dashboard data', error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground mt-1">Live overview of request volume, latency, and system health</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.kpis.totalRequests.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{data.kpis.errorRate.toFixed(2)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">P99 Latency</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.kpis.p99.toFixed(0)} ms</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Services</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.kpis.activeServices}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Requests per Minute (Live)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {data.sparkline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.sparkline}>
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">Waiting for traffic...</div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>AI Root Cause Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.insights.length > 0 ? data.insights.slice(0, 5).map((insight) => (
                <div key={insight.traceId} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-primary">{insight.serviceName}</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${insight.severity === 'CRITICAL' ? 'bg-destructive/20 text-destructive' : 'bg-serious/20 text-serious'}`}>
                      {insight.severity}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{insight.rootCause}</p>
                </div>
              )) : (
                <div className="text-center text-muted-foreground py-8">No recent insights</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Errors Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.errors.length > 0 ? data.errors.map((err) => (
              <div key={err.traceId} className="flex flex-col md:flex-row md:items-center justify-between border-b border-border pb-3 last:border-0 gap-2">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{err.traceId.substring(0, 8)}</span>
                  <span className="font-medium">{err.serviceName}</span>
                </div>
                <span className="text-sm text-destructive">{err.operationName}</span>
              </div>
            )) : (
              <div className="text-center text-muted-foreground py-8">No recent errors</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
