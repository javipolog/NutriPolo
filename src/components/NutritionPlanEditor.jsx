import React, { useState, useMemo } from 'react';
import {
  ClipboardList, Plus, Edit2, Trash2, X, ChevronDown, ChevronRight,
  Leaf, Download, Mail, FolderDown, CopyPlus
} from 'lucide-react';
import { Button, Modal, Input, Textarea, EmptyState, SegmentedControl, useToast, useConfirm } from './UI';
import { invoke } from '@tauri-apps/api/tauri';
import useStore, { formatDate, todayISO, generateId, errMsg } from '../stores/store';
import { useT, plural } from '../i18n';
import { SendEmailModal } from './SendEmailModal';
import { PlanificacionEditor } from './plan/PlanificacionEditor';
import { PLAN_FORMAT, planificacionStats } from '../services/planificacion';
import { generatePlanPdf, planPdfFileName } from '../services/planPdf';

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
        <div style={{ width: `${pct(c)}%` }} className="bg-terra-500 transition-all" title={`Carbohidratos ${pct(c)}%`} />
        <div style={{ width: `${pct(g)}%` }} className="bg-warning transition-all" title={`Grasas ${pct(g)}%`} />
      </div>
      <div className="flex gap-3 mt-1 text-[11px] text-sage-500">
        <span><span className="inline-block w-2 h-2 rounded-full bg-wellness-400 mr-1" />P {pct(p)}%</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-terra-500 mr-1" />C {pct(c)}%</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-warning mr-1" />G {pct(g)}%</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Single meal slot
// ─────────────────────────────────────────────────────────────
const MealSlot = ({ meal, index, onChange, onDelete }) => {
  const t = useT();
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
        <span className="text-xs text-sage-400">{plural(t, 'plan_option_count', (meal.opciones || []).length)}</span>
        <button onClick={onDelete} aria-label={t.plan_delete_meal} title={t.plan_delete_meal} className="p-1 text-sage-300 hover:text-danger transition-colors">
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
                <button onClick={() => removeOption(opt.id)} aria-label={t.plan_remove_option} title={t.plan_remove_option} className="text-sage-300 hover:text-danger">
                  <X size={12} />
                </button>
              </div>
              <input
                value={opt.descripcion}
                onChange={e => updateOption(opt.id, { descripcion: e.target.value })}
                className="w-full text-sm text-sage-800 bg-white border border-sage-200 rounded-button px-3 py-1.5 focus:outline-none focus:border-wellness-400"
                placeholder={t.plan_option_desc_placeholder}
              />
              <textarea
                value={opt.alimentos}
                onChange={e => updateOption(opt.id, { alimentos: e.target.value })}
                rows={2}
                className="w-full text-sm text-sage-700 bg-white border border-sage-200 rounded-button px-3 py-1.5 focus:outline-none focus:border-wellness-400 resize-none"
                placeholder={t.plan_option_foods_placeholder}
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
                  placeholder={t.plan_option_notes_placeholder}
                />
              </div>
            </div>
          ))}
          <button
            onClick={addOption}
            className="text-xs text-wellness-500 hover:text-wellness-600 flex items-center gap-1 transition-colors"
          >
            <Plus size={12} /> {t.plan_add_option}
          </button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Plan Editor Modal (plans per àpats, format antic)
