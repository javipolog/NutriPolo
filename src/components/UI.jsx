import React, { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { X, TrendingUp, TrendingDown, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback for when context is not available
    return {
      success: (msg) => console.log('Toast success:', msg),
      error: (msg) => console.error('Toast error:', msg),
      warning: (msg) => console.warn('Toast warning:', msg),
      info: (msg) => console.log('Toast info:', msg),
    };
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
    
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (msg, duration) => addToast(msg, 'success', duration),
    error: (msg, duration) => addToast(msg, 'error', duration),
    warning: (msg, duration) => addToast(msg, 'warning', duration),
    info: (msg, duration) => addToast(msg, 'info', duration),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

const ToastContainer = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <Toast key={toast.id} {...toast} onClose={() => onRemove(toast.id)} />
      ))}
    </div>
  );
};

export const Toast = ({ message, type = 'info', onClose }) => {
  const config = {
    success: {
      bg: 'bg-emerald-600 border-emerald-500',
      icon: CheckCircle,
    },
    error: {
      bg: 'bg-red-600 border-red-500',
      icon: AlertCircle,
    },
    warning: {
      bg: 'bg-amber-600 border-amber-500',
      icon: AlertTriangle,
    },
    info: {
      bg: 'bg-blue-600 border-blue-500',
      icon: Info,
    },
  };

  const { bg, icon: Icon } = config[type] || config.info;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div 
      className={`${bg} text-white px-4 py-3 rounded-xl border shadow-xl flex items-center gap-3 min-w-[280px] max-w-md animate-slideIn`}
      style={{
        animation: 'slideIn 0.3s ease-out'
      }}
    >
      <Icon size={18} className="shrink-0" />
      <span className="flex-1 text-sm font-medium">{message}</span>
      {onClose && (
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
          <X size={14} />
        </button>
      )}
    </div>
  );
};

// ============================================
// CONFIRM MODAL (Reemplaça confirm() natiu)
// ============================================
export const ConfirmModal = ({ 
  open, 
  onClose, 
  onConfirm, 
  title = 'Confirmar acción', 
  message = '¿Estás seguro de que quieres continuar?',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = false 
}) => {
  if (!open) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-slideIn"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
          <p className="text-slate-400 text-sm">{message}</p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-800/50 border-t border-slate-800">
          <Button variant="ghost" onClick={onClose}>{cancelText}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={handleConfirm}>{confirmText}</Button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// useConfirm Hook - Per usar confirmacions fàcilment
// ============================================
export const useConfirm = () => {
  const [state, setState] = useState({
    open: false,
    title: '',
    message: '',
    danger: false,
    resolve: null,
  });

  const confirm = useCallback(({ title, message, danger = false }) => {
    return new Promise((resolve) => {
      setState({ open: true, title, message, danger, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState(prev => ({ ...prev, open: false }));
  }, [state.resolve]);

  const handleClose = useCallback(() => {
    state.resolve?.(false);
    setState(prev => ({ ...prev, open: false }));
  }, [state.resolve]);

  const ConfirmDialog = (
    <ConfirmModal
      open={state.open}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={state.title}
      message={state.message}
      danger={state.danger}
    />
  );

  return { confirm, ConfirmDialog };
};

// Button Component
export const Button = ({ children, variant = 'primary', size = 'md', icon: Icon, className = '', ...props }) => {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
    ghost: 'bg-transparent hover:bg-slate-800 text-slate-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white'
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />}
      {children}
    </button>
  );
};

// Input Component
export const Input = ({ label, icon: Icon, error, className = '', ...props }) => (
  <div className={className}>
    {label && <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>}
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />}
      <input
        className={`w-full bg-slate-800/50 border ${error ? 'border-red-500' : 'border-slate-700'} rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all ${Icon ? 'pl-10' : ''}`}
        {...props}
      />
    </div>
    {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
  </div>
);

// Textarea Component
export const Textarea = ({ label, error, className = '', ...props }) => (
  <div className={className}>
    {label && <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>}
    <textarea
      className={`w-full bg-slate-800/50 border ${error ? 'border-red-500' : 'border-slate-700'} rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all resize-none`}
      {...props}
    />
    {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
  </div>
);

// Select Component
export const Select = ({ label, options, error, className = '', ...props }) => (
  <div className={className}>
    {label && <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>}
    <div className="relative group">
      <select
        className={`w-full bg-slate-800 border ${error ? 'border-red-500' : 'border-slate-700/50'} rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all appearance-none cursor-pointer hover:border-slate-600 shadow-inner`}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value} className="bg-slate-900 text-slate-100 py-2">
            {opt.label}
          </option>
        ))}
      </select>
    </div>
    {error && <p className="text-red-400 text-xs mt-1.5 font-medium">{error}</p>}
  </div>
);

