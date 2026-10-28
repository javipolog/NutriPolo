import React, { useState, useEffect, useMemo, useId } from 'react';
import {
  Upload, Sun, Moon, Monitor,
  Eye, EyeOff, RotateCcw, Send, Loader2, X, Plus, Edit2,
  Trash2, MapPin, Languages, Calendar, RefreshCw,
  LogOut, Wifi, Palette, Image, Type, ChevronDown, ChevronUp, FileText,
  Archive, History, ShieldCheck, Clock, AlertTriangle, Settings2, AlertCircle, Lock
} from 'lucide-react';
import { Button, Input, Textarea, Modal, useToast, useConfirm } from './UI';
import useStore, { generateId, inferCalendarPurpose, flushAllPending, errMsg } from '../stores/store';
import { PRESETS, FONT_OPTIONS, getPresetColors, validateDesign } from '../services/invoiceDesignPresets';
import { testSmtpConnection } from '../services/emailService';
// Invoice design preview fonts, loaded only with this view
import '@fontsource/work-sans/latin-700.css';
import '@fontsource/roboto/latin-700.css';
import { googleCalendar, formatSyncStats, formatSyncErrors } from '../services/googleCalendarService';
import { useT, useLocale, plural } from '../i18n';
import { RemindersSection } from './settings/RemindersSection';
import { invoke } from '@tauri-apps/api/tauri';

// ── Locations CRUD ─────────────────────────────────────────────────────────

const LocationsManager = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const toast = useToast();
  const t = useT();
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState({ name: '', address: '', type: 'presencial' });

  const locations = config.locations || [];

  const save = () => {
    if (!draft.name.trim()) return;
    if (editId === 'new') {
      updateConfig({ locations: [...locations, { id: generateId(), ...draft }] });
    } else {
      updateConfig({ locations: locations.map(l => l.id === editId ? { ...l, ...draft } : l) });
    }
    setEditId(null);
    toast.success(t.saved);
  };

  const remove = (id) => {
    updateConfig({ locations: locations.filter(l => l.id !== id) });
    toast.success(t.deleted);
  };

  const startAdd = () => {
    setDraft({ name: '', address: '', type: 'presencial' });
    setEditId('new');
  };

  const startEdit = (loc) => {
    setDraft({ name: loc.name, address: loc.address || '', type: loc.type || 'presencial' });
    setEditId(loc.id);
  };

  // A JSX element, not an inline component: an inline component would be a
  // new type on every render and remount the inputs (losing focus per key).
  const form = (
    <div className="border border-wellness-200 rounded-soft p-3 bg-wellness-50 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          placeholder={t.settings_location_name_placeholder}
          aria-label={t.settings_location_name}
          className="text-sm"
        />
        <select
          value={draft.type}
          onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}
          aria-label={t.settings_location_type}
          className="px-3 py-2 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
        >
          <option value="presencial">{t.settings_location_presencial}</option>
          <option value="online">{t.settings_location_online}</option>
        </select>
      </div>
      <Input
        value={draft.address}
        onChange={e => setDraft(d => ({ ...d, address: e.target.value }))}
        placeholder={t.settings_location_addr}
        aria-label={t.settings_location_addr}
        className="text-sm"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>{t.cancel}</Button>
        <Button variant="primary" size="sm" onClick={save}>{t.save}</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {locations.map(loc => (
        <div key={loc.id}>
          {editId === loc.id ? form : (
            <div className="flex items-center gap-3 p-2.5 border border-sage-200 rounded-soft bg-white">
              <MapPin size={13} className="text-wellness-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sage-800">{loc.name}</p>
                {loc.address && <p className="text-xs text-sage-400 truncate">{loc.address}</p>}
              </div>
              <span className="text-xs text-sage-400">{t[`settings_location_${loc.type}`] || loc.type}</span>
              <button onClick={() => startEdit(loc)} aria-label={`${t.edit}: ${loc.name}`} title={t.edit} className="p-1 text-sage-400 hover:text-sage-700"><Edit2 size={13} /></button>
              <button onClick={() => remove(loc.id)} aria-label={`${t.delete}: ${loc.name}`} title={t.delete} className="p-1 text-sage-400 hover:text-danger"><Trash2 size={13} /></button>
            </div>
          )}
        </div>
      ))}
      {editId === 'new' && form}
      {editId !== 'new' && (
        <Button variant="ghost" size="sm" icon={Plus} onClick={startAdd}>{t.settings_add_location}</Button>
      )}
    </div>
  );
};

// ── Consultation Types CRUD ────────────────────────────────────────────────

