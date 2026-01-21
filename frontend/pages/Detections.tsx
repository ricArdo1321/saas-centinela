import React, { useState } from 'react';
import { Filter, Calendar, AlertTriangle } from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle,
  Table, TableHeader, TableRow, TableHead, TableCell,
  Badge, Button, Sheet, Skeleton, LoadingSpinner
} from '../components/UI';
import { useQuery } from '../hooks/useQuery';
import { api } from '../services/api';
import { Detection } from '../types';

export const Detections = () => {
  const { data: detections, isLoading } = useQuery('detections', api.getDetections);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  // Filter Logic
  const filteredData = detections?.filter(d =>
    filterSeverity === 'all' || d.severity === filterSeverity
  ) || [];

  const translateStatus = (status: string) => {
    switch (status) {
      case 'new': return 'NUEVO';
      case 'investigating': return 'INVESTIGANDO';
      case 'resolved': return 'RESUELTO';
      default: return status.toUpperCase();
    }
  };

  const translateSeverity = (severity: string) => {
    switch (severity) {
      case 'critical': return 'CRÍTICO';
      case 'high': return 'ALTO';
      case 'medium': return 'MEDIO';
      case 'low': return 'BAJO';
      default: return severity.toUpperCase();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Detección de Amenazas</h1>
          <p className="text-slate-400 text-sm">Análisis profundo de anomalías de seguridad identificadas por IA.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select
              className="bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-2 text-slate-300 focus:ring-primary focus:border-primary appearance-none pr-8"
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
            >
              <option value="all">Todas las Severidades</option>
              <option value="critical">Crítico</option>
              <option value="high">Alto</option>
              <option value="medium">Medio</option>
              <option value="low">Bajo</option>
            </select>
            <Filter className="absolute right-2 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
          </div>
          <Button variant="outline" size="md" className="gap-2">
            <Calendar className="w-4 h-4" />
            Últimas 24h
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora</TableHead>
                  <TableHead>Severidad</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>IP Origen</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filteredData.map((d) => (
                  <TableRow key={d.id} onClick={() => setSelectedDetection(d)} className="cursor-pointer">
                    <TableCell>
                      <span className="font-mono text-xs text-slate-400">
                        {new Date(d.created_at).toISOString().split('T')[0]} <span className="text-slate-500">{new Date(d.created_at).toLocaleTimeString()}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.severity as any}>{translateSeverity(d.severity)}</Badge>
                    </TableCell>
                    <TableCell><span className="font-medium text-slate-200">{d.detection_type}</span></TableCell>
                    <TableCell><span className="font-mono text-slate-400">{d.source_ip}</span></TableCell>
                    <TableCell>
                       <span className={`text-xs font-medium ${
                         d.status === 'new' ? 'text-blue-400' :
                         d.status === 'investigating' ? 'text-orange-400' : 'text-emerald-400'
                       }`}>
                         {translateStatus(d.status)}
                       </span>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Slide-over */}
      <Sheet
        isOpen={!!selectedDetection}
        onClose={() => setSelectedDetection(null)}
        title="Análisis de Detección"
      >
        {selectedDetection && (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-slate-900 rounded-lg border border-slate-800">
               <div className="flex items-center gap-3">
                 <AlertTriangle className={`w-8 h-8 ${
                   selectedDetection.severity === 'critical' ? 'text-red-500' : 'text-orange-500'
                 }`} />
                 <div>
                   <h4 className="font-bold text-white">{selectedDetection.detection_type}</h4>
                   <p className="text-xs text-slate-400">ID: {selectedDetection.id}</p>
                 </div>
               </div>
               <Badge variant={selectedDetection.severity as any}>{translateSeverity(selectedDetection.severity)}</Badge>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-300">Análisis de IA</h4>
              <p className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 p-3 rounded border border-slate-800">
                {selectedDetection.evidence.ai_analysis}
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-300">Evidencia Cruda</h4>
              <pre className="text-xs bg-black p-4 rounded-lg overflow-x-auto text-green-400 font-mono border border-slate-800">
                {JSON.stringify(selectedDetection.evidence, null, 2)}
              </pre>
            </div>

            <div className="pt-4 flex gap-2">
              <Button className="flex-1">Tomar Acción</Button>
              <Button variant="outline" className="flex-1">Descartar</Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
};
