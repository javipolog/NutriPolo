import React, { useState, useMemo } from 'react';
import { Calculator, FileText } from 'lucide-react';
import { Button, Card, Select } from './UI';
import { useStore, formatCurrency, getQuarter } from '../stores/store';

// ============================================
// MODEL 130 ACUMULAT
// El model 130 és ACUMULATIU dins l'any fiscal.
// Caselles 01-07 acumulen tots els trimestres anteriors del mateix any.
// La quota a ingressar = total acumulat - pagaments ja fets en trimestres anteriors.
// ============================================

const calcularQuarterData = (invoices, expenses, year, quarter) => {
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 3;

  const qInvoices = invoices.filter(i => {
    const d = new Date(i.fecha);
    return d.getFullYear() === year && d.getMonth() >= startMonth && d.getMonth() < endMonth && i.estado !== 'anulada';
  });
  const qExpenses = expenses.filter(e => {
    const d = new Date(e.fecha);
    return d.getFullYear() === year && d.getMonth() >= startMonth && d.getMonth() < endMonth;
  });

  const baseIngresos = qInvoices.reduce((sum, i) => sum + (i.subtotal || 0), 0);
  const ivaRepercutido = qInvoices.reduce((sum, i) => sum + (i.iva || 0), 0);
  const irpfRetenido = qInvoices.reduce((sum, i) => sum + (i.irpf || 0), 0);
  const baseGastos = qExpenses.filter(e => e.deducibleIrpf).reduce((sum, e) => sum + (e.baseImponible || 0), 0);
  const ivaSoportado = qExpenses.filter(e => e.deducibleIva).reduce((sum, e) => sum + (e.ivaImporte || 0), 0);

  return { baseIngresos, ivaRepercutido, irpfRetenido, baseGastos, ivaSoportado, numFacturas: qInvoices.length, numGastos: qExpenses.length };
};

