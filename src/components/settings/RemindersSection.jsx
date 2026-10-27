import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Mail, MessageCircle, RotateCcw, AlertTriangle, MonitorSmartphone } from 'lucide-react';
import { Input, Textarea, Button, SegmentedControl } from '../UI';
import useStore from '../../stores/store';
import { useT } from '../../i18n';
import { AVAILABLE_VARIABLES, DEFAULT_APPOINTMENT_TEMPLATES, resolveTemplate } from '../../services/emailService';
import {
  getReminderConfig, whatsAppTemplate,
} from '../../services/reminderService';

const LANGS = [['es', 'ES'], ['ca', 'CA'], ['en', 'EN']];
const REMINDER_VARIABLES = AVAILABLE_VARIABLES.filter(v => /clientNom|cita|nutri/.test(v.key));

// Sample data for the live preview.
const SAMPLE_CLIENT = { nombre: 'Laura Martínez', email: 'laura@example.com' };
const sampleConsultation = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { fecha, hora: '10:30', duracion: 45, tipo: 'Seguimiento' };
};

const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-2.5 cursor-pointer">
    <input type="checkbox" className="mt-0.5" checked={checked} onChange={e => onChange(e.target.checked)} />
    <span>
      <span className="block text-sm text-sage-800">{label}</span>
      {hint && <span className="block text-xs text-sage-500 mt-0.5">{hint}</span>}
    </span>
  </label>
);

const NumberField = ({ label, value, onChange, min = 0, max = 168, suffix }) => (
  <label className="block">
    <span className="block text-xs font-medium text-sage-600 mb-1">{label}</span>
    <span className="flex items-center gap-2">
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-24"
      />
      {suffix && <span className="text-xs text-sage-500">{suffix}</span>}
    </span>
  </label>
);

/**
 * Start with Windows (hidden in the tray) and keep running when the window is
 * closed, so automatic reminders go out without the window open. The
 * autostart entry lives in the Windows registry, not in the store.
 */
