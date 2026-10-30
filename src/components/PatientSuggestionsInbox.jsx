import React, { useState, useMemo } from 'react';
import {
  UserPlus, Link, Plus, X, CheckCircle, CheckCircle2, Users,
  ChevronDown, ChevronUp, ArrowRight, AlertCircle,
} from 'lucide-react';
import useStore from '../stores/store';
import { Button, useToast, useConfirm } from './UI';
import { useT, plural } from '../i18n';

// Name as written in the event (older suggestions only have the normalized one).
const suggestionName = (sg) => sg.displayName || sg.normalizedName || '';

// ── Score bar ─────────────────────────────────────────────────────────────────

function scoreBarColor(score) {
  if (score >= 0.90) return 'bg-success';
  if (score >= 0.75) return 'bg-warning';
  return 'bg-sage-300';
}

function scoreTextColor(score) {
  if (score >= 0.90) return 'text-success-dark';
  if (score >= 0.75) return 'text-warning';
  return 'text-sage-500';
}

function ScoreBar({ score }) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 bg-sage-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${scoreBarColor(score)}`}
          style={{ width: `${Math.round(score * 100)}%` }}
        />
      </div>
      <span className={`text-xs font-medium tabular-nums w-8 text-right ${scoreTextColor(score)}`}>
        {Math.round(score * 100)}%
      </span>
    </div>
  );
}

// ── AutoMatchCard — compact card for high-confidence pending-confirm matches ──

const AutoMatchCard = ({ suggestion, clients, onConfirm, onOverride, onDismiss }) => {
  const t = useT();
  const [showAlternatives, setShowAlternatives] = useState(false);

  const proposedClient = useMemo(
    () => clients.find(c => c.id === suggestion.suggestedClienteId),
    [clients, suggestion.suggestedClienteId]
  );

  const alternativeCandidates = useMemo(
    () =>
      (suggestion.candidates || [])
        .map(c => ({ ...c, client: clients.find(cl => cl.id === c.clienteId) }))
        .filter(c => c.client && c.clienteId !== suggestion.suggestedClienteId),
    [suggestion.candidates, suggestion.suggestedClienteId, clients]
  );

  if (!proposedClient) return null;

  return (
    <div className="border border-info/30 rounded-soft bg-info-light overflow-hidden shadow-sm">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={16} className="text-info shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono text-sage-400 italic truncate mb-1">
              "{suggestion.rawSummary}"
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-sage-900">{suggestionName(suggestion)}</span>
              <ArrowRight size={12} className="text-sage-400 shrink-0" />
              <span className="text-sm font-semibold text-info">{proposedClient.nombre}</span>
              {suggestion.topScore != null && (
                <span className="text-xs font-medium text-success-dark bg-success-light px-1.5 py-0.5 rounded-full">
                  {Math.round(suggestion.topScore * 100)}%
                </span>
              )}
              {suggestion.occurrences > 1 && (
                <span className="text-xs text-sage-500 bg-sage-100 px-1.5 py-0.5 rounded-full">
                  {t.inbox_occurrences_badge.replace('{n}', suggestion.occurrences)}
                </span>
              )}
            </div>
            {suggestion.firstSeenFecha && (
              <p className="text-xs text-sage-400 mt-0.5">
                {t.suggestion_first_seen}: {suggestion.firstSeenFecha}
                {suggestion.firstSeenHora ? ` ${t.inbox_at_time.replace('{time}', suggestion.firstSeenHora)}` : ''}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onConfirm(suggestion.id)}
              className="flex items-center gap-1 px-3 py-1.5 bg-info text-white text-xs font-semibold rounded-button hover:bg-info-dark transition-colors"
            >
              <CheckCircle2 size={12} />
              {t.inbox_confirm}
            </button>
            {alternativeCandidates.length > 0 && (
              <button
                onClick={() => setShowAlternatives(v => !v)}
                className="px-2 py-1.5 text-xs text-info border border-info/40 rounded-button hover:bg-info/10 transition-colors"
                title={t.inbox_pick_other_client}
                aria-expanded={showAlternatives}
              >
                {t.inbox_other}
              </button>
            )}
            <button
              onClick={() => onDismiss(suggestion.id)}
              className="p-1.5 text-sage-400 hover:text-danger transition-colors rounded"
              title={t.suggestion_dismiss}
              aria-label={t.suggestion_dismiss}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {showAlternatives && (
          <div className="mt-3 space-y-1.5 pt-3 border-t border-info/20">
            <p className="text-xs font-medium text-sage-500">{t.inbox_pick_other_client}:</p>
            {alternativeCandidates.map(({ client, score, clienteId }) => (
              <div
                key={clienteId}
                className="flex items-center gap-3 bg-white border border-sage-100 rounded px-3 py-2"
              >
                <span className="text-sm text-sage-800 font-medium shrink-0 w-28 truncate" title={client.nombre}>
                  {client.nombre}
                </span>
                <ScoreBar score={score} />
                <button
                  onClick={() => { onOverride(suggestion.id, clienteId); setShowAlternatives(false); }}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-wellness-700 bg-wellness-50 border border-wellness-200 rounded hover:bg-wellness-100 transition-colors shrink-0"
                >
                  <Link size={10} />
                  {t.suggestion_link}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── SuggestionCard — existing card for ambiguous candidates / new patients ────

const SuggestionCard = ({ suggestion, clients, onLink, onCreate, onDismiss }) => {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  // Prefilled with what the event said: its name, and the guest email or the
  // phone written in its description.
  const [newClientName, setNewClientName]   = useState(
    suggestion.displayName || (suggestion.normalizedName || '').replace(/(^|\s)\S/g, c => c.toUpperCase())
  );
  const [newClientPhone, setNewClientPhone] = useState(suggestion.contactPhone || '');
  const [newClientEmail, setNewClientEmail] = useState(suggestion.contactEmail || '');

  const candidateClients = useMemo(() =>
    (suggestion.candidates || [])
      .map(c => ({ ...c, client: clients.find(cl => cl.id === c.clienteId) }))
      .filter(c => c.client),
    [suggestion.candidates, clients]
  );

  const MAX_VISIBLE = 3;

  return (
    <div className="border border-sage-200 rounded-soft bg-white overflow-hidden shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono text-sage-400 italic truncate mb-0.5">
              "{suggestion.rawSummary}"
            </p>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-sage-900">{suggestionName(suggestion)}</p>
              {suggestion.occurrences > 1 && (
                <span className="flex-shrink-0 px-1.5 py-0.5 bg-wellness-100 text-wellness-700 text-xs rounded-full font-medium">
                  ×{suggestion.occurrences}
                </span>
              )}
            </div>
            {suggestion.firstSeenFecha && (
              <p className="text-xs text-sage-500 mt-0.5">
                {t.suggestion_first_seen}: {suggestion.firstSeenFecha}
                {suggestion.firstSeenHora ? ` ${t.inbox_at_time.replace('{time}', suggestion.firstSeenHora)}` : ''}
                {suggestion.occurrences > 1 ? ` · ${suggestion.occurrences} ${t.suggestion_occurrences}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="p-1.5 text-sage-400 hover:text-danger transition-colors flex-shrink-0 rounded"
            title={t.inbox_dismiss_forever}
            aria-label={t.inbox_dismiss_forever}
          >
            <X size={14} />
          </button>
        </div>

        {candidateClients.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium text-sage-500">{t.suggestion_candidates}:</p>
            {(expanded ? candidateClients : candidateClients.slice(0, MAX_VISIBLE)).map(
              ({ client, score, clienteId }) => (
                <div
                  key={clienteId}
                  className="flex items-center gap-3 bg-sage-50 border border-sage-100 rounded px-3 py-2"
                >
                  <span className="shrink-0 w-28 min-w-0" title={client.nombre}>
                    <span className="block text-sm text-sage-800 font-medium truncate">{client.nombre}</span>
                    {/* Tells apart clients with the same name */}
                    {(client.telefono || client.email) && (
                      <span className="block text-xs text-sage-500 truncate">{client.telefono || client.email}</span>
                    )}
                  </span>
                  <ScoreBar score={score} />
                  <button
                    onClick={() => onLink(suggestion.id, clienteId)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-wellness-700 bg-wellness-50 border border-wellness-200 rounded hover:bg-wellness-100 transition-colors shrink-0"
                  >
                    <Link size={10} />
                    {t.suggestion_link}
                  </button>
                </div>
              )
            )}
            {candidateClients.length > MAX_VISIBLE && (
              <button
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                className="flex items-center gap-1 text-xs text-sage-500 hover:text-sage-700 transition-colors mt-1"
              >
                {expanded
                  ? <><ChevronUp size={12} /> {t.show_less}</>
                  : <><ChevronDown size={12} /> {t.show_n_more.replace('{n}', candidateClients.length - MAX_VISIBLE)}</>
                }
              </button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-sage-400 italic">
            {t.suggestion_no_candidates}
          </p>
        )}
      </div>

      {!showCreateForm ? (
        <div className="px-4 py-3 bg-sage-50 border-t border-sage-100 flex items-center gap-2">
          <Button size="sm" icon={Plus} onClick={() => setShowCreateForm(true)}>
            {t.suggestion_create}
          </Button>
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="px-3 py-1.5 text-xs text-sage-500 hover:text-danger transition-colors"
          >
            {t.suggestion_dismiss}
          </button>
        </div>
      ) : (
        <div className="px-4 py-3 bg-sage-50 border-t border-sage-100 space-y-2">
          <p className="text-xs font-semibold text-sage-700">{t.new_client}</p>
          <input
            type="text"
            placeholder={`${t.client_name} *`}
            aria-label={t.client_name}
            aria-required="true"
            value={newClientName}
            onChange={e => setNewClientName(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:ring-1 focus:ring-wellness-400 focus:border-wellness-400 outline-none"
            autoFocus
          />
          <div className="flex gap-2">
            <input
              type="tel"
              placeholder={t.phone}
              aria-label={t.phone}
              value={newClientPhone}
              onChange={e => setNewClientPhone(e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:ring-1 focus:ring-wellness-400 focus:border-wellness-400 outline-none"
            />
            <input
              type="email"
              placeholder={t.email}
              aria-label={t.email}
              value={newClientEmail}
              onChange={e => setNewClientEmail(e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:ring-1 focus:ring-wellness-400 focus:border-wellness-400 outline-none"
            />
          </div>
          <div className="flex items-center gap-2 justify-end pt-1">
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 text-xs text-sage-600 hover:text-sage-800 transition-colors"
            >
              {t.cancel}
            </button>
            <Button
              disabled={!newClientName.trim()}
              onClick={() =>
                onCreate(suggestion.id, {
                  nombre:   newClientName.trim(),
                  telefono: newClientPhone.trim() || '',
                  email:    newClientEmail.trim() || '',
                })
              }
              size="sm"
              icon={UserPlus}
            >
              {t.inbox_create_and_link}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Section header helper ─────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, count, colorClass = 'text-sage-600' }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-sage-100">
      <Icon size={15} className={`${colorClass} shrink-0`} />
      <span className={`text-xs font-semibold uppercase tracking-wide ${colorClass}`}>{label}</span>
      <span className="text-xs text-sage-400">· {plural(t, 'inbox_n_pending', count)}</span>
    </div>
  );
}

// ── Main view (promoted to full standalone view) ──────────────────────────────

export const PatientSuggestionsInbox = () => {
  const patientSuggestions         = useStore(s => s.patientSuggestions);
  const clients                    = useStore(s => s.clients);
  const config                     = useStore(s => s.config);
  const linkPatientSuggestion      = useStore(s => s.linkPatientSuggestion);
  const createClientFromSuggestion = useStore(s => s.createClientFromSuggestion);
  const dismissPatientSuggestion   = useStore(s => s.dismissPatientSuggestion);
  const confirmAutoMatch           = useStore(s => s.confirmAutoMatch);
  const overrideAutoMatch          = useStore(s => s.overrideAutoMatch);
  const confirmAllAutoMatches      = useStore(s => s.confirmAllAutoMatches);
  const toast = useToast();
  const t = useT();
  const { confirm, ConfirmDialog } = useConfirm();

  const pendingConfirm = useMemo(
    () => (patientSuggestions || []).filter(sg => sg.status === 'pending-confirm'),
    [patientSuggestions]
  );
  const pendingReview = useMemo(
    () => (patientSuggestions || [])
      .filter(sg => sg.status === 'pending' && sg.candidates?.length > 0)
      .sort((a, b) => (b.detectedAt || '').localeCompare(a.detectedAt || '')),
    [patientSuggestions]
  );
  const pendingNew = useMemo(
    () => (patientSuggestions || [])
      .filter(sg => sg.status === 'pending' && (!sg.candidates || sg.candidates.length === 0))
      .sort((a, b) => (b.detectedAt || '').localeCompare(a.detectedAt || '')),
    [patientSuggestions]
  );

  const totalPending = pendingConfirm.length + pendingReview.length + pendingNew.length;

  const calendarMap = useMemo(() => {
    const map = {};
    (config.googleCalendar?.calendars || []).forEach(c => { map[c.id] = c; });
    return map;
  }, [config.googleCalendar?.calendars]);

  const handleConfirm = (suggestionId) => {
    const sg = (patientSuggestions || []).find(s => s.id === suggestionId);
    const client = clients.find(c => c.id === sg?.suggestedClienteId);
    confirmAutoMatch(suggestionId);
    toast.success(`${t.suggestion_linked_ok} ${client?.nombre || t.client_fallback}`);
  };

  const handleOverride = (suggestionId, clienteId) => {
    const client = clients.find(c => c.id === clienteId);
    overrideAutoMatch(suggestionId, clienteId);
    toast.success(`${t.suggestion_linked_ok} ${client?.nombre || t.client_fallback}`);
  };

  const handleConfirmAll = async () => {
    if (pendingConfirm.length === 0) return;
    const names = pendingConfirm
      .map(sg => {
        const proposed = clients.find(c => c.id === sg.suggestedClienteId);
        return proposed ? `${suggestionName(sg)} → ${proposed.nombre}` : null;
      })
      .filter(Boolean)
      .join('\n');
    const ok = await confirm({
      title: t.inbox_confirm_all_title,
      message: `${plural(t, 'inbox_confirm_all_count', pendingConfirm.length)}:\n\n${names}\n\n${t.inbox_confirm_all_desc}`,
    });
    if (!ok) return;
    const count = confirmAllAutoMatches();
    toast.success(plural(t, 'inbox_confirmed_count', count));
  };

  const handleLink = (suggestionId, clienteId) => {
    linkPatientSuggestion(suggestionId, clienteId);
    const client = clients.find(c => c.id === clienteId);
    toast.success(`${t.suggestion_linked_ok} ${client?.nombre || t.client_fallback}`);
  };

  const handleCreate = (suggestionId, clientData) => {
    createClientFromSuggestion(suggestionId, clientData);
    toast.success(`${clientData.nombre} ${t.suggestion_created_ok}`);
  };

  const handleDismiss = (suggestionId) => {
    dismissPatientSuggestion(suggestionId);
    toast.info(t.suggestion_dismissed_ok);
  };

  return (
    <div className="flex flex-col gap-6 animate-fadeIn">
      {ConfirmDialog}

      {/* Header */}
      <div>
        <h1 className="font-serif text-title text-sage-900 flex items-center gap-2.5">
          <UserPlus size={22} className="text-wellness-500" />
          {t.inbox_title}
        </h1>
        <p className="text-sm text-sage-500 mt-1">
          {totalPending === 0
            ? t.patient_inbox_empty
            : plural(t, 'inbox_to_review', totalPending)
          }
        </p>
      </div>

      {/* Empty state */}
      {totalPending === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <CheckCircle size={44} className="text-success" />
          <div>
            <p className="text-sage-700 font-semibold">{t.dashboard_all_clear}</p>
            <p className="text-sage-500 text-sm mt-1 max-w-sm">
              {t.inbox_empty_desc}
            </p>
          </div>
        </div>
      )}

      {/* Section 1: Auto-matches pending 1-click confirmation */}
      {pendingConfirm.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeader
              icon={CheckCircle2}
              label={t.inbox_section_confirm}
              count={pendingConfirm.length}
              colorClass="text-info"
            />
            {pendingConfirm.length >= 2 && (
              <button
                onClick={handleConfirmAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-info text-white text-xs font-semibold rounded-button hover:bg-info-dark transition-colors"
              >
                <CheckCircle2 size={12} />
                {t.inbox_confirm_all} ({pendingConfirm.length})
              </button>
            )}
          </div>
          <div className="space-y-2">
            {pendingConfirm.map(sg => (
              <AutoMatchCard
                key={sg.id}
                suggestion={sg}
                clients={clients}
                onConfirm={handleConfirm}
                onOverride={handleOverride}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        </div>
      )}

      {/* Section 2: Ambiguous candidates */}
      {pendingReview.length > 0 && (
        <div className="space-y-3">
          <SectionHeader
            icon={AlertCircle}
            label={t.inbox_section_review}
            count={pendingReview.length}
            colorClass="text-terra-500"
          />
          {(() => {
            const groups = {};
            for (const sg of pendingReview) {
              const key = sg.sourceCalendarId || '__unknown__';
              if (!groups[key]) groups[key] = [];
              groups[key].push(sg);
            }
            return Object.entries(groups).map(([calId, suggestions]) => {
              const cal = calendarMap[calId];
              return (
                <div key={calId} className="space-y-3">
                  {Object.keys(groups).length > 1 && (
                    <div className="flex items-center gap-2 pb-1 border-b border-sage-100">
                      <Users size={13} className="text-sage-400 shrink-0" />
                      <span className="text-xs font-semibold text-sage-500 uppercase tracking-wide">
                        {cal?.name || t.external_calendar}
                      </span>
                    </div>
                  )}
                  {suggestions.map(sg => (
                    <SuggestionCard
                      key={sg.id}
                      suggestion={sg}
                      clients={clients}
                      onLink={handleLink}
                      onCreate={handleCreate}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* Section 3: Unknown new patients */}
      {pendingNew.length > 0 && (
        <div className="space-y-3">
          <SectionHeader
            icon={UserPlus}
            label={t.inbox_section_new}
            count={pendingNew.length}
            colorClass="text-sage-600"
          />
          <div className="space-y-3">
            {pendingNew.map(sg => (
              <SuggestionCard
                key={sg.id}
                suggestion={sg}
                clients={clients}
                onLink={handleLink}
                onCreate={handleCreate}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Alias for ClientsView shortcut — renders the full inbox inline
export const PatientSuggestionsSection = PatientSuggestionsInbox;

export default PatientSuggestionsInbox;
