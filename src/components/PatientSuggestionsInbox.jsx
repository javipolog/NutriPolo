import React, { useState, useMemo } from 'react';
import { UserPlus, Link, Plus, X, CheckCircle, Users, ChevronDown, ChevronUp } from 'lucide-react';
import useStore from '../stores/store';
import { useToast } from './UI';

// ── Score bar ─────────────────────────────────────────────────────────────────

function scoreBarColor(score) {
  if (score >= 0.90) return 'bg-green-500';
  if (score >= 0.75) return 'bg-yellow-400';
  return 'bg-sage-300';
}

function scoreTextColor(score) {
  if (score >= 0.90) return 'text-green-700';
  if (score >= 0.75) return 'text-yellow-700';
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

// ── Individual suggestion card ────────────────────────────────────────────────

const SuggestionCard = ({ suggestion, clients, onLink, onCreate, onDismiss }) => {
  const [expanded, setExpanded] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newClientName, setNewClientName]   = useState(
    // Capitalize the extracted name as a starting point
    (suggestion.normalizedName || '').replace(/\b\w/g, c => c.toUpperCase())
  );
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');

  // Resolve candidate client objects (skip any whose id no longer exists)
  const candidateClients = useMemo(() =>
    (suggestion.candidates || [])
      .map(c => ({ ...c, client: clients.find(cl => cl.id === c.clienteId) }))
      .filter(c => c.client),
    [suggestion.candidates, clients]
  );

  const MAX_VISIBLE = 3;

  return (
    <div className="border border-sage-200 rounded-soft bg-white overflow-hidden shadow-sm">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Original summary (raw, from Google) */}
            <p className="text-[11px] font-mono text-sage-400 italic truncate mb-0.5">
              "{suggestion.rawSummary}"
            </p>

            {/* Extracted name */}
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-sage-900">{suggestion.normalizedName}</p>
              {suggestion.occurrences > 1 && (
                <span className="flex-shrink-0 px-1.5 py-0.5 bg-wellness-100 text-wellness-700 text-xs rounded-full font-medium">
                  ×{suggestion.occurrences}
                </span>
              )}
            </div>

            {/* First-seen date */}
            {suggestion.firstSeenFecha && (
              <p className="text-xs text-sage-500 mt-0.5">
                Primera vez:{' '}
                {suggestion.firstSeenFecha}
                {suggestion.firstSeenHora ? ` a las ${suggestion.firstSeenHora}` : ''}
                {suggestion.occurrences > 1
                  ? ` · ${suggestion.occurrences} ocurrencias`
                  : ''
                }
              </p>
            )}
          </div>

          {/* Dismiss (×) */}
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="p-1.5 text-sage-400 hover:text-red-500 transition-colors flex-shrink-0 rounded"
            title="Descartar — no volver a proponer este nombre"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Candidate matches ─────────────────────────────────────────────── */}
        {candidateClients.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium text-sage-500">Candidatos similares:</p>
            {(expanded ? candidateClients : candidateClients.slice(0, MAX_VISIBLE)).map(
              ({ client, score, clienteId }) => (
                <div
                  key={clienteId}
                  className="flex items-center gap-3 bg-sage-50 border border-sage-100 rounded px-3 py-2"
                >
                  <span className="text-sm text-sage-800 font-medium shrink-0 w-28 truncate" title={client.nombre}>
                    {client.nombre}
                  </span>
                  <ScoreBar score={score} />
                  <button
                    onClick={() => onLink(suggestion.id, clienteId)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-wellness-700 bg-wellness-50 border border-wellness-200 rounded hover:bg-wellness-100 transition-colors shrink-0"
                  >
                    <Link size={10} />
                    Vincular
                  </button>
                </div>
              )
            )}

            {candidateClients.length > MAX_VISIBLE && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs text-sage-500 hover:text-sage-700 transition-colors mt-1"
              >
                {expanded
                  ? <><ChevronUp size={12} /> Ver menos</>
                  : <><ChevronDown size={12} /> Ver {candidateClients.length - MAX_VISIBLE} más</>
                }
              </button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-sage-400 italic">
            Sin candidatos similares — posiblemente un paciente nuevo.
          </p>
        )}
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────────── */}
      {!showCreateForm ? (
        <div className="px-4 py-3 bg-sage-50 border-t border-sage-100 flex items-center gap-2">
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-wellness-400 text-white text-xs font-medium rounded-button hover:bg-wellness-500 transition-colors"
          >
            <Plus size={12} />
            Crear cliente nuevo
          </button>
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="px-3 py-1.5 text-xs text-sage-500 hover:text-red-600 transition-colors"
          >
            Descartar
          </button>
        </div>
      ) : (
        <div className="px-4 py-3 bg-sage-50 border-t border-sage-100 space-y-2">
          <p className="text-xs font-semibold text-sage-700">Nuevo cliente</p>
          <input
            type="text"
            placeholder="Nombre completo *"
            value={newClientName}
            onChange={e => setNewClientName(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:ring-1 focus:ring-wellness-400 focus:border-wellness-400 outline-none"
            autoFocus
          />
          <div className="flex gap-2">
            <input
              type="tel"
              placeholder="Teléfono"
              value={newClientPhone}
              onChange={e => setNewClientPhone(e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:ring-1 focus:ring-wellness-400 focus:border-wellness-400 outline-none"
            />
            <input
              type="email"
              placeholder="Email"
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
              Cancelar
            </button>
            <button
              disabled={!newClientName.trim()}
              onClick={() =>
                onCreate(suggestion.id, {
                  nombre:   newClientName.trim(),
                  telefono: newClientPhone.trim() || '',
                  email:    newClientEmail.trim() || '',
                })
              }
              className="flex items-center gap-1.5 px-3 py-1.5 bg-wellness-400 text-white text-xs font-medium rounded-button hover:bg-wellness-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserPlus size={12} />
              Crear y vincular
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main view ─────────────────────────────────────────────────────────────────

export const PatientSuggestionsInbox = () => {
  const patientSuggestions      = useStore(s => s.patientSuggestions);
  const clients                 = useStore(s => s.clients);
  const config                  = useStore(s => s.config);
  const linkPatientSuggestion   = useStore(s => s.linkPatientSuggestion);
  const createClientFromSuggestion = useStore(s => s.createClientFromSuggestion);
  const dismissPatientSuggestion   = useStore(s => s.dismissPatientSuggestion);
  const toast = useToast();

  // Pending suggestions, newest first
  const pending = useMemo(
    () =>
      (patientSuggestions || [])
        .filter(sg => sg.status === 'pending')
        .sort((a, b) => (b.detectedAt || '').localeCompare(a.detectedAt || '')),
    [patientSuggestions]
  );

  // Map calendarId → calendar config for display names
  const calendarMap = useMemo(() => {
    const map = {};
    (config.googleCalendar?.calendars || []).forEach(c => { map[c.id] = c; });
    return map;
  }, [config.googleCalendar?.calendars]);

  // Group pending by source calendar
  const byCalendar = useMemo(() => {
    const groups = {};
    for (const sg of pending) {
      const key = sg.sourceCalendarId || '__unknown__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(sg);
    }
    return groups;
  }, [pending]);

  const handleLink = (suggestionId, clienteId) => {
    linkPatientSuggestion(suggestionId, clienteId);
    const client = clients.find(c => c.id === clienteId);
    toast.success(`Vinculado a ${client?.nombre || 'cliente'}`);
  };

  const handleCreate = (suggestionId, clientData) => {
    createClientFromSuggestion(suggestionId, clientData);
    toast.success(`${clientData.nombre} creado y vinculado`);
  };

  const handleDismiss = (suggestionId) => {
    dismissPatientSuggestion(suggestionId);
    toast.info('Sugerencia descartada — no volverá a aparecer');
  };

  return (
    <div className="flex flex-col gap-6 animate-fadeIn">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-sage-900 flex items-center gap-2.5">
          <UserPlus size={22} className="text-wellness-500" />
          Nuevos pacientes detectados
        </h1>
        <p className="text-sm text-sage-500 mt-1">
          {pending.length === 0
            ? 'Sin sugerencias pendientes de revisar'
            : `${pending.length} ${pending.length === 1 ? 'paciente por identificar' : 'pacientes por identificar'}`
          }
        </p>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {pending.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <CheckCircle size={44} className="text-green-400" />
          <div>
            <p className="text-sage-700 font-semibold">Todo al día</p>
            <p className="text-sage-500 text-sm mt-1 max-w-sm">
              Cuando la clínica externa registre un paciente desconocido,
              aparecerá aquí para que puedas vincularlo o crear su ficha.
            </p>
          </div>
        </div>
      )}

      {/* ── Grouped suggestions ──────────────────────────────────────────────── */}
      {Object.entries(byCalendar).map(([calId, suggestions]) => {
        const cal = calendarMap[calId];
        return (
          <div key={calId} className="space-y-3">
            {/* Calendar group header */}
            <div className="flex items-center gap-2 pb-1 border-b border-sage-100">
              <Users size={14} className="text-sage-400 shrink-0" />
              <span className="text-xs font-semibold text-sage-600 uppercase tracking-wide">
                {cal?.name || 'Calendario externo'}
              </span>
              <span className="text-xs text-sage-400">
                · {suggestions.length} {suggestions.length === 1 ? 'pendiente' : 'pendientes'}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-3">
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
          </div>
        );
      })}
    </div>
  );
};

export default PatientSuggestionsInbox;