// ─────────────────────────────────────────────────────────────
const LegacyPlanEditorModal = ({ plan, defaultClientId, onClose }) => {
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
      { id: generateId(), nombre: t.meal_breakfast, hora: '08:00', opciones: [] },
      { id: generateId(), nombre: t.meal_mid_morning, hora: '11:00', opciones: [] },
      { id: generateId(), nombre: t.meal_lunch, hora: '14:00', opciones: [] },
      { id: generateId(), nombre: t.meal_snack, hora: '17:00', opciones: [] },
      { id: generateId(), nombre: t.meal_dinner, hora: '21:00', opciones: [] },
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
    { id: generateId(), nombre: t.meal_new, hora: '', opciones: [] },
  ]);

  const updateMeal = (id, data) => set('comidas', form.comidas.map(m => m.id === id ? data : m));
  const deleteMeal = (id) => set('comidas', form.comidas.filter(m => m.id !== id));

  const validate = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = t.select_client_error;
    if (!form.nombre.trim()) e.nombre = t.error_required;
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
      toast.success(t.plan_updated);
    } else {
      addNutritionPlan(data);
      toast.success(t.plan_created);
    }
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t.plan_edit : t.plan_new_title}
      size="xl"
      footer={
        <div className="flex items-center justify-between">
          <SegmentedControl
            ariaLabel={t.plan_status}
            value={form.estado}
            onChange={v => set('estado', v)}
            options={[
              { value: 'borrador',   label: t.plan_status_draft },
              { value: 'activo',     label: t.plan_status_active },
              { value: 'completado', label: t.plan_status_completed },
            ]}
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
            <Button variant="primary" onClick={() => handleSave()}>{t.save}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 max-h-[72vh] overflow-y-auto pr-1">

        {/* Header info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_client} *</label>
            <select
              value={form.clienteId}
              onChange={e => set('clienteId', e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 ${errors.clienteId ? 'border-danger' : 'border-sage-300'}`}
            >
              <option value="">{t.select_client_placeholder}</option>
              {[...clients].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            {errors.clienteId && <p className="text-xs text-danger mt-1">{errors.clienteId}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_name} *</label>
            <Input
              value={form.nombre}
              onChange={e => set('nombre', e.target.value)}
              error={errors.nombre}
              placeholder={t.plan_name_placeholder}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_start}</label>
            <Input type="date" value={form.fechaInicio} onChange={e => set('fechaInicio', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_end}</label>
            <Input type="date" value={form.fechaFin} onChange={e => set('fechaFin', e.target.value)} />
          </div>
        </div>

        {/* Objectives */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_objectives}</label>
          <Textarea
            value={form.objetivos}
            onChange={e => set('objetivos', e.target.value)}
            rows={2}
            placeholder={t.plan_objectives_placeholder}
          />
        </div>

        {/* Macros */}
        <div>
          <h3 className="text-xs font-semibold text-sage-700 mb-3">{t.plan_macros}</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-sage-500 mb-1">{t.plan_kcal_day}</label>
              <Input
                type="number"
                value={form.kcalObjetivo}
                onChange={e => set('kcalObjetivo', e.target.value)}
                placeholder="1800"
              />
            </div>
            {[['proteinas', t.plan_macros_protein], ['carbohidratos', t.plan_macros_carbs], ['grasas', t.plan_macros_fats]].map(([k, label]) => (
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
            <h3 className="text-xs font-semibold text-sage-700">{t.plan_meals}</h3>
            <button
              onClick={addMeal}
              className="text-xs text-wellness-500 hover:text-wellness-600 flex items-center gap-1"
            >
              <Plus size={12} /> {t.plan_add_meal}
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
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_recommendations}</label>
            <Textarea
              value={form.recomendaciones}
              onChange={e => set('recomendaciones', e.target.value)}
              rows={4}
              placeholder={t.plan_recommendations_placeholder}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_supplements}</label>
            <Textarea
              value={form.suplementos}
              onChange={e => set('suplementos', e.target.value)}
              rows={4}
              placeholder={t.plan_supplements_placeholder}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.plan_internal_notes}</label>
          <Textarea
            value={form.observaciones}
            onChange={e => set('observaciones', e.target.value)}
            rows={2}
            placeholder={t.only_you_placeholder}
          />
        </div>
      </div>
    </Modal>
  );
};

// Les planificacions (format nou) s'editen a pantalla completa; els plans
// antics per àpats conserven el seu formulari.
export const PlanEditorModal = ({ plan, defaultClientId, basePlan, onClose }) => (
  plan && plan.formato !== PLAN_FORMAT
    ? <LegacyPlanEditorModal plan={plan} defaultClientId={defaultClientId} onClose={onClose} />
    : <PlanificacionEditor plan={plan} defaultClientId={defaultClientId} basePlan={basePlan} onClose={onClose} />
);

// ─────────────────────────────────────────────────────────────
// Status badge colors
// ─────────────────────────────────────────────────────────────
const PLAN_STATUS = {
  borrador:   'bg-warning-light text-warning',
  activo:     'bg-success-light text-success',
  completado: 'bg-sage-100 text-sage-500',
  archivado:  'bg-sage-100 text-sage-400',
};

