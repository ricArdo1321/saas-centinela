import React, { createContext, useContext, useState, useCallback, ReactNode, PropsWithChildren } from 'react';
import { X, AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react';

export type ToastVariant = 'default' | 'success' | 'destructive' | 'info';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextType {
  toast: (props: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};

export const ToastProvider = ({ children }: PropsWithChildren<{}>) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(({ title, description, variant = 'default' }: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, description, variant }]);

    // Auto dismiss
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

const ToastViewport = ({ toasts, onDismiss }: { toasts: Toast[], onDismiss: (id: string) => void }) => {
  return (
    <div className="fixed bottom-0 right-0 z-[100] flex flex-col gap-2 p-6 w-full max-w-[420px] pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
};

const ToastItem = ({ toast, onDismiss }: { toast: Toast, onDismiss: () => void; key?: React.Key }) => {
  const variants = {
    default: "bg-surface border-border text-slate-200",
    success: "bg-emerald-950/50 border-emerald-500/50 text-emerald-200",
    destructive: "bg-red-950/50 border-red-500/50 text-red-200",
    info: "bg-blue-950/50 border-blue-500/50 text-blue-200",
  };

  const icons = {
    default: <Info size={18} />,
    success: <CheckCircle size={18} className="text-emerald-500" />,
    destructive: <AlertTriangle size={18} className="text-red-500" />,
    info: <AlertCircle size={18} className="text-blue-500" />,
  };

  return (
    <div className={`
      pointer-events-auto relative flex w-full items-start gap-4 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all animate-[slideIn_0.2s_ease-out]
      ${variants[toast.variant]}
    `}>
      <div className="mt-0.5">{icons[toast.variant]}</div>
      <div className="flex-1">
        <h3 className="text-sm font-semibold">{toast.title}</h3>
        {toast.description && <p className="text-sm opacity-90 mt-1">{toast.description}</p>}
      </div>
      <button 
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:text-slate-100 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 group"
      >
        <X size={14} />
      </button>
    </div>
  );
};