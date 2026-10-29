import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Activity, Network, BarChart2, BrainCircuit, Aperture } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Sidebar() {
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Traces', path: '/traces', icon: Activity },
    { name: 'Services', path: '/services', icon: Network },
    { name: 'Metrics', path: '/metrics', icon: BarChart2 },
    { name: 'AI Insights', path: '/ai-insights', icon: BrainCircuit },
  ];

  return (
    <div className="w-64 bg-card border-r border-border h-full flex flex-col">
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Aperture className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-lg font-bold tracking-tight leading-none">
            Trace<span className="text-primary">Lens</span>
          </h1>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1 mt-2">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors text-sm",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-6 border-t border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
          System Healthy
        </div>
      </div>
    </div>
  );
}
