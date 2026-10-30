import React, { useEffect, useState, useCallback, useId, useMemo, useRef, createContext, useContext } from 'react';
import { X, TrendingUp, TrendingDown, CheckCircle, AlertCircle, AlertTriangle, Info, RefreshCw, Search } from 'lucide-react';
import { useT } from '../i18n';

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    return { success: () => {}, error: () => {}, warning: () => {}, info: () => {} };
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  // `action` ({ label, onClick }) adds a button that closes the toast.
  const addToast = useCallback((message, type = 'info', duration = 4000, action = null) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type, action }]);
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
    success: (msg, duration, action) => addToast(msg, 'success', duration, action),
    error:   (msg, duration, action) => addToast(msg, 'error',   duration, action),
    warning: (msg, duration, action) => addToast(msg, 'warning', duration, action),
    info:    (msg, duration, action) => addToast(msg, 'info',    duration, action),
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

export const Toast = ({ message, type = 'info', action, onClose }) => {
  const t = useT();
  // Barra lateral de color + icona semàntica, fons blanc
  const config = {
    success: { bar: 'bg-success',   icon: CheckCircle,    text: 'text-success'   },
    error:   { bar: 'bg-danger',    icon: AlertCircle,    text: 'text-danger'    },
    warning: { bar: 'bg-warning',   icon: AlertTriangle,  text: 'text-warning'   },
    info:    { bar: 'bg-info',      icon: Info,           text: 'text-info'      },
  };

  // Auto-dismiss is handled by ToastProvider, which honours each toast's duration
  const { bar, icon: Icon, text } = config[type] || config.info;

  return (
    <div role={type === 'error' ? 'alert' : 'status'} className="bg-white border border-sage-300 shadow-toast rounded-soft flex items-stretch min-w-[280px] max-w-md toast-enter overflow-hidden">
      <div className={`${bar} w-1 shrink-0`} />
      <div className="flex items-center gap-3 px-3 py-3 flex-1">
        <Icon size={16} className={`${text} shrink-0`} />
        <span className="flex-1 text-sm font-medium text-sage-800">{message}</span>
        {action && (
          <button
            onClick={() => { action.onClick(); onClose?.(); }}
            className="px-2 py-1 text-xs font-semibold text-wellness-700 hover:bg-wellness-50 rounded-button transition-colors shrink-0"
          >
            {action.label}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} aria-label={t.close} className="p-1 hover:bg-sage-100 rounded transition-colors">
            <X size={13} className="text-sage-500" />
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
    if (import.meta.env.DEV) console.error('ErrorBoundary caught error:', error, errorInfo);
    // Persist last error to the store so SettingsView > Diagnóstico can show it.
    // Lazy import to avoid a circular dependency with the store module.
    try {
      import('../stores/store').then(({ default: useStore }) => {
        const setLastError = useStore.getState().setLastError;
        if (typeof setLastError === 'function') {
          setLastError({
            message: error?.message || String(error),
            stack: error?.stack || null,
            componentStack: errorInfo?.componentStack || null,
            timestamp: new Date().toISOString(),
          });
        }
      }).catch(() => {});
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

// Function component so the fallback can use useT()
const ErrorFallback = ({ error, onRetry }) => {
  const t = useT();
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 bg-danger-light rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={32} className="text-danger" />
        </div>
        <h2 className="font-serif text-xl font-semibold text-sage-900 mb-2">{t.error_boundary_title}</h2>
        <p className="text-sage-600 mb-1 text-sm">
          {error?.message || t.error_unknown}
        </p>
        <p className="text-sage-500 mb-6 text-xs">
          {t.error_boundary_hint}
        </p>
        <Button icon={RefreshCw} onClick={onRetry}>{t.retry}</Button>
      </div>
    </div>
  );
};

// ============================================
// DIALOG ACCESSIBILITY
// Escape closes, Tab stays inside, focus moves in on open and back on close.
// Only the topmost open dialog reacts, so a ConfirmModal over a Modal closes alone.
// ============================================
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const dialogStack = [];

export const useDialogA11y = (open, onClose, dialogRef, initialFocusRef) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = {};
    dialogStack.push(token);
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;

    if (dialog && !dialog.contains(document.activeElement)) {
      const target = initialFocusRef?.current
        || dialog.querySelector('[autofocus]')
        || dialog.querySelector('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])')
        || dialog;
      target.focus();
    }

    const onKeyDown = (e) => {
      if (dialogStack[dialogStack.length - 1] !== token || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (items.length === 0) { e.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !dialog.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || outside)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || outside)) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = dialogStack.indexOf(token);
      if (i !== -1) dialogStack.splice(i, 1);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, dialogRef, initialFocusRef]);
};

