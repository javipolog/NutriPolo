import React, { useState, useMemo } from 'react';
import { Calculator, FileText, TrendingUp, FileSpreadsheet } from 'lucide-react';
import { Button, Card, Select, useToast } from './UI';
import { useStore, formatCurrency, getQuarter, exportDocumentsCSV, downloadCSV } from '../stores/store';

// ============================================
// MODEL 130 ACUMULAT
// El model 130 és ACUMULATIU dins l'any fiscal.
// ============================================

const calcularQuarterData = (invoices, expenses, year, quarter) => {
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 3;

  const qInvoices = invoices.filter(i => {
    const d = new Date(i.fecha);
    const tipo = i.tipoDocumento || 'factura';
    return d.getFullYear() === year && d.getMonth() >= startMonth && d.getMonth() < endMonth
      && i.estado !== 'anulada' && tipo !== 'presupuesto';
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
  const numFacturas = qInvoices.filter(i => (i.tipoDocumento || 'factura') === 'factura').length;
  const numRectificativas = qInvoices.filter(i => i.tipoDocumento === 'rectificativa').length;

  return { baseIngresos, ivaRepercutido, irpfRetenido, baseGastos, ivaSoportado, numFacturas, numRectificativas, numGastos: qExpenses.length };
};

// ============================================
// VISTA TRIMESTRAL
// ============================================
const TrimestralView = ({ invoices, expenses, selectedYear, selectedQuarter }) => {
  const quarterData = useMemo(() =>
    calcularQuarterData(invoices, expenses, selectedYear, selectedQuarter),
    [invoices, expenses, selectedYear, selectedQuarter]
  );

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

  const resultado303 = quarterData.ivaRepercutido - quarterData.ivaSoportado;
  const rendimentAcumulat = accumulatedData.baseIngresos - accumulatedData.baseGastos;
  const pagamentFraccionatTotal = Math.max(0, rendimentAcumulat * 0.20 - accumulatedData.irpfRetenido);
  const resultado130 = Math.max(0, pagamentFraccionatTotal - pagamentsAnteriors);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Model 303 - IVA */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-soft bg-terra-400"><Calculator size={24} className="text-white" /></div>
          <div>
            <h3 className="font-serif text-lg font-semibold text-sand-900">Modelo 303 - IVA</h3>
            <p className="text-sand-600 text-sm">Declaración trimestral T{selectedQuarter}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="p-4 bg-sand-100 rounded-soft">
            <p className="text-sm text-sand-600">IVA Repercutido ({quarterData.numFacturas} facturas{quarterData.numRectificativas > 0 ? `, ${quarterData.numRectificativas} rect.` : ''})</p>
            <p className="font-serif text-xl font-semibold text-sand-900 mt-1">{formatCurrency(quarterData.ivaRepercutido)}</p>
          </div>
          <div className="p-4 bg-sand-100 rounded-soft">
            <p className="text-sm text-sand-600">IVA Soportado ({quarterData.numGastos} gastos)</p>
            <p className="font-serif text-xl font-semibold text-sand-900 mt-1">-{formatCurrency(quarterData.ivaSoportado)}</p>
          </div>
          <div className={`p-4 rounded-soft ${resultado303 >= 0 ? 'bg-danger-light border border-danger/30' : 'bg-success-light border border-success/30'}`}>
            <p className="text-sm text-sand-600">Resultado (a ingresar)</p>
            <p className={`text-2xl font-bold mt-1 ${resultado303 >= 0 ? 'text-danger' : 'text-success'}`}>
              {resultado303 < 0 ? '-' : ''}{formatCurrency(Math.abs(resultado303))}
            </p>
          </div>
        </div>
      </Card>

      {/* Model 130 - IRPF */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-soft bg-gradient-to-br from-amber-600 to-amber-700"><FileText size={24} className="text-white" /></div>
          <div>
            <h3 className="font-serif text-lg font-semibold text-sand-900">Modelo 130 - IRPF</h3>
            <p className="text-sand-600 text-sm">Pago fraccionado acumulado T1-T{selectedQuarter}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="p-4 bg-sand-100 rounded-soft">
            <p className="text-sm text-sand-600">Ingresos acumulados (T1-T{selectedQuarter})</p>
            <p className="font-serif text-xl font-semibold text-sand-900 mt-1">{formatCurrency(accumulatedData.baseIngresos)}</p>
          </div>
          <div className="p-4 bg-sand-100 rounded-soft">
            <p className="text-sm text-sand-600">Gastos deducibles acumulados</p>
            <p className="font-serif text-xl font-semibold text-sand-900 mt-1">-{formatCurrency(accumulatedData.baseGastos)}</p>
          </div>
          <div className="p-4 bg-sand-100 rounded-soft">
            <p className="text-sm text-sand-600">Retenciones IRPF acumuladas</p>
            <p className="font-serif text-xl font-semibold text-sand-900 mt-1">-{formatCurrency(accumulatedData.irpfRetenido)}</p>
          </div>
          {selectedQuarter > 1 && (
            <div className="p-4 bg-sand-100 rounded-soft">
              <p className="text-sm text-sand-600">Pagos realizados trimestres anteriores</p>
              <p className="text-xl font-semibold text-warning mt-1">-{formatCurrency(pagamentsAnteriors)}</p>
            </div>
          )}
          <div className={`p-4 rounded-soft ${resultado130 > 0 ? 'bg-danger-light border border-danger/30' : 'bg-success-light border border-success/30'}`}>
            <p className="text-sm text-sand-600">A ingresar este trimestre</p>
            <p className={`text-2xl font-bold mt-1 ${resultado130 > 0 ? 'text-danger' : 'text-success'}`}>
              {formatCurrency(resultado130)}
            </p>
          </div>
        </div>
        <div className="mt-4 p-3 bg-white rounded-soft border border-sand-300 text-xs text-sand-500 space-y-1">
          <p className="font-semibold text-sand-600 mb-2">Cálculo acumulado:</p>
          <p>Rendimiento neto: {formatCurrency(rendimentAcumulat)}</p>
          <p>20% s/rendimiento: {formatCurrency(rendimentAcumulat * 0.20)}</p>
          <p>- Retenciones: -{formatCurrency(accumulatedData.irpfRetenido)}</p>
          <p>= Total fraccionado: {formatCurrency(pagamentFraccionatTotal)}</p>
          {selectedQuarter > 1 && <p>- Pagos anteriores: -{formatCurrency(pagamentsAnteriors)}</p>}
          <p className="font-semibold text-sand-700">= A ingresar T{selectedQuarter}: {formatCurrency(resultado130)}</p>
        </div>
      </Card>
    </div>
  );
};

// ============================================
// VISTA RESUM ANUAL (#24)
// Tots els trimestres + Modelo 100 estimat
// ============================================
const AnualView = ({ invoices, expenses, selectedYear }) => {
  // Calcular dades per als 4 trimestres
  const quarters = useMemo(() => {
    const result = [];
    for (let q = 1; q <= 4; q++) {
      const d = calcularQuarterData(invoices, expenses, selectedYear, q);

      // Model 303 (no acumulatiu)
      const resultado303 = d.ivaRepercutido - d.ivaSoportado;

      // Model 130 acumulatiu fins a T{q}
      let acc = { baseIngresos: 0, baseGastos: 0, irpfRetenido: 0 };
      for (let tq = 1; tq <= q; tq++) {
        const td = calcularQuarterData(invoices, expenses, selectedYear, tq);
        acc.baseIngresos += td.baseIngresos;
        acc.baseGastos += td.baseGastos;
        acc.irpfRetenido += td.irpfRetenido;
      }
      // Pagaments anteriors
      let prev = { baseIngresos: 0, baseGastos: 0, irpfRetenido: 0 };
      for (let tq = 1; tq < q; tq++) {
        const td = calcularQuarterData(invoices, expenses, selectedYear, tq);
        prev.baseIngresos += td.baseIngresos;
        prev.baseGastos += td.baseGastos;
        prev.irpfRetenido += td.irpfRetenido;
      }
      const rendPrev = prev.baseIngresos - prev.baseGastos;
      const pagosPrev = Math.max(0, rendPrev * 0.20 - prev.irpfRetenido);
      const rendAcc = acc.baseIngresos - acc.baseGastos;
      const pagFracTotal = Math.max(0, rendAcc * 0.20 - acc.irpfRetenido);
      const resultado130 = Math.max(0, pagFracTotal - pagosPrev);

      const deadlines = { 1: '20 abril', 2: '20 julio', 3: '20 octubre', 4: '30 enero' };
      result.push({ q, d, resultado303, resultado130, deadline: deadlines[q] });
    }
    return result;
  }, [invoices, expenses, selectedYear]);

  // Totals anuals
  const totalAnual = useMemo(() => {
    const all = quarters.reduce((acc, { d }) => ({
      baseIngresos: acc.baseIngresos + d.baseIngresos,
      ivaRepercutido: acc.ivaRepercutido + d.ivaRepercutido,
      ivaSoportado: acc.ivaSoportado + d.ivaSoportado,
      irpfRetenido: acc.irpfRetenido + d.irpfRetenido,
      baseGastos: acc.baseGastos + d.baseGastos,
    }), { baseIngresos: 0, ivaRepercutido: 0, ivaSoportado: 0, irpfRetenido: 0, baseGastos: 0 });

    const total303 = all.ivaRepercutido - all.ivaSoportado;
    const rendAnual = all.baseIngresos - all.baseGastos;
    const total130 = quarters.reduce((s, { resultado130 }) => s + resultado130, 0);

    return { ...all, total303, rendAnual, total130 };
  }, [quarters]);

  // Modelo 100 (IRPF anual estimat)
  const modelo100 = useMemo(() => {
    const ingresos = totalAnual.baseIngresos;
    const gastos = totalAnual.baseGastos;
    const rendimiento = ingresos - gastos;
    const retenciones = totalAnual.irpfRetenido;
    const pagosAcuenta = totalAnual.total130;
    // Estimació: 20% sobre rendiment net - retencions - pagos a compte
    const cuotaEstimada = Math.max(0, rendimiento * 0.20);
    const resultadoEstimado = cuotaEstimada - retenciones - pagosAcuenta;
    return { ingresos, gastos, rendimiento, retenciones, pagosAcuenta, cuotaEstimada, resultadoEstimado };
  }, [totalAnual]);

  const currentQ = getQuarter(new Date());
  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      {/* Taula de 4 trimestres */}
      <Card className="p-6">
        <h3 className="font-serif text-lg font-semibold text-sand-900 mb-4 flex items-center gap-2">
          <TrendingUp size={20} className="text-terra-400" />
          Resumen por trimestres — {selectedYear}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-sand-300">
                <th className="py-2 px-4 text-left text-sand-600 font-medium">Trimestre</th>
                <th className="py-2 px-4 text-right text-sand-600 font-medium">Base Ingresos</th>
                <th className="py-2 px-4 text-right text-sand-600 font-medium">IVA Rep.</th>
                <th className="py-2 px-4 text-right text-sand-600 font-medium">IVA Sop.</th>
                <th className="py-2 px-4 text-right text-sand-600 font-medium">Mod. 303</th>
                <th className="py-2 px-4 text-right text-sand-600 font-medium">IRPF Ret.</th>
                <th className="py-2 px-4 text-right text-sand-600 font-medium">Mod. 130</th>
                <th className="py-2 px-4 text-left text-sand-600 font-medium">Plazo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-200">
              {quarters.map(({ q, d, resultado303, resultado130, deadline }) => {
                const isPast = selectedYear < currentYear || (selectedYear === currentYear && q < currentQ);
                const isCurrent = selectedYear === currentYear && q === currentQ;
                return (
                  <tr key={q} className={`transition-colors ${isCurrent ? 'bg-terra-50' : 'hover:bg-sand-50'}`}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${isCurrent ? 'text-terra-500' : 'text-sand-800'}`}>T{q}</span>
                        {isCurrent && <span className="text-xs bg-terra-400/30 text-terra-300 px-1.5 rounded">actual</span>}
                        {isPast && !isCurrent && <span className="text-xs text-sand-400">pasado</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-sand-700">{formatCurrency(d.baseIngresos)}</td>
                    <td className="py-3 px-4 text-right font-mono text-sand-600">{formatCurrency(d.ivaRepercutido)}</td>
                    <td className="py-3 px-4 text-right font-mono text-sand-600">{formatCurrency(d.ivaSoportado)}</td>
                    <td className={`py-3 px-4 text-right font-mono font-semibold ${resultado303 >= 0 ? 'text-danger' : 'text-success'}`}>
                      {resultado303 < 0 ? '-' : ''}{formatCurrency(Math.abs(resultado303))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-sand-600">{formatCurrency(d.irpfRetenido)}</td>
                    <td className={`py-3 px-4 text-right font-mono font-semibold ${resultado130 > 0 ? 'text-danger' : 'text-success'}`}>
                      {formatCurrency(resultado130)}
                    </td>
                    <td className="py-3 px-4 text-xs text-sand-500">{deadline}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-sand-400">
              <tr className="bg-sand-50">
                <td className="py-3 px-4 font-bold text-sand-900">TOTAL {selectedYear}</td>
                <td className="py-3 px-4 text-right font-mono font-bold text-sand-900">{formatCurrency(totalAnual.baseIngresos)}</td>
                <td className="py-3 px-4 text-right font-mono font-bold text-sand-900">{formatCurrency(totalAnual.ivaRepercutido)}</td>
                <td className="py-3 px-4 text-right font-mono text-sand-700">{formatCurrency(totalAnual.ivaSoportado)}</td>
                <td className={`py-3 px-4 text-right font-mono font-bold ${totalAnual.total303 >= 0 ? 'text-danger' : 'text-success'}`}>
                  {totalAnual.total303 < 0 ? '-' : ''}{formatCurrency(Math.abs(totalAnual.total303))}
                </td>
                <td className="py-3 px-4 text-right font-mono text-sand-700">{formatCurrency(totalAnual.irpfRetenido)}</td>
                <td className={`py-3 px-4 text-right font-mono font-bold ${totalAnual.total130 > 0 ? 'text-danger' : 'text-success'}`}>
                  {formatCurrency(totalAnual.total130)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Modelo 100 estimat */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 rounded-soft bg-info"><TrendingUp size={22} className="text-white" /></div>
          <div>
            <h3 className="font-serif text-lg font-semibold text-sand-900">Modelo 100 — Estimación IRPF Anual</h3>
            <p className="text-sand-600 text-sm">Renta {selectedYear} (estimación simplificada al 20%)</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Ingresos brutos', value: modelo100.ingresos, color: 'text-sand-900' },
            { label: 'Gastos deducibles', value: -modelo100.gastos, color: 'text-danger', prefix: '-' },
            { label: 'Rendimiento neto', value: modelo100.rendimiento, color: 'text-terra-300', bold: true },
            { label: 'Cuota estimada (20%)', value: modelo100.cuotaEstimada, color: 'text-warning' },
            { label: 'Retenciones practicadas', value: -modelo100.retenciones, color: 'text-success', prefix: '-' },
            { label: 'Pagos a cuenta (130)', value: -modelo100.pagosAcuenta, color: 'text-success', prefix: '-' },
          ].map(({ label, value, color, bold }) => (
            <div key={label} className="p-4 bg-sand-100 rounded-soft">
              <p className="text-xs text-sand-600">{label}</p>
              <p className={`text-lg ${bold ? 'font-bold' : 'font-semibold'} ${color} mt-1 font-mono`}>
                {formatCurrency(Math.abs(value))}
              </p>
            </div>
          ))}
        </div>
        <div className={`mt-4 p-4 rounded-soft border ${modelo100.resultadoEstimado >= 0 ? 'bg-danger-light border-danger/20' : 'bg-success-light border-success/20'}`}>
          <p className="text-sm text-sand-600">Resultado estimado (a ingresar / a devolver)</p>
          <p className={`text-3xl font-bold mt-1 font-mono ${modelo100.resultadoEstimado >= 0 ? 'text-danger' : 'text-success'}`}>
            {modelo100.resultadoEstimado < 0 ? '' : '+'}{formatCurrency(modelo100.resultadoEstimado)}
          </p>
          <p className="text-xs text-sand-500 mt-2">
            * Estimación simplificada. Consulta con tu gestor para el cálculo definitivo (deducciones personales, mínimo vital, etc.).
          </p>
        </div>
      </Card>
    </div>
  );
};

// ============================================
// COMPONENT PRINCIPAL
// ============================================
export const TaxesView = () => {
  const { invoices, expenses, clients } = useStore();
  const currentYear = new Date().getFullYear();
  const toast = useToast();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState(getQuarter(new Date()));
  const [viewMode, setViewMode] = useState('trimestral'); // 'trimestral' | 'anual'
  const [isExporting, setIsExporting] = useState(false);

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const csv = exportDocumentsCSV(invoices, clients, {
        year: selectedYear,
        quarter: viewMode === 'trimestral' ? selectedQuarter : null,
        tipoDocumento: 'factura',
      });
      const suffix = viewMode === 'trimestral' ? `T${selectedQuarter}-${selectedYear}` : `${selectedYear}`;
      const filename = `facturas-emitidas-${suffix}.csv`;
      const result = await downloadCSV(csv, filename);
      if (result.success) toast.success('CSV exportado correctamente');
      else if (!result.cancelled) toast.error('Error al exportar CSV');
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setIsExporting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-sand-900">Impuestos</h1>
          <p className="text-sand-600 mt-1">Modelos 303, 130 y resumen fiscal anual</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tab: Trimestral / Anual */}
          <div className="flex gap-1 p-1 bg-sand-100 rounded-soft">
            <button onClick={() => setViewMode('trimestral')}
              className={`px-4 py-1.5 rounded-button text-sm font-medium transition-all ${viewMode === 'trimestral' ? 'bg-terra-400 text-white' : 'text-sand-600 hover:text-sand-800'}`}>
              Trimestral
            </button>
            <button onClick={() => setViewMode('anual')}
              className={`px-4 py-1.5 rounded-button text-sm font-medium transition-all ${viewMode === 'anual' ? 'bg-violet-600 text-white' : 'text-sand-600 hover:text-sand-800'}`}>
              Resumen Anual
            </button>
          </div>

          {viewMode === 'trimestral' && (
            <Select value={selectedQuarter} onChange={e => setSelectedQuarter(parseInt(e.target.value))}
              options={[1, 2, 3, 4].map(q => ({ value: q, label: `T${q}` }))} />
          )}
          <Select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
            options={[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(y => ({ value: y, label: y.toString() }))} />

          <Button icon={FileSpreadsheet} variant="secondary" onClick={handleExportCSV} disabled={isExporting}
            title="Exportar CSV facturas emitidas">
            {isExporting ? '...' : 'Exportar CSV'}
          </Button>
        </div>
      </div>

      {viewMode === 'trimestral' ? (
        <TrimestralView
          invoices={invoices} expenses={expenses}
          selectedYear={selectedYear} selectedQuarter={selectedQuarter}
        />
      ) : (
        <AnualView invoices={invoices} expenses={expenses} selectedYear={selectedYear} />
      )}

      {/* Dates de presentació */}
      <Card className="p-6">
        <h3 className="font-serif text-lg font-semibold text-sand-900 mb-4">Fechas de presentación {selectedYear}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[{ q: 1, date: '20 abril' }, { q: 2, date: '20 julio' }, { q: 3, date: '20 octubre' }, { q: 4, date: '30 enero' }].map(({ q, date }) => (
            <div key={q} className={`p-4 rounded-soft border ${viewMode === 'trimestral' && q === selectedQuarter ? 'bg-terra-50 border-terra-300' : 'bg-sand-50 border-sand-300'}`}>
              <p className="text-sm font-medium text-sand-600">T{q}</p>
              <p className="text-sand-900 font-semibold mt-1">{date}</p>
              {viewMode === 'trimestral' && q === selectedQuarter && (
                <span className="inline-block mt-2 text-xs bg-terra-400 text-white px-2 py-0.5 rounded">Actual</span>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