const BackgroundSection = () => {
  const closeToTray = useStore(s => s.config.closeToTray !== false);
  const autoLockMinutes = useStore(s => Number(s.config.autoLockMinutes) || 0);
  const updateConfig = useStore(s => s.updateConfig);
  const t = useT();
  const [autostart, setAutostart] = useState(false);
  const [encrypted, setEncrypted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    invoke('autostart_is_enabled').then(setAutostart).catch(() => {});
    invoke('encryption_is_enabled').then(setEncrypted).catch(() => {});
  }, []);

  const toggleAutostart = async (enabled) => {
    setError('');
    try {
      await invoke('autostart_set', { enabled });
      setAutostart(enabled);
    } catch (e) {
      setError(t.background_autostart_error.replace('{error}', String(e)));
    }
  };

  return (
    <div className="space-y-3 p-4 border border-sage-200 rounded-soft">
      <p className="text-sm font-medium text-sage-800 flex items-center gap-2"><MonitorSmartphone size={14} /> {t.background_title}</p>
      <Toggle
        checked={autostart}
        onChange={toggleAutostart}
        label={t.background_autostart}
        hint={t.background_autostart_hint}
      />
      <Toggle
        checked={closeToTray}
        onChange={v => updateConfig({ closeToTray: v })}
        label={t.background_close_to_tray}
        hint={t.background_close_to_tray_hint}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-sage-400">{t.background_sleep_hint}</p>
      {encrypted && (
        <div className="flex items-start gap-2 px-3 py-2 bg-warning-light border border-warning/30 rounded-button">
          <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning-dark">
            {autoLockMinutes > 0 ? t.background_encrypted_autolock : t.background_encrypted}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Settings → Recordatorios. Channel switches, timing, quiet hours and the
 * per-language templates (with variable chips and a live preview).
 */
export const RemindersSection = ({ onGoToSmtp }) => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const t = useT();
  const rc = getReminderConfig(config);
  const [lang, setLang] = useState(config.appLang || 'es');
  const [channel, setChannel] = useState('email');
  const [focusField, setFocusField] = useState('body');

  const setReminders = (patch) => updateConfig({ reminders: { ...rc, ...patch } });
  const setChannelCfg = (ch, patch) => setReminders({ [ch]: { ...rc[ch], ...patch } });

  const emailTmpl = rc.email.templates?.[lang] || DEFAULT_APPOINTMENT_TEMPLATES[lang];
  const waTmpl = whatsAppTemplate(config, lang);
  const isCustom = channel === 'email' ? !!rc.email.templates?.[lang] : !!rc.whatsapp.templates?.[lang];

  const setEmailTmpl = (field, value) =>
    setChannelCfg('email', { templates: { ...rc.email.templates, [lang]: { ...emailTmpl, [field]: value } } });
  const setWaTmpl = (value) =>
    setChannelCfg('whatsapp', { templates: { ...rc.whatsapp.templates, [lang]: value } });
  const restoreDefault = () => {
    const ch = channel;
    const { [lang]: _removed, ...rest } = rc[ch].templates || {};
    setChannelCfg(ch, { templates: rest });
    // Also drop the pre-1.10 WhatsApp template so the default really applies.
    if (ch === 'whatsapp' && config.whatsappReminderTemplate?.[lang]) {
      const { [lang]: _old, ...legacy } = config.whatsappReminderTemplate;
      updateConfig({ whatsappReminderTemplate: legacy });
    }
  };

  const insertVariable = (key) => {
    if (channel === 'whatsapp') setWaTmpl(waTmpl + key);
    else setEmailTmpl(focusField, (emailTmpl[focusField] || '') + key);
  };

  const preview = useMemo(() => {
    const ctx = { client: SAMPLE_CLIENT, consultation: { ...sampleConsultation(), locationId: config.locations?.[0]?.id }, config, lang };
    return channel === 'email'
      ? `${resolveTemplate(emailTmpl.subject, ctx)}\n\n${resolveTemplate(emailTmpl.body, ctx)}`
      : resolveTemplate(waTmpl, ctx);
  }, [channel, emailTmpl, waTmpl, config, lang]);

  const smtpReady = !!config.smtp?.host;

  return (
    <div className="space-y-5">
      <p className="text-xs text-sage-500">{t.reminders_settings_intro}</p>

      {/* Email */}
      <div className="space-y-3 p-4 border border-sage-200 rounded-soft">
        <p className="text-sm font-medium text-sage-800 flex items-center gap-2"><Mail size={14} /> Email</p>
        <Toggle checked={rc.email.enabled} onChange={v => setChannelCfg('email', { enabled: v })} label={t.reminders_email_enabled} />
        {rc.email.enabled && (
          <>
            <Toggle
              checked={rc.email.auto}
              onChange={v => setChannelCfg('email', { auto: v })}
              label={t.reminders_email_auto}
              hint={t.reminders_email_auto_hint}
            />
            {rc.email.auto && !smtpReady && (
              <div className="flex items-start gap-2 px-3 py-2 bg-warning-light border border-warning/30 rounded-button">
                <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning-dark">
                  {t.reminders_smtp_missing}{' '}
                  {onGoToSmtp && <button onClick={onGoToSmtp} className="underline">{t.reminders_go_to_smtp}</button>}
                </p>
              </div>
            )}
            <NumberField
              label={t.reminders_lead_hours}
              value={rc.email.leadHours}
              onChange={v => setChannelCfg('email', { leadHours: v })}
              min={1}
              suffix={t.reminders_hours_before}
            />
          </>
        )}
      </div>

      {/* WhatsApp */}
      <div className="space-y-3 p-4 border border-sage-200 rounded-soft">
        <p className="text-sm font-medium text-sage-800 flex items-center gap-2"><MessageCircle size={14} /> WhatsApp</p>
        <Toggle
          checked={rc.whatsapp.enabled}
          onChange={v => setChannelCfg('whatsapp', { enabled: v })}
          label={t.reminders_whatsapp_enabled}
          hint={t.reminders_whatsapp_hint}
        />
        <div className="flex flex-wrap gap-4">
          {rc.whatsapp.enabled && (
            <NumberField
              label={t.reminders_lead_hours}
              value={rc.whatsapp.leadHours}
              onChange={v => setChannelCfg('whatsapp', { leadHours: v })}
              min={1}
              suffix={t.reminders_hours_before}
            />
          )}
          <label className="block">
            <span className="block text-xs font-medium text-sage-600 mb-1">{t.whatsapp_country_code}</span>
            <Input
              value={config.whatsappCountryCode || '34'}
              onChange={e => updateConfig({ whatsappCountryCode: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              placeholder="34"
              className="w-24"
            />
          </label>
        </div>
        <p className="text-xs text-sage-400">{t.reminders_country_hint}</p>
        <fieldset>
          <legend className="block text-xs font-medium text-sage-600 mb-1">{t.reminders_whatsapp_open_with}</legend>
          <div className="flex flex-wrap gap-4">
            {[['desktop', t.reminders_whatsapp_open_desktop], ['browser', t.reminders_whatsapp_open_browser]].map(([id, label]) => (
              <label key={id} className="flex items-center gap-1.5 text-sm text-sage-800 cursor-pointer">
                <input
                  type="radio"
                  name="whatsapp-open-with"
                  checked={rc.whatsapp.openWith === id}
                  onChange={() => setChannelCfg('whatsapp', { openWith: id })}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-sage-400 mt-1">{t.reminders_whatsapp_open_hint}</p>
        </fieldset>
      </div>

      {/* Timing rules */}
      <div className="space-y-3 p-4 border border-sage-200 rounded-soft">
        <NumberField
          label={t.reminders_min_lead}
          value={rc.minLeadHours}
          onChange={v => setReminders({ minLeadHours: v })}
          max={48}
          suffix={t.reminders_hours_before}
        />
        <Toggle
          checked={rc.quietHours.enabled}
          onChange={v => setReminders({ quietHours: { ...rc.quietHours, enabled: v } })}
          label={t.reminders_quiet_hours}
          hint={t.reminders_quiet_hours_hint}
        />
        {rc.quietHours.enabled && (
          <div className="flex items-center gap-2 text-xs text-sage-600">
            <Input type="time" value={rc.quietHours.from} onChange={e => setReminders({ quietHours: { ...rc.quietHours, from: e.target.value } })} className="w-28" />
            <span>→</span>
            <Input type="time" value={rc.quietHours.to} onChange={e => setReminders({ quietHours: { ...rc.quietHours, to: e.target.value } })} className="w-28" />
          </div>
        )}
      </div>

      <BackgroundSection />

      {/* Templates */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-sage-800">{t.reminders_templates}</p>
          <div className="flex gap-2">
            <SegmentedControl
              value={channel}
              onChange={setChannel}
              options={[{ value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }]}
            />
            <SegmentedControl
              value={lang}
              onChange={setLang}
              options={LANGS.map(([code, label]) => ({ value: code, label }))}
            />
          </div>
        </div>

        {channel === 'email' ? (
          <>
            <label className="block">
              <span className="block text-xs font-medium text-sage-600 mb-1">{t.reminders_subject}</span>
              <Input value={emailTmpl.subject} onFocus={() => setFocusField('subject')} onChange={e => setEmailTmpl('subject', e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-sage-600 mb-1">{t.reminders_body}</span>
              <Textarea rows={8} value={emailTmpl.body} onFocus={() => setFocusField('body')} onChange={e => setEmailTmpl('body', e.target.value)} />
            </label>
          </>
        ) : (
          <label className="block">
            <span className="block text-xs font-medium text-sage-600 mb-1">{t.reminders_message}</span>
            <Textarea rows={4} value={waTmpl} onChange={e => setWaTmpl(e.target.value)} />
          </label>
        )}

        <div className="flex flex-wrap gap-1">
          {REMINDER_VARIABLES.map(v => (
            <button
              key={v.key}
              onClick={() => insertVariable(v.key)}
              className="px-1.5 py-0.5 text-[11px] bg-sage-100 text-sage-600 rounded font-mono hover:bg-sage-200 transition-colors"
              title={v.label}
            >
              {v.key}
            </button>
          ))}
        </div>

        <div>
          <p className="text-xs font-medium text-sage-600 mb-1">{t.reminders_preview}</p>
          <div className="p-3 bg-sage-50 border border-sage-200 rounded-soft text-xs text-sage-700 whitespace-pre-wrap">{preview}</div>
        </div>

        {isCustom && (
          <Button variant="ghost" size="sm" icon={RotateCcw} onClick={restoreDefault}>{t.reminders_restore_default}</Button>
        )}
      </div>
    </div>
  );
};

export default RemindersSection;
