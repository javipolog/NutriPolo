import React, { useState, useEffect, useMemo } from 'react';
import {
  Check, Download, Upload, Sun, Moon, Monitor, Mail,
  Eye, EyeOff, RotateCcw, Send, Loader2, X, Plus, Edit2,
  Trash2, MapPin, ClipboardList, Languages, Calendar, RefreshCw,
  LogOut, Wifi, Star, Palette, Image, Type, ChevronDown, ChevronUp, FileText,
  Archive, HardDriveDownload, History, ShieldCheck, Clock
} from 'lucide-react';
import { Button, Input, Textarea, useToast, useConfirm } from './UI';
import useStore, { generateId, DEFAULT_INVOICE_DESIGN } from '../stores/store';
import { PRESETS, FONT_OPTIONS, getPresetColors, validateDesign } from '../services/invoiceDesignPresets';
import { testSmtpConnection } from '../services/emailService';
import { googleCalendar } from '../services/googleCalendarService';
import { useT } from '../i18n';

// ── Inline editable list (for locations & consultation types) ──────────────

const InlineList = ({ items, onAdd, onUpdate, onDelete, renderItem, addLabel }) => {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState('');

  const startAdd = () => { setDraft(''); setAdding(true); setEditId(null); };
  const startEdit = (item) => { setDraft(JSON.stringify(item)); setEditId(item.id || item); setAdding(false); };

  return (
    <div className="space-y-2">
      {items.map(item => renderItem(item, editId, setEditId, onUpdate, onDelete))}
      <Button variant="ghost" size="sm" icon={Plus} onClick={() => onAdd()}>
        {addLabel}
      </Button>
    </div>
  );
};

// ── Locations CRUD ─────────────────────────────────────────────────────────

const LocationsManager = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const toast = useToast();
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState({ name: '', address: '', type: 'presencial' });
  const [adding, setAdding] = useState(false);

  const locations = config.locations || [];

  const save = () => {
    if (!draft.name.trim()) return;
    if (editId === 'new') {
      updateConfig({ locations: [...locations, { id: generateId(), ...draft }] });
    } else {
      updateConfig({ locations: locations.map(l => l.id === editId ? { ...l, ...draft } : l) });
    }
    setEditId(null);
    setAdding(false);
    toast.success('Guardado');
  };

  const remove = (id) => {
    updateConfig({ locations: locations.filter(l => l.id !== id) });
    toast.success('Eliminado');
  };

  const startAdd = () => {
    setDraft({ name: '', address: '', type: 'presencial' });
    setEditId('new');
    setAdding(true);
  };

  const startEdit = (loc) => {
    setDraft({ name: loc.name, address: loc.address || '', type: loc.type || 'presencial' });
    setEditId(loc.id);
    setAdding(false);
  };

  const Form = () => (
    <div className="border border-wellness-200 rounded-soft p-3 bg-wellness-50 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          placeholder="Nombre (ej. Centro Synergia)"
          className="text-sm"
        />
        <select
          value={draft.type}
          onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}
          className="px-3 py-2 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
        >
          <option value="presencial">Presencial</option>
          <option value="online">Online</option>
        </select>
      </div>
      <Input
        value={draft.address}
        onChange={e => setDraft(d => ({ ...d, address: e.target.value }))}
        placeholder="Dirección"
        className="text-sm"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={() => { setEditId(null); setAdding(false); }}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={save}>Guardar</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {locations.map(loc => (
        <div key={loc.id}>
          {editId === loc.id ? <Form /> : (
            <div className="flex items-center gap-3 p-2.5 border border-sage-200 rounded-soft bg-white">
              <MapPin size={13} className="text-wellness-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sage-800">{loc.name}</p>
                {loc.address && <p className="text-xs text-sage-400 truncate">{loc.address}</p>}
              </div>
              <span className="text-xs text-sage-400">{loc.type}</span>
              <button onClick={() => startEdit(loc)} className="p-1 text-sage-400 hover:text-sage-700"><Edit2 size={13} /></button>
              <button onClick={() => remove(loc.id)} className="p-1 text-sage-400 hover:text-danger"><Trash2 size={13} /></button>
            </div>
          )}
        </div>
      ))}
      {editId === 'new' && <Form />}
      {editId !== 'new' && (
        <Button variant="ghost" size="sm" icon={Plus} onClick={startAdd}>Añadir ubicación</Button>
      )}
    </div>
  );
};

// ── Consultation Types CRUD ────────────────────────────────────────────────

