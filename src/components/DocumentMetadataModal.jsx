import React, { useState, useEffect } from 'react';
import { Modal, Input, Textarea, Select, Button } from './UI';
import { useT } from '../i18n';

const DOC_TYPES = [
  { value: 'plan_nutricional', labelKey: 'doc_type_plan' },
  { value: 'informe',         labelKey: 'doc_type_informe' },
  { value: 'analitica',       labelKey: 'doc_type_analitica' },
  { value: 'receta',          labelKey: 'doc_type_receta' },
  { value: 'otro',            labelKey: 'doc_type_otro' },
];

export const DocumentMetadataModal = ({ open, onClose, onSave, document, fileName }) => {
  const t = useT();

  const [form, setForm] = useState({
    nombre: '',
    tipo: 'plan_nutricional',
    fechaDocumento: '',
    notas: '',
  });

  useEffect(() => {
    if (open) {
      if (document) {
        setForm({
          nombre: document.nombre || '',
          tipo: document.tipo || 'plan_nutricional',
          fechaDocumento: document.fechaDocumento || '',
          notas: document.notas || '',
        });
      } else {
        setForm({
          nombre: fileName ? fileName.replace(/\.pdf$/i, '') : '',
          tipo: 'plan_nutricional',
          fechaDocumento: new Date().toISOString().slice(0, 10),
          notas: '',
        });
      }
    }
  }, [open, document, fileName]);

  const handleSave = () => {
    onSave({
      nombre: form.nombre.trim() || (fileName || 'Documento'),
      tipo: form.tipo,
      fechaDocumento: form.fechaDocumento,
      notas: form.notas.trim(),
    });
  };

  const typeOptions = DOC_TYPES.map(dt => ({
    value: dt.value,
    label: t[dt.labelKey] || dt.value,
  }));

  return (
    <Modal open={open} onClose={onClose} title={document ? t.doc_edit : t.doc_upload} size="md">
      <div className="space-y-4">
        <Input
          label={t.doc_name}
          value={form.nombre}
          onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
          placeholder={fileName || ''}
        />
        <Select
          label={t.doc_type}
          value={form.tipo}
          onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
          options={typeOptions}
        />
        <Input
          label={t.doc_date}
          type="date"
          value={form.fechaDocumento}
          onChange={e => setForm(f => ({ ...f, fechaDocumento: e.target.value }))}
        />
        <Textarea
          label={t.doc_notes}
          value={form.notas}
          onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
          rows={3}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t.cancel}</Button>
          <Button onClick={handleSave}>{t.save}</Button>
        </div>
      </div>
    </Modal>
  );
};
