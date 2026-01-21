import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ShieldAlert,
  FileText,
  Cpu,
  Settings,
  Bell,
  Search,
  Menu,
  LogOut
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRealTimeAlerts } from '../hooks/useRealTimeAlerts';

const NavItem = ({ to, icon: Icon, label }: { to: string, icon: any, label: string }) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <NavLink
      to={to}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
        ${isActive
          ? 'bg-primary/10 text-primary shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)]'
          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
        }`}
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
};

export const Layout = ({ children }: { children?: React.ReactNode }) => {
  const { user, logout } = useAuth();

  // Enable simulated alerts only if user is logged in
  useRealTimeAlerts(!!user);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-slate-950/50 hidden md:flex flex-col sticky top-0 h-screen">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2 text-primary">
            <ShieldAlert className="w-6 h-6" />
            <span className="font-bold text-lg tracking-tight text-white">Centinela<span className="text-slate-400 font-light">Cloud</span></span>
          </div>
        </div>

        <div className="flex-1 py-6 px-4 space-y-1">
          <NavItem to="/" icon={LayoutDashboard} label="Resumen" />
          <NavItem to="/detections" icon={ShieldAlert} label="Detecciones" />
          <NavItem to="/ai-reports" icon={FileText} label="Reportes IA" />
          <NavItem to="/cache" icon={Cpu} label="Caché Intel" />
          <NavItem to="/settings" icon={Settings} label="Configuración" />
        </div>

        <div className="p-4 border-t border-border space-y-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white ring-2 ring-slate-800">
              {user?.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
            <button onClick={logout} className="text-slate-400 hover:text-red-400 transition-colors" title="Cerrar Sesión">
              <LogOut size={16} />
            </button>
          </div>

          <div className="bg-slate-900 rounded-lg p-3 text-xs text-slate-400 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-slate-200">Estado del Sistema</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
            <p>Motor: v1.0.0 (MVP)</p>
            <p className="mt-1">API: Conectada</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="md:hidden">
            <Menu className="text-slate-400" />
          </div>

          <div className="flex-1 max-w-md mx-4 hidden md:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar logs, IPs o IDs de amenazas..."
                className="w-full bg-slate-900 border border-slate-800 rounded-full py-1.5 pl-10 pr-4 text-sm text-slate-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="relative text-slate-400 hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-accent rounded-full border-2 border-slate-950"></span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-6 scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};