import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Zap, Database, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Table, TableHeader, TableRow, TableHead, TableCell, Skeleton } from '../components/UI';
import { useQuery, api } from '../services/mockApi';

export const Cache = () => {
  const { data: patterns, isLoading } = useQuery('cache-patterns', api.getCachePatterns);

  const stats = [
    { label: "Patrones Totales", value: "1,240", icon: Database, color: "text-blue-400" },
    { label: "Patrones Válidos", value: "892", icon: Zap, color: "text-yellow-400" },
    { label: "Tokens Ahorrados", value: "4.2M", icon: TrendingUp, color: "text-emerald-400" },
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
            {isLoading ? <div className="p-6 space-y-2">{[1,2,3].map(i=><Skeleton key={i} className="h-10 w-full"/>)}</div> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hash de Firma</TableHead>
                    <TableHead>Tipo de Amenaza</TableHead>
                    <TableHead className="text-right">Impactos</TableHead>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {patterns?.map((p) => (
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
            )}
          </CardContent>
        </Card>

        {/* Chart */}
        <Card className="min-h-[400px]">
          <CardHeader>
            <CardTitle>Distribución de Amenazas (En Caché)</CardTitle>
          </CardHeader>
          <CardContent className="h-[350px]">
            {isLoading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={patterns} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <XAxis type="number" stroke="#525252" fontSize={12} />
                  <YAxis dataKey="threat_type" type="category" width={100} stroke="#a3a3a3" fontSize={12} />
                  <Tooltip cursor={{fill: '#262626'}} contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#f5f5f5' }} />
                  <Bar dataKey="hits" radius={[0, 16, 16, 0]} barSize={24}>
                    {patterns?.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#a5b4fc' : '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};