const ConsultationTypesManager = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const toast = useToast();
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const types = config.consultationTypes || [];

  const add = () => {
    if (!draft.trim()) return;
    if (types.includes(draft.trim())) return;
    updateConfig({ consultationTypes: [...types, draft.trim()] });
    setDraft('');
    setAdding(false);
    toast.success(t.settings_type_added);
  };

  const remove = (type) => {
    updateConfig({ consultationTypes: types.filter(x => x !== type) });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {types.map(type => (
          <div key={type} className="flex items-center gap-1 px-2.5 py-1 bg-sage-100 text-sage-700 rounded-badge text-xs">
            <span>{type}</span>
            <button onClick={() => remove(type)} aria-label={`${t.delete}: ${type}`} title={t.delete} className="text-sage-400 hover:text-danger ml-0.5"><X size={11} /></button>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }}
            placeholder={`${t.consultation_type}...`}
            aria-label={t.consultation_type}
            className="text-sm"
            autoFocus
          />
          <Button variant="primary" size="sm" onClick={add}>{t.add}</Button>
          <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>{t.cancel}</Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => { setDraft(''); setAdding(true); }}>
          {t.settings_add_type}
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
    toast.success(t.saved);
  };

  const remove = (id) => {
    updateConfig({ blockedHours: blocked.filter(b => b.id !== id) });
    toast.success(t.deleted);
  };

  return (
    <div className="space-y-2">
      {blocked.map(b => (
        <div key={b.id} className="flex items-center gap-3 p-2.5 border border-sage-200 rounded-soft bg-white">
          <Clock size={13} className="text-sage-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sage-800">
              {t[DAY_KEYS[b.dayOfWeek]] || DAY_KEYS[b.dayOfWeek]} — {t.blocked_hours_range.replace('{from}', b.startHour).replace('{to}', b.endHour)}
            </p>
            {b.label && <p className="text-xs text-sage-400">{b.label}</p>}
          </div>
          <button onClick={() => remove(b.id)} aria-label={t.delete} title={t.delete} className="p-1 text-sage-400 hover:text-danger"><Trash2 size={13} /></button>
        </div>
      ))}
      {adding ? (
        <div className="border border-wellness-200 rounded-soft p-3 bg-wellness-50 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="blocked-day" className="block text-xs text-sage-500 mb-1">{t.blocked_hours_day}</label>
              <select
                id="blocked-day"
                value={draft.dayOfWeek}
                onChange={e => setDraft(d => ({ ...d, dayOfWeek: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
              >
                {DAY_KEYS.map((k, i) => <option key={i} value={i}>{t[k]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="blocked-from" className="block text-xs text-sage-500 mb-1">{t.blocked_hours_from}</label>
              <select
                id="blocked-from"
                value={draft.startHour}
                onChange={e => setDraft(d => ({ ...d, startHour: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="blocked-to" className="block text-xs text-sage-500 mb-1">{t.blocked_hours_to}</label>
              <select
                id="blocked-to"
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
            aria-label={t.blocked_hours_label}
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
  const t = useT();
  const [showPw, setShowPw] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  // Reflects whether a password is present in the OS credential store.
  // We never expose the plaintext password — only its presence.
  const [keyringHas, setKeyringHas] = useState(false);

  const smtp = config.smtp || {};
  const set = (k, v) => updateConfig({ smtp: { ...smtp, [k]: v } });

  // On mount, check the OS credential store. If a password is present,
  // load it into the session-only `smtpPassword` so the user can
  // immediately send/test without re-entering it.
  useEffect(() => {
    (async () => {
      try {
        const present = await invoke('has_smtp_password');
        setKeyringHas(!!present);
        if (present && !smtpPassword) {
          try {
            const pw = await invoke('get_smtp_password');
            if (pw) setSmtpPassword(pw);
          } catch { /* ignore — user may have revoked access */ }
        }
      } catch { /* ignore — keyring may be unavailable */ }
    })();
    // Intentionally run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await testSmtpConnection({
        host:      smtp.host,
        port:      smtp.port || 587,
        username:  smtp.user || '',
        password:  smtpPassword,
        fromName:  config.nombre || '',
        fromEmail: smtp.user || '',
        useTls:    smtp.secure !== false,
      });
      if (result.success) toast.success(t.smtp_test_ok);
      else toast.error(result.error || t.smtp_test_fail);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setTesting(false);
    }
  };

  const savePasswordToKeyring = async () => {
    if (!smtpPassword) {
      toast.error(t.smtp_password_required);
      return;
    }
    setSaving(true);
    try {
      await invoke('store_smtp_password', { password: smtpPassword });
      setKeyringHas(true);
      toast.success(t.smtp_password_saved);
    } catch (e) {
      toast.error(t.smtp_password_save_error.replace('{error}', e?.toString() || 'keyring_error'));
    } finally {
      setSaving(false);
    }
  };

  const clearPasswordFromKeyring = async () => {
    try {
      await invoke('clear_smtp_password');
      setKeyringHas(false);
      setSmtpPassword('');
      toast.success(t.smtp_password_cleared);
    } catch (e) {
      toast.error(t.smtp_password_clear_error.replace('{error}', e?.toString() || 'keyring_error'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label htmlFor="smtp-host" className="block text-xs font-medium text-sage-600 mb-1">{t.smtp_host}</label>
          <Input id="smtp-host" value={smtp.host || ''} onChange={e => set('host', e.target.value)} placeholder="smtp.gmail.com" />
        </div>
        <div>
          <label htmlFor="smtp-port" className="block text-xs font-medium text-sage-600 mb-1">{t.smtp_port}</label>
          <Input id="smtp-port" type="number" value={smtp.port || 587} onChange={e => set('port', parseInt(e.target.value))} />
        </div>
      </div>
      <div>
        <label htmlFor="smtp-user" className="block text-xs font-medium text-sage-600 mb-1">{t.smtp_user}</label>
        <Input id="smtp-user" type="email" value={smtp.user || ''} onChange={e => set('user', e.target.value)} placeholder="nutripoloraquel@gmail.com" />
      </div>
      <div>
        <label htmlFor="smtp-password" className="block text-xs font-medium text-sage-600 mb-1">
          {t.smtp_password_label}
          {keyringHas && <span className="ml-2 text-wellness-600">✓ {t.smtp_password_stored_badge}</span>}
        </label>
        <div className="relative">
          <Input
            id="smtp-password"
            type={showPw ? 'text' : 'password'}
            value={smtpPassword}
            onChange={e => setSmtpPassword(e.target.value)}
            placeholder={keyringHas ? t.smtp_password_placeholder_saved : t.smtp_password_placeholder}
          />
          <button
            type="button"
            onClick={() => setShowPw(s => !s)}
            aria-label={showPw ? t.hide_password : t.show_password}
            title={showPw ? t.hide_password : t.show_password}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sage-400 hover:text-sage-600"
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-xs text-sage-500 mt-1">
          {t.smtp_password_hint}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" icon={testing ? Loader2 : Send} onClick={testConnection} disabled={testing}>
          {testing ? t.smtp_testing : t.smtp_test}
        </Button>
        <Button variant="ghost" size="sm" icon={saving ? Loader2 : ShieldCheck} onClick={savePasswordToKeyring} disabled={saving || !smtpPassword}>
          {saving ? t.saving : t.smtp_save_password}
        </Button>
        {keyringHas && (
          <Button variant="ghost" size="sm" icon={Trash2} onClick={clearPasswordFromKeyring}>
            {t.smtp_clear_password}
          </Button>
        )}
      </div>
    </div>
  );
};

// ── Google Calendar ────────────────────────────────────────────────────────

const GoogleCalendarSection = () => {
  const config = useStore(s => s.config);
  const consultations = useStore(s => s.consultations);
  const updateConfig = useStore(s => s.updateConfig);
  const clearGoogleCalendarData = useStore(s => s.clearGoogleCalendarData);
  const removeConsultationsForCalendar = useStore(s => s.removeConsultationsForCalendar);
  const detachConsultationsFromCalendars = useStore(s => s.detachConsultationsFromCalendars);
  const removePersonalEventsForCalendar = useStore(s => s.removePersonalEventsForCalendar);
  const convertConsultationsToPersonal = useStore(s => s.convertConsultationsToPersonal);
  const acceptMassDelete = useStore(s => s.acceptMassDelete);
  const ignoreMassDeleteOnce = useStore(s => s.ignoreMassDeleteOnce);
  const toast = useToast();
  const t = useT();

  // 3-option migration dialog state (convert / hide / cancel) — useConfirm
  // only supports yes/no, so we roll a tiny inline modal for this case.
  const [migrationPrompt, setMigrationPrompt] = useState(null);
  const [showAdvancedFuzzy, setShowAdvancedFuzzy] = useState(false);

  const gcal = config.googleCalendar || {};
  // Read the live config: handlers call this after long awaits (OAuth, sync)
  // and a render-time snapshot would overwrite concurrent changes.
  const setGcal = (partial) => updateConfig({
    googleCalendar: { ...useStore.getState().config.googleCalendar, ...partial },
  });

  // Helper: update a single calendar's stored config
  const updateStoredCal = (calId, patch) => {
    const updated = (gcal.calendars || []).map(c => c.id === calId ? { ...c, ...patch } : c);
    setGcal({ calendars: updated });
  };

  // Keep clientId/clientSecret in the store so they survive tab navigation
  const clientId = gcal.clientId || '';
  const clientSecret = gcal.clientSecret || '';
  const setClientId = (v) => setGcal({ clientId: v });
  const setClientSecret = (v) => setGcal({ clientSecret: v });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [calendars, setCalendars] = useState([]);

  useEffect(() => {
    if (gcal.connected) handleLoadCalendars();
  }, [gcal.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error(t.gcal_missing_credentials);
      return;
    }
    setLoading(true);
    try {
      // Step 1: start OAuth — backend opens browser and waits for redirect code
      const authResult = await googleCalendar.startAuth(clientId.trim(), clientSecret.trim());
      const code = authResult.code;
      const redirectUri = authResult.redirect_uri || 'urn:ietf:wg:oauth:2.0:oob';
      const codeVerifier = authResult.code_verifier;

      // Step 2: exchange code for tokens (with PKCE verifier)
      const tokenResult = await googleCalendar.exchangeToken(
        clientId.trim(), clientSecret.trim(), code, redirectUri, codeVerifier
      );
      const accessToken = tokenResult.access_token;
      const expiresAt = Date.now() + (tokenResult.expires_in * 1000);
      const refreshToken = tokenResult.refresh_token || '';
      const grantedScopes = tokenResult.scope || '';
      // Granular consent lets the user untick the calendar permission.
      if (tokenResult.scope && !googleCalendar.hasRequiredScope(tokenResult.scope)) {
        googleCalendar.revokeToken(accessToken).catch(() => {});
        toast.error(t.gcal_scope_missing);
        return;
      }

      // Step 3: list calendars to get user email
      const calList = await googleCalendar.listCalendars(accessToken);
      setCalendars(calList);
      const primary = calList.find(c => c.primary) || calList[0];
      const userEmail = primary?.id || '';
      // Consultations linked to calendars this account cannot see (another
      // account, or a calendar removed) become local records.
      detachConsultationsFromCalendars(calList.map(c => c.id));

      const newCalendars = calList.map(c => {
        const base = {
          id: c.id,
          name: c.summary,
          color: c.background_color,
          accessRole: c.access_role,
          syncMode: 'disabled',
          // Multi-calendar v8 fields — set from inference, user can override in UI
          purpose: inferCalendarPurpose({ id: c.id, name: c.summary, syncMode: 'disabled' }),
          lastKnownRemoteCount: null,
          lastKnownRemoteSyncAt: null,
          massDeletePending: null,
          fuzzyAutoThreshold: 0.92,
          fuzzySuggestThreshold: 0.75,
        };
        return base;
      });

      // Reconnecting after an expired session: keep the per-calendar settings.
      const previous = new Map((gcal.calendars || []).map(c => [c.id, c]));
      if (previous.size > 0) {
        const merged = newCalendars.map(c => previous.has(c.id)
          ? { ...previous.get(c.id), name: c.name, color: c.color, accessRole: c.accessRole }
          : c);
        const keepDefault = merged.some(c => c.id === gcal.defaultPushCalendarId) ? gcal.defaultPushCalendarId : null;
        setGcal({
          connected: true, needsReauth: false,
          clientId: clientId.trim(), clientSecret: clientSecret.trim(),
          accessToken, refreshToken, expiresAt, grantedScopes,
          calendars: merged, defaultPushCalendarId: keepDefault, userEmail,
        });
        toast.success(t.gcal_reconnected);
        return;
      }

      // Auto-detect NutriPolo calendar: set as bidirectional push target if writable
      const nutripoloIdx = newCalendars.findIndex(
        c => c.name && c.name.toLowerCase().includes('nutripolo')
      );
      let defaultPushCalendarId = null;
      if (nutripoloIdx !== -1) {
        const npCal = newCalendars[nutripoloIdx];
        const canWrite = npCal.accessRole !== 'reader';
        npCal.syncMode = canWrite ? 'bidirectional' : 'readonly';
        npCal.purpose = canWrite ? 'primary' : 'other';
        if (canWrite) defaultPushCalendarId = npCal.id;
      }

      setGcal({
        connected: true,
        needsReauth: false,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        accessToken,
        refreshToken,
        expiresAt,
        grantedScopes,
        calendars: newCalendars,
        defaultPushCalendarId,
        userEmail,
      });

      if (nutripoloIdx !== -1) {
        const mode = (defaultPushCalendarId ? t.gcal_bidirectional : t.gcal_readonly).toLowerCase();
        toast.success(t.gcal_connected_auto.replace('{name}', newCalendars[nutripoloIdx].name).replace('{mode}', mode));
      } else {
        toast.success(t.gcal_connected_pick);
      }
    } catch (e) {
      toast.error(t.gcal_connect_error.replace('{error}', e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadCalendars = async () => {
    try {
      const token = await googleCalendar.ensureToken();
      const calList = await googleCalendar.listCalendars(token);
      setCalendars(calList);
    } catch (e) {
      toast.error(t.gcal_load_error.replace('{error}', String(e?.message || e)));
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const stats = await googleCalendar.syncAll();
      toast.success(formatSyncStats(stats, t));
      if (stats.errors > 0) toast.error(formatSyncErrors(stats, t));
    } catch (e) {
      toast.error(t.gcal_sync_error_detail.replace('{error}', e?.message || String(e)));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    // Best-effort token revocation at Google (revoking the refresh token
    // revokes the whole grant).
    try {
      const token = gcal.refreshToken || gcal.accessToken;
      if (token) await googleCalendar.revokeToken(token);
    } catch { /* ignore */ }
    // Atomic store reset
    clearGoogleCalendarData();
    setCalendars([]);
    toast.success(t.gcal_disconnected);
  };

  const isHolidayCalendar = (cal) => {
    const name = (cal.summary || cal.name || '').toLowerCase();
    return (
      cal.id?.endsWith('@holiday.calendar.google.com') ||
      name.includes('holiday') || name.includes('holidays') ||
      name.includes('festivos') || name.includes('días festivos')
    );
  };

  // Build a fresh stored-entry shell for a calendar we haven't seen before.
  // Infers purpose from name so the UI always has a concrete value to bind.
  const makeNewStoredCalendar = (cal, syncMode) => {
    const seed = { id: cal.id, name: cal.summary, syncMode };
    return {
      id: cal.id,
      name: cal.summary,
      color: cal.background_color,
      accessRole: cal.access_role,
      syncMode,
      purpose: inferCalendarPurpose(seed),
      lastKnownRemoteCount: null,
      lastKnownRemoteSyncAt: null,
      massDeletePending: null,
      fuzzyAutoThreshold: 0.92,
      fuzzySuggestThreshold: 0.75,
    };
  };

  const handleCalendarSyncMode = (cal, newMode) => {
    const current = gcal.calendars || [];
    const exists = current.find(sc => sc.id === cal.id);
    const updated = exists
      ? current.map(sc => sc.id === cal.id ? { ...sc, syncMode: newMode } : sc)
      : [...current, makeNewStoredCalendar(cal, newMode)];

    const patch = { calendars: updated };

    // Auto-set push calendar when choosing bidirectional
    if (newMode === 'bidirectional') {
      patch.defaultPushCalendarId = cal.id;
    } else if (gcal.defaultPushCalendarId === cal.id) {
      // Cleared the push calendar — pick another bidirectional one if available
      const other = updated.find(sc => sc.syncMode === 'bidirectional' && sc.id !== cal.id);
      patch.defaultPushCalendarId = other?.id || null;
    }

    setGcal(patch);

    // When disabling a holiday calendar, delete its synced events (they are noise, not real consultations)
    if (newMode === 'disabled' && isHolidayCalendar(cal)) {
      removeConsultationsForCalendar(cal.id);
    }
  };

  // Apply a purpose change (no side effects on consultations — caller decides).
  const applyPurposeChange = (cal, newPurpose) => {
    const current = gcal.calendars || [];
    const stored = current.find(sc => sc.id === cal.id);
    // primary ⇒ bidirectional (if writable); everything else ⇒ readonly,
    // preserving a pre-existing 'disabled' so users can keep a calendar off.
    const canWrite = (stored?.accessRole || cal.access_role) !== 'reader';
    let newSyncMode;
    if (newPurpose === 'primary') {
      if (!canWrite) {
        toast.error(t.purpose_primary_reader_error);
        return;
      }
      newSyncMode = 'bidirectional';
    } else {
      // Non-primary: if was bidirectional, downgrade to readonly. Keep 'disabled' as-is.
      const prev = stored?.syncMode || 'disabled';
      newSyncMode = prev === 'disabled' ? 'disabled' : (prev === 'bidirectional' ? 'readonly' : prev);
    }

    let updated;
    if (stored) {
      updated = current.map(sc =>
        sc.id === cal.id ? { ...sc, purpose: newPurpose, syncMode: newSyncMode } : sc
      );
    } else {
      updated = [...current, { ...makeNewStoredCalendar(cal, newSyncMode), purpose: newPurpose }];
    }

    // Enforce single-primary: demote any other primary to 'other' + readonly.
    if (newPurpose === 'primary') {
      updated = updated.map(sc =>
        sc.id !== cal.id && sc.purpose === 'primary'
          ? { ...sc, purpose: 'other', syncMode: sc.syncMode === 'bidirectional' ? 'readonly' : sc.syncMode }
          : sc
      );
    }

    const patch = { calendars: updated };
    if (newPurpose === 'primary') {
      patch.defaultPushCalendarId = cal.id;
    } else if (gcal.defaultPushCalendarId === cal.id && newSyncMode !== 'bidirectional') {
      const other = updated.find(sc => sc.syncMode === 'bidirectional' && sc.id !== cal.id);
      patch.defaultPushCalendarId = other?.id || null;
    }
    setGcal(patch);
  };

  const handleCalendarPurpose = (cal, newPurpose) => {
    const current = gcal.calendars || [];
    const stored = current.find(sc => sc.id === cal.id);
    const prevPurpose = stored?.purpose || inferCalendarPurpose({ id: cal.id, name: cal.summary });
    if (prevPurpose === newPurpose) return;

    // Count local consultations attached to this calendar — these need migration
    // when switching to 'personal' (they're not clinical anymore).
    const affectedCount = consultations.filter(c => c.sourceCalendarId === cal.id).length;

    // Switching TO personal with existing consultations → 3-option dialog.
    if (newPurpose === 'personal' && affectedCount > 0) {
      setMigrationPrompt({ cal, newPurpose, count: affectedCount });
      return;
    }

    applyPurposeChange(cal, newPurpose);
  };

  // Migration dialog resolvers
  const handleMigrationConvert = () => {
    if (!migrationPrompt) return;
    const { cal, count } = migrationPrompt;
    convertConsultationsToPersonal(cal.id);
    applyPurposeChange(cal, 'personal');
    setMigrationPrompt(null);
    toast.success(t.gcal_converted_personal.replace('{n}', count));
  };

  const handleMigrationHide = () => {
    if (!migrationPrompt) return;
    const { cal } = migrationPrompt;
    const current = gcal.calendars || [];
    const stored = current.find(sc => sc.id === cal.id);
    const updated = stored
      ? current.map(sc => sc.id === cal.id ? { ...sc, purpose: 'personal', syncMode: 'disabled' } : sc)
      : [...current, { ...makeNewStoredCalendar(cal, 'disabled'), purpose: 'personal' }];
    const patch = { calendars: updated };
    if (gcal.defaultPushCalendarId === cal.id) {
      const other = updated.find(sc => sc.syncMode === 'bidirectional' && sc.id !== cal.id);
      patch.defaultPushCalendarId = other?.id || null;
    }
    setGcal(patch);
    setMigrationPrompt(null);
    toast.success(t.gcal_hidden_done);
  };

  const handleMigrationCancel = () => setMigrationPrompt(null);

  if (gcal.connected) {
    return (
      <div className="space-y-4">
        {/* Connected badge */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-success-light text-success-dark rounded-badge text-xs font-medium">
            <Wifi size={12} />
            {t.gcal_connected_as.replace('{email}', gcal.userEmail || 'Google Calendar')}
          </span>
        </div>

        {gcal.needsReauth && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-warning-light border border-warning/30 rounded-button">
            <AlertTriangle size={14} className="text-warning shrink-0" />
            <p className="text-xs text-warning-dark flex-1 min-w-[12rem]">{t.gcal_reauth_scope_notice}</p>
            <Button size="sm" variant="primary" onClick={handleConnect} disabled={loading}>{t.gcal_reconnect}</Button>
          </div>
        )}
        {!gcal.needsReauth && !String(gcal.grantedScopes || '').includes('calendar.events') && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-info-light border border-info/30 rounded-button">
            <p className="text-xs text-info-dark flex-1 min-w-[12rem]">{t.gcal_scope_upgrade_notice}</p>
            <Button size="sm" variant="ghost" onClick={handleConnect} disabled={loading}>{t.gcal_reconnect}</Button>
          </div>
        )}

        {/* Calendar list with sync modes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="block text-xs font-medium text-sage-600">{t.gcal_calendars}</p>
            <button onClick={handleLoadCalendars} className="text-xs text-wellness-500 hover:text-wellness-600">
              {t.gcal_refresh_list}
            </button>
          </div>
          {calendars.length === 0 ? (
            <p className="text-xs text-sage-400">{t.gcal_loading_calendars}</p>
          ) : (
            <div className="space-y-2">
              {calendars.map(cal => {
                const stored = (gcal.calendars || []).find(sc => sc.id === cal.id);
                const syncMode = stored?.syncMode || 'disabled';
                const purpose = stored?.purpose || inferCalendarPurpose({ id: cal.id, name: cal.summary, syncMode });
                const isReader = cal.access_role === 'reader';
                const purposeBadge = {
                  primary:           { label: t.gcal_badge_primary,  cls: 'bg-success-light text-success-dark' },
                  'external-clinic': { label: t.gcal_badge_clinic,   cls: 'bg-info-light text-info' },
                  personal:          { label: t.gcal_badge_personal, cls: 'bg-sage-200 text-sage-700' },
                  holidays:          { label: t.gcal_badge_holidays, cls: 'bg-warning-light text-warning' },
                  other:             { label: '',          cls: '' },
                }[purpose] || { label: '', cls: '' };
                return (
                  <div key={cal.id} className="p-2 rounded-button border border-sage-200 bg-sage-50 space-y-1.5">
                    {/* Top row: color dot, name, badges */}
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: cal.background_color || '#4285f4' }}
                      />
                      <span className="flex-1 text-sm text-sage-700 truncate">{cal.summary || cal.id}</span>
                      {purposeBadge.label && (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-badge whitespace-nowrap ${purposeBadge.cls}`}>
                          {purposeBadge.label}
                        </span>
                      )}
                      {isReader && (
                        <span className="text-[11px] px-1.5 py-0.5 bg-warning-light text-warning rounded-badge whitespace-nowrap">{t.gcal_badge_readonly}</span>
                      )}
                      {gcal.defaultPushCalendarId === cal.id && (
                        <span className="text-[11px] px-1.5 py-0.5 bg-wellness-100 text-wellness-600 rounded-badge whitespace-nowrap">{t.gcal_badge_target}</span>
                      )}
                    </div>
                    {/* Bottom row: purpose + sync mode selectors */}
                    <div className="flex items-center gap-2 pl-5">
                      <label htmlFor={`cal-purpose-${cal.id}`} className="text-[11px] text-sage-500 whitespace-nowrap">{t.purpose_label}:</label>
                      <select
                        id={`cal-purpose-${cal.id}`}
                        value={purpose}
                        onChange={e => handleCalendarPurpose(cal, e.target.value)}
                        className="text-xs px-2 py-1 border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 flex-1"
                      >
                        {!isReader && <option value="primary">{t.purpose_primary}</option>}
                        <option value="external-clinic">{t.purpose_external_clinic}</option>
                        <option value="personal">{t.purpose_personal}</option>
                        <option value="holidays">{t.purpose_holidays}</option>
                        <option value="other">{t.purpose_other}</option>
                      </select>
                      <select
                        value={syncMode}
                        onChange={e => handleCalendarSyncMode(cal, e.target.value)}
                        aria-label={t.gcal_sync_mode}
                        className="text-xs px-2 py-1 border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
                      >
                        {!isReader && <option value="bidirectional">↔ {t.gcal_bidirectional}</option>}
                        <option value="readonly">← {t.gcal_readonly}</option>
                        <option value="disabled">✗ {t.gcal_disabled}</option>
                      </select>
                    </div>

                    {/* Mass-delete pending resolution panel */}
                    {stored?.massDeletePending && (
                      <div className="ml-5 mt-1 p-2.5 bg-danger-light border border-danger/30 rounded-button space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={13} className="text-danger shrink-0 mt-0.5" />
                          <p className="text-xs text-danger-dark leading-snug">
                            <strong>{t.gcal_mass_delete_label}</strong>{' '}
                            {t.gcal_mass_delete_detail
                              .replace('{prev}', stored.massDeletePending.prevCount)
                              .replace('{new}', stored.massDeletePending.newCount)
                              .replace('{drop}', stored.massDeletePending.drop)}
                          </p>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          <button
                            onClick={() => { ignoreMassDeleteOnce(stored.id); toast.info(t.gcal_sync_resumed); }}
                            className="px-2 py-1 text-[11px] font-medium bg-white border border-danger/30 text-danger-dark rounded-button hover:bg-danger-light transition-colors"
                          >
                            {t.mass_delete_ignore}
                          </button>
                          <button
                            onClick={() => { acceptMassDelete(stored.id); toast.success(t.gcal_deletes_accepted); }}
                            className="px-2 py-1 text-[11px] font-medium bg-danger text-white rounded-button hover:bg-danger-dark transition-colors"
                          >
                            {t.mass_delete_accept}
                          </button>
                          <button
                            onClick={() => handleCalendarSyncMode(cal, 'disabled')}
                            className="px-2 py-1 text-[11px] text-danger hover:text-danger-dark transition-colors"
                          >
                            {t.mass_delete_suspend}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Migration dialog (purpose → personal with existing consultations) */}
        <Modal open={!!migrationPrompt} onClose={handleMigrationCancel} title={t.purpose_migrate_title} size="sm">
          {migrationPrompt && (
            <div className="space-y-3">
              <p className="text-sm text-sage-600">
                {plural(t, 'gcal_migrate_body', migrationPrompt.count)}
              </p>
              <div className="space-y-2 pt-2">
                <Button variant="primary" className="w-full justify-start" onClick={handleMigrationConvert}>
                  {t.purpose_migrate_convert}
                  <span className="block text-xs opacity-80 mt-0.5">{t.purpose_migrate_convert_hint}</span>
                </Button>
                <Button variant="secondary" className="w-full justify-start" onClick={handleMigrationHide}>
                  {t.purpose_migrate_hide}
                  <span className="block text-xs opacity-80 mt-0.5">{t.purpose_migrate_hide_hint}</span>
                </Button>
                <Button variant="ghost" className="w-full" onClick={handleMigrationCancel}>
                  {t.cancel}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Purpose summary card */}
        {(gcal.calendars || []).length > 0 && (() => {
          const counts = { primary: 0, 'external-clinic': 0, personal: 0, holidays: 0, disabled: 0 };
          for (const c of gcal.calendars || []) {
            if (c.syncMode === 'disabled') { counts.disabled++; continue; }
            counts[c.purpose || 'other'] = (counts[c.purpose || 'other'] || 0) + 1;
          }
          const parts = [
            counts.primary && `${counts.primary} ${t.gcal_badge_primary}`,
            counts['external-clinic'] && `${counts['external-clinic']} ${t.gcal_badge_clinic}`,
            counts.personal && `${counts.personal} ${t.gcal_badge_personal}`,
            counts.holidays && `${counts.holidays} ${t.gcal_badge_holidays}`,
            counts.disabled && plural(t, 'gcal_summary_disabled', counts.disabled),
          ].filter(Boolean);
          return parts.length ? (
            <div className="px-3 py-2 bg-sage-50 border border-sage-200 rounded-soft text-xs text-sage-500">
              {parts.join(' · ')}
            </div>
          ) : null;
        })()}

        {/* Push calendar indicator */}
        {gcal.defaultPushCalendarId && (() => {
          const pushCal = (gcal.calendars || []).find(c => c.id === gcal.defaultPushCalendarId);
          return pushCal ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-wellness-50 border border-wellness-200 rounded-soft text-xs text-wellness-700">
              <span className="font-medium">{t.gcal_push_calendar}:</span>
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: pushCal.color || '#4285f4' }}
              />
              <span>{pushCal.name}</span>
              <span className="text-wellness-400">— {t.gcal_push_hint}</span>
            </div>
          ) : null;
        })()}

        {/* Advanced: fuzzy thresholds (collapsed by default) */}
        {(gcal.calendars || []).some(c => c.purpose === 'external-clinic') && (
          <div className="border border-sage-200 rounded-soft overflow-hidden">
            <button
              onClick={() => setShowAdvancedFuzzy(v => !v)}
              aria-expanded={showAdvancedFuzzy}
              className="w-full flex items-center justify-between px-3 py-2 bg-sage-50 text-xs text-sage-600 hover:bg-sage-100 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Settings2 size={12} />
                {t.gcal_advanced_fuzzy}
              </span>
              {showAdvancedFuzzy ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showAdvancedFuzzy && (
              <div className="px-3 pb-3 pt-2 space-y-3">
                {(gcal.calendars || []).filter(c => c.purpose === 'external-clinic').map(c => (
                  <div key={c.id} className="space-y-2">
                    <p className="text-[11px] font-medium text-sage-600">{c.name}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`fuzzy-auto-${c.id}`} className="block text-[11px] text-sage-500 mb-1">
                          {t.gcal_auto_threshold.replace('{p}', Math.round((c.fuzzyAutoThreshold ?? 0.92) * 100))}
                        </label>
                        <input
                          id={`fuzzy-auto-${c.id}`}
                          type="range" min="70" max="99" step="1"
                          value={Math.round((c.fuzzyAutoThreshold ?? 0.92) * 100)}
                          onChange={e => updateStoredCal(c.id, { fuzzyAutoThreshold: parseInt(e.target.value) / 100 })}
                          className="w-full accent-wellness-400"
                        />
                        <p className="text-[11px] text-sage-400 mt-0.5">{t.gcal_auto_threshold_hint}</p>
                      </div>
                      <div>
                        <label htmlFor={`fuzzy-suggest-${c.id}`} className="block text-[11px] text-sage-500 mb-1">
                          {t.gcal_suggest_threshold.replace('{p}', Math.round((c.fuzzySuggestThreshold ?? 0.75) * 100))}
                        </label>
                        <input
                          id={`fuzzy-suggest-${c.id}`}
                          type="range" min="50" max="90" step="1"
                          value={Math.round((c.fuzzySuggestThreshold ?? 0.75) * 100)}
                          onChange={e => updateStoredCal(c.id, { fuzzySuggestThreshold: parseInt(e.target.value) / 100 })}
                          className="w-full accent-wellness-400"
                        />
                        <p className="text-[11px] text-sage-400 mt-0.5">{t.gcal_suggest_threshold_hint}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Auto-sync toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-sage-700">{t.gcal_auto_sync}</p>
            <p className="text-xs text-sage-400">{t.gcal_auto_sync_hint}</p>
          </div>
          <button
            onClick={() => setGcal({ autoSync: !gcal.autoSync })}
            role="switch"
            aria-checked={!!gcal.autoSync}
            aria-label={t.gcal_auto_sync}
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
            {syncing ? t.gcal_syncing : t.gcal_sync_now}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={LogOut}
            onClick={handleDisconnect}
          >
            {t.gcal_disconnect}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {gcal.needsReauth && (
        <div className="flex items-start gap-2 px-3 py-2 bg-warning-light border border-warning/30 rounded-button">
          <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning-dark">
            {t.gcal_reauth_notice}
          </p>
        </div>
      )}
      <p className="text-xs text-sage-500">
        {t.gcal_intro}
      </p>
      <div>
        <label htmlFor="gcal-client-id" className="block text-xs font-medium text-sage-600 mb-1">Client ID</label>
        <Input
          id="gcal-client-id"
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
        />
      </div>
      <div>
        <label htmlFor="gcal-client-secret" className="block text-xs font-medium text-sage-600 mb-1">Client Secret</label>
        <Input
          id="gcal-client-secret"
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
        {loading ? t.gcal_connecting : t.gcal_connect}
      </Button>
    </div>
  );
};

// ── Security Section (at-rest encryption) ─────────────────────────────────
const SecuritySection = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const toast = useToast();
  const t = useT();
  const { confirm, ConfirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);

  // Setup form state
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [ackLoss, setAckLoss] = useState(false);
  const [busy, setBusy] = useState(false);

  // Change password form state
  const [oldPw, setOldPw] = useState('');
  const [changeNewPw, setChangeNewPw] = useState('');
  const [changeConfirmPw, setChangeConfirmPw] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const e = await invoke('encryption_is_enabled');
        setEnabled(!!e);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const handleEnable = async () => {
    if (newPw.length < 8) {
      toast.error(t.security_pw_min);
      return;
    }
    if (newPw !== confirmPw) {
      toast.error(t.security_pw_mismatch);
      return;
    }
    if (!ackLoss) {
      toast.error(t.security_ack_required);
      return;
    }
    setBusy(true);
    try {
      await invoke('encryption_setup', { password: newPw });
      toast.success(t.security_enabled_ok);
      setEnabled(true);
      setSetupOpen(false);
      setNewPw(''); setConfirmPw(''); setAckLoss(false);
    } catch (e) {
      toast.error(t.security_enable_error.replace('{error}', String(e)));
    } finally {
      setBusy(false);
    }
  };

  const handleChange = async () => {
    if (changeNewPw.length < 8) {
      toast.error(t.security_pw_new_min);
      return;
    }
    if (changeNewPw !== changeConfirmPw) {
      toast.error(t.security_pw_mismatch);
      return;
    }
    setBusy(true);
    try {
      await invoke('encryption_change_password', {
        oldPassword: oldPw,
        newPassword: changeNewPw,
      });
      toast.success(t.security_pw_changed);
      setChangeOpen(false);
      setOldPw(''); setChangeNewPw(''); setChangeConfirmPw('');
    } catch (e) {
      const code = String(e || '');
      if (code.includes('wrong_password')) {
        toast.error(t.security_wrong_password);
      } else {
        toast.error(t.security_change_error.replace('{error}', code));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    const ok = await confirm({
      title: t.security_lock_now,
      message: t.security_lock_message,
    });
    if (!ok) return;
    try {
      // Write pending changes while the key is still available.
      await flushAllPending();
      await invoke('encryption_lock');
      // Force a reload so the EncryptionGate re-checks state
      window.location.reload();
    } catch (e) {
      toast.error(t.security_lock_error.replace('{error}', String(e)));
    }
  };

  if (loading) {
    return <p className="text-xs text-sage-400">{t.security_checking}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-sage-50 border border-sage-200 rounded-button">
        <ShieldCheck
          size={18}
          className={enabled ? 'text-success mt-0.5 shrink-0' : 'text-sage-400 mt-0.5 shrink-0'}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-sage-900">
            {enabled ? t.security_on : t.security_off}
          </p>
          <p className="text-xs text-sage-500 mt-0.5">
            {enabled ? t.security_on_desc : t.security_off_desc}
          </p>
        </div>
      </div>

      {!enabled ? (
        <Button variant="primary" icon={Lock} onClick={() => setSetupOpen(true)}>
          {t.security_enable}
        </Button>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" icon={RotateCcw} onClick={() => setChangeOpen(true)}>
              {t.security_change_password}
            </Button>
            <Button variant="ghost" icon={Lock} onClick={handleLock}>
              {t.security_lock_now}
            </Button>
          </div>

          <div className="pt-3 border-t border-sage-100">
            <label htmlFor="auto-lock" className="block text-xs font-medium text-sage-600 mb-1.5">
              {t.security_auto_lock}
            </label>
            <select
              id="auto-lock"
              value={Number(config.autoLockMinutes) || 0}
              onChange={(e) =>
                updateConfig({ autoLockMinutes: Number(e.target.value) || 0 })
              }
              className="w-full max-w-xs px-3 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:border-wellness-400 focus:outline-none focus:ring-1 focus:ring-wellness-400"
            >
              <option value={0}>{t.security_never}</option>
              <option value={5}>{t.security_minutes.replace('{n}', 5)}</option>
              <option value={15}>{t.security_minutes.replace('{n}', 15)}</option>
              <option value={30}>{t.security_minutes.replace('{n}', 30)}</option>
              <option value={60}>{t.security_one_hour}</option>
            </select>
            <p className="text-xs text-sage-400 mt-1">
              {t.security_auto_lock_hint}
            </p>
          </div>
        </>
      )}

      {/* Setup modal */}
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title={t.security_setup_title} size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 bg-warning-light border border-warning/30 rounded-button">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning-dark">
              {t.security_setup_warning} <strong>{t.security_setup_warning_strong}</strong>
            </p>
          </div>

          <div>
            <label htmlFor="enc-new-pw" className="block text-xs font-medium text-sage-600 mb-1">
              {t.security_master_password}
            </label>
            <Input
              id="enc-new-pw"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder={t.security_pw_placeholder}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="enc-confirm-pw" className="block text-xs font-medium text-sage-600 mb-1">
              {t.security_confirm_password}
            </label>
            <Input
              id="enc-confirm-pw"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder={t.security_repeat_password}
              autoComplete="new-password"
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ackLoss}
              onChange={(e) => setAckLoss(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span className="text-xs text-sage-600">
              {t.security_ack}
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setSetupOpen(false)} disabled={busy}>
              {t.cancel}
            </Button>
            <Button variant="primary" onClick={handleEnable} disabled={busy}>
              {busy ? t.security_enabling : t.security_enable}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Change password modal */}
      <Modal open={changeOpen} onClose={() => setChangeOpen(false)} title={t.security_change_title} size="sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="enc-old-pw" className="block text-xs font-medium text-sage-600 mb-1">
              {t.security_current_password}
            </label>
            <Input
              id="enc-old-pw"
              type="password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="enc-change-new-pw" className="block text-xs font-medium text-sage-600 mb-1">
              {t.security_new_password}
            </label>
            <Input
              id="enc-change-new-pw"
              type="password"
              value={changeNewPw}
              onChange={(e) => setChangeNewPw(e.target.value)}
              placeholder={t.security_pw_placeholder}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="enc-change-confirm-pw" className="block text-xs font-medium text-sage-600 mb-1">
              {t.security_confirm_new}
            </label>
            <Input
              id="enc-change-confirm-pw"
              type="password"
              value={changeConfirmPw}
              onChange={(e) => setChangeConfirmPw(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setChangeOpen(false)} disabled={busy}>
              {t.cancel}
            </Button>
            <Button variant="primary" onClick={handleChange} disabled={busy}>
              {busy ? t.security_changing : t.security_change_password}
            </Button>
          </div>
        </div>
      </Modal>

      {ConfirmDialog}
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
        toast.error(t.design_logo_too_large);
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
          toast.success(t.design_logo_updated);
          resolve();
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen invalida')); };
        img.src = url;
      });
    } catch (err) {
      if (import.meta.env.DEV && err.message !== 'Imagen invalida') console.error(err);
      toast.error(t.design_logo_error);
    }
  };

  const removeLogo = () => {
    setDesign({ logo: null });
    toast.success(t.design_logo_removed);
  };

  // Render helpers (not components) so inputs keep their identity across
  // renders — otherwise dragging the color picker remounts it mid-drag.
  // ── Color swatch for preset cards ──
  const presetCard = (id, preset) => {
    const isActive = design.preset === id;
    const colors = preset.colors;
    return (
      <button
        key={id}
        onClick={() => setDesign({ preset: id, colors: getPresetColors(id) })}
        aria-pressed={isActive}
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
        <span className="text-[11px] font-medium text-sage-600">{t[`design_preset_${id}`] || preset.label}</span>
      </button>
    );
  };

  // ── Color input row ──
  const colorRow = (label, colorKey) => (
    <div key={colorKey} className="flex items-center gap-3">
      <input
        type="color"
        value={design.colors[colorKey]}
        onChange={(e) => setColor(colorKey, e.target.value)}
        aria-label={label}
        className="w-8 h-8 rounded border border-sage-200 cursor-pointer p-0.5"
      />
      <span className="text-xs text-sage-600 flex-1">{label}</span>
      <span className="text-[11px] font-mono text-sage-400">{design.colors[colorKey]}</span>
    </div>
  );

  // ── HTML Preview ──
  const preview = () => {
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
          {t.design_logo}
        </label>
        <div className="flex items-center gap-4">
          <button
            onClick={handleLogoUpload}
            aria-label={t.design_upload_logo}
            className="flex items-center justify-center border-2 border-dashed border-sage-300 rounded-soft hover:border-wellness-400 transition-colors cursor-pointer"
            style={{ width: 160, height: 64 }}
          >
            {design.logo?.data ? (
              <img src={design.logo.data} alt="Logo" className="max-h-14 max-w-[150px] object-contain" />
            ) : (
              <span className="text-xs text-sage-400 flex items-center gap-1">
                <Upload size={14} />
                {t.design_upload_logo}
              </span>
            )}
          </button>
          {design.logo && (
            <Button variant="ghost" size="sm" icon={Trash2} onClick={removeLogo}>
              {t.design_remove_logo}
            </Button>
          )}
        </div>
      </div>

      {/* Presets */}
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-2">
          <Palette size={13} className="inline mr-1" />
          {t.design_preset}
        </label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([id, preset]) => (
            presetCard(id, preset)
          ))}
          {design.preset === 'custom' && (
            <div className="flex flex-col items-center justify-center px-3 py-2.5 rounded-soft border-2 border-wellness-400 bg-wellness-50 shadow-sm">
              <div className="flex gap-1">
                {[design.colors.accent, design.colors.accentDark, design.colors.primary, design.colors.cardBg].map((c, i) => (
                  <span key={i} className="w-4 h-4 rounded-full border border-sage-200" style={{ backgroundColor: c }} />
                ))}
              </div>
              <span className="text-[11px] font-medium text-sage-600">{t.design_preset_custom}</span>
            </div>
          )}
        </div>
      </div>

      {/* Custom colors (collapsible) */}
      <div>
        <button
          onClick={() => setColorsOpen(!colorsOpen)}
          aria-expanded={colorsOpen}
          className="flex items-center gap-1.5 text-xs font-medium text-sage-500 hover:text-sage-700 transition-colors"
        >
          {colorsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {t.design_colors}
        </button>
        {colorsOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-sage-50 rounded-soft border border-sage-200">
            {colorRow(t.design_accent, 'accent')}
            {colorRow(t.design_color_dark, 'accentDark')}
            {colorRow(t.design_color_light, 'accentLight')}
            {colorRow(t.design_color_mid, 'accentMid')}
            {colorRow(t.design_text_primary, 'primary')}
            {colorRow(t.design_text_secondary, 'secondary')}
            {colorRow(t.design_labels, 'muted')}
            {colorRow(t.design_alt_bg, 'cardBg')}
          </div>
        )}
      </div>

      {/* Font selector */}
      <div>
        <label htmlFor="design-font" className="block text-xs font-medium text-sage-600 mb-2">
          <Type size={13} className="inline mr-1" />
          {t.design_font}
        </label>
        <select
          id="design-font"
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
          {t.design_show_tagline}
        </label>
        {design.showTagline && (
          <Input
            value={design.taglineText}
            onChange={(e) => setDesign({ taglineText: e.target.value })}
            className="flex-1 text-xs"
            aria-label={t.design_tagline}
            placeholder={t.design_tagline_placeholder}
          />
        )}
      </div>

      {/* Live preview */}
      <div>
        <label className="block text-xs font-medium text-sage-600 mb-2">
          <FileText size={13} className="inline mr-1" />
          {t.design_preview}
        </label>
        {preview()}
      </div>
    </div>
  );
};

const Section = ({ title, children, id }) => {
  const autoId = useId();
  return (
    <section id={id || autoId} data-settings-section aria-label={typeof title === 'string' ? title : undefined} className="bg-white border border-sage-200 rounded-soft shadow-card p-5 space-y-4 scroll-mt-4">
      <h2 className="text-sm font-semibold text-sage-700 border-b border-sage-100 pb-2">{title}</h2>
      {children}
    </section>
  );
};

/** Sticky table of contents for the settings page, highlighting the section in view. */
const SettingsIndex = ({ lang }) => {
  const t = useT();
  const [sections, setSections] = useState([]);
  const [active, setActive] = useState(null);

  useEffect(() => {
    const els = [...document.querySelectorAll('[data-settings-section]')];
    setSections(els.map(el => ({ id: el.id, title: el.querySelector('h2')?.textContent || '' })));
    // The section crossing the top third of the scroll area counts as current.
    // At the very bottom the last sections can never reach it, so keep the clicked one.
    const root = document.querySelector('main');
    const observer = new IntersectionObserver(entries => {
      if (root && root.scrollTop + root.clientHeight >= root.scrollHeight - 4) return;
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { root, rootMargin: '0px 0px -65% 0px' });
    els.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [lang]);

  return (
    <nav aria-label={t.settings_title} className="hidden lg:block sticky top-0 w-52 shrink-0 pt-14">
      <ul className="space-y-0.5 border-l border-sage-200">
        {sections.map(sec => (
          <li key={sec.id}>
            <button
              type="button"
              onClick={() => {
                setActive(sec.id);
                document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              aria-current={active === sec.id ? 'location' : undefined}
              className={`-ml-px block w-full text-left pl-3 py-1.5 text-sm border-l-2 transition-colors ${
                active === sec.id
                  ? 'border-wellness-400 text-sage-900 font-medium'
                  : 'border-transparent text-sage-500 hover:text-sage-800 hover:border-sage-300'
              }`}
            >
              {sec.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export const SettingsView = () => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const appTheme = useStore(s => s.appTheme);
  const setAppTheme = useStore(s => s.setAppTheme);
  const exportDataToZip = useStore(s => s.exportDataToZip);
  const importDataFromZip = useStore(s => s.importDataFromZip);
  const getAutoBackupInfo = useStore(s => s.getAutoBackupInfo);
  const restoreFromAutoBackup = useStore(s => s.restoreFromAutoBackup);
  const lastError = useStore(s => s.lastError);
  const clearLastError = useStore(s => s.clearLastError);
  const t = useT();
  const locale = useLocale();
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
      toast.error(t.backup_export_error + ': ' + errMsg(e));
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
      toast.error(t.backup_import_error + ': ' + errMsg(e));
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
      toast.error(t.backup_restore_error + ': ' + errMsg(e));
    } finally {
      setRestoring(false);
    }
  };

  const THEMES = [
    { id: 'light', icon: Sun, label: t.settings_theme_light },
    { id: 'dark', icon: Moon, label: t.settings_theme_dark },
    { id: 'auto', icon: Monitor, label: t.settings_theme_auto },
  ];

  const LANGS = [
    { id: 'es', label: 'Castellano' },
    { id: 'ca', label: 'Català' },
    { id: 'en', label: 'English' },
  ];

  return (
    <div className="flex items-start gap-10 animate-fadeIn">
    <div className="space-y-5 max-w-2xl flex-1 min-w-0">
      <h1 className="font-serif text-title text-sage-900">{t.settings_title}</h1>

      {/* Personal data */}
      <Section title={t.settings_personal}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cfg-nombre" className="block text-xs font-medium text-sage-600 mb-1">{t.client_name}</label>
            <Input id="cfg-nombre" value={config.nombre || ''} onChange={e => set('nombre', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cfg-nif" className="block text-xs font-medium text-sage-600 mb-1">NIF</label>
            <Input id="cfg-nif" value={config.nif || ''} onChange={e => set('nif', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cfg-colegiada" className="block text-xs font-medium text-sage-600 mb-1">{t.settings_num_colegiada}</label>
            <Input id="cfg-colegiada" value={config.numColegiada || ''} onChange={e => set('numColegiada', e.target.value)} placeholder="CV01944" />
          </div>
          <div>
            <label htmlFor="cfg-email" className="block text-xs font-medium text-sage-600 mb-1">{t.email}</label>
            <Input id="cfg-email" type="email" value={config.email || ''} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cfg-telefono" className="block text-xs font-medium text-sage-600 mb-1">{t.phone}</label>
            <Input id="cfg-telefono" value={config.telefono || ''} onChange={e => set('telefono', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cfg-web" className="block text-xs font-medium text-sage-600 mb-1">Web</label>
            <Input id="cfg-web" value={config.web || ''} onChange={e => set('web', e.target.value)} placeholder="nutripoloraquel.com" />
          </div>
        </div>
        <div>
          <label htmlFor="cfg-direccion" className="block text-xs font-medium text-sage-600 mb-1">{t.client_street}</label>
          <Textarea id="cfg-direccion" value={config.direccion || ''} onChange={e => set('direccion', e.target.value)} rows={2} />
        </div>
      </Section>

      {/* Clinic config */}
      <Section title={t.settings_profile}>
        <div>
          <p className="block text-xs font-medium text-sage-600 mb-2">{t.settings_locations}</p>
          <LocationsManager />
        </div>
        <div>
          <p className="block text-xs font-medium text-sage-600 mb-2">{t.settings_consultation_types}</p>
          <ConsultationTypesManager />
        </div>
        <div>
          <label htmlFor="cfg-duration" className="block text-xs font-medium text-sage-600 mb-1">{t.settings_default_duration}</label>
          <Input
            id="cfg-duration"
            type="number"
            value={config.defaultConsultationDuration || 45}
            onChange={e => set('defaultConsultationDuration', parseInt(e.target.value))}
            className="w-32"
          />
        </div>
        <div>
          <p className="block text-xs font-medium text-sage-600 mb-2">{t.settings_blocked_hours}</p>
          <BlockedHoursManager />
        </div>
      </Section>

      {/* Email / SMTP */}
      <Section title={t.settings_email} id="settings-smtp">
        <SmtpSection />
      </Section>

      {/* Appointment reminders (email + WhatsApp) */}
      <Section title={t.reminders_title} id="settings-reminders">
        <RemindersSection
          onGoToSmtp={() => document.getElementById('settings-smtp')?.scrollIntoView({ behavior: 'smooth' })}
        />
      </Section>

      {/* Appearance */}
      <Section title={t.settings_appearance}>
        <div>
          <p className="block text-xs font-medium text-sage-600 mb-2">{t.settings_theme}</p>
          <div className="flex gap-2" role="group" aria-label={t.settings_theme}>
            {THEMES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setAppTheme(id)}
                aria-pressed={appTheme === id}
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
          <p className="block text-xs font-medium text-sage-600 mb-2">
            <Languages size={13} className="inline mr-1" />
            {t.settings_language}
          </p>
          <div className="flex gap-2" role="group" aria-label={t.settings_language}>
            {LANGS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => set('appLang', id)}
                aria-pressed={config.appLang === id}
                lang={id}
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
          {t.settings_invoice_design}
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
                aria-label={t.backup_auto_select}
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

      {/* Seguridad (cifrado AES-256) */}
      <Section title={t.settings_security}>
        <SecuritySection />
      </Section>

      {/* Diagnóstico */}
      <Section title={t.settings_diagnostics}>
        {lastError ? (
          <div className="space-y-3">
            <div className="bg-danger-light border border-danger/30 rounded-soft p-3">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-danger">
                    {t.diag_last_error}
                  </p>
                  <p className="text-xs text-sage-500 mt-0.5">
                    {new Date(lastError.timestamp).toLocaleString(locale)}
                  </p>
                </div>
              </div>
              <pre className="mt-2 text-xs font-mono text-sage-800 whitespace-pre-wrap break-words bg-white/60 rounded-button p-2 max-h-40 overflow-auto">
                {lastError.message}
              </pre>
              {lastError.stack && (
                <details className="mt-2">
                  <summary className="text-xs text-sage-500 cursor-pointer hover:text-sage-700">
                    {t.diag_view_stack}
                  </summary>
                  <pre className="mt-1 text-xs font-mono text-sage-600 whitespace-pre-wrap break-words bg-white/60 rounded-button p-2 max-h-60 overflow-auto">
                    {lastError.stack}
                    {lastError.componentStack && '\n\nComponent stack:' + lastError.componentStack}
                  </pre>
                </details>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={clearLastError}>
              {t.diag_clear}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-sage-400">
            {t.diag_none}
          </p>
        )}
      </Section>

      {ConfirmDialog}
    </div>
    <SettingsIndex lang={config.appLang} />
    </div>
  );
};

export default SettingsView;
