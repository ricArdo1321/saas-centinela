import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Shield, Cpu, Server, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '../components/UI';
import { useQuery } from '../hooks/useQuery';
import { api } from '../services/api';
import { Detection } from '../types';

const KPICard = ({ title, value, subtext, icon: Icon, colorClass, loading }: any) => (
  <Card className="relative overflow-hidden">
    <div className={`absolute top-0 right-0 p-3 opacity-10 ${colorClass}`}>
      <Icon size={60} />
    </div>
    <CardHeader className="pb-2">
      <h3 className="text-sm font-medium text-slate-400">{title}</h3>
    </CardHeader>
    <CardContent>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <div className="space-y-1">
          <div className={`text-3xl font-bold ${colorClass.replace('bg-', 'text-').replace('/10', '')}`}>{value}</div>
          <p className="text-xs text-slate-500">{subtext}</p>
        </div>
      )}
    </CardContent>
  </Card>
);

const ActivityItem = ({ detection }: { detection: Detection; key?: any }) => (
  <div className="flex gap-4 p-3 rounded-2xl hover:bg-slate-800/50 transition-colors border-l-2 border-transparent hover:border-slate-700">
    <div className={`mt-1 w-2 h-2 rounded-full ${detection.severity === 'critical' ? 'bg-red-500' :
        detection.severity === 'high' ? 'bg-orange-500' : 'bg-blue-500'
      }`} />
    <div className="flex-1 space-y-1">
      <div className="flex justify-between items-start">
        <p className="text-sm font-medium text-slate-200">{detection.detection_type}</p>
        <span className="text-xs text-slate-500 font-mono">{new Date(detection.created_at).toLocaleTimeString()}</span>
      </div>
      <p className="text-xs text-slate-400">Origen: <span className="font-mono text-slate-500">{detection.source_ip}</span></p>
    </div>
  </div>
);

// Chart data will come from API in future versions
const CHART_DATA: { time: string; events: number; detections: number }[] = [];

export const Dashboard = () => {
  const { data: stats, isLoading: statsLoading } = useQuery('dashboard-stats', api.getStats);
  const { data: detections, isLoading: detectionsLoading } = useQuery('recent-detections', api.getDetections);

  // Filter recent 5 for feed
  const recentActivity = detections ? detections.slice(0, 5) : [];

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Resumen del Dashboard</h1>
        <p className="text-slate-400 text-sm">Postura de seguridad en tiempo real y análisis de amenazas.</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Alertas Críticas (24h)"
          value={stats?.detections.critical ?? 0}
          subtext="Últimas 24 horas"
          icon={Shield}
          colorClass="text-red-500"
          loading={statsLoading}
        />
        <KPICard
          title="Eventos Procesados"
          value={stats?.events.processed_24h?.toLocaleString() ?? '0'}
          subtext="Últimas 24 horas"
          icon={Activity}
          colorClass="text-primary"
          loading={statsLoading}
        />
        <KPICard
          title="Tasa de Aciertos Caché"
          value={stats?.cache.hit_rate != null ? `${stats.cache.hit_rate.toFixed(1)}%` : '0%'}
          subtext={stats?.cache.total_hits != null ? `${stats.cache.total_hits.toLocaleString()} aciertos` : 'Sin datos'}
          icon={Cpu}
          colorClass="text-emerald-500"
          loading={statsLoading}
        />
        <KPICard
          title="Estado Agentes IA"
          value={stats?.agents.healthy ? "Saludable" : "Degradado"}
          subtext="Todos los modelos operativos"
          icon={CheckCircle2}
          colorClass="text-sky-400"
          loading={statsLoading}
        />
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Main Chart */}
        <Card className="lg:col-span-2 min-h-[400px]">
          <CardHeader>
            <CardTitle>Eventos vs. Detecciones</CardTitle>
          </CardHeader>
          <CardContent className="h-[350px] flex items-center justify-center">
            {CHART_DATA.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={CHART_DATA}>
                  <defs>
                    <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a5b4fc" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a5b4fc" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorDetections" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                  <XAxis dataKey="time" stroke="#525252" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#525252" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#f5f5f5' }}
                  />
                  <Area type="monotone" dataKey="events" stroke="#a5b4fc" fillOpacity={1} fill="url(#colorEvents)" />
                  <Area type="monotone" dataKey="detections" stroke="#f43f5e" fillOpacity={1} fill="url(#colorDetections)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-slate-500">
                <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Gráfico de tendencias</p>
                <p className="text-xs mt-1">Disponible cuando haya datos históricos</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Feed en Vivo</CardTitle>
          </CardHeader>
          <CardContent>
            {detectionsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
                {recentActivity.map(d => <ActivityItem key={d.id} detection={d} />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};
