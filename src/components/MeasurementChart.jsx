import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import { Button, SegmentedControl, useToast, useConfirm } from './UI';
import useStore, { formatDate, formatDateShort, calcIMC, todayISO } from '../stores/store';
import { useT } from '../i18n';

// Y axis fitted to the data with a little headroom, instead of starting at 0
const FITTED_DOMAIN = [min => Math.floor(min * 0.97), max => Math.ceil(max * 1.03)];

// Module-level so it keeps its identity across renders (an inline component
// would remount the <input> on every keystroke and drop the focus).
const MeasurementField = ({ label, unit, value, onChange }) => (
  <div>
    <label className="block text-xs text-sage-500 mb-1">{label} {unit && <span className="text-sage-400">({unit})</span>}</label>
    <input
      type="number"
      step="0.1"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-1.5 text-sm border border-sage-300 rounded-button bg-white text-sage-800 focus:outline-none focus:border-wellness-400"
      placeholder="—"
    />
  </div>
);

const MeasurementModal = ({ clientId, onClose }) => {
  const addMeasurement = useStore(s => s.addMeasurement);
  const toast = useToast();
  const t = useT();
  const today = todayISO();

  const [form, setForm] = useState({
    fecha: today, peso: '', grasaCorporal: '', masaMuscular: '',
    agua: '', grasaVisceral: '', cintura: '', pecho: '',
    cadera: '', brazo: '', muslo: '', notas: '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.peso && !form.grasaCorporal) {
      toast.error('Introduce al menos peso o grasa corporal');
      return;
    }
    const data = { ...form, clienteId: clientId };
    Object.keys(data).forEach(k => {
      if (['peso','grasaCorporal','masaMuscular','agua','grasaVisceral','cintura','pecho','cadera','brazo','muslo'].includes(k)) {
        data[k] = data[k] ? parseFloat(data[k]) : null;
      }
    });
    addMeasurement(data);
    toast.success('Medición guardada');
    onClose();
  };

  // Plain render helper (not a component) so the inputs keep their identity.
  const field = (label, key, unit) => (
    <MeasurementField key={key} label={label} unit={unit} value={form[key]} onChange={v => set(key, v)} />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-soft shadow-modal w-full max-w-lg max-h-[85vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-sage-200 flex items-center justify-between">
          <h2 className="font-semibold text-sage-900">{t.new_measurement}</h2>
          <input type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)}
            className="text-sm border border-sage-300 rounded-button px-2 py-1 focus:outline-none focus:border-wellness-400" />
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {field(t.measurement_weight, 'peso', 'kg')}
            {field(t.measurement_body_fat, 'grasaCorporal', '%')}
            {field(t.measurement_muscle, 'masaMuscular', 'kg')}
            {field(t.measurement_water, 'agua', '%')}
            {field(t.measurement_visceral_fat, 'grasaVisceral', '')}
          </div>
          <div>
            <p className="text-xs font-medium text-sage-600 mb-2">Perímetros corporales</p>
            <div className="grid grid-cols-3 gap-3">
              {field(t.measurement_waist, 'cintura', 'cm')}
              {field(t.measurement_chest, 'pecho', 'cm')}
              {field(t.measurement_hip, 'cadera', 'cm')}
              {field(t.measurement_arm, 'brazo', 'cm')}
              {field(t.measurement_thigh, 'muslo', 'cm')}
            </div>
          </div>
          <div>
            <label className="block text-xs text-sage-500 mb-1">{t.measurement_notes}</label>
            <textarea
              value={form.notas}
              onChange={e => set('notas', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 resize-none"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-sage-200 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
          <Button variant="primary" onClick={handleSave}>{t.save}</Button>
        </div>
      </div>
    </div>
  );
};

export const MeasurementChart = ({ clientId, measurements, clientHeight }) => {
  const deleteMeasurement = useStore(s => s.deleteMeasurement);
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [chartType, setChartType] = useState('weight');

  const chartData = measurements.map(m => ({
    fecha: formatDateShort(m.fecha),
    peso: m.peso || null,
    grasa: m.grasaCorporal || null,
    musculo: m.masaMuscular || null,
    imc: m.imc || (m.peso && clientHeight ? calcIMC(m.peso, clientHeight) : null),
  }));

  const secondaryKey = { weight: 'imc', bodyfat: 'musculo' }[chartType];
  const hasSecondary = !!secondaryKey && chartData.some(d => d[secondaryKey] != null);

  const handleDelete = async (id) => {
    const ok = await confirm('¿Eliminar esta medición?');
    if (ok) { deleteMeasurement(id); toast.success('Medición eliminada'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SegmentedControl
          value={chartType}
          onChange={setChartType}
          options={[
            { value: 'weight', label: 'Peso' },
            { value: 'bodyfat', label: 'Grasa' },
            { value: 'circumferences', label: 'Perímetros' },
          ]}
        />
        <Button variant="primary" size="sm" onClick={() => setShowModal(true)} icon={Plus}>
          {t.new_measurement}
        </Button>
      </div>

      {measurements.length === 0 ? (
        <div className="text-center py-16 text-sage-400">
          <p className="text-sm">{t.no_measurements}</p>
          <Button variant="ghost" size="sm" onClick={() => setShowModal(true)} className="mt-3">{t.new_measurement}</Button>
        </div>
      ) : (
        <>
          {/* Chart */}
          {chartData.length > 1 && (
            <div className="bg-white border border-sage-200 rounded-soft p-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E6E2D8" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#75726A' }} />
                  {/* Each series gets its own axis fitted to its range: on a 0-based
                      axis a 82 → 78 kg change looks like a flat line. */}
                  <YAxis yAxisId="left" domain={FITTED_DOMAIN} tick={{ fontSize: 10, fill: '#75726A' }} width={36} />
                  {hasSecondary && (
                    <YAxis yAxisId="right" orientation="right" domain={FITTED_DOMAIN} tick={{ fontSize: 10, fill: '#75726A' }} width={36} />
                  )}
                  <Tooltip contentStyle={{ fontSize: 12, borderColor: '#DEDAD0', borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {chartType === 'weight' && (
                    <>
                      <Line yAxisId="left" type="monotone" dataKey="peso" stroke="#3E6B52" strokeWidth={2} dot={{ r: 3 }} name="Peso (kg)" connectNulls />
                      {hasSecondary && <Line yAxisId="right" type="monotone" dataKey="imc" stroke="#C15F3C" strokeWidth={2} dot={{ r: 3 }} name="IMC" connectNulls />}
                    </>
                  )}
                  {chartType === 'bodyfat' && (
                    <>
                      <Line yAxisId="left" type="monotone" dataKey="grasa" stroke="#C15F3C" strokeWidth={2} dot={{ r: 3 }} name="Grasa (%)" connectNulls />
                      {hasSecondary && <Line yAxisId="right" type="monotone" dataKey="musculo" stroke="#3E6B52" strokeWidth={2} dot={{ r: 3 }} name="Músculo (kg)" connectNulls />}
                    </>
                  )}
                  {chartType === 'circumferences' && (
                    <Line yAxisId="left" type="monotone" dataKey="peso" stroke="#3E6B52" strokeWidth={2} dot={{ r: 3 }} name="Peso ref." connectNulls />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Measurement list */}
          <div className="space-y-2">
            {[...measurements].reverse().map(m => (
              <div key={m.id} className="bg-white border border-sage-200 rounded-soft p-3 flex items-start gap-3">
                <div className="text-center w-16 shrink-0">
                  <p className="text-xs font-bold text-wellness-500">{formatDate(m.fecha)}</p>
                </div>
                <div className="flex-1 grid grid-cols-4 gap-2 text-center">
                  {m.peso && <div><p className="text-xs text-sage-400">Peso</p><p className="text-sm font-semibold text-sage-800">{m.peso}kg</p></div>}
                  {m.imc && <div><p className="text-xs text-sage-400">IMC</p><p className="text-sm font-semibold text-sage-800">{m.imc}</p></div>}
                  {m.grasaCorporal && <div><p className="text-xs text-sage-400">Grasa</p><p className="text-sm font-semibold text-sage-800">{m.grasaCorporal}%</p></div>}
                  {m.cintura && <div><p className="text-xs text-sage-400">Cintura</p><p className="text-sm font-semibold text-sage-800">{m.cintura}cm</p></div>}
                </div>
                <button
                  onClick={() => handleDelete(m.id)}
                  aria-label={t.delete}
                  title={t.delete}
                  className="p-1.5 text-sage-300 hover:text-danger transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && (
        <MeasurementModal
          clientId={clientId}
          onClose={() => setShowModal(false)}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default MeasurementChart;
