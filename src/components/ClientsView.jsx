import React, { useState, useMemo } from 'react';
import { Users, Plus, Edit2, Trash2, Search, MessageCircle, ChevronRight, Phone } from 'lucide-react';
import { Button, Input, EmptyState, useToast, useConfirm } from './UI';
import useStore, { formatDate } from '../stores/store';
import { useT } from '../i18n';
import { ClientModal } from './ClientModal';
import { ClientDetailView } from './ClientDetailView';
import { deleteClientDocumentsDir } from '../services/documentService';
import { PatientSuggestionsSection } from './PatientSuggestionsInbox';

const OBJETIVO_LABELS = {
  perdida_grasa: 'Pérdida grasa',
  ganancia_muscular: 'Ganancia muscular',
  mejora_digestiva: 'Mejora digestiva',
  rendimiento_deportivo: 'Deporte',
  dietoterapia: 'Dietoterapia',
  relacion_alimentacion: 'Relación alimentación',
};

export const ClientsView = () => {
  const clients = useStore(s => s.clients);
  const deleteClient = useStore(s => s.deleteClient);
  const selectedClientId = useStore(s => s.selectedClientId);
  const setSelectedClientId = useStore(s => s.setSelectedClientId);
  const clientSearch = useStore(s => s.clientSearch);
  const setClientSearch = useStore(s => s.setClientSearch);
  const clientFilters = useStore(s => s.clientFilters);
  const setClientFilters = useStore(s => s.setClientFilters);
  const config = useStore(s => s.config);

  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState(null);

  const filtered = useMemo(() => {
    const q = clientSearch.toLowerCase();
    return clients.filter(c => {
      if (q && !(c.nombre || '').toLowerCase().includes(q) &&
               !(c.email || '').toLowerCase().includes(q) &&
               !(c.telefono || '').toLowerCase().includes(q)) return false;
      if (clientFilters.estado !== 'all' && c.estado !== clientFilters.estado) return false;
      if (clientFilters.objetivo !== 'all' && !(c.objetivos || []).includes(clientFilters.objetivo)) return false;
      return true;
    });
  }, [clients, clientSearch, clientFilters]);

  // If a client is selected, show detail view
  if (selectedClientId) {
    return <ClientDetailView clientId={selectedClientId} onBack={() => setSelectedClientId(null)} />;
  }

  const handleDelete = async (client) => {
    const ok = await confirm(`¿Eliminar a ${client.nombre}? Se eliminarán también sus consultas, mediciones y documentos.`);
    if (!ok) return;
    deleteClientDocumentsDir(client.id).catch(() => { /* Best-effort cleanup */ });
    deleteClient(client.id);
    toast.success(`${client.nombre} eliminado`);
  };

  const openWhatsApp = (client) => {
    const phone = (client.whatsapp || client.telefono || '').replace(/\D/g, '');
    if (!phone) { toast.error('Sin número de WhatsApp'); return; }
    const cc = (config.whatsappCountryCode || '34').replace(/\D/g, '');
    window.open(`https://wa.me/${cc}${phone}`, '_blank');
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Suggested new clients from external calendars */}
      <PatientSuggestionsSection />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-sage-900">{t.clients_title}</h1>
        <Button
          variant="primary"
          onClick={() => { setEditClient(null); setShowModal(true); }}
          icon={Plus}
        >
          {t.new_client}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-400" />
          <Input
            value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            placeholder={t.search_clients}
            className="pl-9"
          />
        </div>
        <select
          value={clientFilters.estado}
          onChange={e => setClientFilters({ estado: e.target.value })}
          className="px-3 py-2 text-sm bg-white border border-sage-300 rounded-button text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">Todos los estados</option>
          <option value="activo">{t.client_status_active}</option>
          <option value="inactivo">{t.client_status_inactive}</option>
          <option value="alta">{t.client_status_alta}</option>
        </select>
        <select
          value={clientFilters.objetivo}
          onChange={e => setClientFilters({ objetivo: e.target.value })}
          className="px-3 py-2 text-sm bg-white border border-sage-300 rounded-button text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">Todos los objetivos</option>
          {Object.entries(OBJETIVO_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Results count */}
      <p className="text-xs text-sage-500">{filtered.length} cliente{filtered.length !== 1 ? 's' : ''}</p>

      {/* Client list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={clients.length === 0 ? t.no_clients : t.no_results}
          action={clients.length === 0 ? { label: t.new_client, onClick: () => setShowModal(true) } : null}
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map(client => (
            <div
              key={client.id}
              className="bg-white border border-sage-200 rounded-soft shadow-card hover:shadow-card-hover transition-shadow p-4 flex items-center gap-4"
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-wellness-100 flex items-center justify-center shrink-0 text-wellness-600 font-semibold text-sm">
                {(client.nombre || '?').charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedClientId(client.id)}>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sage-900 truncate">{client.nombre}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-badge font-medium ${
                    client.estado === 'activo'   ? 'bg-success-light text-success' :
                    client.estado === 'alta'     ? 'bg-warning-light text-warning' :
                    'bg-sage-100 text-sage-500'
                  }`}>
                    {t[`client_status_${client.estado}`] || client.estado}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-sage-500">
                  {client.telefono && <span className="flex items-center gap-1"><Phone size={10} />{client.telefono}</span>}
                  {client.fechaUltimaConsulta && <span>Última visita: {formatDate(client.fechaUltimaConsulta)}</span>}
                  {!client.fechaUltimaConsulta && <span className="text-warning">{t.client_no_visits}</span>}
                </div>
                {(client.objetivos || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {client.objetivos.slice(0, 3).map(o => (
                      <span key={o} className="text-[10px] px-1.5 py-0.5 bg-wellness-50 text-wellness-600 rounded-badge">
                        {OBJETIVO_LABELS[o] || o}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openWhatsApp(client)}
                  title={t.whatsapp_open}
                  className="p-2 rounded-button text-sage-400 hover:text-success hover:bg-success-light transition-colors"
                >
                  <MessageCircle size={15} />
                </button>
                <button
                  onClick={() => { setEditClient(client); setShowModal(true); }}
                  className="p-2 rounded-button text-sage-400 hover:text-sage-700 hover:bg-sage-100 transition-colors"
                >
                  <Edit2 size={15} />
                </button>
                <button
                  onClick={() => handleDelete(client)}
                  className="p-2 rounded-button text-sage-400 hover:text-danger hover:bg-danger-light transition-colors"
                >
                  <Trash2 size={15} />
                </button>
                <button
                  onClick={() => setSelectedClientId(client.id)}
                  className="p-2 rounded-button text-sage-400 hover:text-wellness-500 hover:bg-wellness-50 transition-colors"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ClientModal
          client={editClient}
          onClose={() => { setShowModal(false); setEditClient(null); }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default ClientsView;
