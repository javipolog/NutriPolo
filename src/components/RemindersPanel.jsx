import React, { useEffect, useMemo, useState } from 'react';
import { Bell, MessageCircle, Mail, Settings, UserPlus, ArrowRight, Loader2, SkipForward, CheckCircle2, Star, MapPin } from 'lucide-react';
import { Card, Button, Modal, Textarea, Badge } from './UI';
import useStore, { filterVisibleConsultations, todayISO, localISODate } from '../stores/store';
import { useT } from '../i18n';
import { useNow } from '../hooks/useNow';
import { useReminderActions } from '../hooks/useReminderActions';
import { getReminderCandidates, getReminderConfig, buildReminderWhatsApp } from '../services/reminderService';
import { getReviewCandidates, getReviewConfig, buildReviewWhatsApp } from '../services/reviewRequestService';

const STATE_STYLES = {
  due:        'bg-warning-light text-warning-dark',
  error:      'bg-danger-light text-danger',
  sending:    'bg-sage-100 text-sage-600',
  sent:       'bg-success-light text-success',
  opened:     'bg-success-light text-success',
  manual:     'bg-success-light text-success',
  upcoming:   'bg-sage-100 text-sage-500',
  waiting:    'bg-sage-100 text-sage-500',
  already_asked: 'bg-sage-100 text-sage-400',
  no_link:    'bg-warning-light text-warning-dark',
  too_late:   'bg-sage-100 text-sage-400',
  opted_out:  'bg-sage-100 text-sage-400',
  no_contact: 'bg-sage-100 text-sage-400',
};

const DONE = new Set(['sent', 'opened', 'manual', 'sending']);
const BLOCKED = new Set(['opted_out', 'no_contact', 'already_asked', 'no_link']);
// Review rows where nothing can be done are left out of the panel.
const REVIEW_HIDDEN = new Set(['opted_out', 'already_asked']);

/** Entries that need the user: WhatsApp due, or email due/failed when not auto-sent. */
const needsUser = (autoEmail) => (e) =>
  (e.channel === 'whatsapp' && e.state === 'due') ||
  (e.channel === 'email' && (e.state === 'error' || (e.state === 'due' && !autoEmail)));

/** Number of reminders and review requests that need the user. */
export function countPendingReminders(state, now = Date.now()) {
  const { config, consultations, clients } = state;
  const smtp = !!config.smtp?.host;
  const visible = filterVisibleConsultations(consultations, config.googleCalendar);
  const reminders = getReminderCandidates({ consultations: visible, clients, config, now })
    .filter(needsUser(getReminderConfig(config).email.auto && smtp));
  const reviews = getReviewCandidates({ consultations: visible, history: consultations, clients, config, now })
    .filter(needsUser(getReviewConfig(config).email.auto && smtp));
  return reminders.length + reviews.length;
}

function dayLabel(start, t) {
  const iso = localISODate(start);
  if (iso === todayISO()) return t.today;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (iso === localISODate(tomorrow)) return t.tomorrow;
  return `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
}

function stateLabel(entry, t) {
  if (entry.state === 'no_contact') {
    return entry.channel === 'email' ? t.reminders_state_no_contact_email : t.reminders_state_no_contact_whatsapp;
  }
  return t[`reminders_state_${entry.state}`] || entry.state;
}

const ChannelCell = ({ entry, autoEmail, busy, onSend, sendLabels, t }) => {
  const Icon = entry.channel === 'email' ? Mail : MessageCircle;
  const canSend = !BLOCKED.has(entry.state) && entry.state !== 'sending';
  const label = (entry.state === 'upcoming' || entry.state === 'waiting') && entry.channel === 'email' && autoEmail
    ? t.reminders_state_scheduled_auto
    : stateLabel(entry, t);
  const sendLabel = sendLabels?.[entry.channel]
    || (entry.channel === 'email' ? t.reminders_send_email : t.reminders_send_whatsapp);
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-badge ${STATE_STYLES[entry.state] || STATE_STYLES.upcoming}`}
        title={entry.record?.error || ''}
      >
        <Icon size={11} /> {label}
      </span>
      {canSend && (
        <button
          onClick={onSend}
          disabled={busy}
          className={`p-1 rounded-button transition-colors disabled:opacity-50 ${
            DONE.has(entry.state) ? 'text-sage-400 hover:text-sage-700 hover:bg-sage-100' : 'text-wellness-600 hover:bg-wellness-50'
          }`}
          title={DONE.has(entry.state) ? t.reminders_resend : sendLabel}
          aria-label={sendLabel}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
        </button>
      )}
    </div>
  );
};

