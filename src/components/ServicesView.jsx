import React, { useState } from 'react';
import { Package, Plus, Edit2, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button, Modal, Input, Textarea, EmptyState, useToast, useConfirm } from './UI';
import useStore, { formatCurrency } from '../stores/store';
import { useT } from '../i18n';

const ServiceModal = ({ service, onClose }) => {
  const addService = useStore(s => s.addService);
  const updateService = useStore(s => s.updateService);
  const t = useT();
  const toast = useToast();
  const isEdit = !!service;

  const [form, setForm] = useState({
    nombre: '', descripcion: '', precio: '', numSesiones: '1', duracion: '45', activo: true,
    ...service,
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    if (!form.precio) e.precio = 'Requerido';
    if (Object.keys(e).length) { setErrors(e); return; }
    const data = { ...form, precio: parseFloat(form.precio), numSesiones: parseInt(form.numSesiones) || 1, duracion: parseInt(form.duracion) || 45 };
    if (isEdit) { updateService(service.id, data); toast.success('Servicio actualizado'); }
    else { addService(data); toast.success('Servicio creado'); }
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Editar servicio' : 'Nuevo servicio'}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.service_name} *</label>
          <Input value={form.nombre} onChange={e => set('nombre', e.target.value)} error={errors.nombre} />
        </div>
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.service_description}</label>
          <Textarea value={form.descripcion} onChange={e => set('descripcion', e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.service_price} *</label>
            <Input value={form.precio} onChange={e => set('precio', e.target.value)} type="number" error={errors.precio} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.service_sessions}</label>
            <Input value={form.numSesiones} onChange={e => set('numSesiones', e.target.value)} type="number" min="1" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.service_duration}</label>
            <Input value={form.duracion} onChange={e => set('duracion', e.target.value)} type="number" />
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-sage-200 mt-4">
        <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
        <Button variant="primary" onClick={handleSave}>{t.save}</Button>
      </div>
    </Modal>
  );
};

export const ServicesView = () => {
  const services = useStore(s => s.services);
  const updateService = useStore(s => s.updateService);
  const deleteService = useStore(s => s.deleteService);
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editService, setEditService] = useState(null);

  const handleDelete = async (svc) => {
    const ok = await confirm(`¿Eliminar servicio "${svc.nombre}"?`);
    if (!ok) return;
    deleteService(svc.id);
    toast.success('Servicio eliminado');
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-sage-900">{t.services_title}</h1>
        <Button variant="primary" icon={Plus} onClick={() => { setEditService(null); setShowModal(true); }}>
          {t.new_service}
        </Button>
      </div>

      {services.length === 0 ? (
        <EmptyState icon={Package} title={t.no_services} action={{ label: t.new_service, onClick: () => setShowModal(true) }} />
      ) : (
        <div className="grid gap-3">
          {services.map(svc => (
            <div key={svc.id} className={`bg-white border rounded-soft shadow-card p-4 flex items-center gap-4 ${svc.activo ? 'border-sage-200' : 'border-sage-100 opacity-60'}`}>
              <div className={`p-2.5 rounded-soft ${svc.activo ? 'bg-wellness-50' : 'bg-sage-100'}`}>
                <Package size={18} className={svc.activo ? 'text-wellness-400' : 'text-sage-400'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sage-900">{svc.nombre}</p>
                {svc.descripcion && <p className="text-xs text-sage-400 mt-0.5 truncate">{svc.descripcion}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-sage-500">
                  <span>{svc.numSesiones > 1 ? `${svc.numSesiones} sesiones` : '1 sesión'}</span>
                  <span>·</span>
                  <span>{svc.duracion} min</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-lg text-sage-800">{formatCurrency(svc.precio)}</p>
                {svc.numSesiones > 1 && (
                  <p className="text-xs text-sage-400">{formatCurrency(svc.precio / svc.numSesiones)}/sesión</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => updateService(svc.id, { activo: !svc.activo })}
                  className="p-2 rounded-button text-sage-400 hover:text-sage-700 transition-colors"
                  title={svc.activo ? 'Desactivar' : 'Activar'}
                >
                  {svc.activo ? <ToggleRight size={16} className="text-wellness-400" /> : <ToggleLeft size={16} />}
                </button>
                <button onClick={() => { setEditService(svc); setShowModal(true); }} className="p-2 rounded-button text-sage-400 hover:text-sage-700 transition-colors">
                  <Edit2 size={15} />
                </button>
                <button onClick={() => handleDelete(svc)} className="p-2 rounded-button text-sage-400 hover:text-danger transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ServiceModal service={editService} onClose={() => { setShowModal(false); setEditService(null); }} />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default ServicesView;
