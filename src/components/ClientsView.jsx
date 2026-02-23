import React, { useState, useMemo } from 'react';
import { Users, Plus, Edit2, Trash2, Search } from 'lucide-react';
import { Button, Input, Select, Card, EmptyState, useToast, useConfirm } from './UI';
import { useStore, formatCurrency, generateId, generateClientCode, validateNIFOrCIF } from '../stores/store';
import { ClientModal } from './ClientModal';

export const ClientsView = () => {
  const { clients, invoices, addClient, updateClient, deleteClient } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [search, setSearch] = useState('');
  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const [sortOrder, setSortOrder] = useState('volumeDesc');

  const clientStats = useMemo(() => {
    const stats = {};
    clients.forEach(c => {
      const clientInvoices = invoices.filter(i => i.clienteId === c.id && i.estado !== 'anulada');
      stats[c.id] = {
        count: clientInvoices.length,
        total: clientInvoices.reduce((sum, i) => sum + (i.total || 0), 0)
      };
    });
    return stats;
  }, [clients, invoices]);

  const filteredClients = useMemo(() => {
    let result = clients.filter(c =>
      c.nombre?.toLowerCase().includes(search.toLowerCase()) || c.cifNif?.toLowerCase().includes(search.toLowerCase())
    );

    if (sortOrder === 'volumeDesc') {
      result.sort((a, b) => (clientStats[b.id]?.total || 0) - (clientStats[a.id]?.total || 0));
    } else {
      result.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    return result;
  }, [clients, search, sortOrder, clientStats]);

  const openNew = () => { setEditingClient(null); setShowModal(true); };
  const openEdit = (client) => { setEditingClient(client); setShowModal(true); };

  const saveClient = (data) => {
    if (editingClient) {
      updateClient(editingClient.id, data);
      toast.success('Cliente actualizado correctamente');
    } else {
      const codigo = data.codigo || generateClientCode(data.nombre);
      addClient({ ...data, id: generateId(), codigo });
      toast.success('Cliente creado correctamente');
    }
    setShowModal(false);
  };

  const handleDelete = async (id) => {
    if (invoices.some(i => i.clienteId === id)) {
      toast.error('No se puede eliminar un cliente con facturas asociadas');
      return;
    }

    const confirmed = await confirm({
      title: 'Eliminar cliente',
      message: '¿Estás seguro de que quieres eliminar este cliente? Esta acción no se puede deshacer.',
      danger: true
    });

    if (confirmed) {
      deleteClient(id);
      toast.success('Cliente eliminado');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-sand-900">Clientes</h1>
          <p className="text-sand-600 mt-1">{clients.length} clientes</p>
        </div>
        <Button icon={Plus} onClick={openNew}>Nuevo Cliente</Button>
      </div>

      <Card className="p-4 flex gap-4">
        <Input icon={Search} placeholder="Buscar clientes..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1" />
        <Select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
          options={[
            { value: 'volumeDesc', label: 'Por Volumen (€)' },
            { value: 'nameAsc', label: 'Por Nombre (A-Z)' }
          ]}
          className="w-48"
        />
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredClients.map(client => {
          const stats = clientStats[client.id] || { count: 0, total: 0 };
          return (
            <Card key={client.id} className="p-6" hover>
              <div className="flex items-start justify-between mb-3">
                <span className="bg-terra-400/20 text-terra-400 text-xs font-mono px-2 py-1 rounded">{client.codigo}</span>
                <div className="text-right">
                  <p className="text-sand-900 font-semibold">{formatCurrency(stats.total)}</p>
                  <p className="text-sand-500 text-xs">{stats.count} facturas</p>
                </div>
              </div>
              <h3 className="text-sand-900 font-medium truncate">{client.nombre}</h3>
              <p className="text-sand-600 text-sm mt-1">{client.cifNif}</p>
              <p className="text-sand-500 text-sm mt-2 line-clamp-2">{client.direccion}</p>
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-sand-300">
                <Button variant="ghost" size="sm" icon={Edit2} onClick={() => openEdit(client)}>Editar</Button>
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDelete(client.id)}>Eliminar</Button>
              </div>
            </Card>
          );
        })}
        {filteredClients.length === 0 && (
          <Card className="col-span-full p-12">
            <EmptyState icon={Users} title="No hay clientes" description="Añade tu primer cliente para empezar" action={<Button icon={Plus} onClick={openNew}>Añadir Cliente</Button>} />
          </Card>
        )}
      </div>

      <ClientModal open={showModal} onClose={() => setShowModal(false)} onSave={saveClient} client={editingClient} />
      {ConfirmDialog}
    </div>
  );
};