/**
 * Walks through the due WhatsApp messages one by one: each step shows the
 * message (editable) and opens the chat; the user presses Send in WhatsApp
 * and comes back for the next. `entries` is a snapshot taken when opening.
 * `build` makes the message (reminder or review), `title` heads the modal.
 */
const WhatsAppQueueModal = ({ entries, onClose, sendWhatsApp, build = buildReminderWhatsApp, title, t }) => {
  const config = useStore(s => s.config);
  const [index, setIndex] = useState(0);
  const [opened, setOpened] = useState(0);
  const [busy, setBusy] = useState(false);
  const entry = entries[index];
  const [text, setText] = useState('');

  useEffect(() => {
    if (entry) setText(build({ consultation: entry.consultation, client: entry.client, config }).text || '');
    // Rebuild only when moving to another patient, not on every config change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const next = () => setIndex(i => i + 1);
  const openCurrent = async () => {
    setBusy(true);
    try {
      if (await sendWhatsApp(entry.consultation, entry.client, { text, silent: true })) {
        setOpened(n => n + 1);
        next();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title || t.reminders_wa_queue_title} size="sm">
      {!entry ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 size={32} className="mx-auto text-success" />
          <p className="text-sm text-sage-700">
            {t.reminders_wa_queue_done.replace('{opened}', opened).replace('{skipped}', entries.length - opened)}
          </p>
          <Button onClick={onClose}>{t.close}</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-sage-900 truncate">{entry.client.nombre}</p>
              <p className="text-xs text-sage-500">{dayLabel(entry.start, t)} · {entry.consultation.hora || '—'}</p>
            </div>
            <span className="text-xs text-sage-500 shrink-0" aria-live="polite">
              {t.reminders_wa_queue_progress.replace('{i}', index + 1).replace('{n}', entries.length)}
            </span>
          </div>
          <Textarea rows={5} value={text} onChange={e => setText(e.target.value)} aria-label={t.reminders_message} />
          <p className="text-xs text-sage-500">{t.reminders_wa_queue_help}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" icon={SkipForward} onClick={next} disabled={busy}>{t.reminders_wa_queue_skip}</Button>
            <Button icon={busy ? Loader2 : MessageCircle} onClick={openCurrent} disabled={busy || !text.trim()} autoFocus>
              {t.reminders_wa_queue_open}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export const RemindersPanel = ({ onNavigate }) => {
  const consultations = useStore(s => s.consultations);
  const clients = useStore(s => s.clients);
  const config = useStore(s => s.config);
  const t = useT();
  const now = useNow(60000);
  const { sendWhatsApp, sendEmail } = useReminderActions();
  const [busyKey, setBusyKey] = useState(null);
  const [waQueue, setWaQueue] = useState(null);

  const rc = getReminderConfig(config);
  const autoEmail = rc.email.auto && !!config.smtp?.host;
  const horizonHours = Math.max(rc.email.leadHours, rc.whatsapp.leadHours) + 24;

  const rows = useMemo(() => {
    const visible = filterVisibleConsultations(consultations, config.googleCalendar);
    const entries = getReminderCandidates({ consultations: visible, clients, config, now, horizonHours });
    const byId = new Map();
    for (const e of entries) {
      const row = byId.get(e.consultation.id) || { consultation: e.consultation, client: e.client, start: e.start, channels: [] };
      if (e.channel) row.channels.push(e);
      byId.set(e.consultation.id, row);
    }
    return [...byId.values()];
  }, [consultations, clients, config, now, horizonHours]);

  const dueWhatsApp = rows.flatMap(r => r.channels).filter(e => e.channel === 'whatsapp' && e.state === 'due');
  const pendingEmails = rows.flatMap(r => r.channels).filter(e =>
    e.channel === 'email' && (e.state === 'error' || (e.state === 'due' && !autoEmail)));

  const run = async (key, fn) => {
    setBusyKey(key);
    try { await fn(); } finally { setBusyKey(null); }
  };

  const send = (entry) => run(`${entry.consultation.id}_${entry.channel}`, () =>
    entry.channel === 'email' ? sendEmail(entry.consultation, entry.client) : sendWhatsApp(entry.consultation, entry.client));

  const sendAllEmails = () => run('all_email', async () => {
    for (const e of pendingEmails) {
      // eslint-disable-next-line no-await-in-loop
      await sendEmail(e.consultation, e.client);
    }
  });

  if (!rc.email.enabled && !rc.whatsapp.enabled) return null;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2">
            <Bell size={17} className="text-wellness-400" />
            {t.reminders_panel_title}
          </h2>
          <p className="text-xs text-sage-500 mt-0.5">
            {t.reminders_panel_subtitle.replace('{h}', horizonHours)}
            {rc.email.enabled && ` · ${autoEmail ? t.reminders_auto_on : rc.email.auto ? t.reminders_auto_no_smtp : t.reminders_auto_off}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dueWhatsApp.length > 0 && (
            <Button size="sm" icon={MessageCircle} disabled={!!busyKey} onClick={() => setWaQueue(dueWhatsApp)}>
              {t.reminders_wa_queue_button} ({dueWhatsApp.length})
            </Button>
          )}
          {pendingEmails.length > 0 && (
            <Button size="sm" variant="secondary" icon={busyKey === 'all_email' ? Loader2 : Mail} disabled={!!busyKey} onClick={sendAllEmails}>
              {t.reminders_send_all_email} ({pendingEmails.length})
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={Settings} onClick={() => onNavigate('settings')} title={t.reminders_title}>
            <span className="sr-only">{t.reminders_title}</span>
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-sage-500 py-4 text-center">{t.reminders_empty}</p>
      ) : (
        <div className="divide-y divide-sage-100 max-h-96 overflow-y-auto -mx-2 px-2">
          {rows.map(row => {
            const c = row.consultation;
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                <div className="w-24 shrink-0">
                  <p className="text-xs text-sage-500">{dayLabel(row.start, t)}</p>
                  <p className="tabular-nums text-sm font-semibold text-sage-900">{c.hora || '—'}</p>
                </div>
                <div className="flex-1 min-w-[10rem]">
                  {row.client ? (
                    <p className="text-sm font-medium text-sage-900 truncate">{row.client.nombre}</p>
                  ) : (
                    <button
                      onClick={() => onNavigate('inbox')}
                      className="text-sm text-warning-dark inline-flex items-center gap-1 hover:underline"
                    >
                      <UserPlus size={13} /> {c.googleSummary || t.reminders_no_client}
                    </button>
                  )}
                  <p className="text-xs text-sage-500 truncate">
                    {row.client ? (c.tipo || '') : t.reminders_no_client}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {row.channels.map(entry => (
                    <ChannelCell
                      key={entry.channel}
                      entry={entry}
                      autoEmail={autoEmail}
                      busy={busyKey === `${c.id}_${entry.channel}` || busyKey === 'all_email'}
                      onSend={() => send(entry)}
                      t={t}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {waQueue && (
        <WhatsAppQueueModal entries={waQueue} onClose={() => setWaQueue(null)} sendWhatsApp={sendWhatsApp} t={t} />
      )}
    </Card>
  );
};

/**
 * Google review requests for recent consultations (Dashboard). Same layout
 * as RemindersPanel; hidden when review requests are off or nothing is left.
 */
export const ReviewRequestsPanel = ({ onNavigate }) => {
  const consultations = useStore(s => s.consultations);
  const clients = useStore(s => s.clients);
  const config = useStore(s => s.config);
  const t = useT();
  const now = useNow(60000);
  const { sendReviewWhatsApp, sendReviewEmail } = useReminderActions();
  const [busyKey, setBusyKey] = useState(null);
  const [waQueue, setWaQueue] = useState(null);

  const rv = getReviewConfig(config);
  const autoEmail = rv.email.auto && !!config.smtp?.host;
  const locationName = (id) => config.locations?.find(l => l.id === id)?.name || '';

  const rows = useMemo(() => {
    const visible = filterVisibleConsultations(consultations, config.googleCalendar);
    const entries = getReviewCandidates({ consultations: visible, history: consultations, clients, config, now });
    const byId = new Map();
    for (const e of entries) {
      const row = byId.get(e.consultation.id) || { consultation: e.consultation, client: e.client, end: e.end, firstVisit: e.firstVisit, channels: [] };
      row.channels.push(e);
      byId.set(e.consultation.id, row);
    }
    return [...byId.values()].filter(r => r.channels.some(e => !REVIEW_HIDDEN.has(e.state)));
  }, [consultations, clients, config, now]);

  const channels = rows.flatMap(r => r.channels);
  const dueWhatsApp = channels.filter(e => e.channel === 'whatsapp' && e.state === 'due');
  const pendingEmails = channels.filter(e => e.channel === 'email' && (e.state === 'error' || (e.state === 'due' && !autoEmail)));

  const run = async (key, fn) => {
    setBusyKey(key);
    try { await fn(); } finally { setBusyKey(null); }
  };

  const send = (entry) => run(`${entry.consultation.id}_${entry.channel}`, () =>
    entry.channel === 'email' ? sendReviewEmail(entry.consultation, entry.client) : sendReviewWhatsApp(entry.consultation, entry.client));

  const sendAllEmails = () => run('all_email', async () => {
    for (const e of pendingEmails) {
      // eslint-disable-next-line no-await-in-loop
      await sendReviewEmail(e.consultation, e.client);
    }
  });

  if (!rv.enabled || rows.length === 0) return null;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2">
            <Star size={17} className="text-wellness-400" />
            {t.review_panel_title}
          </h2>
          <p className="text-xs text-sage-500 mt-0.5">
            {t.review_panel_subtitle.replace('{d}', rv.maxAgeDays)}
            {rv.email.enabled && ` · ${autoEmail ? t.reminders_auto_on : rv.email.auto ? t.reminders_auto_no_smtp : t.reminders_auto_off}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dueWhatsApp.length > 0 && (
            <Button size="sm" icon={MessageCircle} disabled={!!busyKey} onClick={() => setWaQueue(dueWhatsApp)}>
              {t.reminders_wa_queue_button} ({dueWhatsApp.length})
            </Button>
          )}
          {pendingEmails.length > 0 && (
            <Button size="sm" variant="secondary" icon={busyKey === 'all_email' ? Loader2 : Mail} disabled={!!busyKey} onClick={sendAllEmails}>
              {t.reminders_send_all_email} ({pendingEmails.length})
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={Settings} onClick={() => onNavigate('settings')} title={t.review_title}>
            <span className="sr-only">{t.review_title}</span>
          </Button>
        </div>
      </div>

      <div className="divide-y divide-sage-100 max-h-96 overflow-y-auto -mx-2 px-2">
        {rows.map(row => {
          const c = row.consultation;
          const location = locationName(c.locationId);
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
              <div className="w-24 shrink-0">
                <p className="text-xs text-sage-500">{dayLabel(row.end, t)}</p>
                <p className="tabular-nums text-sm font-semibold text-sage-900">{c.hora || '—'}</p>
              </div>
              <div className="flex-1 min-w-[10rem]">
                <p className="text-sm font-medium text-sage-900 flex items-center gap-2 min-w-0">
                  <span className="truncate">{row.client.nombre}</span>
                  {row.firstVisit && <Badge tone="primary">{t.review_first_visit}</Badge>}
                </p>
                {location && (
                  <p className="text-xs text-sage-500 truncate flex items-center gap-1"><MapPin size={11} /> {location}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {row.channels.map(entry => (
                  <ChannelCell
                    key={entry.channel}
                    entry={entry}
                    autoEmail={autoEmail}
                    busy={busyKey === `${c.id}_${entry.channel}` || busyKey === 'all_email'}
                    onSend={() => send(entry)}
                    sendLabels={{ email: t.review_send_email, whatsapp: t.review_send_whatsapp }}
                    t={t}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {waQueue && (
        <WhatsAppQueueModal
          entries={waQueue}
          onClose={() => setWaQueue(null)}
          sendWhatsApp={sendReviewWhatsApp}
          build={buildReviewWhatsApp}
          title={t.review_wa_queue_title}
          t={t}
        />
      )}
    </Card>
  );
};

export default RemindersPanel;
