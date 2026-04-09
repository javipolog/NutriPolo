import React, { useState, useMemo } from 'react';
import {
  ClipboardList, Plus, Edit2, Trash2, X, ChevronDown, ChevronRight,
  Leaf, Download, Mail, FolderDown
} from 'lucide-react';
import { Button, Modal, Input, Textarea, EmptyState, useToast, useConfirm } from './UI';
import useStore, { formatDate, todayISO, generateId } from '../stores/store';
import { useT } from '../i18n';
import { SendEmailModal } from './SendEmailModal';

// ─────────────────────────────────────────────────────────────
// Macro bar: visual distribution of P / C / G
// ─────────────────────────────────────────────────────────────
const MacroBar = ({ proteinas, carbohidratos, grasas }) => {
  const p = parseFloat(proteinas) || 0;
  const c = parseFloat(carbohidratos) || 0;
  const g = parseFloat(grasas) || 0;
  const total = p + c + g;
  if (!total) return null;
  const pct = (n) => ((n / total) * 100).toFixed(1);
  return (
    <div className="mt-2">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        <div style={{ width: `${pct(p)}%` }} className="bg-wellness-400 transition-all" title={`Proteínas ${pct(p)}%`} />
        <div style={{ width: `${pct(c)}%` }} className="bg-coral-400 transition-all" title={`Carbohidratos ${pct(c)}%`} />
        <div style={{ width: `${pct(g)}%` }} className="bg-yellow-400 transition-all" title={`Grasas ${pct(g)}%`} />
      </div>
      <div className="flex gap-3 mt-1 text-[10px] text-sage-500">
        <span><span className="inline-block w-2 h-2 rounded-full bg-wellness-400 mr-1" />P {pct(p)}%</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-coral-400 mr-1" />C {pct(c)}%</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-1" />G {pct(g)}%</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Single meal slot
// ─────────────────────────────────────────────────────────────
const MealSlot = ({ meal, index, onChange, onDelete }) => {
  const [collapsed, setCollapsed] = useState(false);
  const set = (k, v) => onChange({ ...meal, [k]: v });

  const addOption = () => onChange({
    ...meal,
    opciones: [...(meal.opciones || []), { id: generateId(), descripcion: '', alimentos: '', kcalAprox: '', notas: '' }],
  });

  const updateOption = (oid, data) => onChange({
    ...meal,
    opciones: meal.opciones.map(o => o.id === oid ? { ...o, ...data } : o),
  });

  const removeOption = (oid) => onChange({
    ...meal,
    opciones: meal.opciones.filter(o => o.id !== oid),
  });

  return (
    <div className="border border-sage-200 rounded-soft bg-white">
      {/* Meal header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-sage-100">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-sage-400 hover:text-sage-600 transition-colors"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        <div className="flex-1 flex items-center gap-3">
          <input
            value={meal.nombre}
            onChange={e => set('nombre', e.target.value)}
            className="text-sm font-medium text-sage-800 bg-transparent border-none outline-none focus:ring-0 w-40"
            placeholder={`Comida ${index + 1}`}
          />
          <input
            type="time"
            value={meal.hora || ''}
            onChange={e => set('hora', e.target.value)}
            className="text-xs text-sage-500 bg-transparent border-none outline-none focus:ring-0"
          />
        </div>
        <span className="text-xs text-sage-400">{(meal.opciones || []).length} opción{(meal.opciones || []).length !== 1 ? 'es' : ''}</span>
        <button onClick={onDelete} className="p-1 text-sage-300 hover:text-danger transition-colors">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Options */}
      {!collapsed && (
        <div className="p-4 space-y-3">
          {(meal.opciones || []).map((opt, i) => (
            <div key={opt.id} className="border border-sage-100 rounded-button p-3 space-y-2 bg-sage-50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-sage-500">Opción {i + 1}</span>
                <button onClick={() => removeOption(opt.id)} className="text-sage-300 hover:text-danger">
                  <X size={12} />
                </button>
              </div>
              <input
                value={opt.descripcion}
                onChange={e => updateOption(opt.id, { descripcion: e.target.value })}
                className="w-full text-sm text-sage-800 bg-white border border-sage-200 rounded-button px-3 py-1.5 focus:outline-none focus:border-wellness-400"
                placeholder="Descripción corta (ej. Opción con lactosa)"
              />
              <textarea
                value={opt.alimentos}
                onChange={e => updateOption(opt.id, { alimentos: e.target.value })}
                rows={2}
                className="w-full text-sm text-sage-700 bg-white border border-sage-200 rounded-button px-3 py-1.5 focus:outline-none focus:border-wellness-400 resize-none"
                placeholder="Alimentos y cantidades&#10;ej. 40g avena, 200ml leche semidesnatada, 1 plátano..."
              />
              <div className="flex gap-3">
                <div className="w-28">
                  <input
                    type="number"
                    value={opt.kcalAprox}
                    onChange={e => updateOption(opt.id, { kcalAprox: e.target.value })}
                    className="w-full text-xs bg-white border border-sage-200 rounded-button px-2 py-1 focus:outline-none focus:border-wellness-400"
                    placeholder="kcal aprox"
                  />
                </div>
                <input
                  value={opt.notas}
                  onChange={e => updateOption(opt.id, { notas: e.target.value })}
                  className="flex-1 text-xs bg-white border border-sage-200 rounded-button px-2 py-1 focus:outline-none focus:border-wellness-400"
                  placeholder="Notas adicionales..."
                />
              </div>
            </div>
          ))}
          <button
            onClick={addOption}
            className="text-xs text-wellness-500 hover:text-wellness-600 flex items-center gap-1 transition-colors"
          >
            <Plus size={12} /> Añadir opción
          </button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Plan Editor Modal
// ─────────────────────────────────────────────────────────────
const PlanEditorModal = ({ plan, defaultClientId, onClose }) => {
  const clients = useStore(s => s.clients);
  const addNutritionPlan = useStore(s => s.addNutritionPlan);
  const updateNutritionPlan = useStore(s => s.updateNutritionPlan);
  const toast = useToast();
  const t = useT();
  const isEdit = !!plan;

  const [form, setForm] = useState({
    clienteId: defaultClientId || '',
    nombre: '',
    fechaInicio: todayISO(),
    fechaFin: '',
    estado: 'borrador',
    objetivos: '',
    kcalObjetivo: '',
    comidas: [
      { id: generateId(), nombre: 'Desayuno', hora: '08:00', opciones: [] },
      { id: generateId(), nombre: 'Media mañana', hora: '11:00', opciones: [] },
      { id: generateId(), nombre: 'Comida', hora: '14:00', opciones: [] },
      { id: generateId(), nombre: 'Merienda', hora: '17:00', opciones: [] },
      { id: generateId(), nombre: 'Cena', hora: '21:00', opciones: [] },
    ],
    recomendaciones: '',
    suplementos: '',
    observaciones: '',
    ...plan,
    macros: { proteinas: '', carbohidratos: '', grasas: '', ...(plan?.macros || {}) },
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setMacro = (k, v) => setForm(f => ({ ...f, macros: { ...f.macros, [k]: v } }));

  const addMeal = () => set('comidas', [
    ...form.comidas,
    { id: generateId(), nombre: 'Nueva comida', hora: '', opciones: [] },
  ]);

  const updateMeal = (id, data) => set('comidas', form.comidas.map(m => m.id === id ? data : m));
  const deleteMeal = (id) => set('comidas', form.comidas.filter(m => m.id !== id));

  const validate = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = 'Selecciona un cliente';
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    return e;
  };

  const handleSave = (nuevoEstado) => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const data = {
      ...form,
      estado: nuevoEstado || form.estado,
      kcalObjetivo: form.kcalObjetivo ? parseFloat(form.kcalObjetivo) : null,
      macros: {
        proteinas: form.macros.proteinas ? parseFloat(form.macros.proteinas) : null,
        carbohidratos: form.macros.carbohidratos ? parseFloat(form.macros.carbohidratos) : null,
        grasas: form.macros.grasas ? parseFloat(form.macros.grasas) : null,
      },
    };
    if (isEdit) {
      updateNutritionPlan(plan.id, data);
      toast.success('Plan actualizado');
    } else {
      addNutritionPlan(data);
      toast.success('Plan creado');
    }
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Editar plan nutricional' : 'Nuevo plan nutricional'} size="xl">
      <div className="space-y-5 max-h-[72vh] overflow-y-auto pr-1">

        {/* Header info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Cliente *</label>
            <select
              value={form.clienteId}
              onChange={e => set('clienteId', e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 ${errors.clienteId ? 'border-danger' : 'border-sage-300'}`}
            >
              <option value="">Seleccionar cliente...</option>
              {[...clients].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            {errors.clienteId && <p className="text-xs text-danger mt-1">{errors.clienteId}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Nombre del plan *</label>
            <Input
              value={form.nombre}
              onChange={e => set('nombre', e.target.value)}
              error={errors.nombre}
              placeholder="ej. Plan pérdida de grasa — Marzo 2026"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Fecha inicio</label>
            <Input type="date" value={form.fechaInicio} onChange={e => set('fechaInicio', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Fecha fin</label>
            <Input type="date" value={form.fechaFin} onChange={e => set('fechaFin', e.target.value)} />
          </div>
        </div>

        {/* Objectives */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">Objetivos del plan</label>
          <Textarea
            value={form.objetivos}
            onChange={e => set('objetivos', e.target.value)}
            rows={2}
            placeholder="Describe los objetivos principales del plan..."
          />
        </div>

        {/* Macros */}
        <div>
          <h3 className="text-xs font-semibold text-sage-700 mb-3">Distribución de macros</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-sage-500 mb-1">Kcal objetivo/día</label>
              <Input
                type="number"
                value={form.kcalObjetivo}
                onChange={e => set('kcalObjetivo', e.target.value)}
                placeholder="1800"
              />
            </div>
            {[['proteinas', 'Proteínas (g)'], ['carbohidratos', 'Carbohidratos (g)'], ['grasas', 'Grasas (g)']].map(([k, label]) => (
              <div key={k}>
                <label className="block text-xs text-sage-500 mb-1">{label}</label>
                <Input
                  type="number"
                  value={form.macros[k]}
                  onChange={e => setMacro(k, e.target.value)}
                  placeholder="—"
                />
              </div>
            ))}
          </div>
          <MacroBar {...form.macros} />
        </div>

        {/* Meals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-sage-700">Comidas del día</h3>
            <button
              onClick={addMeal}
              className="text-xs text-wellness-500 hover:text-wellness-600 flex items-center gap-1"
            >
              <Plus size={12} /> Añadir comida
            </button>
          </div>
          <div className="space-y-3">
            {form.comidas.map((meal, i) => (
              <MealSlot
                key={meal.id}
                meal={meal}
                index={i}
                onChange={data => updateMeal(meal.id, data)}
                onDelete={() => deleteMeal(meal.id)}
              />
            ))}
          </div>
        </div>

        {/* Recommendations + Supplements */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Recomendaciones generales</label>
            <Textarea
              value={form.recomendaciones}
              onChange={e => set('recomendaciones', e.target.value)}
              rows={4}
              placeholder="Consejos de hábitos, hidratación, masticación, horarios..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Suplementación</label>
            <Textarea
              value={form.suplementos}
              onChange={e => set('suplementos', e.target.value)}
              rows={4}
              placeholder="Suplementos recomendados, dosis, timing..."
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">Observaciones internas</label>
          <Textarea
            value={form.observaciones}
            onChange={e => set('observaciones', e.target.value)}
            rows={2}
            placeholder="Solo visible para ti..."
          />
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-4 border-t border-sage-200 mt-4">
        <div className="flex gap-2">
          {['borrador', 'activo', 'completado'].map(s => (
            <button
              key={s}
              type="button"
              onClick={() => set('estado', s)}
              className={`px-3 py-1 text-xs rounded-badge transition-colors ${
                form.estado === s ? 'bg-wellness-400 text-white' : 'bg-sage-100 text-sage-600 hover:bg-sage-200'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
          <Button variant="primary" onClick={() => handleSave()}>{t.save}</Button>
        </div>
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────
// Status badge colors
// ─────────────────────────────────────────────────────────────
const PLAN_STATUS = {
  borrador:   'bg-warning-light text-warning',
  activo:     'bg-success-light text-success',
  completado: 'bg-sage-100 text-sage-500',
  archivado:  'bg-sage-100 text-sage-400',
};

// ─────────────────────────────────────────────────────────────
// Main view — plan list
// ─────────────────────────────────────────────────────────────
export const NutritionPlanEditor = () => {
  const nutritionPlans = useStore(s => s.nutritionPlans);
  const clients = useStore(s => s.clients);
  const deleteNutritionPlan = useStore(s => s.deleteNutritionPlan);
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const config = useStore(s => s.config);
  const [showModal, setShowModal] = useState(false);
  const [editPlan, setEditPlan] = useState(null);
  const [emailPlan, setEmailPlan] = useState(null);
  const [filterEstado, setFilterEstado] = useState('all');

  const filtered = useMemo(() => {
    return nutritionPlans
      .filter(p => filterEstado === 'all' || p.estado === filterEstado)
      .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  }, [nutritionPlans, filterEstado]);

  const handleDelete = async (plan) => {
    const ok = await confirm(`¿Eliminar el plan "${plan.nombre}"?`);
    if (!ok) return;
    deleteNutritionPlan(plan.id);
    toast.success('Plan eliminado');
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-sage-900">{t.plans_title}</h1>
        <Button variant="primary" icon={Plus} onClick={() => { setEditPlan(null); setShowModal(true); }}>
          {t.new_plan}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 bg-sage-100 p-1 rounded-button w-fit">
        {[['all', 'Todos'], ['borrador', 'Borrador'], ['activo', 'Activo'], ['completado', 'Completado']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilterEstado(id)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              filterEstado === id ? 'bg-white text-sage-800 shadow-sm' : 'text-sage-500 hover:text-sage-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="text-xs text-sage-500">{filtered.length} plan{filtered.length !== 1 ? 'es' : ''}</p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t.no_plans}
          action={{ label: t.new_plan, onClick: () => setShowModal(true) }}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(plan => {
            const client = clients.find(c => c.id === plan.clienteId);
            const totalKcal = plan.comidas?.reduce((sum, meal) =>
              sum + (meal.opciones || []).reduce((s, o) => s + (parseFloat(o.kcalAprox) || 0), 0), 0) || 0;

            return (
              <div key={plan.id} className="bg-white border border-sage-200 rounded-soft shadow-card p-4 flex items-start gap-4 hover:shadow-card-hover transition-shadow">
                <div className="p-2.5 bg-wellness-50 rounded-soft shrink-0">
                  <Leaf size={16} className="text-wellness-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sage-900">{plan.nombre}</p>
                  <p className="text-xs text-sage-500 mt-0.5">{client?.nombre || '—'}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-sage-400">
                    {plan.fechaInicio && <span>{formatDate(plan.fechaInicio)}{plan.fechaFin ? ` → ${formatDate(plan.fechaFin)}` : ''}</span>}
                    {plan.kcalObjetivo && <span>{plan.kcalObjetivo} kcal/día</span>}
                    {plan.comidas?.length > 0 && <span>{plan.comidas.length} comidas</span>}
                  </div>
                  {plan.macros && (plan.macros.proteinas || plan.macros.carbohidratos || plan.macros.grasas) && (
                    <MacroBar {...plan.macros} />
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-badge font-medium mr-1 ${PLAN_STATUS[plan.estado] || 'bg-sage-100 text-sage-500'}`}>
                    {plan.estado}
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        const { generateNutritionPlanPDF } = await import('../services/pdfPlanGenerator');
                        const client = clients.find(c => c.id === plan.clienteId);
                        const bytes = await generateNutritionPlanPDF(plan, client, config);
                        const blob = new Blob([bytes], { type: 'application/pdf' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = `${plan.nombre || 'plan'}.pdf`; a.click();
                        URL.revokeObjectURL(url);
                        toast.success('PDF descargado');
                      } catch (e) { toast.error('Error al generar PDF: ' + e.message); }
                    }}
                    className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                    title="Descargar PDF"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const { generateNutritionPlanPDF } = await import('../services/pdfPlanGenerator');
                        const { saveBytesToDocuments } = await import('../services/documentService');
                        const client = clients.find(c => c.id === plan.clienteId);
                        const bytes = await generateNutritionPlanPDF(plan, client, config);
                        let binary = '';
                        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                        const b64 = btoa(binary);
                        const fileName = `${plan.nombre || 'plan'}.pdf`;
                        const { storedFileName } = await saveBytesToDocuments(plan.clienteId, fileName, b64);
                        const addDoc = useStore.getState().addClientDocument;
                        addDoc({
                          clienteId: plan.clienteId,
                          nombre: plan.nombre || 'Plan nutricional',
                          tipo: 'plan_nutricional',
                          fileName,
                          storedFileName,
                          fileSize: bytes.length,
                          fechaDocumento: todayISO(),
                          notas: '',
                        });
                        toast.success(t.doc_saved_to_client || 'Plan guardado en documentos del cliente');
                      } catch (e) { toast.error('Error: ' + e.message); }
                    }}
                    className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                    title={t.doc_save_to_client || 'Guardar en documentos del cliente'}
                  >
                    <FolderDown size={14} />
                  </button>
                  <button
                    onClick={() => setEmailPlan(plan)}
                    className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                    title="Enviar por email"
                  >
                    <Mail size={14} />
                  </button>
                  <button
                    onClick={() => { setEditPlan(plan); setShowModal(true); }}
                    className="p-1.5 rounded-button text-sage-400 hover:text-sage-700 hover:bg-sage-100 transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(plan)}
                    className="p-1.5 rounded-button text-sage-400 hover:text-danger hover:bg-danger-light transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <PlanEditorModal
          plan={editPlan}
          onClose={() => { setShowModal(false); setEditPlan(null); }}
        />
      )}

      {emailPlan && (
        <SendEmailModal
          mode="plan"
          plan={emailPlan}
          client={clients.find(c => c.id === emailPlan.clienteId)}
          onClose={() => setEmailPlan(null)}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default NutritionPlanEditor;
