import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Info, BrainCircuit } from 'lucide-react';
import { fetchInsights, type InsightRow } from '@/lib/api';

export default function AiInsights() {
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await fetchInsights();
        setInsights(rows);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const filtered = insights.filter((i) => {
    if (severityFilter && i.severity !== severityFilter) return false;
    if (serviceFilter && i.serviceName !== serviceFilter) return false;
    return true;
  });

  const stats = {
    total: insights.length,
    critical: insights.filter((i) => i.severity === 'CRITICAL').length,
    high: insights.filter((i) => i.severity === 'HIGH').length,
  };

  const getSeverityVariant = (sev: string) => {
    switch (sev) {
      case 'CRITICAL': return 'destructive';
      case 'HIGH': return 'serious';
      case 'MEDIUM': return 'warning';
      default: return 'secondary';
    }
  };

  const getSeverityBarClass = (sev: string) => {
    switch (sev) {
      case 'CRITICAL': return 'bg-destructive';
      case 'HIGH': return 'bg-serious';
      case 'MEDIUM': return 'bg-warning';
      default: return 'bg-muted';
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">AI Root Cause Insights</h2>
        <p className="text-sm text-muted-foreground mt-1">LLM-generated root cause analysis for recent error traces</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-muted/20 border-border/50">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Analysed</p>
              <h3 className="text-3xl font-bold mt-1">{stats.total}</h3>
            </div>
            <Info className="w-8 h-8 text-primary/40" />
          </CardContent>
        </Card>
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Critical Incidents</p>
              <h3 className="text-3xl font-bold text-destructive mt-1">{stats.critical}</h3>
            </div>
            <AlertCircle className="w-8 h-8 text-destructive/40" />
          </CardContent>
        </Card>
        <Card className="bg-serious/5 border-serious/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">High Severity</p>
              <h3 className="text-3xl font-bold text-serious mt-1">{stats.high}</h3>
            </div>
            <AlertCircle className="w-8 h-8 text-serious/40" />
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4 mb-6">
        <select
          className="bg-card border border-border text-sm rounded-md px-3 py-2 text-foreground outline-none"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">All Severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <select
          className="bg-card border border-border text-sm rounded-md px-3 py-2 text-foreground outline-none"
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
        >
          <option value="">All Services</option>
          <option value="payment-service">payment-service</option>
          <option value="order-service">order-service</option>
          <option value="inventory-service">inventory-service</option>
          <option value="api-gateway">api-gateway</option>
          <option value="notification-service">notification-service</option>
        </select>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-10 text-muted-foreground">Loading AI analysis...</div>
        ) : filtered.length === 0 ? (
          <Card className="bg-muted/10 border-dashed">
            <CardContent className="py-12 flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="w-12 h-12 text-success/50 mb-4" />
              <h3 className="text-xl font-semibold mb-2">No active incidents</h3>
              <p className="text-muted-foreground max-w-sm">The LLM has not detected any anomalous traces in the last period. Your system is running smoothly.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((insight) => (
            <Card key={insight.traceId} className="overflow-hidden border-border transition-all hover:border-primary/30">
              <div className={`h-1 w-full ${getSeverityBarClass(insight.severity)}`} />
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex gap-3 items-center">
                    <Badge variant={getSeverityVariant(insight.severity) as 'destructive' | 'serious' | 'warning' | 'secondary'}>
                      {insight.severity}
                    </Badge>
                    <span className="font-semibold text-lg">{insight.serviceName}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{insight.timestamp}</span>
                </div>

                <div className="grid md:grid-cols-2 gap-6 mt-4">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Root Cause</h4>
                    <p className="text-sm leading-relaxed">{insight.rootCause}</p>
                  </div>
                  <div className="space-y-2 bg-muted/30 p-4 rounded-lg border border-border">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <BrainCircuit className="w-4 h-4" /> Recommended Action
                    </h4>
                    <p className="text-sm leading-relaxed text-primary/90">{insight.recommendation}</p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
                  <span>Trace ID: <span className="font-mono bg-muted px-1 py-0.5 rounded text-foreground">{insight.traceId}</span></span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
