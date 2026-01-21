import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Zap, Database, TrendingUp, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Table, TableHeader, TableRow, TableHead, TableCell, Skeleton } from '../components/UI';
import { useQuery } from '../hooks/useQuery';
import { api } from '../services/api';

export const Cache = () => {
  const { data: patterns, isLoading, error } = useQuery('cache-patterns', api.getCachePatterns);
  const { data: cacheStats } = useQuery('cache-stats', api.getCacheStats);

  // Use real data from API or show zeros
  const stats = [
    { label: "Patrones Totales", value: cacheStats?.total_patterns?.toLocaleString() ?? '0', icon: Database, color: "text-blue-400" },
    { label: "Patrones Válidos", value: cacheStats?.valid_patterns?.toLocaleString() ?? '0', icon: Zap, color: "text-yellow-400" },
    { label: "Total Aciertos", value: cacheStats?.total_hits?.toLocaleString() ?? '0', icon: TrendingUp, color: "text-emerald-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Inteligencia de Caché</h1>
        <p className="text-slate-400 text-sm">Rendimiento de caché semántico y firmas de amenazas aprendidas.</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-4 py-6">
              <div className={`p-3 rounded-full bg-slate-900 ${stat.color}`}>
                <stat.icon size={24} />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
                <p className="text-2xl font-bold text-slate-100">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Table */}
        <Card className="min-h-[400px]">
          <CardHeader>
            <CardTitle>Top Patrones Aprendidos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : error ? (
              <div className="p-6 text-center text-slate-500">
                <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No se pudieron cargar los patrones</p>
                <p className="text-xs mt-1">El caché se llenará cuando haya análisis de IA</p>
              </div>
            ) : patterns && patterns.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hash de Firma</TableHead>
                    <TableHead>Tipo de Amenaza</TableHead>
                    <TableHead className="text-right">Impactos</TableHead>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {patterns.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell><code className="bg-slate-900 px-2 py-1 rounded-md text-xs text-primary">{p.signature}</code></TableCell>
                      <TableCell>{p.threat_type}</TableCell>
                      <TableCell>
                        <div className="text-right font-mono text-slate-400">{p.hits.toLocaleString()}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="p-6 text-center text-slate-500">
                <Database className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Sin patrones en caché</p>
                <p className="text-xs mt-1">Aparecerán cuando el sistema analice eventos</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chart */}
        <Card className="min-h-[400px]">
          <CardHeader>
            <CardTitle>Distribución de Amenazas (En Caché)</CardTitle>
          </CardHeader>
          <CardContent className="h-[350px] flex items-center justify-center">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : patterns && patterns.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={patterns} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <XAxis type="number" stroke="#525252" fontSize={12} />
                  <YAxis dataKey="threat_type" type="category" width={100} stroke="#a3a3a3" fontSize={12} />
                  <Tooltip cursor={{ fill: '#262626' }} contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#f5f5f5' }} />
                  <Bar dataKey="hits" radius={[0, 16, 16, 0]} barSize={24}>
                    {patterns.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#a5b4fc' : '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-slate-500">
                <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Sin datos para graficar</p>
                <p className="text-xs mt-1">El gráfico aparecerá con los patrones</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