const PLAN_STATUS_LABEL = {
  borrador:   'plan_status_draft',
  activo:     'plan_status_active',
  completado: 'plan_status_completed',
  archivado:  'plan_status_archived',
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
  const planLibrary = useStore(s => s.planLibrary);
  const [showModal, setShowModal] = useState(false);
  const [editPlan, setEditPlan] = useState(null);
  const [basePlan, setBasePlan] = useState(null);
  const [emailPlan, setEmailPlan] = useState(null);
  const [filterEstado, setFilterEstado] = useState('all');

  const filtered = useMemo(() => {
    return nutritionPlans
      .filter(p => filterEstado === 'all' || p.estado === filterEstado)
      .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  }, [nutritionPlans, filterEstado]);

  const handleDelete = async (plan) => {
    const ok = await confirm(t.plan_confirm_delete.replace('{name}', plan.nombre));
    if (!ok) return;
    deleteNutritionPlan(plan.id);
    toast.success(t.plan_deleted);
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-title text-sage-900">{t.plans_title}</h1>
        <Button variant="primary" icon={Plus} onClick={() => { setEditPlan(null); setBasePlan(null); setShowModal(true); }}>
          {t.new_plan}
        </Button>
      </div>

      {/* Filters */}
      <SegmentedControl
        value={filterEstado}
        onChange={setFilterEstado}
        options={[
          { value: 'all',        label: t.all },
          { value: 'borrador',   label: t.plan_status_draft },
          { value: 'activo',     label: t.plan_status_active },
          { value: 'completado', label: t.plan_status_completed },
        ]}
      />

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
            const isPlanificacion = plan.formato === PLAN_FORMAT;
            const stats = isPlanificacion ? planificacionStats(plan) : null;

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
                    {!isPlanificacion && plan.comidas?.length > 0 && <span>{plan.comidas.length} comidas</span>}
                    {stats && <span>{plural(t, 'pf_options', stats.opciones)} · {plural(t, 'pf_dishes', stats.platos)}</span>}
                  </div>
                  {!!(plan.macros?.proteinas || plan.macros?.carbohidratos || plan.macros?.grasas) && (
                    <MacroBar {...plan.macros} />
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-badge font-medium mr-1 ${PLAN_STATUS[plan.estado] || 'bg-sage-100 text-sage-500'}`}>
                    {PLAN_STATUS_LABEL[plan.estado] ? t[PLAN_STATUS_LABEL[plan.estado]] : plan.estado}
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        const { save } = await import('@tauri-apps/api/dialog');
                        const { writeBinaryFile } = await import('@tauri-apps/api/fs');
                        const bytes = await generatePlanPdf(plan, client, config, planLibrary);
                        // Same flow as invoices: an <a download> blob link is unreliable in Tauri.
                        const filePath = await save({
                          defaultPath: planPdfFileName(plan, client),
                          filters: [{ name: 'PDF', extensions: ['pdf'] }],
                        });
                        if (!filePath) return;
                        await writeBinaryFile(filePath, bytes);
                        invoke('open_file', { path: filePath }).catch(() => {});
                        toast.success(t.pdf_saved);
                      } catch (e) { toast.error(t.pdf_error.replace('{error}', errMsg(e))); }
                    }}
                    className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                    title={t.download_pdf}
                    aria-label={t.download_pdf}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const { saveBytesToDocuments } = await import('../services/documentService');
                        const bytes = await generatePlanPdf(plan, client, config, planLibrary);
                        let binary = '';
                        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                        const b64 = btoa(binary);
                        const fileName = planPdfFileName(plan, client);
                        const { storedFileName } = await saveBytesToDocuments(plan.clienteId, fileName, b64);
                        const addDoc = useStore.getState().addClientDocument;
                        addDoc({
                          clienteId: plan.clienteId,
                          nombre: plan.nombre || t.plan_pdf_title,
                          tipo: 'plan_nutricional',
                          fileName,
                          storedFileName,
                          fileSize: bytes.length,
                          fechaDocumento: todayISO(),
                          notas: '',
                        });
                        toast.success(t.doc_saved_to_client);
                      } catch (e) { toast.error('Error: ' + errMsg(e)); }
                    }}
                    className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                    title={t.doc_save_to_client}
                    aria-label={t.doc_save_to_client}
                  >
                    <FolderDown size={14} />
                  </button>
                  <button
                    onClick={async () => {
                      // The email must carry the plan itself: generate the PDF first.
                      try {
                        const pdfBytes = await generatePlanPdf(plan, client, config, planLibrary);
                        setEmailPlan({ plan, pdfBytes });
                      } catch (e) { toast.error(t.pdf_error.replace('{error}', errMsg(e))); }
                    }}
                    className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                    title={t.send_by_email}
                    aria-label={t.send_by_email}
                  >
                    <Mail size={14} />
                  </button>
                  {isPlanificacion && (
                    <button
                      onClick={() => { setEditPlan(null); setBasePlan(plan); setShowModal(true); }}
                      title={t.pf_new_from_this}
                      aria-label={`${t.pf_new_from_this}: ${plan.nombre || ''}`}
                      className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                    >
                      <CopyPlus size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => { setEditPlan(plan); setBasePlan(null); setShowModal(true); }}
                    title={t.edit}
                    aria-label={`${t.edit}: ${plan.nombre || ''}`}
                    className="p-1.5 rounded-button text-sage-400 hover:text-sage-700 hover:bg-sage-100 transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(plan)}
                    title={t.delete}
                    aria-label={`${t.delete}: ${plan.nombre || ''}`}
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
          basePlan={basePlan}
          onClose={() => { setShowModal(false); setEditPlan(null); setBasePlan(null); }}
        />
      )}

      {emailPlan && (
        <SendEmailModal
          mode="plan"
          plan={emailPlan.plan}
          pdfBytes={emailPlan.pdfBytes}
          client={clients.find(c => c.id === emailPlan.plan.clienteId)}
          onClose={() => setEmailPlan(null)}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default NutritionPlanEditor;
