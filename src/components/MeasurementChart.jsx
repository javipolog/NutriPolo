import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import { Button, useToast, useConfirm } from './UI';
import useStore, { formatDate, formatDateShort, calcIMC } from '../stores/store';
import { useT } from '../i18n';

const MeasurementModal = ({ clientId, clientHeight, onClose }) => {
  const addMeasurement = useStore(s => s.addMeasurement);
  const toast = useToast();
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

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

  const Field = ({ label, field, unit }) => (
    <div>
      <label className="block text-xs text-sage-500 mb-1">{label} {unit && <span className="text-sage-400">({unit})</span>}</label>
      <input
        type="number"
        step="0.1"
        value={form[field]}
        onChange={e => set(field, e.target.value)}
        className="w-full px-3 py-1.5 text-sm border border-sage-300 rounded-button bg-white text-sage-800 focus:outline-none focus:border-wellness-400"
        placeholder="—"
      />
    </div>
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
            <Field label={t.measurement_weight} field="peso" unit="kg" />
            <Field label={t.measurement_body_fat} field="grasaCorporal" unit="%" />
            <Field label={t.measurement_muscle} field="masaMuscular" unit="kg" />
            <Field label={t.measurement_water} field="agua" unit="%" />
            <Field label={t.measurement_visceral_fat} field="grasaVisceral" unit="" />
          </div>
          <div>
            <p className="text-xs font-medium text-sage-600 mb-2">Perímetros corporales</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t.measurement_waist} field="cintura" unit="cm" />
              <Field label={t.measurement_chest} field="pecho" unit="cm" />
              <Field label={t.measurement_hip} field="cadera" unit="cm" />
              <Field label={t.measurement_arm} field="brazo" unit="cm" />
              <Field label={t.measurement_thigh} field="muslo" unit="cm" />
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

  const handleDelete = async (id) => {
    const ok = await confirm('¿Eliminar esta medición?');
    if (ok) { deleteMeasurement(id); toast.success('Medición eliminada'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {[['weight','Peso'], ['bodyfat','Grasa'], ['circumferences','Perímetros']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setChartType(id)}
              className={`px-3 py-1.5 text-xs rounded-button transition-colors ${
                chartType === id ? 'bg-wellness-400 text-white' : 'bg-sage-100 text-sage-600 hover:bg-sage-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E5DC" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#7A816F' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#7A816F' }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderColor: '#D4D8CD', borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {chartType === 'weight' && (
                    <>
                      <Line type="monotone" dataKey="peso" stroke="#4A9960" strokeWidth={2} dot={{ r: 3 }} name="Peso (kg)" connectNulls />
                      <Line type="monotone" dataKey="imc" stroke="#E8846A" strokeWidth={2} dot={{ r: 3 }} name="IMC" connectNulls />
                    </>
                  )}
                  {chartType === 'bodyfat' && (
                    <>
                      <Line type="monotone" dataKey="grasa" stroke="#E8846A" strokeWidth={2} dot={{ r: 3 }} name="Grasa (%)" connectNulls />
                      <Line type="monotone" dataKey="musculo" stroke="#4A9960" strokeWidth={2} dot={{ r: 3 }} name="Músculo (kg)" connectNulls />
                    </>
                  )}
                  {chartType === 'circumferences' && (
                    <Line type="monotone" dataKey="peso" stroke="#4A9960" strokeWidth={2} dot={{ r: 3 }} name="Peso ref." connectNulls />
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
          clientHeight={clientHeight}
          onClose={() => setShowModal(false)}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default MeasurementChart;
