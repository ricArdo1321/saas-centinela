import React from 'react';
import { Loader2 } from 'lucide-react';

// Common props including key to satisfy strict type checking in some environments
interface BaseProps {
  className?: string;
  children?: React.ReactNode;
  key?: React.Key;
}

// --- Card ---
export const Card = ({ children, className = "" }: BaseProps) => (
  <div className={`bg-surface border border-border rounded-2xl shadow-sm ${className}`}>
    {children}
  </div>
);

export const CardHeader = ({ children, className = "" }: BaseProps) => (
  <div className={`p-6 pb-2 ${className}`}>{children}</div>
);

export const CardTitle = ({ children, className = "" }: BaseProps) => (
  <h3 className={`text-lg font-semibold text-slate-100 tracking-tight ${className}`}>{children}</h3>
);

export const CardContent = ({ children, className = "" }: BaseProps) => (
  <div className={`p-6 pt-2 ${className}`}>{children}</div>
);

// --- Badge ---
export const Badge = ({ variant = 'default', children }: { variant?: 'default' | 'critical' | 'high' | 'medium' | 'low' | 'outline', children?: React.ReactNode }) => {
  const styles = {
    default: "bg-slate-800 text-slate-300",
    critical: "bg-red-500/10 text-red-400 border border-red-500/20",
    high: "bg-orange-500/10 text-orange-400 border border-orange-500/20",
    medium: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
    low: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    outline: "bg-transparent border border-slate-700 text-slate-400"
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
};

// --- Button ---
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
}

export const Button = ({ children, variant = 'primary', size = 'md', className = "", ...props }: ButtonProps) => {
  const base = "inline-flex items-center justify-center rounded-full font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-primary disabled:opacity-50 disabled:pointer-events-none";
  
  const variants = {
    primary: "bg-primary hover:bg-indigo-300 text-slate-950 shadow-lg shadow-indigo-500/20",
    ghost: "bg-transparent hover:bg-slate-800 text-slate-300 hover:text-white",
    outline: "bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800",
    danger: "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20",
  };
  
  const sizes = {
    sm: "h-8 px-4 text-xs",
    md: "h-10 px-6 py-2",
    lg: "h-12 px-8 text-lg"
  };

  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
};

// --- Skeleton / Loading ---
export const Skeleton = ({ className = "" }: { className?: string; key?: React.Key }) => (
  <div className={`animate-pulse rounded-2xl bg-slate-800 ${className}`} />
);

export const LoadingSpinner = () => (
  <div className="flex justify-center items-center p-8 text-slate-500">
    <Loader2 className="w-8 h-8 animate-spin" />
  </div>
);

// --- Sheet (Side Panel) ---
export const Sheet = ({ isOpen, onClose, children, title }: { isOpen: boolean, onClose: () => void, children?: React.ReactNode, title: string }) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
      
      {/* Panel */}
      <div className="relative w-full max-w-md h-full bg-background border-l border-border shadow-2xl transform transition-transform duration-300 ease-out overflow-y-auto">
        <div className="p-6 border-b border-border flex justify-between items-center sticky top-0 bg-background/80 backdrop-blur-md z-10">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
};

// --- Table (Simple) ---
export const Table = ({ children, className = "" }: BaseProps) => (
  <div className="w-full overflow-auto">
    <table className={`w-full caption-bottom text-sm ${className}`}>{children}</table>
  </div>
);

export const TableHeader = ({ children, className = "" }: BaseProps) => (
  <thead className={`[&_tr]:border-b border-slate-800 ${className}`}>{children}</thead>
);

export const TableRow = ({ children, className = "", onClick }: BaseProps & { onClick?: () => void }) => (
  <tr 
    className={`border-b border-slate-800 transition-colors hover:bg-slate-800/50 data-[state=selected]:bg-slate-800 ${onClick ? 'cursor-pointer' : ''} ${className}`}
    onClick={onClick}
  >
    {children}
  </tr>
);

export const TableHead = ({ children, className = "" }: BaseProps) => (
  <th className={`h-12 px-4 text-left align-middle font-medium text-slate-400 [&:has([role=checkbox])]:pr-0 ${className}`}>
    {children}
  </th>
);

export const TableCell = ({ children, className = "" }: BaseProps) => (
  <td className={`p-4 align-middle [&:has([role=checkbox])]:pr-0 text-slate-300 ${className}`}>
    {children}
  </td>
);