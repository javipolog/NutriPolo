import React, { useState, useMemo } from 'react';
import {
  UserPlus, Link, Plus, X, CheckCircle, CheckCircle2, Users,
  ChevronDown, ChevronUp, ArrowRight, AlertCircle,
} from 'lucide-react';
import useStore from '../stores/store';
import { useToast, useConfirm } from './UI';

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

// ── AutoMatchCard — compact card for high-confidence pending-confirm matches ──

const AutoMatchCard = ({ suggestion, clients, onConfirm, onOverride, onDismiss }) => {
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
              <span className="text-sm font-semibold text-sage-900">{suggestion.normalizedName}</span>
              <ArrowRight size={12} className="text-sage-400 shrink-0" />
              <span className="text-sm font-semibold text-info">{proposedClient.nombre}</span>
              {suggestion.topScore != null && (
                <span className="text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                  {Math.round(suggestion.topScore * 100)}%
                </span>
              )}
              {suggestion.occurrences > 1 && (
                <span className="text-xs text-sage-500 bg-sage-100 px-1.5 py-0.5 rounded-full">
                  ×{suggestion.occurrences} citas
                </span>
              )}
            </div>
            {suggestion.firstSeenFecha && (
              <p className="text-xs text-sage-400 mt-0.5">
                Primera vez: {suggestion.firstSeenFecha}
                {suggestion.firstSeenHora ? ` a las ${suggestion.firstSeenHora}` : ''}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onConfirm(suggestion.id)}
              className="flex items-center gap-1 px-3 py-1.5 bg-info text-white text-xs font-semibold rounded-button hover:bg-info-dark transition-colors"
            >
              <CheckCircle2 size={12} />
              Confirmar
            </button>
            {alternativeCandidates.length > 0 && (
              <button
                onClick={() => setShowAlternatives(v => !v)}
                className="px-2 py-1.5 text-xs text-info border border-info/40 rounded-button hover:bg-info/10 transition-colors"
                title="Elegir otro cliente"
              >
                Otro
              </button>
            )}
            <button
              onClick={() => onDismiss(suggestion.id)}
              className="p-1.5 text-sage-400 hover:text-red-500 transition-colors rounded"
              title="Descartar"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {showAlternatives && (
          <div className="mt-3 space-y-1.5 pt-3 border-t border-info/20">
            <p className="text-xs font-medium text-sage-500">Elegir otro cliente:</p>
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
                  Vincular
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
  const [expanded, setExpanded] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newClientName, setNewClientName]   = useState(
    (suggestion.normalizedName || '').replace(/\b\w/g, c => c.toUpperCase())
  );
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');

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
              <p className="text-sm font-semibold text-sage-900">{suggestion.normalizedName}</p>
              {suggestion.occurrences > 1 && (
                <span className="flex-shrink-0 px-1.5 py-0.5 bg-wellness-100 text-wellness-700 text-xs rounded-full font-medium">
                  ×{suggestion.occurrences}
                </span>
              )}
            </div>
            {suggestion.firstSeenFecha && (
              <p className="text-xs text-sage-500 mt-0.5">
                Primera vez: {suggestion.firstSeenFecha}
                {suggestion.firstSeenHora ? ` a las ${suggestion.firstSeenHora}` : ''}
                {suggestion.occurrences > 1 ? ` · ${suggestion.occurrences} ocurrencias` : ''}
              </p>
            )}
          </div>
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="p-1.5 text-sage-400 hover:text-red-500 transition-colors flex-shrink-0 rounded"
            title="Descartar — no volver a proponer este nombre"
          >
            <X size={14} />
          </button>
        </div>

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

// ── Section header helper ─────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, count, colorClass = 'text-sage-600' }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-sage-100">
      <Icon size={15} className={`${colorClass} shrink-0`} />
      <span className={`text-xs font-semibold uppercase tracking-wide ${colorClass}`}>{label}</span>
      <span className="text-xs text-sage-400">· {count} pendiente{count !== 1 ? 's' : ''}</span>
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
    toast.success(`Vinculado a ${client?.nombre || 'cliente'}`);
  };

  const handleOverride = (suggestionId, clienteId) => {
    const client = clients.find(c => c.id === clienteId);
    overrideAutoMatch(suggestionId, clienteId);
    toast.success(`Vinculado a ${client?.nombre || 'cliente'}`);
  };

  const handleConfirmAll = async () => {
    if (pendingConfirm.length === 0) return;
    const names = pendingConfirm
      .map(sg => {
        const proposed = clients.find(c => c.id === sg.suggestedClienteId);
        return proposed ? `${sg.normalizedName} → ${proposed.nombre}` : null;
      })
      .filter(Boolean)
      .join('\n');
    const ok = await confirm(
      'Confirmar coincidencias',
      `Se vincularán ${pendingConfirm.length} coincidencia${pendingConfirm.length !== 1 ? 's' : ''}:\n\n${names}\n\nPuedes cambiar cualquier vinculación manualmente después.`
    );
    if (!ok) return;
    const count = confirmAllAutoMatches();
    toast.success(`${count} coincidencia${count !== 1 ? 's' : ''} confirmada${count !== 1 ? 's' : ''}`);
  };

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
      {ConfirmDialog}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-sage-900 flex items-center gap-2.5">
          <UserPlus size={22} className="text-wellness-500" />
          Nuevos pacientes detectados
        </h1>
        <p className="text-sm text-sage-500 mt-1">
          {totalPending === 0
            ? 'Sin sugerencias pendientes de revisar'
            : `${totalPending} ${totalPending === 1 ? 'paciente por revisar' : 'pacientes por revisar'}`
          }
        </p>
      </div>

      {/* Empty state */}
      {totalPending === 0 && (
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

      {/* Section 1: Auto-matches pending 1-click confirmation */}
      {pendingConfirm.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeader
              icon={CheckCircle2}
              label="Confirmar coincidencias automáticas"
              count={pendingConfirm.length}
              colorClass="text-info"
            />
            {pendingConfirm.length >= 2 && (
              <button
                onClick={handleConfirmAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-info text-white text-xs font-semibold rounded-button hover:bg-info-dark transition-colors"
              >
                <CheckCircle2 size={12} />
                Confirmar todo ({pendingConfirm.length})
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
            label="Candidatos a revisar"
            count={pendingReview.length}
            colorClass="text-orange-600"
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
                        {cal?.name || 'Calendario externo'}
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
            label="Pacientes nuevos"
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
