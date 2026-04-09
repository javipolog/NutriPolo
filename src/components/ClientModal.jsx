import React, { useState, useEffect } from 'react';
import { Button, Input, Textarea, Select, Modal, useToast } from './UI';
import useStore, { generateId } from '../stores/store';
import { useT } from '../i18n';

const OBJECTIVES = [
  { id: 'perdida_grasa',        label: 'Pérdida de grasa' },
  { id: 'ganancia_muscular',    label: 'Ganancia muscular' },
  { id: 'mejora_digestiva',     label: 'Mejora digestiva' },
  { id: 'rendimiento_deportivo',label: 'Rendimiento deportivo' },
  { id: 'dietoterapia',         label: 'Dietoterapia' },
  { id: 'relacion_alimentacion',label: 'Relación con la alimentación' },
];

const DIET_RESTRICTIONS = [
  { id: 'vegetariano',  label: 'Vegetariano' },
  { id: 'vegano',       label: 'Vegano' },
  { id: 'sin_gluten',   label: 'Sin gluten' },
  { id: 'sin_lactosa',  label: 'Sin lactosa' },
  { id: 'sin_cerdo',    label: 'Sin cerdo' },
  { id: 'halal',        label: 'Halal' },
];

const MultiSelect = ({ options, value = [], onChange, placeholder }) => {
  const toggle = (id) => {
    const next = value.includes(id) ? value.filter(x => x !== id) : [...value, id];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-1.5 p-2 border border-sage-300 rounded-button min-h-9 bg-white">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => toggle(opt.id)}
          className={`text-xs px-2.5 py-1 rounded-badge transition-colors ${
            value.includes(opt.id)
              ? 'bg-wellness-400 text-white'
              : 'bg-sage-100 text-sage-600 hover:bg-sage-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

const TagInput = ({ value = [], onChange, placeholder }) => {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setInput('');
  };
  const remove = (tag) => onChange(value.filter(t => t !== tag));
  return (
    <div className="border border-sage-300 rounded-button p-2 bg-white min-h-9">
      <div className="flex flex-wrap gap-1 mb-1">
        {value.map(tag => (
          <span key={tag} className="flex items-center gap-1 text-xs bg-sage-100 text-sage-700 px-2 py-0.5 rounded-badge">
            {tag}
            <button type="button" onClick={() => remove(tag)} className="text-sage-400 hover:text-danger ml-0.5">&times;</button>
          </span>
        ))}
      </div>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={placeholder}
        className="text-xs outline-none w-full bg-transparent text-sage-700 placeholder-sage-400"
      />
    </div>
  );
};

export const ClientModal = ({ client, onClose }) => {
  const addClient = useStore(s => s.addClient);
  const updateClient = useStore(s => s.updateClient);
  const toast = useToast();
  const t = useT();

  const isEdit = !!client;

  const [form, setForm] = useState({
    nombre: '', email: '', telefono: '', whatsapp: '', nif: '',
    calle: '', codigoPostal: '', ciudad: '', provincia: '',
    fechaNacimiento: '', genero: '',
    altura: '', medicacion: '',
    nivelActividad: 'moderado', ejercicio: '',
    notas: '', estado: 'activo',
    alergias: [], intolerancias: [], patologias: [],
    objetivos: [], restriccionesDieteticas: [],
    ...client,
  });
  const [errors, setErrors] = useState({});
  const [section, setSection] = useState('personal');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = t.error_required;
    return e;
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const data = { ...form, altura: form.altura ? parseFloat(form.altura) : null };
    if (isEdit) {
      updateClient(client.id, data);
      toast.success('Cliente actualizado');
    } else {
      addClient(data);
      toast.success('Cliente creado');
    }
    onClose();
  };

  const SECTIONS = [
    { id: 'personal', label: 'Datos personales' },
    { id: 'health',   label: 'Salud' },
    { id: 'goals',    label: 'Objetivos' },
    { id: 'notes',    label: 'Notas' },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Editar — ${client.nombre}` : t.new_client}
      size="lg"
    >
      {/* Section tabs */}
      <div className="flex gap-1 mb-5 border-b border-sage-200 pb-0">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              section === s.id
                ? 'border-wellness-400 text-wellness-600'
                : 'border-transparent text-sage-500 hover:text-sage-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'personal' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_name} *</label>
            <Input value={form.nombre} onChange={e => set('nombre', e.target.value)} error={errors.nombre} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.email}</label>
            <Input value={form.email} onChange={e => set('email', e.target.value)} type="email" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.phone}</label>
            <Input value={form.telefono} onChange={e => set('telefono', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.whatsapp}</label>
            <Input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="Sin prefijo +34" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_nif}</label>
            <Input value={form.nif} onChange={e => set('nif', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_street}</label>
            <Input value={form.calle} onChange={e => set('calle', e.target.value)} placeholder="Calle, número, piso..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_postal_code}</label>
            <Input value={form.codigoPostal} onChange={e => set('codigoPostal', e.target.value)} placeholder="46001" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_city}</label>
            <Input value={form.ciudad} onChange={e => set('ciudad', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_province}</label>
            <Input value={form.provincia} onChange={e => set('provincia', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_birth}</label>
            <Input value={form.fechaNacimiento} onChange={e => set('fechaNacimiento', e.target.value)} type="date" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_gender}</label>
            <select
              value={form.genero}
              onChange={e => set('genero', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
            >
              <option value="">Seleccionar</option>
              <option value="M">{t.client_gender_m}</option>
              <option value="F">{t.client_gender_f}</option>
              <option value="otro">{t.client_gender_other}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_status}</label>
            <select
              value={form.estado}
              onChange={e => set('estado', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
            >
              <option value="activo">{t.client_status_active}</option>
              <option value="inactivo">{t.client_status_inactive}</option>
              <option value="alta">{t.client_status_alta}</option>
            </select>
          </div>
        </div>
      )}

      {section === 'health' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_height}</label>
              <Input value={form.altura} onChange={e => set('altura', e.target.value)} type="number" placeholder="170" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_activity}</label>
              <select
                value={form.nivelActividad}
                onChange={e => set('nivelActividad', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
              >
                <option value="sedentario">{t.activity_sedentary}</option>
                <option value="ligero">{t.activity_light}</option>
                <option value="moderado">{t.activity_moderate}</option>
                <option value="activo">{t.activity_active}</option>
                <option value="muy_activo">{t.activity_very_active}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_allergies} <span className="text-sage-400">(Enter para añadir)</span></label>
            <TagInput value={form.alergias} onChange={v => set('alergias', v)} placeholder="Frutos secos, marisco..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_intolerances}</label>
            <TagInput value={form.intolerancias} onChange={v => set('intolerancias', v)} placeholder="Lactosa, gluten..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_pathologies}</label>
            <TagInput value={form.patologias} onChange={v => set('patologias', v)} placeholder="SIBO, hipotiroidismo..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_medication}</label>
            <Textarea value={form.medicacion} onChange={e => set('medicacion', e.target.value)} rows={2} placeholder="Medicación actual..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_exercise}</label>
            <Textarea value={form.ejercicio} onChange={e => set('ejercicio', e.target.value)} rows={2} placeholder="Tipo de ejercicio y frecuencia..." />
          </div>
        </div>
      )}

      {section === 'goals' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-2">{t.client_goals}</label>
            <MultiSelect options={OBJECTIVES} value={form.objetivos} onChange={v => set('objetivos', v)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-2">{t.client_diet_restrictions}</label>
            <MultiSelect options={DIET_RESTRICTIONS} value={form.restriccionesDieteticas} onChange={v => set('restriccionesDieteticas', v)} />
          </div>
        </div>
      )}

      {section === 'notes' && (
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.client_private_notes}</label>
          <Textarea
            value={form.notas}
            onChange={e => set('notas', e.target.value)}
            rows={8}
            placeholder="Observaciones privadas sobre el cliente..."
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t border-sage-200 mt-5">
        <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
        <Button variant="primary" onClick={handleSave}>{t.save}</Button>
      </div>
    </Modal>
  );
};

export default ClientModal;
