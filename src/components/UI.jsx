import React, { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { X, TrendingUp, TrendingDown, CheckCircle, AlertCircle, AlertTriangle, Info, RefreshCw } from 'lucide-react';

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
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
    error:   (msg, duration) => addToast(msg, 'error',   duration),
    warning: (msg, duration) => addToast(msg, 'warning', duration),
    info:    (msg, duration) => addToast(msg, 'info',    duration),
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
  // Barra lateral de color + icona semàntica, fons blanc
  const config = {
    success: { bar: 'bg-success',   icon: CheckCircle,    text: 'text-success'   },
    error:   { bar: 'bg-danger',    icon: AlertCircle,    text: 'text-danger'    },
    warning: { bar: 'bg-warning',   icon: AlertTriangle,  text: 'text-warning'   },
    info:    { bar: 'bg-info',      icon: Info,           text: 'text-info'      },
  };

  const { bar, icon: Icon, text } = config[type] || config.info;

  useEffect(() => {
    const timer = setTimeout(() => { if (onClose) onClose(); }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="bg-white border border-sand-300 shadow-toast rounded-soft flex items-stretch min-w-[280px] max-w-md toast-enter overflow-hidden">
      <div className={`${bar} w-1 shrink-0`} />
      <div className="flex items-center gap-3 px-3 py-3 flex-1">
        <Icon size={16} className={`${text} shrink-0`} />
        <span className="flex-1 text-sm font-medium text-sand-800">{message}</span>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-sand-100 rounded transition-colors">
            <X size={13} className="text-sand-500" />
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================
// ERROR BOUNDARY (#23)
// ============================================
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 bg-danger-light rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} className="text-danger" />
            </div>
            <h2 className="font-serif text-xl font-semibold text-sand-900 mb-2">Ha ocurrido un error</h2>
            <p className="text-sand-600 mb-1 text-sm">
              {this.state.error?.message || 'Error desconocido'}
            </p>
            <p className="text-sand-500 mb-6 text-xs">
              Si el problema persiste, exporta tus datos desde Configuración.
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-terra-400 hover:bg-terra-500 text-white rounded-button transition-colors text-sm font-medium"
            >
              <RefreshCw size={14} />
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================
// CONFIRM MODAL
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

  const handleConfirm = () => { onConfirm(); onClose(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white border border-sand-300 rounded-soft shadow-modal overflow-hidden animate-scaleIn"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="font-serif text-lg font-semibold text-sand-900 mb-2">{title}</h3>
          <p className="text-sand-600 text-sm">{message}</p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-sand-50 border-t border-sand-300">
          <Button variant="ghost" onClick={onClose}>{cancelText}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={handleConfirm}>{confirmText}</Button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// useConfirm Hook
// ============================================
export const useConfirm = () => {
  const [state, setState] = useState({
    open: false, title: '', message: '', danger: false, resolve: null,
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

// ============================================
// BUTTON
// ============================================
export const Button = ({ children, variant = 'primary', size = 'md', icon: Icon, className = '', ...props }) => {
  const variants = {
    primary:   'bg-terra-400 hover:bg-terra-500 text-white shadow-sm',
    secondary: 'bg-sand-200 hover:bg-sand-300 text-sand-700 border border-sand-300',
    ghost:     'bg-transparent hover:bg-sand-100 text-sand-700',
    danger:    'bg-danger hover:bg-danger-dark text-white',
    success:   'bg-success hover:bg-success-dark text-white',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-button transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />}
      {children}
    </button>
  );
};

// ============================================
// INPUT
// ============================================
export const Input = ({ label, icon: Icon, error, className = '', ...props }) => (
  <div className={className}>
    {label && <label className="block text-sm font-medium text-sand-700 mb-1.5">{label}</label>}
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-sand-500" size={16} />}
      <input
        className={`w-full bg-white border ${error ? 'border-danger' : 'border-sand-300'} rounded-button px-4 py-2.5 text-sand-900 placeholder-sand-500 focus:outline-none focus:border-terra-400 focus:ring-2 focus:ring-terra-400/10 transition-colors ${Icon ? 'pl-10' : ''}`}
        {...props}
      />
    </div>
    {error && <p className="text-danger text-xs mt-1">{error}</p>}
  </div>
);

// ============================================
// TEXTAREA
// ============================================
export const Textarea = ({ label, error, className = '', ...props }) => (
  <div className={className}>
    {label && <label className="block text-sm font-medium text-sand-700 mb-1.5">{label}</label>}
    <textarea
      className={`w-full bg-white border ${error ? 'border-danger' : 'border-sand-300'} rounded-button px-4 py-2.5 text-sand-900 placeholder-sand-500 focus:outline-none focus:border-terra-400 focus:ring-2 focus:ring-terra-400/10 transition-colors resize-none`}
      {...props}
    />
    {error && <p className="text-danger text-xs mt-1">{error}</p>}
  </div>
);

// ============================================
// SELECT
// ============================================
export const Select = ({ label, options, error, className = '', ...props }) => (
  <div className={className}>
    {label && <label className="block text-sm font-medium text-sand-700 mb-1.5">{label}</label>}
    <div className="relative">
      <select
        className={`w-full bg-white border ${error ? 'border-danger' : 'border-sand-300'} rounded-button px-4 py-2.5 text-sand-900 focus:outline-none focus:border-terra-400 focus:ring-2 focus:ring-terra-400/10 transition-colors appearance-none cursor-pointer hover:border-sand-400`}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
    {error && <p className="text-danger text-xs mt-1">{error}</p>}
  </div>
);

// ============================================
// CARD
// ============================================
export const Card = ({ children, className = '', hover = false, variant = 'default', onClick }) => {
  // variant "glass" i "gradient" ara fan servir el disseny default net
  const base = 'bg-white border border-sand-300 rounded-soft shadow-card';
  const hoverCls = hover ? 'hover:shadow-card-hover hover:border-sand-400 transition-all duration-200 cursor-pointer' : '';

  return (
    <div className={`${base} ${hoverCls} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
};

// ============================================
// MODAL
// ============================================
export const Modal = ({ open, onClose, title, children, size = 'md' }) => {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-7xl' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`w-full ${sizes[size]} bg-white border border-sand-300 rounded-soft shadow-modal max-h-[90vh] overflow-hidden flex flex-col animate-scaleIn`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-sand-300">
          <h2 className="font-serif text-heading text-sand-900">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-sand-100 rounded-button transition-colors">
            <X size={18} className="text-sand-500" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

// ============================================
// STAT CARD
// ============================================
export const StatCard = ({ icon: Icon, label, value, subValue, trend, trendUp, color = 'terra', onClick }) => {
  const iconColors = {
    terra:   'bg-terra-50 text-terra-400',
    success: 'bg-success-light text-success',
    warning: 'bg-warning-light text-warning',
    danger:  'bg-danger-light text-danger',
    info:    'bg-info-light text-info',
    blue:    'bg-info-light text-info',
    emerald: 'bg-success-light text-success',
    amber:   'bg-warning-light text-warning',
    red:     'bg-danger-light text-danger',
    purple:  'bg-purple-50 text-purple-600',
    indigo:  'bg-info-light text-info',
    pink:    'bg-pink-50 text-pink-600',
  };

  return (
    <Card
      className="p-6"
      hover={!!onClick}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-sand-600 mb-1">{label}</p>
          <h3 className="font-mono text-display text-sand-950 tracking-tight leading-none">{value}</h3>
          {subValue && <p className="text-sand-500 text-xs mt-1.5">{subValue}</p>}
        </div>
        <div className={`p-3 rounded-full ${iconColors[color] || iconColors.terra} shrink-0 ml-4`}>
          <Icon size={20} />
        </div>
      </div>

      {trend && (
        <div className="mt-4 flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-badge ${trendUp ? 'bg-success-light text-success' : 'bg-danger-light text-danger'}`}>
            {trendUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend}
          </span>
          <span className="text-sand-500 text-xs">vs mes anterior</span>
        </div>
      )}
    </Card>
  );
};

// ============================================
// STATUS BADGE
// ============================================
export const StatusBadge = ({ status }) => {
  const styles = {
    borrador:     'bg-sand-100 text-sand-600 border border-sand-300',
    emitida:      'bg-warning-light text-warning border border-warning/20',
    pagada:       'bg-success-light text-success border border-success/20',
    anulada:      'bg-danger-light text-danger border border-danger/20',
    parcial:      'bg-info-light text-info border border-info/20',
    presupuesto:  'bg-purple-50 text-purple-700 border border-purple-200',
    rectificativa:'bg-orange-50 text-orange-700 border border-orange-200',
  };
  const labels = {
    borrador: 'Borrador', emitida: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada',
    parcial: 'Parcial', presupuesto: 'Presupuesto', rectificativa: 'Rectificativa',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-badge text-xs font-medium ${styles[status] || styles.borrador}`}>
      {labels[status] || status}
    </span>
  );
};

// ============================================
// SPINNER
// ============================================
export const Spinner = ({ size = 'md' }) => {
  const sizes = { sm: 'w-4 h-4 border-2', md: 'w-8 h-8 border-[3px]', lg: 'w-12 h-12 border-4' };
  return (
    <div className={`${sizes[size]} border-terra-400 border-t-transparent rounded-full animate-spin`}></div>
  );
};

// ============================================
// EMPTY STATE
// ============================================
export const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="text-center py-16">
    {Icon && <Icon size={44} className="text-sand-400 mx-auto mb-4" />}
    <h3 className="font-serif text-lg text-sand-800 mb-2">{title}</h3>
    {description && <p className="text-sand-600 text-sm mb-5">{description}</p>}
    {action}
  </div>
);
