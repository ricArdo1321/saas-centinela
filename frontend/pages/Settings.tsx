import React, { useState } from 'react';
import { Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '../components/UI';

const TabButton = ({ active, onClick, children }: any) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      active ? 'border-primary text-primary' : 'border-transparent text-slate-400 hover:text-slate-200'
    }`}
  >
    {children}
  </button>
);

const Toggle = ({ label, checked, onChange }: any) => (
  <div className="flex items-center justify-between py-3 border-b border-slate-800 last:border-0">
    <span className="text-sm text-slate-300">{label}</span>
    <button 
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 flex items-center rounded-full px-1 transition-colors ${checked ? 'bg-primary' : 'bg-slate-700'}`}
    >
      <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  </div>
);

export const Settings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [aiConfig, setAiConfig] = useState({
    agentsEnabled: true,
    autoBan: false,
    temperature: 0.2
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Configuración del Sistema</h1>
        <p className="text-slate-400 text-sm">Administrar inquilinos, parámetros de IA y reglas de detección.</p>
      </div>

      <div className="flex border-b border-slate-800 mb-6">
        <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')}>General</TabButton>
        <TabButton active={activeTab === 'ai'} onClick={() => setActiveTab('ai')}>Configuración IA</TabButton>
        <TabButton active={activeTab === 'rules'} onClick={() => setActiveTab('rules')}>Reglas y Políticas</TabButton>
      </div>

      {activeTab === 'ai' && (
        <Card>
          <CardHeader>
            <CardTitle>Parámetros del Modelo IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">Selección de Modelo</label>
              <select className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none">
                <option>Gemini 1.5 Pro (Recomendado)</option>
                <option>Gemini 1.0 Ultra</option>
                <option>OpenAI GPT-4o</option>
              </select>
              <p className="text-xs text-slate-500">Seleccione el LLM subyacente para el análisis de logs.</p>
            </div>

            <div className="grid gap-2">
              <div className="flex justify-between">
                <label className="text-sm font-medium text-slate-300">Temperatura</label>
                <span className="text-xs text-slate-400">{aiConfig.temperature}</span>
              </div>
              <input 
                type="range" min="0" max="1" step="0.1" 
                value={aiConfig.temperature}
                onChange={(e) => setAiConfig({...aiConfig, temperature: parseFloat(e.target.value)})}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-xs text-slate-500">Valores más bajos producen resultados más deterministas.</p>
            </div>

            <div className="pt-4 border-t border-slate-800">
              <h4 className="text-sm font-medium text-slate-200 mb-2">Automatización</h4>
              <Toggle 
                label="Habilitar Agentes Autónomos" 
                checked={aiConfig.agentsEnabled} 
                onChange={(v: boolean) => setAiConfig({...aiConfig, agentsEnabled: v})} 
              />
              <Toggle 
                label="Auto-Banear IPs confirmadas (Confianza > 95%)" 
                checked={aiConfig.autoBan} 
                onChange={(v: boolean) => setAiConfig({...aiConfig, autoBan: v})} 
              />
            </div>
          </CardContent>
          <div className="p-6 pt-0 flex justify-end">
            <Button className="gap-2">
              <Save size={16} /> Guardar Cambios
            </Button>
          </div>
        </Card>
      )}

      {activeTab === 'general' && (
        <Card>
           <CardHeader><CardTitle>Detalles del Inquilino</CardTitle></CardHeader>
           <CardContent>
             <div className="text-slate-400 text-sm">Configuración general...</div>
           </CardContent>
        </Card>
      )}

      {activeTab === 'rules' && (
        <Card>
           <CardHeader><CardTitle>Reglas de Detección</CardTitle></CardHeader>
           <CardContent className="space-y-4">
             <Toggle label="Detección de Fuerza Bruta" checked={true} onChange={()=>{}} />
             <Toggle label="Patrones de Inyección SQL" checked={true} onChange={()=>{}} />
             <Toggle label="Exfiltración de Datos Anómala" checked={true} onChange={()=>{}} />
             <Toggle label="Viaje Imposible (Impossible Travel)" checked={false} onChange={()=>{}} />
           </CardContent>
        </Card>
      )}
    </div>
  );
};