const ConsultationTypesManager = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const types = config.consultationTypes || [];

  const add = () => {
    if (!draft.trim()) return;
    if (types.includes(draft.trim())) return;
    updateConfig({ consultationTypes: [...types, draft.trim()] });
    setDraft('');
    setAdding(false);
    toast.success('Tipo añadido');
  };

  const remove = (type) => {
    updateConfig({ consultationTypes: types.filter(t => t !== type) });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {types.map(type => (
          <div key={type} className="flex items-center gap-1 px-2.5 py-1 bg-sage-100 text-sage-700 rounded-badge text-xs">
            <span>{type}</span>
            <button onClick={() => remove(type)} className="text-sage-400 hover:text-danger ml-0.5"><X size={11} /></button>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Tipo de consulta..."
            className="text-sm"
            autoFocus
          />
          <Button variant="primary" size="sm" onClick={add}>Añadir</Button>
          <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancelar</Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => { setDraft(''); setAdding(true); }}>
          Añadir tipo
        </Button>
      )}
    </div>
  );
};

// ── Blocked Hours CRUD ────────────────────────────────────────────────────

const DAY_KEYS = ['day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun'];
const HOUR_OPTIONS = Array.from({ length: 13 }, (_, i) => i + 8); // 8..20

const BlockedHoursManager = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const toast = useToast();
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ dayOfWeek: 0, startHour: 14, endHour: 16, label: '' });

  const blocked = config.blockedHours || [];

  const save = () => {
    if (draft.startHour >= draft.endHour) return;
    updateConfig({ blockedHours: [...blocked, { id: generateId(), ...draft }] });
    setDraft({ dayOfWeek: 0, startHour: 14, endHour: 16, label: '' });
    setAdding(false);
    toast.success(t.save);
  };

  const remove = (id) => {
    updateConfig({ blockedHours: blocked.filter(b => b.id !== id) });
    toast.success(t.delete);
  };

  return (
    <div className="space-y-2">
      {blocked.map(b => (
        <div key={b.id} className="flex items-center gap-3 p-2.5 border border-sage-200 rounded-soft bg-white">
          <Clock size={13} className="text-sage-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sage-800">
              {t[DAY_KEYS[b.dayOfWeek]] || DAY_KEYS[b.dayOfWeek]} — {b.startHour}:00 a {b.endHour}:00
            </p>
            {b.label && <p className="text-xs text-sage-400">{b.label}</p>}
          </div>
          <button onClick={() => remove(b.id)} className="p-1 text-sage-400 hover:text-danger"><Trash2 size={13} /></button>
        </div>
      ))}
      {adding ? (
        <div className="border border-wellness-200 rounded-soft p-3 bg-wellness-50 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-sage-500 mb-1">{t.blocked_hours_day}</label>
              <select
                value={draft.dayOfWeek}
                onChange={e => setDraft(d => ({ ...d, dayOfWeek: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
              >
                {DAY_KEYS.map((k, i) => <option key={i} value={i}>{t[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-sage-500 mb-1">{t.blocked_hours_from}</label>
              <select
                value={draft.startHour}
                onChange={e => setDraft(d => ({ ...d, startHour: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-sage-500 mb-1">{t.blocked_hours_to}</label>
              <select
                value={draft.endHour}
                onChange={e => setDraft(d => ({ ...d, endHour: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
              >
                {HOUR_OPTIONS.filter(h => h > draft.startHour).map(h => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
          </div>
          <Input
            value={draft.label}
            onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            placeholder={`${t.blocked_hours_label} (${t.optional})`}
            className="text-sm"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>{t.cancel}</Button>
            <Button variant="primary" size="sm" onClick={save}>{t.save}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(true)}>
          {t.blocked_hours_add}
        </Button>
      )}
    </div>
  );
};

// ── SMTP tester ────────────────────────────────────────────────────────────

const SmtpSection = () => {
  const config = useStore(s => s.config);
  const smtpPassword = useStore(s => s.smtpPassword);
  const updateConfig = useStore(s => s.updateConfig);
  const setSmtpPassword = useStore(s => s.setSmtpPassword);
  const toast = useToast();
  const [showPw, setShowPw] = useState(false);
  const [testing, setTesting] = useState(false);

  const smtp = config.smtp || {};
  const set = (k, v) => updateConfig({ smtp: { ...smtp, [k]: v } });

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await testSmtpConnection({
        host: smtp.host, port: smtp.port || 587,
        user: smtp.user, password: smtpPassword, secure: smtp.secure !== false,
      });
      if (result.success) toast.success('Conexión SMTP correcta');
      else toast.error(result.error || 'Error de conexión');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-sage-600 mb-1">Servidor SMTP</label>
          <Input value={smtp.host || ''} onChange={e => set('host', e.target.value)} placeholder="smtp.gmail.com" />
        </div>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">Puerto</label>
          <Input type="number" value={smtp.port || 587} onChange={e => set('port', parseInt(e.target.value))} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-1">Usuario</label>
        <Input type="email" value={smtp.user || ''} onChange={e => set('user', e.target.value)} placeholder="nutripoloraquel@gmail.com" />
      </div>
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-1">Contraseña / App Password</label>
        <div className="relative">
          <Input
            type={showPw ? 'text' : 'password'}
            value={smtpPassword}
            onChange={e => setSmtpPassword(e.target.value)}
            placeholder="No se guarda en disco"
          />
          <button
            type="button"
            onClick={() => setShowPw(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sage-400 hover:text-sage-600"
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      <Button variant="ghost" size="sm" icon={testing ? Loader2 : Send} onClick={testConnection} disabled={testing}>
        {testing ? 'Probando...' : 'Probar conexión'}
      </Button>
    </div>
  );
};

// ── Google Calendar ────────────────────────────────────────────────────────

const GoogleCalendarSection = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const clearGoogleCalendarData = useStore(s => s.clearGoogleCalendarData);
  const removeConsultationsForCalendar = useStore(s => s.removeConsultationsForCalendar);
  const toast = useToast();

  const gcal = config.googleCalendar || {};
  const setGcal = (partial) => updateConfig({ googleCalendar: { ...gcal, ...partial } });

  // Keep clientId/clientSecret in the store so they survive tab navigation
  const clientId = gcal.clientId || '';
  const clientSecret = gcal.clientSecret || '';
  const setClientId = (v) => setGcal({ clientId: v });
  const setClientSecret = (v) => setGcal({ clientSecret: v });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [calendars, setCalendars] = useState([]);

  useEffect(() => {
    if (gcal.connected && gcal.accessToken) handleLoadCalendars();
  }, [gcal.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error('Introduce el Client ID y el Client Secret');
      return;
    }
    setLoading(true);
    try {
      // Step 1: start OAuth — backend opens browser and waits for redirect code
      const authResult = await googleCalendar.startAuth(clientId.trim(), clientSecret.trim());
      const code = authResult.code;
      const redirectUri = authResult.redirect_uri || 'urn:ietf:wg:oauth:2.0:oob';

      // Step 2: exchange code for tokens
      const tokenResult = await googleCalendar.exchangeToken(
        clientId.trim(), clientSecret.trim(), code, redirectUri
      );
      const accessToken = tokenResult.access_token;
      const expiresAt = Date.now() + (tokenResult.expires_in * 1000);
      const refreshToken = tokenResult.refresh_token || '';

      // Step 3: list calendars to get user email
      const calList = await googleCalendar.listCalendars(accessToken);
      setCalendars(calList);
      const primary = calList.find(c => c.primary) || calList[0];
      const userEmail = primary?.id || '';

      const newCalendars = calList.map(c => ({
        id: c.id,
        name: c.summary,
        color: c.background_color,
        accessRole: c.access_role,
        syncMode: 'disabled',
      }));

      // Auto-detect NutriPolo calendar and enable it as default
      let defaultPushCalendarId = null;
      const nutripoloIdx = newCalendars.findIndex(
        c => c.name && c.name.toLowerCase().includes('nutripolo') && c.accessRole !== 'reader'
      );
      if (nutripoloIdx !== -1) {
        newCalendars[nutripoloIdx].syncMode = 'bidirectional';
        defaultPushCalendarId = newCalendars[nutripoloIdx].id;
      }

      setGcal({
        connected: true,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        accessToken,
        refreshToken,
        expiresAt,
        calendars: newCalendars,
        defaultPushCalendarId,
        userEmail,
      });

      if (nutripoloIdx !== -1) {
        toast.success(`Conectado — "${newCalendars[nutripoloIdx].name}" activado automáticamente`);
      } else {
        toast.success('Google Calendar conectado — selecciona un calendario bidireccional');
      }
    } catch (e) {
      toast.error('Error al conectar: ' + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadCalendars = async () => {
    if (!gcal.accessToken) return;
    try {
      const calList = await googleCalendar.listCalendars(gcal.accessToken);
      setCalendars(calList);
    } catch {
      // ignore — calendars may not be loaded yet
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { default: useStore } = await import('../stores/store');
      const stats = await googleCalendar.syncAll(useStore.getState());
      toast.success(`Sincronizado — ${stats.pushed} enviados, ${stats.pulled} recibidos, ${stats.updated} actualizados`);
    } catch (e) {
      toast.error('Error al sincronizar: ' + (e?.message || String(e)));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    // Best-effort token revocation at Google
    try {
      if (gcal.accessToken) await googleCalendar.revokeToken(gcal.accessToken);
    } catch { /* ignore */ }
    try {
      if (gcal.refreshToken) await googleCalendar.revokeToken(gcal.refreshToken);
    } catch { /* ignore */ }
    // Atomic store reset
    clearGoogleCalendarData();
    setCalendars([]);
    toast.success('Google Calendar desconectado');
  };

  const isHolidayCalendar = (cal) => {
    const name = (cal.summary || cal.name || '').toLowerCase();
    return (
      cal.id?.endsWith('@holiday.calendar.google.com') ||
      name.includes('holiday') || name.includes('holidays') ||
      name.includes('festivos') || name.includes('días festivos')
    );
  };

  const handleCalendarSyncMode = (cal, newMode) => {
    if (cal.access_role === 'reader' && newMode === 'bidirectional') return;
    const current = gcal.calendars || [];
    const exists = current.find(sc => sc.id === cal.id);
    const updated = exists
      ? current.map(sc => sc.id === cal.id ? { ...sc, syncMode: newMode } : sc)
      : [...current, { id: cal.id, name: cal.summary, color: cal.background_color, accessRole: cal.access_role, syncMode: newMode }];
    const extra = {};
    if (newMode !== 'bidirectional' && gcal.defaultPushCalendarId === cal.id) {
      extra.defaultPushCalendarId = null;
    }
    setGcal({ calendars: updated, ...extra });

    // When disabling a holiday calendar, delete its synced events (they are noise, not real consultations)
    if (newMode === 'disabled' && isHolidayCalendar(cal)) {
      removeConsultationsForCalendar(cal.id);
    }
  };

  const handleSetDefaultCalendar = (calId) => {
    setGcal({ defaultPushCalendarId: calId });
  };

  if (gcal.connected) {
    return (
      <div className="space-y-4">
        {/* Connected badge */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-badge text-xs font-medium">
            <Wifi size={12} />
            Conectado como {gcal.userEmail || 'Google Calendar'}
          </span>
        </div>

        {/* Calendar list with sync modes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-sage-600">Calendarios</label>
            <button onClick={handleLoadCalendars} className="text-xs text-wellness-500 hover:text-wellness-600">
              Actualizar lista
            </button>
          </div>
          {calendars.length === 0 ? (
            <p className="text-xs text-sage-400">Cargando calendarios...</p>
          ) : (
            <div className="space-y-2">
              {calendars.map(cal => {
                const stored = (gcal.calendars || []).find(sc => sc.id === cal.id);
                const syncMode = stored?.syncMode || 'disabled';
                const isReader = cal.access_role === 'reader';
                return (
                  <div key={cal.id} className="flex items-center gap-2 p-2 rounded-button border border-sage-200 bg-sage-50">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: cal.background_color || '#4285f4' }}
                    />
                    <span className="flex-1 text-sm text-sage-700 truncate">{cal.summary || cal.id}</span>
                    {isReader && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded-badge whitespace-nowrap">solo lectura</span>
                    )}
                    <select
                      value={syncMode}
                      onChange={e => handleCalendarSyncMode(cal, e.target.value)}
                      className="text-xs px-2 py-1 border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
                    >
                      {!isReader && <option value="bidirectional">↔ Bidireccional</option>}
                      <option value="readonly">← Solo lectura</option>
                      <option value="disabled">✗ Desactivado</option>
                    </select>
                    {syncMode === 'bidirectional' && (
                      <button
                        onClick={() => handleSetDefaultCalendar(cal.id)}
                        className={`p-1 transition-colors ${
                          gcal.defaultPushCalendarId === cal.id
                            ? 'text-amber-500'
                            : 'text-sage-300 hover:text-amber-400'
                        }`}
                        title="Calendario predeterminado para nuevas consultas"
                      >
                        <Star size={14} fill={gcal.defaultPushCalendarId === cal.id ? 'currentColor' : 'none'} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Auto-sync toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-sage-700">Sincronizar automáticamente</p>
            <p className="text-xs text-sage-400">Al abrir el calendario se sincronizará con Google</p>
          </div>
          <button
            onClick={() => setGcal({ autoSync: !gcal.autoSync })}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
              gcal.autoSync ? 'bg-wellness-400' : 'bg-sage-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                gcal.autoSync ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            icon={syncing ? Loader2 : RefreshCw}
            onClick={handleSyncNow}
            disabled={syncing}
          >
            {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={LogOut}
            onClick={handleDisconnect}
          >
            Desconectar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-sage-500">
        Conecta tu Google Calendar para sincronizar consultas automáticamente.
        Necesitas un proyecto en{' '}
        <span className="font-medium text-sage-700">Google Cloud Console</span>{' '}
        con la API de Google Calendar habilitada.
      </p>
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-1">Client ID</label>
        <Input
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-1">Client Secret</label>
        <Input
          type="password"
          value={clientSecret}
          onChange={e => setClientSecret(e.target.value)}
          placeholder="GOCSPX-..."
        />
      </div>
      <Button
        variant="primary"
        size="sm"
        icon={loading ? Loader2 : Calendar}
        onClick={handleConnect}
        disabled={loading}
      >
        {loading ? 'Conectando...' : 'Conectar con Google'}
      </Button>
    </div>
  );
};

// ── Main SettingsView ──────────────────────────────────────────────────────

// ── Invoice Design Section ─────────────────────────────────────────────────
const InvoiceDesignSection = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const toast = useToast();
  const t = useT();
  const [colorsOpen, setColorsOpen] = useState(false);

  const design = useMemo(() => validateDesign(config.invoiceDesign), [config.invoiceDesign]);

  const setDesign = (partial) => {
    updateConfig({ invoiceDesign: { ...design, ...partial } });
  };
  const setColor = (key, value) => {
    setDesign({ colors: { ...design.colors, [key]: value }, preset: 'custom' });
  };

  // ── Logo upload ──
  const handleLogoUpload = async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { readBinaryFile } = await import('@tauri-apps/api/fs');
      const filePath = await open({
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
        multiple: false,
      });
      if (!filePath) return;

      const bytes = await readBinaryFile(filePath);
      if (bytes.length > 2 * 1024 * 1024) {
        toast.error(t.design_logo_too_large || 'Imagen demasiado grande (max 2MB)');
        return;
      }

      const ext = filePath.toLowerCase().split('.').pop();
      const type = ext === 'png' ? 'png' : 'jpg';
      const mimeType = type === 'png' ? 'image/png' : 'image/jpeg';
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);

      await new Promise((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => {
          const MAX_W = 300, MAX_H = 100;
          let { width, height } = img;
          if (width > MAX_W || height > MAX_H) {
            const ratio = Math.min(MAX_W / width, MAX_H / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL(mimeType, 0.9);
          URL.revokeObjectURL(url);
          setDesign({ logo: { data: dataUrl, type, width, height } });
          toast.success('Logo actualizado');
          resolve();
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen invalida')); };
        img.src = url;
      });
    } catch (err) {
      if (import.meta.env.DEV && err.message !== 'Imagen invalida') console.error(err);
      toast.error('Error al cargar el logo');
    }
  };

  const removeLogo = () => {
    setDesign({ logo: null });
    toast.success('Logo eliminado');
  };

  // ── Color swatch for preset cards ──
  const PresetCard = ({ id, preset }) => {
    const isActive = design.preset === id;
    const colors = preset.colors;
    return (
      <button
        onClick={() => setDesign({ preset: id, colors: getPresetColors(id) })}
        className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-soft border-2 transition-all ${
          isActive
            ? 'border-wellness-400 bg-wellness-50 shadow-sm'
            : 'border-sage-200 bg-white hover:border-sage-300'
        }`}
      >
        <div className="flex gap-1">
          {[colors.accent, colors.accentDark, colors.primary, colors.cardBg].map((c, i) => (
            <span key={i} className="w-4 h-4 rounded-full border border-sage-200" style={{ backgroundColor: c }} />
          ))}
        </div>
        <span className="text-[10px] font-medium text-sage-600">{t[`design_preset_${id}`] || preset.label}</span>
      </button>
    );
  };

  // ── Color input row ──
  const ColorRow = ({ label, colorKey }) => (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={design.colors[colorKey]}
        onChange={(e) => setColor(colorKey, e.target.value)}
        className="w-8 h-8 rounded border border-sage-200 cursor-pointer p-0.5"
      />
      <span className="text-xs text-sage-600 flex-1">{label}</span>
      <span className="text-[10px] font-mono text-sage-400">{design.colors[colorKey]}</span>
    </div>
  );

  // ── HTML Preview ──
  const Preview = () => {
    const c = design.colors;
    return (
      <div className="border border-sage-200 rounded-soft overflow-hidden bg-white" style={{ maxWidth: 360 }}>
        <div style={{ transform: 'scale(0.55)', transformOrigin: 'top left', width: '182%', height: 320 }}>
          {/* Accent bar */}
          <div style={{ height: 6, background: c.accent }} />
          {/* Header */}
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {design.logo?.data ? (
                <img src={design.logo.data} alt="Logo" style={{ maxHeight: 36, maxWidth: 140 }} />
              ) : (
                <span style={{ fontFamily: design.fontFamily === 'roboto' ? 'Roboto' : 'Work Sans, sans-serif', fontSize: 20, fontWeight: 700, color: c.accent, letterSpacing: 3 }}>NUTRIPOLO</span>
              )}
              {design.showTagline && (
                <div style={{ fontSize: 7, color: c.muted, marginTop: 2 }}>{design.taglineText}</div>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: 8, color: c.accent, fontWeight: 600 }}>
              <div>N FACTURA</div>
              <div style={{ color: c.primary }}>NP-2026-001</div>
            </div>
          </div>
          {/* Section labels */}
          <div style={{ padding: '0 20px', display: 'flex', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: c.accent, borderBottom: `2px solid ${c.accentMid}`, paddingBottom: 3, marginBottom: 4 }}>PROFESIONAL</div>
              <div style={{ fontSize: 7, color: c.primary }}>Raquel Polo Garcia</div>
              <div style={{ fontSize: 7, color: c.secondary }}>NIF: 12345678A</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: c.accent, borderBottom: `2px solid ${c.accentMid}`, paddingBottom: 3, marginBottom: 4 }}>CLIENTE</div>
              <div style={{ fontSize: 7, color: c.primary }}>Maria Lopez</div>
              <div style={{ fontSize: 7, color: c.secondary }}>NIF: 87654321B</div>
            </div>
          </div>
          {/* Items table */}
          <div style={{ padding: '10px 20px' }}>
            <div style={{ display: 'flex', background: c.accentLight, padding: '4px 6px', fontSize: 7, fontWeight: 600, color: c.muted }}>
              <span style={{ flex: 3 }}>SERVICIO</span>
              <span style={{ flex: 1, textAlign: 'right' }}>CANT.</span>
              <span style={{ flex: 1, textAlign: 'right' }}>PRECIO</span>
              <span style={{ flex: 1, textAlign: 'right' }}>IMPORTE</span>
            </div>
            {[['Primera visita', '1', '60,00', '60,00'], ['Seguimiento', '2', '40,00', '80,00']].map(([desc, qty, price, amt], i) => (
              <div key={i} style={{ display: 'flex', padding: '4px 6px', fontSize: 7, color: c.primary, background: i % 2 ? c.cardBg : 'transparent' }}>
                <span style={{ flex: 3 }}>{desc}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{qty}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{price} &euro;</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{amt} &euro;</span>
              </div>
            ))}
          </div>
          {/* Totals */}
          <div style={{ padding: '6px 20px' }}>
            <div style={{ background: c.accentLight, padding: '6px 10px', borderRadius: 4, textAlign: 'right' }}>
              <div style={{ fontSize: 7, color: c.secondary }}>Base: 140,00 &euro; &middot; IVA 21%: 29,40 &euro;</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.accentDark, marginTop: 2 }}>TOTAL: 169,40 &euro;</div>
            </div>
          </div>
          {/* Footer */}
          <div style={{ marginTop: 8, padding: '6px 20px', borderTop: `1px solid ${c.accentMid}`, fontSize: 6, color: c.muted, display: 'flex', justifyContent: 'space-between' }}>
            <span>NUTRIPOLO</span>
            <span>nutripoloraquel@gmail.com</span>
            <span>Pag. 1 de 1</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Logo */}
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-2">
          <Image size={13} className="inline mr-1" />
          {t.design_logo || 'Logotipo'}
        </label>
        <div className="flex items-center gap-4">
          <button
            onClick={handleLogoUpload}
            className="flex items-center justify-center border-2 border-dashed border-sage-300 rounded-soft hover:border-wellness-400 transition-colors cursor-pointer"
            style={{ width: 160, height: 64 }}
          >
            {design.logo?.data ? (
              <img src={design.logo.data} alt="Logo" className="max-h-14 max-w-[150px] object-contain" />
            ) : (
              <span className="text-xs text-sage-400 flex items-center gap-1">
                <Upload size={14} />
                {t.design_upload_logo || 'Subir logotipo'}
              </span>
            )}
          </button>
          {design.logo && (
            <Button variant="ghost" size="sm" icon={Trash2} onClick={removeLogo}>
              {t.design_remove_logo || 'Eliminar'}
            </Button>
          )}
        </div>
      </div>

      {/* Presets */}
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-2">
          <Palette size={13} className="inline mr-1" />
          {t.design_preset || 'Paleta de colores'}
        </label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([id, preset]) => (
            <PresetCard key={id} id={id} preset={preset} />
          ))}
          {design.preset === 'custom' && (
            <div className="flex flex-col items-center justify-center px-3 py-2.5 rounded-soft border-2 border-wellness-400 bg-wellness-50 shadow-sm">
              <div className="flex gap-1">
                {[design.colors.accent, design.colors.accentDark, design.colors.primary, design.colors.cardBg].map((c, i) => (
                  <span key={i} className="w-4 h-4 rounded-full border border-sage-200" style={{ backgroundColor: c }} />
                ))}
              </div>
              <span className="text-[10px] font-medium text-sage-600">{t.design_preset_custom || 'Personalizado'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Custom colors (collapsible) */}
      <div>
        <button
          onClick={() => setColorsOpen(!colorsOpen)}
          className="flex items-center gap-1.5 text-xs font-medium text-sage-500 hover:text-sage-700 transition-colors"
        >
          {colorsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {t.design_colors || 'Personalizar colores'}
        </button>
        {colorsOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-sage-50 rounded-soft border border-sage-200">
            <ColorRow label={t.design_accent || 'Color principal'} colorKey="accent" />
            <ColorRow label="Color oscuro" colorKey="accentDark" />
            <ColorRow label="Color claro" colorKey="accentLight" />
            <ColorRow label="Color medio" colorKey="accentMid" />
            <ColorRow label="Texto principal" colorKey="primary" />
            <ColorRow label="Texto secundario" colorKey="secondary" />
            <ColorRow label="Labels" colorKey="muted" />
            <ColorRow label="Fondo alterno" colorKey="cardBg" />
          </div>
        )}
      </div>

      {/* Font selector */}
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-2">
          <Type size={13} className="inline mr-1" />
          {t.design_font || 'Tipografia del PDF'}
        </label>
        <select
          value={design.fontFamily}
          onChange={(e) => setDesign({ fontFamily: e.target.value })}
          className="px-3 py-1.5 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          {FONT_OPTIONS.map(f => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Tagline */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-sage-600 cursor-pointer">
          <input
            type="checkbox"
            checked={design.showTagline}
            onChange={(e) => setDesign({ showTagline: e.target.checked })}
            className="rounded border-sage-300 text-wellness-400 focus:ring-wellness-400"
          />
          {t.design_show_tagline || 'Mostrar subtitulo'}
        </label>
        {design.showTagline && (
          <Input
            value={design.taglineText}
            onChange={(e) => setDesign({ taglineText: e.target.value })}
            className="flex-1 text-xs"
            placeholder="Nutricion Clinica"
          />
        )}
      </div>

      {/* Live preview */}
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-2">
          <FileText size={13} className="inline mr-1" />
          {t.design_preview || 'Vista previa'}
        </label>
        <Preview />
      </div>
    </div>
  );
};

const Section = ({ title, children }) => (
  <div className="bg-white border border-sage-200 rounded-soft shadow-card p-5 space-y-4">
    <h2 className="text-sm font-semibold text-sage-700 border-b border-sage-100 pb-2">{title}</h2>
    {children}
  </div>
);

export const SettingsView = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const appTheme = useStore(s => s.appTheme);
  const setAppTheme = useStore(s => s.setAppTheme);
  const exportDataToZip = useStore(s => s.exportDataToZip);
  const importDataFromZip = useStore(s => s.importDataFromZip);
  const getAutoBackupInfo = useStore(s => s.getAutoBackupInfo);
  const restoreFromAutoBackup = useStore(s => s.restoreFromAutoBackup);
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [exportProgress, setExportProgress] = useState(null);
  const [backupInfo, setBackupInfo] = useState({ count: 0, lastDate: null, dates: [] });
  const [selectedBackupDate, setSelectedBackupDate] = useState('');
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    getAutoBackupInfo().then(info => {
      setBackupInfo(info);
      if (info.dates.length > 0) setSelectedBackupDate(info.dates[info.dates.length - 1]);
    });
  }, []);

  const set = (k, v) => updateConfig({ [k]: v });

  const handleExportZip = async () => {
    try {
      const result = await exportDataToZip(({ current, total }) => setExportProgress({ current, total }));
      setExportProgress(null);
      toast.success(t.backup_export_success);
      if (result?.skipped > 0) {
        toast.warning(t.backup_skipped_files.replace('{count}', result.skipped));
      }
    } catch (e) {
      setExportProgress(null);
      toast.error(t.backup_export_error + ': ' + e.message);
    }
  };

  const handleImportZip = async () => {
    const ok = await confirm({
      title: t.backup_import_confirm_title,
      message: t.backup_import_confirm_msg,
      danger: true,
    });
    if (!ok) return;
    setImporting(true);
    try {
      const result = await importDataFromZip();
      if (result) {
        toast.success(t.backup_import_success);
      }
    } catch (e) {
      toast.error(t.backup_import_error + ': ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleRestoreAutoBackup = async () => {
    if (!selectedBackupDate) return;
    const ok = await confirm({
      title: t.backup_auto_restore,
      message: t.backup_auto_restore_confirm.replace('{date}', selectedBackupDate),
      danger: true,
    });
    if (!ok) return;
    setRestoring(true);
    try {
      await restoreFromAutoBackup(selectedBackupDate);
      toast.success(t.backup_import_success);
    } catch (e) {
      toast.error(t.backup_restore_error + ': ' + e.message);
    } finally {
      setRestoring(false);
    }
  };

  const THEMES = [
    { id: 'light', icon: Sun, label: 'Claro' },
    { id: 'dark', icon: Moon, label: 'Oscuro' },
    { id: 'auto', icon: Monitor, label: 'Sistema' },
  ];

  const LANGS = [
    { id: 'es', label: 'Castellano' },
    { id: 'ca', label: 'Català' },
    { id: 'en', label: 'English' },
  ];

  return (
    <div className="space-y-5 animate-fadeIn max-w-2xl">
      <h1 className="text-2xl font-bold text-sage-900">{t.settings_title}</h1>

      {/* Personal data */}
      <Section title={t.settings_personal}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Nombre completo</label>
            <Input value={config.nombre || ''} onChange={e => set('nombre', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">NIF</label>
            <Input value={config.nif || ''} onChange={e => set('nif', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Nº Colegiada</label>
            <Input value={config.numColegiada || ''} onChange={e => set('numColegiada', e.target.value)} placeholder="CV01944" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Email</label>
            <Input type="email" value={config.email || ''} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Teléfono</label>
            <Input value={config.telefono || ''} onChange={e => set('telefono', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Web</label>
            <Input value={config.web || ''} onChange={e => set('web', e.target.value)} placeholder="nutripoloraquel.com" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">Dirección</label>
          <Textarea value={config.direccion || ''} onChange={e => set('direccion', e.target.value)} rows={2} />
        </div>
      </Section>

      {/* Clinic config */}
      <Section title="Configuración de consulta">
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-2">Ubicaciones</label>
          <LocationsManager />
        </div>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-2">Tipos de consulta</label>
          <ConsultationTypesManager />
        </div>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">Duración por defecto (min)</label>
          <Input
            type="number"
            value={config.defaultConsultationDuration || 45}
            onChange={e => set('defaultConsultationDuration', parseInt(e.target.value))}
            className="w-32"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-2">{t.settings_blocked_hours}</label>
          <BlockedHoursManager />
        </div>
      </Section>

      {/* Email / SMTP */}
      <Section title={t.settings_email}>
        <SmtpSection />
      </Section>

      {/* WhatsApp */}
      <Section title="WhatsApp">
        <div className="max-w-xs">
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.whatsapp_country_code}</label>
          <Input
            value={config.whatsappCountryCode || '34'}
            onChange={e => set('whatsappCountryCode', e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="34"
          />
          <p className="text-xs text-sage-400 mt-1">España: 34 · México: 52 · Argentina: 54</p>
        </div>
      </Section>

      {/* Appearance */}
      <Section title={t.settings_appearance}>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-2">Tema</label>
          <div className="flex gap-2">
            {THEMES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setAppTheme(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-button border transition-colors ${
                  appTheme === id
                    ? 'bg-wellness-400 text-white border-wellness-400'
                    : 'bg-white text-sage-600 border-sage-300 hover:border-wellness-300'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-2">
            <Languages size={13} className="inline mr-1" />
            Idioma
          </label>
          <div className="flex gap-2">
            {LANGS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => set('appLang', id)}
                className={`px-3 py-1.5 text-xs rounded-button border transition-colors ${
                  config.appLang === id
                    ? 'bg-wellness-400 text-white border-wellness-400'
                    : 'bg-white text-sage-600 border-sage-300 hover:border-wellness-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Invoice Design */}
      <Section title={
        <span className="flex items-center gap-1.5">
          <Palette size={14} />
          {t.settings_invoice_design || 'Diseno de documentos'}
        </span>
      }>
        <InvoiceDesignSection />
      </Section>

      {/* Google Calendar */}
      <Section title={
        <span className="flex items-center gap-1.5">
          <Calendar size={14} />
          Google Calendar
        </span>
      }>
        <GoogleCalendarSection />
      </Section>

      {/* Data & Backups */}
      <Section title={
        <span className="flex items-center gap-1.5">
          <ShieldCheck size={14} />
          {t.settings_data}
        </span>
      }>
        {/* Auto-backup info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-sage-500">
            <History size={13} />
            {backupInfo.lastDate ? (
              <span>{t.backup_auto_last}: <strong className="text-sage-700">{backupInfo.lastDate}</strong> — {backupInfo.count} {t.backup_auto_count}</span>
            ) : (
              <span>{t.backup_auto_none}</span>
            )}
          </div>

          {backupInfo.dates.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedBackupDate}
                onChange={e => setSelectedBackupDate(e.target.value)}
                className="text-xs border border-sage-300 rounded-button px-2 py-1.5 bg-white text-sage-700 focus:border-wellness-400 focus:ring-1 focus:ring-wellness-400 outline-none"
              >
                {backupInfo.dates.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                onClick={handleRestoreAutoBackup}
                disabled={restoring}
              >
                {restoring ? <Loader2 size={13} className="animate-spin" /> : t.backup_auto_restore}
              </Button>
            </div>
          )}
          <p className="text-xs text-sage-400 italic">{t.backup_auto_data_only}</p>
        </div>

        {/* Manual backup (ZIP) */}
        <div className="border-t border-sage-100 pt-4 space-y-3">
          <div className="flex gap-3">
            <Button
              variant="ghost"
              icon={Archive}
              onClick={handleExportZip}
              disabled={!!exportProgress || importing}
            >
              {exportProgress
                ? t.backup_exporting.replace('{current}', exportProgress.current).replace('{total}', exportProgress.total)
                : t.backup_export_zip}
            </Button>
            <Button
              variant="ghost"
              icon={Upload}
              onClick={handleImportZip}
              disabled={!!exportProgress || importing}
            >
              {importing ? <Loader2 size={13} className="animate-spin" /> : t.backup_import}
            </Button>
          </div>
          <p className="text-xs text-sage-400">{t.backup_includes_docs}</p>
        </div>

        <p className="text-xs text-sage-400 border-t border-sage-100 pt-3">{t.backup_data_hint}</p>
      </Section>

      {ConfirmDialog}
    </div>
  );
};

export default SettingsView;
