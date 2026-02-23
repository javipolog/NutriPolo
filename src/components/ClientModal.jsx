import React, { useState, useEffect } from 'react';
import { Button, Input, Textarea, Modal, useToast } from './UI';
import { generateClientCode, validateNIFOrCIF } from '../stores/store';

export const ClientModal = ({ open, onClose, onSave, client }) => {
  const [form, setForm] = useState({ nombre: '', cifNif: '', direccion: '', codigo: '', email: '', telefono: '' });
  const [errors, setErrors] = useState({});
  const toast = useToast();

  useEffect(() => {
    if (client) {
      setForm(client);
      setErrors({});
    } else {
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
            {suggestedCode && !form.codigo && <p className="text-xs text-sand-500 mt-1">Sugerido: {suggestedCode}</p>}
          </div>
        </div>
        <Textarea label="Dirección" value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} rows={3} required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} error={errors.email} />
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