// ============================================
// CONFIRM MODAL
// ============================================
export const ConfirmModal = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  danger = false
}) => {
  const t = useT();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  // Destructive actions start on Cancel so Enter does not delete by accident
  useDialogA11y(open, onClose, dialogRef, danger ? cancelRef : confirmRef);
  const titleId = useId();
  const messageId = useId();
  if (!open) return null;

  const handleConfirm = () => { onConfirm(); onClose(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="w-full max-w-md bg-white border border-sage-300 rounded-soft shadow-modal overflow-hidden animate-scaleIn focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 id={titleId} className="font-serif text-lg font-semibold text-sage-900 mb-2">{title || t.confirm_title}</h3>
          <p id={messageId} className="text-sage-600 text-sm">{message || t.confirm_message}</p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-sage-50 border-t border-sage-300">
          <Button ref={cancelRef} variant="ghost" onClick={onClose}>{cancelText || t.cancel}</Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={handleConfirm}>{confirmText || t.confirm}</Button>
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

  const confirm = useCallback((arg) => {
    // An empty title falls back to the translated default in ConfirmModal
    const { title, message, danger } = typeof arg === 'string'
      ? { title: '', message: arg, danger: false }
      : { title: arg.title || '', message: arg.message, danger: arg.danger || false };
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
export const Button = React.forwardRef(({ children, variant = 'primary', size = 'md', icon: Icon, className = '', ...props }, ref) => {
  const variants = {
    primary:   'bg-wellness-400 hover:bg-wellness-500 text-white shadow-sm',
    secondary: 'bg-white hover:bg-sage-50 text-sage-800 border border-sage-300 hover:border-sage-400 shadow-sm',
    ghost:     'bg-transparent hover:bg-sage-100 text-sage-700',
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
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-button transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />}
      {children}
    </button>
  );
});
Button.displayName = 'Button';

// Links a field's label and error message to the control
const useFieldIds = (id, error) => {
  const generated = useId();
  const fieldId = id || generated;
  const errorId = `${fieldId}-error`;
  return {
    fieldId,
    errorId,
    controlProps: {
      id: fieldId,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? errorId : undefined,
    },
  };
};

// ============================================
// INPUT
// ============================================
export const Input = ({ label, icon: Icon, error, className = '', id, ...props }) => {
  const { fieldId, errorId, controlProps } = useFieldIds(id, error);
  return (
    <div className={className}>
      {label && <label htmlFor={fieldId} className="block text-sm font-medium text-sage-700 mb-1.5">{label}</label>}
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-500" size={16} aria-hidden="true" />}
        <input
          className={`w-full bg-white border ${error ? 'border-danger' : 'border-sage-300'} rounded-button px-4 py-2.5 text-sage-900 placeholder-sage-500 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10 transition-colors ${Icon ? 'pl-10' : ''}`}
          {...controlProps}
          {...props}
        />
      </div>
      {error && <p id={errorId} className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
};

// ============================================
// TEXTAREA
// ============================================
export const Textarea = ({ label, error, className = '', id, ...props }) => {
  const { fieldId, errorId, controlProps } = useFieldIds(id, error);
  return (
    <div className={className}>
      {label && <label htmlFor={fieldId} className="block text-sm font-medium text-sage-700 mb-1.5">{label}</label>}
      <textarea
        className={`w-full bg-white border ${error ? 'border-danger' : 'border-sage-300'} rounded-button px-4 py-2.5 text-sage-900 placeholder-sage-500 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10 transition-colors resize-none`}
        {...controlProps}
        {...props}
      />
      {error && <p id={errorId} className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
};

// ============================================
// SELECT
// ============================================
export const Select = ({ label, options, error, className = '', id, ...props }) => {
  const { fieldId, errorId, controlProps } = useFieldIds(id, error);
  return (
    <div className={className}>
      {label && <label htmlFor={fieldId} className="block text-sm font-medium text-sage-700 mb-1.5">{label}</label>}
      <div className="relative">
        <select
          className={`w-full bg-white border ${error ? 'border-danger' : 'border-sage-300'} rounded-button px-4 py-2.5 text-sage-900 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10 transition-colors appearance-none cursor-pointer hover:border-sage-400`}
          {...controlProps}
          {...props}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {error && <p id={errorId} className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
};

// ============================================
// TAG INPUT
// ============================================
// Enter or comma adds the typed tag; Enter on an empty input is left to the
// container (it moves to the next field in keyboard forms), and Backspace on
// an empty input removes the last tag. `inputProps` go to the <input>
// (ids, aria, data-* attributes for keyboard navigation).
export const TagInput = ({ value = [], onChange, placeholder, inputProps = {}, className = '' }) => {
  const t = useT();
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setInput('');
  };
  const remove = (tag) => onChange(value.filter(x => x !== tag));
  const onKeyDown = (e) => {
    if (e.key === ',' || (e.key === 'Enter' && input.trim())) {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !input && value.length) {
      e.preventDefault();
      remove(value[value.length - 1]);
    }
  };
  return (
    <div className={`border border-sage-300 rounded-button px-2 py-1.5 bg-white min-h-9 flex flex-wrap items-center gap-1 focus-within:border-wellness-400 ${className}`}>
      {value.map(tag => (
        <span key={tag} className="flex items-center gap-1 text-xs bg-sage-100 text-sage-700 px-2 py-0.5 rounded-badge">
          {tag}
          <button type="button" tabIndex={-1} onClick={() => remove(tag)} aria-label={`${t.delete} ${tag}`} className="text-sage-500 hover:text-danger ml-0.5">&times;</button>
        </span>
      ))}
      <input
        {...inputProps}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        className="flex-1 min-w-[6rem] text-sm outline-none bg-transparent text-sage-800 placeholder-sage-500"
      />
    </div>
  );
};

// ============================================
// CARD
// ============================================
export const Card = ({ children, className = '', hover = false, variant = 'default', onClick }) => {
  // variant "glass" i "gradient" ara fan servir el disseny default net
  const base = 'bg-white border border-sage-300 rounded-soft shadow-card';
  const hoverCls = hover ? 'hover:shadow-card-hover hover:border-sage-400 transition-all duration-200 cursor-pointer' : '';

  return (
    <div className={`${base} ${hoverCls} ${className}`} {...(onClick ? clickableProps(onClick) : {})}>
      {children}
    </div>
  );
};

// Props that make a non-button element (card, calendar chip, list row) work
// as a button for keyboard and screen-reader users.
export const clickableProps = (onClick) => ({
  role: 'button',
  tabIndex: 0,
  onClick,
  onKeyDown: (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
  },
});

// ============================================
// MODAL
// ============================================
// `footer` renders below the scrolling body, so the main actions stay visible
// however long the form is.
export const Modal = ({ open, onClose, title, children, footer, size = 'md' }) => {
  const t = useT();
  const dialogRef = useRef(null);
  useDialogA11y(open, onClose, dialogRef);
  const titleId = useId();
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-7xl' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${sizes[size]} bg-white border border-sage-300 rounded-soft shadow-modal max-h-[90vh] overflow-hidden flex flex-col animate-scaleIn focus:outline-none`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-sage-300">
          <h2 id={titleId} className="font-serif text-heading text-sage-900">{title}</h2>
          <button onClick={onClose} aria-label={t.close} className="p-2 hover:bg-sage-100 rounded-button transition-colors">
            <X size={18} className="text-sage-500" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 bg-sage-50 border-t border-sage-300 shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
};

// ============================================
// STAT CARD
// ============================================
export const StatCard = ({ icon: Icon, label, value, subValue, trend, trendUp, color = 'wellness', onClick }) => {
  const t = useT();
  const iconColors = {
    wellness:'bg-wellness-50 text-wellness-400',
    success: 'bg-success-light text-success',
    warning: 'bg-warning-light text-warning',
    danger:  'bg-danger-light text-danger',
    info:    'bg-info-light text-info',
    blue:    'bg-info-light text-info',
    emerald: 'bg-success-light text-success',
    amber:   'bg-warning-light text-warning',
    red:     'bg-danger-light text-danger',
    purple:  'bg-info-light text-info',
    indigo:  'bg-info-light text-info',
    pink:    'bg-terra-50 text-terra-500',
  };

  return (
    <Card
      className="p-5"
      hover={!!onClick}
      onClick={onClick}
    >
      {/* Icon sits next to the label so the value gets the full card width */}
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`p-1.5 rounded-button ${iconColors[color] || iconColors.wellness} shrink-0`}>
          <Icon size={15} aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-sage-600 truncate">{label}</p>
      </div>
      <p className="tabular-nums text-[1.75rem] font-semibold text-sage-950 tracking-tight leading-none whitespace-nowrap">{value}</p>
      {subValue && <p className="text-sage-500 text-xs mt-2">{subValue}</p>}

      {trend && (
        <div className="mt-3 flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-badge ${trendUp ? 'bg-success-light text-success' : 'bg-danger-light text-danger'}`}>
            {trendUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend}
          </span>
          <span className="text-sage-500 text-xs">{t.vs_last_month}</span>
        </div>
      )}
    </Card>
  );
};

// ============================================
// STATUS BADGE
// ============================================
export const StatusBadge = ({ status }) => {
  const t = useT();
  const tones = {
    borrador: 'neutral', emitida: 'warning', pagada: 'success', anulada: 'danger',
    parcial: 'info', presupuesto: 'neutral', rectificativa: 'primary',
  };
  const labels = {
    borrador: t.invoice_status_draft, emitida: t.invoice_status_pending, pagada: t.invoice_status_paid,
    anulada: t.invoice_status_cancelled, parcial: t.invoice_status_partial,
    presupuesto: t.invoice_status_quote, rectificativa: t.invoice_status_corrective,
  };

  return <Badge tone={tones[status] || 'neutral'}>{labels[status] || status}</Badge>;
};

// ============================================
// SEGMENTED CONTROL
// One choice out of a few (view mode, status, language).
// options: [{ value, label }]
// ============================================
export const SegmentedControl = ({ options, value, onChange, ariaLabel, className = '' }) => (
  <div role="radiogroup" aria-label={ariaLabel} className={`inline-flex flex-wrap gap-0.5 p-0.5 bg-sage-100 border border-sage-200 rounded-button ${className}`}>
    {options.map(opt => {
      const active = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-xs font-medium rounded-[5px] transition-colors ${
            active ? 'bg-white text-sage-900 shadow-sm ring-1 ring-sage-200' : 'text-sage-600 hover:text-sage-900'
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

// ============================================
// COMBOBOX
// Searchable single choice for long lists (clients).
// options: [{ value, label, hint? }] — matches label and hint, ignoring accents.
// ============================================
const normalize = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const Combobox = ({ options, value, onChange, placeholder, emptyText, error, id, autoFocus }) => {
  const generated = useId();
  const inputId = id || generated;
  const listId = `${inputId}-list`;
  const selected = options.find(o => o.value === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef(null);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options;
    return options.filter(o => normalize(o.label).includes(q) || normalize(o.hint).includes(q));
  }, [options, query]);

  useEffect(() => { setHighlight(0); }, [query]);
  useEffect(() => {
    if (open) listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const choose = (opt) => {
    onChange(opt.value);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight(h => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && open && matches[highlight]) {
      e.preventDefault();
      choose(matches[highlight]);
    } else if (e.key === 'Escape' && open) {
      // Close the list only; preventDefault keeps the surrounding dialog open
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-500 pointer-events-none" aria-hidden="true" />
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[highlight] ? `${listId}-${highlight}` : undefined}
        aria-invalid={error ? true : undefined}
        autoFocus={autoFocus}
        autoComplete="off"
        value={open ? query : (selected?.label || '')}
        placeholder={selected ? selected.label : placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        // Selecting the shown name makes typing replace it instead of appending to it.
        // The list does not open on focus: dialogs focus this field on open.
        onFocus={e => e.target.select()}
        onClick={() => setOpen(true)}
        onBlur={() => { setOpen(false); setQuery(''); }}
        onKeyDown={onKeyDown}
        className={`w-full pl-9 pr-3 py-2 text-sm border rounded-button bg-white text-sage-800 placeholder-sage-500 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10 ${error ? 'border-danger' : 'border-sage-300'}`}
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-sage-300 rounded-soft shadow-modal py-1"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-sage-500">{emptyText}</li>
          ) : matches.map((opt, i) => (
            <li
              key={opt.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={opt.value === value}
              // mousedown keeps focus in the input so onBlur does not close first
              onMouseDown={e => { e.preventDefault(); choose(opt); }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer ${
                i === highlight ? 'bg-sage-100' : ''
              } ${opt.value === value ? 'font-medium text-wellness-500' : 'text-sage-800'}`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.hint && <span className="text-xs text-sage-500 truncate">{opt.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ============================================
// BADGE
// ============================================
const BADGE_TONES = {
  neutral: 'bg-sage-100 text-sage-600 border-sage-200',
  primary: 'bg-wellness-50 text-wellness-500 border-wellness-200',
  success: 'bg-success-light text-success border-success/20',
  warning: 'bg-warning-light text-warning border-warning/20',
  danger:  'bg-danger-light text-danger border-danger/20',
  info:    'bg-info-light text-info border-info/20',
  accent:  'bg-terra-50 text-terra-500 border-terra-200',
};

export const Badge = ({ tone = 'neutral', icon: Icon, children, className = '' }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-badge border text-xs font-medium whitespace-nowrap ${BADGE_TONES[tone] || BADGE_TONES.neutral} ${className}`}>
    {Icon && <Icon size={11} aria-hidden="true" />}
    {children}
  </span>
);

// ============================================
// SPINNER
// ============================================
export const Spinner = ({ size = 'md' }) => {
  const t = useT();
  const sizes = { sm: 'w-4 h-4 border-2', md: 'w-8 h-8 border-[3px]', lg: 'w-12 h-12 border-4' };
  return (
    <div role="status" aria-label={t.loading} className={`${sizes[size]} border-wellness-400 border-t-transparent rounded-full animate-spin`}></div>
  );
};

// ============================================
// EMPTY STATE
// ============================================
export const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="text-center py-16">
    {Icon && <Icon size={44} className="text-sage-300 mx-auto mb-4" />}
    <h3 className="text-lg font-medium text-sage-700 mb-2">{title}</h3>
    {description && <p className="text-sage-500 text-sm mb-5">{description}</p>}
    {action && (typeof action === 'object' && action.label
      ? <Button onClick={action.onClick} className="mt-2">{action.label}</Button>
      : action
    )}
  </div>
);
