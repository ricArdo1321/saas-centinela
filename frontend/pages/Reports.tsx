import React, { useState } from 'react';
import { FileText, Bot, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Card, CardContent, Button, Badge, Skeleton } from '../components/UI';
import { useQuery, api } from '../services/mockApi';
import { AIReport } from '../types';

const ReportCard = ({ report }: { report: AIReport; key?: any }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="transition-all duration-200 hover:border-slate-700">
      <div 
        className="p-6 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-4">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
            <FileText size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-100">{report.subject}</h3>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
              <span className="flex items-center gap-1">
                <Bot size={14} /> {report.model_used}
              </span>
              <span>•</span>
              <span>{new Date(report.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); }}>
            Exportar PDF
          </Button>
          {expanded ? <ChevronUp className="text-slate-500" /> : <ChevronDown className="text-slate-500" />}
        </div>
      </div>

      {expanded && (
        <div className="px-6 pb-6 pt-0 border-t border-slate-800/50 animation-fade-in">
          <div className="mt-4 prose prose-invert max-w-none prose-sm text-slate-300">
            {/* Simple Markdown Simulation for the demo */}
            {report.body.split('\n').map((line, i) => {
              if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('## ', '')}</h2>;
              if (line.startsWith('### ')) return <h3 key={i} className="text-md font-semibold text-indigo-300 mt-3 mb-1">{line.replace('### ', '')}</h3>;
              if (line.startsWith('* ')) return <li key={i} className="ml-4 list-disc">{line.replace('* ', '')}</li>;
              if (line.trim() === '') return <br key={i} />;
              return <p key={i}>{line}</p>;
            })}
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="ghost" className="text-xs text-indigo-400 hover:text-indigo-300 gap-1">
              Ver Contexto de Análisis Original <ExternalLink size={12} />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

export const Reports = () => {
  const { data: reports, isLoading } = useQuery('ai-reports', api.getReports);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reportes Generados por IA</h1>
        <p className="text-slate-400 text-sm">Resúmenes ejecutivos automatizados y evaluaciones de amenazas por el Agente "Escritor".</p>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
        ) : (
          reports?.map(report => (
            <ReportCard key={report.id} report={report} />
          ))
        )}
      </div>
    </div>
  );
};