export const TaxesView = () => {
  const { invoices, expenses } = useStore();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState(getQuarter(new Date()));

  // Dades del trimestre seleccionat (per al Model 303 IVA — no acumulatiu)
  const quarterData = useMemo(() => {
    return calcularQuarterData(invoices, expenses, selectedYear, selectedQuarter);
  }, [invoices, expenses, selectedYear, selectedQuarter]);

  // Dades acumulades des de Q1 fins al trimestre seleccionat (per al Model 130 IRPF — acumulatiu)
  const accumulatedData = useMemo(() => {
    let acc = { baseIngresos: 0, baseGastos: 0, irpfRetenido: 0 };
    for (let q = 1; q <= selectedQuarter; q++) {
      const d = calcularQuarterData(invoices, expenses, selectedYear, q);
      acc.baseIngresos += d.baseIngresos;
      acc.baseGastos += d.baseGastos;
      acc.irpfRetenido += d.irpfRetenido;
    }
    return acc;
  }, [invoices, expenses, selectedYear, selectedQuarter]);

  // Pagaments ja fets en trimestres anteriors del mateix any (calculats sobre les dades acumulades fins Q(n-1))
  const pagamentsAnteriors = useMemo(() => {
    let acc = { baseIngresos: 0, baseGastos: 0, irpfRetenido: 0 };
    for (let q = 1; q < selectedQuarter; q++) {
      const d = calcularQuarterData(invoices, expenses, selectedYear, q);
      acc.baseIngresos += d.baseIngresos;
      acc.baseGastos += d.baseGastos;
      acc.irpfRetenido += d.irpfRetenido;
    }
    const rendimentAnterior = acc.baseIngresos - acc.baseGastos;
    return Math.max(0, rendimentAnterior * 0.20 - acc.irpfRetenido);
  }, [invoices, expenses, selectedYear, selectedQuarter]);

  // Model 303: IVA del trimestre (no acumulatiu)
  const resultado303 = quarterData.ivaRepercutido - quarterData.ivaSoportado;

  // Model 130: Pago fraccionado acumulat - pagaments ja fets trimestres anteriors
  const rendimentAcumulat = accumulatedData.baseIngresos - accumulatedData.baseGastos;
  const pagamentFraccionatTotal = Math.max(0, rendimentAcumulat * 0.20 - accumulatedData.irpfRetenido);
  const resultado130 = Math.max(0, pagamentFraccionatTotal - pagamentsAnteriors);

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
        {/* Model 303 - IVA (trimestre aïllat) */}
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700"><Calculator size={24} className="text-white" /></div>
            <div>
              <h3 className="text-lg font-semibold text-white">Modelo 303 - IVA</h3>
              <p className="text-slate-400 text-sm">Declaración trimestral T{selectedQuarter}</p>
            </div>
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
            <div className={`p-4 rounded-xl ${resultado303 >= 0 ? 'bg-red-900/30 border border-red-800' : 'bg-emerald-900/30 border border-emerald-800'}`}>
              <p className="text-sm text-slate-400">Resultado (a ingresar)</p>
              <p className={`text-2xl font-bold mt-1 ${resultado303 >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {resultado303 < 0 ? '-' : ''}{formatCurrency(Math.abs(resultado303))}
              </p>
            </div>
          </div>
        </Card>

        {/* Model 130 - IRPF (acumulatiu) */}
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gradient-to-br from-amber-600 to-amber-700"><FileText size={24} className="text-white" /></div>
            <div>
              <h3 className="text-lg font-semibold text-white">Modelo 130 - IRPF</h3>
              <p className="text-slate-400 text-sm">Pago fraccionado acumulado T1-T{selectedQuarter}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">Ingresos acumulados (T1-T{selectedQuarter})</p>
              <p className="text-xl font-semibold text-white mt-1">{formatCurrency(accumulatedData.baseIngresos)}</p>
            </div>
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">Gastos deducibles acumulados</p>
              <p className="text-xl font-semibold text-white mt-1">-{formatCurrency(accumulatedData.baseGastos)}</p>
            </div>
            <div className="p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-400">Retenciones IRPF acumuladas</p>
              <p className="text-xl font-semibold text-white mt-1">-{formatCurrency(accumulatedData.irpfRetenido)}</p>
            </div>
            {selectedQuarter > 1 && (
              <div className="p-4 bg-slate-800/50 rounded-xl">
                <p className="text-sm text-slate-400">Pagos realizados trimestres anteriores</p>
                <p className="text-xl font-semibold text-amber-400 mt-1">-{formatCurrency(pagamentsAnteriors)}</p>
              </div>
            )}
            <div className={`p-4 rounded-xl ${resultado130 > 0 ? 'bg-red-900/30 border border-red-800' : 'bg-emerald-900/30 border border-emerald-800'}`}>
              <p className="text-sm text-slate-400">A ingresar este trimestre</p>
              <p className={`text-2xl font-bold mt-1 ${resultado130 > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {formatCurrency(resultado130)}
              </p>
            </div>
          </div>

          {/* Detall càlcul */}
          <div className="mt-4 p-3 bg-slate-900/50 rounded-xl border border-slate-800 text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-400 mb-2">Cálculo acumulado:</p>
            <p>Rendimiento neto: {formatCurrency(rendimentAcumulat)}</p>
            <p>20% s/rendimiento: {formatCurrency(rendimentAcumulat * 0.20)}</p>
            <p>- Retenciones: -{formatCurrency(accumulatedData.irpfRetenido)}</p>
            <p>= Total fraccionado: {formatCurrency(pagamentFraccionatTotal)}</p>
            {selectedQuarter > 1 && <p>- Pagos anteriores: -{formatCurrency(pagamentsAnteriors)}</p>}
            <p className="font-semibold text-slate-300">= A ingresar T{selectedQuarter}: {formatCurrency(resultado130)}</p>
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
