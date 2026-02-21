import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Home, FileText, Users, Wallet, Calculator, Settings, Plus, Search, Edit2, Trash2, Eye, Check, Clock, AlertCircle, Calendar, Euro, Copy, Printer, Download, Palette, Command } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { save } from '@tauri-apps/api/dialog';
import { Button, Input, Textarea, Select, Card, Modal, StatCard, StatusBadge, Spinner, EmptyState, ToastProvider, useToast, useConfirm, ConfirmModal } from './components/UI';
import { Dashboard } from './components/Dashboard';
import { Invoices } from './components/Invoices';
import { useStore, generateId, formatCurrency, formatDate, formatDateShort, generateClientCode, generateInvoiceNumber, calcularFactura, getQuarter, defaultCategories, validateNIFOrCIF, validateIBAN, formatIBAN } from './stores/store';
import { DesignEditor } from './components/DesignEditor';
import { InvoicePreviewModern } from './components/InvoicePreview';
import { useDesignStore, loadGoogleFonts } from './stores/designStore';
import { NotionSync, NotionStatusBadge } from './components/NotionSync';
import { useNotionStore } from './stores/notionStore';

// ============================================
// INVOICE PDF PREVIEW (Uses Design Store)
// ============================================


// ============================================
// DASHBOARD VIEW
// ============================================
// ============================================
// DASHBOARD VIEW (NOW IMPORTED)
// ============================================
// Dashboard component is now imported from ./components/Dashboard.jsx

// ============================================
// INVOICES VIEW (NOW IMPORTED)
// ============================================
// Invoices component is now imported from ./components/Invoices.jsx

// Invoice Form Modal


// ============================================
// CLIENTS VIEW
// ============================================
const ClientsView = () => {
  const { clients, invoices, addClient, updateClient, deleteClient } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [search, setSearch] = useState('');
  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const [sortOrder, setSortOrder] = useState('volumeDesc'); // 'volumeDesc', 'nameAsc'

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
          <h1 className="text-2xl font-bold text-white">Clientes</h1>
          <p className="text-slate-400 mt-1">{clients.length} clientes</p>
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
                <span className="bg-blue-600/20 text-blue-400 text-xs font-mono px-2 py-1 rounded">{client.codigo}</span>
                <div className="text-right">
                  <p className="text-white font-semibold">{formatCurrency(stats.total)}</p>
                  <p className="text-slate-500 text-xs">{stats.count} facturas</p>
                </div>
              </div>
              <h3 className="text-white font-medium truncate">{client.nombre}</h3>
              <p className="text-slate-400 text-sm mt-1">{client.cifNif}</p>
              <p className="text-slate-500 text-sm mt-2 line-clamp-2">{client.direccion}</p>
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-800">
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

const ClientModal = ({ open, onClose, onSave, client }) => {
  const [form, setForm] = useState({ nombre: '', cifNif: '', direccion: '', codigo: '', email: '', telefono: '' });
  const [errors, setErrors] = useState({});
  const toast = useToast();

  useEffect(() => {
    if (client) {
      setForm(client);
      setErrors({});
    }
    else {
      setForm({ nombre: '', cifNif: '', direccion: '', codigo: '', email: '', telefono: '' });
      setErrors({});
    }
  }, [client, open]);

  const validateForm = () => {
    const newErrors = {};
    
    if (!form.nombre.trim()) {
      newErrors.nombre = 'El nombre es obligatorio';
    }
    
    if (form.cifNif && !validateNIFOrCIF(form.cifNif)) {
      newErrors.cifNif = 'NIF/CIF no válido';
    }
    
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Email no válido';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => { 
    e.preventDefault(); 
    if (validateForm()) {
      onSave(form);
    } else {
      toast.warning('Por favor, corrige los errores del formulario');
    }
  };
  const suggestedCode = form.nombre ? generateClientCode(form.nombre) : '';

  return (
    <Modal open={open} onClose={onClose} title={client ? 'Editar Cliente' : 'Nuevo Cliente'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input 
          label="Nombre / Razón Social" 
          value={form.nombre} 
          onChange={e => setForm({ ...form, nombre: e.target.value })} 
          required 
          error={errors.nombre}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input 
            label="CIF/NIF" 
            value={form.cifNif} 
            onChange={e => setForm({ ...form, cifNif: e.target.value.toUpperCase() })} 
            error={errors.cifNif}
            placeholder="B12345678"
          />
          <div>
            <Input label="Código" value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase() })} placeholder={suggestedCode} />
            {suggestedCode && !form.codigo && <p className="text-xs text-slate-500 mt-1">Sugerido: {suggestedCode}</p>}
          </div>
        </div>
        <Textarea label="Dirección" value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} rows={3} required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <Input label="Teléfono" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
};