// Card Component
export const Card = ({ children, className = '', hover = false, variant = 'default', onClick }) => {
  const variants = {
    default: 'bg-slate-900/50 backdrop-blur border border-slate-800',
    glass: 'bg-slate-900/30 backdrop-blur-md border border-slate-700/50 shadow-xl',
    gradient: 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700/50',
    solid: 'bg-slate-900 border border-slate-800'
  };

  return (
    <div
      className={`${variants[variant]} rounded-2xl ${hover ? 'hover:border-slate-600 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

// Modal Component
export const Modal = ({ open, onClose, title, children, size = 'md' }) => {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-7xl' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`w-full ${sizes[size]} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col animate-slideIn`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

// StatCard Component
export const StatCard = ({ icon: Icon, label, value, subValue, trend, trendUp, color = 'blue', onClick }) => {
  const colors = {
    blue: 'from-blue-500 to-blue-700 shadow-blue-500/20',
    emerald: 'from-emerald-500 to-emerald-700 shadow-emerald-500/20',
    amber: 'from-amber-500 to-amber-700 shadow-amber-500/20',
    red: 'from-red-500 to-red-700 shadow-red-500/20',
    purple: 'from-purple-500 to-purple-700 shadow-purple-500/20',
    indigo: 'from-indigo-500 to-indigo-700 shadow-indigo-500/20',
    pink: 'from-pink-500 to-pink-700 shadow-pink-500/20'
  };

  const iconColors = {
    blue: 'bg-blue-500/10 text-blue-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-400',
    red: 'bg-red-500/10 text-red-400',
    purple: 'bg-purple-500/10 text-purple-400',
    indigo: 'bg-indigo-500/10 text-indigo-400',
    pink: 'bg-pink-500/10 text-pink-400'
  };

  return (
    <Card className="p-6 relative overflow-hidden group" hover={!!onClick} onClick={onClick} variant="gradient">
      <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 rounded-full bg-slate-800/30 blur-2xl group-hover:bg-slate-700/30 transition-all duration-500"></div>

      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-slate-400 text-sm font-medium mb-1">{label}</p>
          <h3 className="text-2xl font-bold text-white tracking-tight">{value}</h3>
          {subValue && <p className="text-slate-500 text-xs mt-1">{subValue}</p>}
        </div>

        <div className={`p-3 rounded-xl ${iconColors[color]} transition-colors duration-300`}>
          <Icon size={22} />
        </div>
      </div>

      {trend && (
        <div className="mt-4 flex items-center gap-2 relative z-10">
          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${trendUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend}
          </span>
          <span className="text-slate-500 text-xs">vs mes anterior</span>
        </div>
      )}
    </Card>
  );
};

// StatusBadge Component
export const StatusBadge = ({ status }) => {
  const styles = {
    borrador: 'bg-slate-700 text-slate-300',
    emitida: 'bg-amber-900/50 text-amber-400 border border-amber-700',
    pagada: 'bg-emerald-900/50 text-emerald-400 border border-emerald-700',
    anulada: 'bg-red-900/50 text-red-400 border border-red-700'
  };
  const labels = { borrador: 'Borrador', emitida: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada' };

  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

// Loading Spinner
export const Spinner = ({ size = 'md' }) => {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return (
    <div className={`${sizes[size]} border-4 border-blue-600 border-t-transparent rounded-full animate-spin`}></div>
  );
};

// Empty State
export const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="text-center py-12">
    {Icon && <Icon size={48} className="text-slate-600 mx-auto mb-4" />}
    <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
    {description && <p className="text-slate-400 mb-4">{description}</p>}
    {action}
  </div>
);

// ============================================
// CSS KEYFRAMES (Afegir a styles.css o inline)
// ============================================
// Aquests estils s'han d'afegir al fitxer styles.css
// @keyframes slideIn {
//   from { opacity: 0; transform: translateY(10px); }
//   to { opacity: 1; transform: translateY(0); }
// }
// @keyframes fadeIn {
//   from { opacity: 0; }
//   to { opacity: 1; }
// }
// .animate-slideIn { animation: slideIn 0.3s ease-out; }
// .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
