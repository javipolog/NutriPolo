import React, { useState, useEffect } from 'react';
import { Check, Download, Upload, Shield, AlertTriangle, Sun, Moon, Monitor } from 'lucide-react';
import { Button, Input, Textarea, Select, Card, useToast } from './UI';
import { useStore, validateNIFOrCIF, validateIBAN, formatIBAN, exportDataToJSON, importDataFromJSON } from '../stores/store';
import { NotionSync } from './NotionSync';

export const SettingsView = () => {
  const { config, setConfig, lastBackupDate, appTheme, setAppTheme } = useStore();
  const [form, setForm] = useState(config);
  const [errors, setErrors] = useState({});
  const [importMode, setImportMode] = useState('replace');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportDataToJSON();
      if (result.success) {
        toast.success('Datos exportados correctamente');
      } else if (!result.cancelled) {
        toast.error('Error al exportar los datos');
      }
    } catch (err) {
      toast.error(`Error al exportar: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const result = await importDataFromJSON(importMode);
      if (result.success) {
        const modeLabel = importMode === 'replace' ? 'reemplazados' : 'fusionados';
        toast.success(`Datos importados y ${modeLabel} correctamente`);
      } else if (!result.cancelled) {
        toast.error('Error al importar los datos');
      }
    } catch (err) {
      toast.error(`Error al importar: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const lastBackupText = lastBackupDate
    ? `Último backup: ${new Date(lastBackupDate).toLocaleDateString('es-ES')}`
    : 'Sin backup registrado';

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

      {/* Backup i exportació de dades (#2, #13) */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
            <Shield size={16} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Backup y datos</h3>
            <p className="text-xs text-slate-500">{lastBackupText} · Backup automático diario activado</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Exportar */}
          <div className="bg-slate-800/40 rounded-xl p-4">
            <h4 className="text-sm font-medium text-white mb-1">Exportar datos</h4>
            <p className="text-xs text-slate-500 mb-4">
              Guarda todos tus datos en un fichero JSON. Útil para hacer copias manuales o migrar a otro equipo.
            </p>
            <Button
              onClick={handleExport}
              icon={Download}
              variant="secondary"
              disabled={isExporting}
              className="w-full justify-center"
            >
              {isExporting ? 'Exportando...' : 'Exportar JSON'}
            </Button>
          </div>

          {/* Importar */}
          <div className="bg-slate-800/40 rounded-xl p-4">
            <h4 className="text-sm font-medium text-white mb-1">Importar datos</h4>
            <p className="text-xs text-slate-500 mb-3">
              Carga datos desde un fichero JSON exportado anteriormente.
            </p>
            <div className="mb-3">
              <Select
                label="Modo de importación"
                value={importMode}
                onChange={e => setImportMode(e.target.value)}
                options={[
                  { value: 'replace', label: 'Reemplazar todo' },
                  { value: 'merge', label: 'Fusionar (añadir nuevos)' },
                ]}
              />
            </div>
            {importMode === 'replace' && (
              <div className="flex items-start gap-2 mb-3 p-2 bg-amber-900/30 border border-amber-700/30 rounded-lg">
                <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-300/80">
                  Reemplazar eliminará todos los datos actuales.
                </p>
              </div>
            )}
            <Button
              onClick={handleImport}
              icon={Upload}
              variant="secondary"
              disabled={isImporting}
              className="w-full justify-center"
            >
              {isImporting ? 'Importando...' : 'Importar JSON'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Aparença i tema (#19) */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Apariencia</h3>
        <div>
          <p className="text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">Tema de color</p>
          <div className="flex gap-3">
            {[
              { value: 'dark',  label: 'Oscuro', icon: Moon },
              { value: 'light', label: 'Claro',  icon: Sun },
              { value: 'auto',  label: 'Auto',   icon: Monitor },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setAppTheme(value)}
                className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  appTheme === value
                    ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
                }`}
              >
                <Icon size={20} />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {appTheme === 'auto' ? 'Sigue las preferencias del sistema operativo.' :
             appTheme === 'light' ? 'Interfaz clara, ideal para trabajar con luz natural.' :
             'Interfaz oscura, reduce la fatiga visual en entornos oscuros.'}
          </p>
        </div>
      </Card>

      {/* Sincronización con Notion */}
      <div className="pt-6 border-t border-slate-800">
        <h3 className="text-lg font-semibold text-white mb-4">Integración con Notion</h3>
        <NotionSync />
      </div>
    </div>
  );
};