// ============================================
// EXPENSES VIEW
// ============================================
import { ExpensesView } from './components/ExpensesView';



// ============================================
// TAXES VIEW
// ============================================
const TaxesView = () => {
  const { invoices, expenses } = useStore();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState(getQuarter(new Date()));

  const quarterData = useMemo(() => {
    const startMonth = (selectedQuarter - 1) * 3;
    const endMonth = startMonth + 3;

    const qInvoices = invoices.filter(i => {
      const d = new Date(i.fecha);
      return d.getFullYear() === selectedYear && d.getMonth() >= startMonth && d.getMonth() < endMonth && i.estado !== 'anulada';
    });
    const qExpenses = expenses.filter(e => {
      const d = new Date(e.fecha);
      return d.getFullYear() === selectedYear && d.getMonth() >= startMonth && d.getMonth() < endMonth;
    });

    const baseIngresos = qInvoices.reduce((sum, i) => sum + (i.subtotal || 0), 0);
    const ivaRepercutido = qInvoices.reduce((sum, i) => sum + (i.iva || 0), 0);
    const irpfRetenido = qInvoices.reduce((sum, i) => sum + (i.irpf || 0), 0);
    const baseGastos = qExpenses.filter(e => e.deducibleIrpf).reduce((sum, e) => sum + (e.baseImponible || 0), 0);
    const ivaSoportado = qExpenses.filter(e => e.deducibleIva).reduce((sum, e) => sum + (e.ivaImporte || 0), 0);

    const resultado303 = ivaRepercutido - ivaSoportado;
    const rendimiento = baseIngresos - baseGastos;
    const resultado130 = Math.max(0, rendimiento * 0.20 - irpfRetenido);

    return { baseIngresos, ivaRepercutido, irpfRetenido, baseGastos, ivaSoportado, resultado303, rendimiento, resultado130, numFacturas: qInvoices.length, numGastos: qExpenses.length };
  }, [invoices, expenses, selectedYear, selectedQuarter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Impuestos</h1>
          <p className="text-slate-400 mt-1">Cálculo de modelos trimestrales</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedQuarter} onChange={e => setSelectedQuarter(parseInt(e.target.value))} options={[1, 2, 3, 4].map(q => ({ value: q, label: `T${q}` }))} />
          <Select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))} options={[currentYear - 1, currentYear, currentYear + 1].map(y => ({ value: y, label: y.toString() }))} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700"><Calculator size={24} className="text-white" /></div>
            <div><h3 className="text-lg font-semibold text-white">Modelo 303 - IVA</h3><p className="text-slate-400 text-sm">Declaración trimestral</p></div>
          </div>
          <div className="space-y-3">
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">IVA Repercutido ({quarterData.numFacturas} facturas)</p>
              <p className="text-xl font-semibold text-white mt-1">{formatCurrency(quarterData.ivaRepercutido)}</p>
            </div>
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">IVA Soportado ({quarterData.numGastos} gastos)</p>
              <p className="text-xl font-semibold text-white mt-1">-{formatCurrency(quarterData.ivaSoportado)}</p>
            </div>
            <div className={`p-4 rounded-xl ${quarterData.resultado303 >= 0 ? 'bg-red-900/30 border border-red-800' : 'bg-emerald-900/30 border border-emerald-800'}`}>
              <p className="text-sm text-slate-400">Resultado</p>
              <p className={`text-2xl font-bold mt-1 ${quarterData.resultado303 >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatCurrency(Math.abs(quarterData.resultado303))}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gradient-to-br from-amber-600 to-amber-700"><FileText size={24} className="text-white" /></div>
            <div><h3 className="text-lg font-semibold text-white">Modelo 130 - IRPF</h3><p className="text-slate-400 text-sm">Pago fraccionado</p></div>
          </div>
          <div className="space-y-3">
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">Ingresos</p>
              <p className="text-xl font-semibold text-white mt-1">{formatCurrency(quarterData.baseIngresos)}</p>
            </div>
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">Gastos deducibles</p>
              <p className="text-xl font-semibold text-white mt-1">-{formatCurrency(quarterData.baseGastos)}</p>
            </div>
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">Retenciones</p>
              <p className="text-xl font-semibold text-white mt-1">-{formatCurrency(quarterData.irpfRetenido)}</p>
            </div>
            <div className={`p-4 rounded-xl ${quarterData.resultado130 >= 0 ? 'bg-red-900/30 border border-red-800' : 'bg-emerald-900/30 border border-emerald-800'}`}>
              <p className="text-sm text-slate-400">Resultado (20% - retenciones)</p>
              <p className={`text-2xl font-bold mt-1 ${quarterData.resultado130 >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatCurrency(quarterData.resultado130)}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Fechas de presentación {selectedYear}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[{ q: 1, date: '20 abril' }, { q: 2, date: '20 julio' }, { q: 3, date: '20 octubre' }, { q: 4, date: '30 enero' }].map(({ q, date }) => (
            <div key={q} className={`p-4 rounded-xl border ${q === selectedQuarter ? 'bg-blue-900/30 border-blue-700' : 'bg-slate-800/30 border-slate-700'}`}>
              <p className="text-sm font-medium text-slate-400">T{q}</p>
              <p className="text-white font-semibold mt-1">{date}</p>
              {q === selectedQuarter && <span className="inline-block mt-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded">Actual</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ============================================
// SETTINGS VIEW
// ============================================
const SettingsView = () => {
  const { config, setConfig } = useStore();
  const [form, setForm] = useState(config);
  const [errors, setErrors] = useState({});
  const toast = useToast();

  useEffect(() => { setForm(config); }, [config]);

  const validateForm = () => {
    const newErrors = {};
    
    if (form.nif && !validateNIFOrCIF(form.nif)) {
      newErrors.nif = 'NIF/CIF no válido';
    }
    
    if (form.iban && !validateIBAN(form.iban.replace(/\s/g, ''))) {
      newErrors.iban = 'IBAN no válido';
    }
    
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Email no válido';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateForm()) {
      // Format IBAN before saving
      const formattedForm = {
        ...form,
        iban: form.iban ? formatIBAN(form.iban) : ''
      };
      setConfig(formattedForm);
      toast.success('Configuración guardada correctamente');
    } else {
      toast.error('Por favor, corrige los errores del formulario');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Configuración</h1>
        <p className="text-slate-400 mt-1">Datos del autónomo y preferencias</p>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Datos personales</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Nombre / Razón Social" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
          <Input 
            label="NIF" 
            value={form.nif} 
            onChange={e => setForm({ ...form, nif: e.target.value.toUpperCase() })} 
            error={errors.nif}
          />
          <Textarea label="Dirección" value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} rows={2} className="md:col-span-2" />
          <Input 
            label="Email" 
            type="email" 
            value={form.email} 
            onChange={e => setForm({ ...form, email: e.target.value })} 
            error={errors.email}
          />
          <Input label="Teléfono" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
          <Input label="Web" value={form.web} onChange={e => setForm({ ...form, web: e.target.value })} />
          <Input 
            label="IBAN" 
            value={form.iban} 
            onChange={e => setForm({ ...form, iban: e.target.value.toUpperCase() })} 
            error={errors.iban}
            placeholder="ES00 0000 0000 0000 0000 0000"
          />
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Valores por defecto</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input label="IVA (%)" type="number" value={form.tipoIva} onChange={e => setForm({ ...form, tipoIva: parseFloat(e.target.value) || 0 })} />
          <Input label="IRPF (%)" type="number" value={form.tipoIrpf} onChange={e => setForm({ ...form, tipoIrpf: parseFloat(e.target.value) || 0 })} />
          <Select label="Idioma por defecto" value={form.idiomaDefecto} onChange={e => setForm({ ...form, idiomaDefecto: e.target.value })} options={[{ value: 'es', label: 'Castellano' }, { value: 'ca', label: 'Català' }]} />
        </div>
      </Card>

      <div className="flex items-center justify-end gap-4">
        <Button onClick={handleSave} icon={Check}>Guardar Configuración</Button>
      </div>

      {/* Sincronización con Notion */}
      <div className="pt-6 border-t border-slate-800">
        <h3 className="text-lg font-semibold text-white mb-4">Integración con Notion</h3>
        <NotionSync />
      </div>
    </div>
  );
};

// ============================================
// MAIN APP
// ============================================
function AppContent() {
  const { currentView, setCurrentView, config, isLoading } = useStore();
  const toast = useToast();

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard', shortcut: '1' },
    { id: 'invoices', icon: FileText, label: 'Facturas', shortcut: '2' },
    { id: 'clients', icon: Users, label: 'Clientes', shortcut: '3' },
    { id: 'expenses', icon: Wallet, label: 'Gastos', shortcut: '4' },
    { id: 'taxes', icon: Calculator, label: 'Impuestos', shortcut: '5' },
    { id: 'design', icon: Palette, label: 'Diseño', shortcut: '6' },
    { id: 'settings', icon: Settings, label: 'Configuración', shortcut: '7' }
  ];

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyboard = (e) => {
      // Only handle shortcuts when not in input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
          case '1': e.preventDefault(); setCurrentView('dashboard'); break;
          case '2': e.preventDefault(); setCurrentView('invoices'); break;
          case '3': e.preventDefault(); setCurrentView('clients'); break;
          case '4': e.preventDefault(); setCurrentView('expenses'); break;
          case '5': e.preventDefault(); setCurrentView('taxes'); break;
          case '6': e.preventDefault(); setCurrentView('design'); break;
          case '7': e.preventDefault(); setCurrentView('settings'); break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [setCurrentView]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="text-slate-400 mt-4">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center">
              <Euro size={20} className="text-white" />
            </div>
            Contabilidad
          </h1>
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {navItems.map(item => (
              <li key={item.id}>
                <button
                  onClick={() => setCurrentView(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group ${currentView === item.id
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  title={`${item.label} (Ctrl+${item.shortcut})`}
                >
                  <item.icon size={20} />
                  <span className="flex-1 text-left">{item.label}</span>
                  <kbd className={`text-[10px] px-1.5 py-0.5 rounded ${
                    currentView === item.id 
                      ? 'bg-blue-500/30 text-blue-200' 
                      : 'bg-slate-800 text-slate-500 group-hover:bg-slate-700 group-hover:text-slate-400'
                  }`}>
                    {item.shortcut}
                  </kbd>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="bg-slate-800/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-white truncate">{config.nombre}</p>
              <NotionStatusBadge />
            </div>
            <p className="text-xs text-slate-500">{config.nif}</p>
          </div>
          
          {/* Keyboard shortcuts hint */}
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-600">
            <Command size={10} />
            <span>+ número para navegar</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        {currentView === 'dashboard' && <Dashboard />}
        {currentView === 'invoices' && <Invoices />}
        {currentView === 'clients' && <ClientsView />}
        {currentView === 'expenses' && <ExpensesView />}
        {currentView === 'taxes' && <TaxesView />}
        {currentView === 'design' && <DesignEditor />}
        {currentView === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
