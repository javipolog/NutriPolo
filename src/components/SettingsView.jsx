import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { Button, Input, Textarea, Select, Card, useToast } from './UI';
import { useStore, validateNIFOrCIF, validateIBAN, formatIBAN } from '../stores/store';
import { NotionSync } from './NotionSync';

export const SettingsView = () => {
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
