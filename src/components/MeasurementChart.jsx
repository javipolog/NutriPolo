import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SegmentedControl } from './UI';
import { formatDateShort, calcIMC } from '../stores/store';
import { FollowUpTable } from './client/FollowUpTable';
import { EnergyNeedsCard } from './client/EnergyNeedsCard';
import { useT } from '../i18n';
import { useChartTheme } from '../hooks/useChartTheme';

// Y axis fitted to the data with a little headroom, instead of starting at 0
const FITTED_DOMAIN = [min => Math.floor(min * 0.97), max => Math.ceil(max * 1.03)];

export const MeasurementChart = ({ client, measurements }) => {
  const clientHeight = client.altura;
  const t = useT();
  const c = useChartTheme();
  const [chartType, setChartType] = useState('weight');

  const chartData = measurements.map(m => ({
    fecha: formatDateShort(m.fecha),
    peso: m.peso || null,
    grasa: m.grasaCorporal || null,
    musculo: m.masaMuscular || null,
    imc: m.imc || (m.peso && clientHeight ? calcIMC(m.peso, clientHeight) : null),
    cintura: m.cintura || null,
    cadera: m.cadera || null,
    brazo: m.brazo || null,
    muslo: m.muslo || null,
  }));
  // Perimeters share one cm axis; only the ones with data are drawn.
  const perimeters = [
    { key: 'cintura', label: t.measurement_waist, color: c.primary },
    { key: 'cadera', label: t.measurement_hip, color: c.accent },
    { key: 'brazo', label: t.measurement_arm, color: c.info },
    { key: 'muslo', label: t.measurement_thigh, color: c.axis },
  ].filter(p => chartData.some(d => d[p.key] != null));

  const secondaryKey = { weight: 'imc', bodyfat: 'musculo' }[chartType];
  const hasSecondary = !!secondaryKey && chartData.some(d => d[secondaryKey] != null);

  return (
    <div className="space-y-5">
      <FollowUpTable client={client} measurements={measurements} />

      {chartData.length > 1 && (
        <div className="space-y-3">
          <SegmentedControl
            value={chartType}
            onChange={setChartType}
            options={[
              { value: 'weight', label: t.chart_weight_short },
              { value: 'bodyfat', label: t.chart_fat },
              { value: 'circumferences', label: t.chart_perimeters },
            ]}
          />
          <div className="bg-white border border-sage-200 rounded-soft p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: c.axis }} />
                {/* Each series gets its own axis fitted to its range: on a 0-based
                    axis a 82 → 78 kg change looks like a flat line. */}
                <YAxis yAxisId="left" domain={FITTED_DOMAIN} tick={{ fontSize: 10, fill: c.axis }} width={36} />
                {hasSecondary && (
                  <YAxis yAxisId="right" orientation="right" domain={FITTED_DOMAIN} tick={{ fontSize: 10, fill: c.axis }} width={36} />
                )}
                <Tooltip contentStyle={{ fontSize: 12, borderColor: c.tooltipBorder, backgroundColor: c.tooltipBg, color: c.tooltipText, borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {chartType === 'weight' && (
                  <>
                    <Line yAxisId="left" type="monotone" dataKey="peso" stroke={c.primary} strokeWidth={2} dot={{ r: 3 }} name={t.measurement_weight} connectNulls />
                    {hasSecondary && <Line yAxisId="right" type="monotone" dataKey="imc" stroke={c.accent} strokeWidth={2} dot={{ r: 3 }} name="IMC" connectNulls />}
                  </>
                )}
                {chartType === 'bodyfat' && (
                  <>
                    <Line yAxisId="left" type="monotone" dataKey="grasa" stroke={c.accent} strokeWidth={2} dot={{ r: 3 }} name={t.measurement_body_fat} connectNulls />
                    {hasSecondary && <Line yAxisId="right" type="monotone" dataKey="musculo" stroke={c.primary} strokeWidth={2} dot={{ r: 3 }} name={t.measurement_muscle} connectNulls />}
                  </>
                )}
                {chartType === 'circumferences' && perimeters.map(p => (
                  <Line key={p.key} yAxisId="left" type="monotone" dataKey={p.key} stroke={p.color} strokeWidth={2} dot={{ r: 3 }} name={p.label} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <EnergyNeedsCard client={client} lastMeasurement={measurements[measurements.length - 1]} />
    </div>
  );
};

export default MeasurementChart;
