import React, { useState } from 'react';
import { FileText, Upload, Eye, Mail, Edit2, Trash2 } from 'lucide-react';
import { Button, EmptyState, useToast, useConfirm } from './UI';
import { DocumentMetadataModal } from './DocumentMetadataModal';
import useStore, { formatDate } from '../stores/store';
import { useT } from '../i18n';
import {
  selectPdfFile,
  uploadDocument,
  openDocument,
  deleteDocumentFile,
  formatFileSize,
} from '../services/documentService';

const TYPE_COLORS = {
  plan_nutricional: 'bg-wellness-100 text-wellness-700',
  informe:          'bg-info/10 text-info',
  analitica:        'bg-purple-100 text-purple-700',
  receta:           'bg-amber-100 text-amber-700',
  otro:             'bg-sage-100 text-sage-600',
};

const TYPE_LABEL_KEYS = {
  plan_nutricional: 'doc_type_plan',
  informe:          'doc_type_informe',
  analitica:        'doc_type_analitica',
  receta:           'doc_type_receta',
  otro:             'doc_type_otro',
};

export const ClientDocuments = ({ clientId, client, onSendEmail }) => {
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const documents = useStore(s => s.getClientDocuments(clientId));
  const addClientDocument = useStore(s => s.addClientDocument);
  const updateClientDocument = useStore(s => s.updateClientDocument);
  const deleteClientDocument = useStore(s => s.deleteClientDocument);

  const [filterType, setFilterType] = useState('all');
  const [metadataModal, setMetadataModal] = useState(null); // { mode: 'upload'|'edit', doc?, filePath?, fileName? }

  const filtered = filterType === 'all' ? documents : documents.filter(d => d.tipo === filterType);

  const handleUpload = async () => {
    try {
      const filePath = await selectPdfFile();
      if (!filePath) return;

      const fileName = filePath.split(/[/\\]/).pop();
      setMetadataModal({ mode: 'upload', filePath, fileName });
    } catch (err) {
      toast.error(t.doc_upload_error);
    }
  };

  const handleUploadConfirm = async (metadata) => {
    const { filePath, fileName } = metadataModal;
    setMetadataModal(null);

    try {
      const result = await uploadDocument(filePath, clientId, fileName);

      addClientDocument({
        clienteId: clientId,
        nombre: metadata.nombre,
        tipo: metadata.tipo,
        fileName,
        storedFileName: result.storedFileName,
        fileSize: result.fileSize,
        fechaDocumento: metadata.fechaDocumento,
        notas: metadata.notas,
      });

      toast.success(t.doc_upload_success);
    } catch (err) {
      const msg = err?.toString() || '';
      if (msg.includes('file_too_large')) toast.error(t.doc_file_too_large);
      else if (msg.includes('invalid_pdf')) toast.error(t.doc_invalid_pdf);
      else toast.error(t.doc_upload_error);
    }
  };

  const handleEditConfirm = (metadata) => {
    const doc = metadataModal.doc;
    setMetadataModal(null);
    updateClientDocument(doc.id, metadata);
    toast.success(t.doc_update_success);
  };

  const handleOpen = async (doc) => {
    try {
      await openDocument(clientId, doc.storedFileName);
    } catch {
      toast.error(t.doc_open_error);
    }
  };

  const handleDelete = async (doc) => {
    const ok = await confirm({ title: t.doc_delete, message: t.doc_confirm_delete, danger: true });
    if (!ok) return;
    try {
      await deleteDocumentFile(clientId, doc.storedFileName);
    } catch { /* file may already be gone */ }
    deleteClientDocument(doc.id);
    toast.success(t.doc_delete_success);
  };

  const handleEmail = (doc) => {
    if (onSendEmail) onSendEmail(doc);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="text-xs border border-sage-200 rounded-button px-2 py-1.5 bg-white dark:bg-sage-800 dark:border-sage-600 dark:text-sage-200"
          >
            <option value="all">{t.doc_filter_all}</option>
            {Object.entries(TYPE_LABEL_KEYS).map(([val, key]) => (
              <option key={val} value={val}>{t[key]}</option>
            ))}
          </select>
        </div>
        <Button size="sm" icon={Upload} onClick={handleUpload}>
          {t.doc_upload}
        </Button>
      </div>

      {/* Document list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t.doc_no_documents}
          description={t.doc_no_documents_desc}
          action={<Button size="sm" icon={Upload} onClick={handleUpload}>{t.doc_upload}</Button>}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => (
            <div
              key={doc.id}
              className="flex items-center gap-3 p-3 bg-white dark:bg-sage-800 border border-sage-150 dark:border-sage-700 rounded-soft hover:shadow-card transition-shadow"
            >
              {/* Icon */}
              <div className="flex-shrink-0 w-9 h-9 rounded-soft bg-sage-50 dark:bg-sage-700 flex items-center justify-center">
                <FileText size={18} className="text-sage-400" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-sage-800 dark:text-sage-100 truncate">
                    {doc.nombre || doc.fileName}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-badge font-medium ${TYPE_COLORS[doc.tipo] || TYPE_COLORS.otro}`}>
                    {t[TYPE_LABEL_KEYS[doc.tipo]] || doc.tipo}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {doc.fechaDocumento && (
                    <span className="text-[11px] text-sage-400">{formatDate(doc.fechaDocumento)}</span>
                  )}
                  {doc.fileSize > 0 && (
                    <span className="text-[11px] text-sage-400">{formatFileSize(doc.fileSize)}</span>
                  )}
                  {doc.notas && (
                    <span className="text-[11px] text-sage-400 truncate max-w-[200px]">{doc.notas}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleOpen(doc)}
                  title={t.doc_open}
                  className="p-1.5 text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 rounded-button transition-colors"
                >
                  <Eye size={15} />
                </button>
                {onSendEmail && (
                  <button
                    onClick={() => handleEmail(doc)}
                    title={t.doc_email_document}
                    className="p-1.5 text-sage-400 hover:text-info hover:bg-info/10 rounded-button transition-colors"
                  >
                    <Mail size={15} />
                  </button>
                )}
                <button
                  onClick={() => setMetadataModal({ mode: 'edit', doc })}
                  title={t.doc_edit}
                  className="p-1.5 text-sage-400 hover:text-sage-600 hover:bg-sage-100 rounded-button transition-colors"
                >
                  <Edit2 size={15} />
                </button>
                <button
                  onClick={() => handleDelete(doc)}
                  title={t.doc_delete}
                  className="p-1.5 text-sage-400 hover:text-danger hover:bg-danger/10 rounded-button transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Metadata modal */}
      {metadataModal && (
        <DocumentMetadataModal
          open={true}
          onClose={() => setMetadataModal(null)}
          onSave={metadataModal.mode === 'upload' ? handleUploadConfirm : handleEditConfirm}
          document={metadataModal.mode === 'edit' ? metadataModal.doc : null}
          fileName={metadataModal.fileName}
        />
      )}

      {ConfirmDialog}
    </div>
  );
};
