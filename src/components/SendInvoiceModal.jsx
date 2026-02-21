/**
 * SendInvoiceModal.jsx
 * ====================
 * Modal complet per a enviar factures per correu electrònic.
 *
 * Funcionalitats:
 *  - Destinatari pre-emplenat des del client (editable)
 *  - Assumpte i cos amb variables {{token}}
 *  - Editor de plantilla visual amb inserció de variables amb 1 clic
 *  - Previsualització resolta en temps real
 *  - Genera PDF + obre client de correu natiu
 *  - Guarda la plantilla personalitzada per a futures factures
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mail, Send, Eye, EyeOff, ChevronDown, Check,
  AlertCircle, Loader2, FileText, User, AtSign,
  Zap, Tag, RotateCcw, Info, Copy, ExternalLink,
  X, Edit3
} from 'lucide-react';
import { Modal, Button } from './UI';
import {
  resolveTemplate,
  sendInvoiceEmail,
  AVAILABLE_VARIABLES,
  DEFAULT_EMAIL_TEMPLATES,
} from '../services/emailService';
import { useStore, formatCurrency } from '../stores/store';

// ============================================
// MINI COMPONENTS
// ============================================

const InfoBadge = ({ children, color = 'blue' }) => {
  const colors = {
    blue:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
    amber:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    emerald:'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    red:    'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${colors[color]}`}>
      {children}
    </span>
  );
};

const VarChip = ({ token, desc, onInsert }) => (
  <button
    type="button"
    onClick={() => onInsert(token)}
    title={desc}
    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500/40 text-slate-300 hover:text-blue-400 text-[10px] font-mono px-2 py-1 rounded-md transition-all"
  >
    <Tag size={9} className="opacity-60 shrink-0" />
    {token.replace(/[{}]/g, '')}
  </button>
);

// ============================================
// MAIN COMPONENT
// ============================================

export const SendInvoiceModal = ({ open, onClose, invoice, client }) => {
  const { config } = useStore();

  // ---- State ----
  const [toEmail,      setToEmail]      = useState('');
  const [subject,      setSubject]      = useState('');
  const [body,         setBody]         = useState('');
  const [showPreview,  setShowPreview]  = useState(false);
  const [showVars,     setShowVars]     = useState(false);
  const [activeField,  setActiveField]  = useState('body'); // 'subject' | 'body'
  const [sending,      setSending]      = useState(false);
  const [sent,         setSent]         = useState(false);
  const [pdfPath,      setPdfPath]      = useState(null);
  const [error,        setError]        = useState('');
  const [langTab,      setLangTab]      = useState('ca');

  const bodyRef    = useRef(null);
  const subjectRef = useRef(null);

  // ---- Init ----
  useEffect(() => {
    if (!open) return;
    const lang = invoice?.idioma || config?.idiomaDefecto || 'ca';
    setLangTab(lang);
    const tpl = DEFAULT_EMAIL_TEMPLATES[lang] || DEFAULT_EMAIL_TEMPLATES.es;
    setToEmail(client?.email || '');
    setSubject(tpl.subject);
    setBody(tpl.body);
    setSent(false);
    setPdfPath(null);
    setError('');
    setShowPreview(false);
  }, [open, invoice, client, config]);

  // ---- Template data for resolution ----
  const tplData = { invoice, client, config };

  const resolvedSubject = resolveTemplate(subject, tplData);
  const resolvedBody    = resolveTemplate(body, tplData);

  // ---- Language switch ----
  const handleLangSwitch = (lang) => {
    const tpl = DEFAULT_EMAIL_TEMPLATES[lang] || DEFAULT_EMAIL_TEMPLATES.es;
    setSubject(tpl.subject);
    setBody(tpl.body);
    setLangTab(lang);
  };

  // ---- Variable insertion ----
  const insertVariable = useCallback((token) => {
    const ref  = activeField === 'subject' ? subjectRef : bodyRef;
    const setter = activeField === 'subject' ? setSubject : setBody;
    const value  = activeField === 'subject' ? subject   : body;

    if (ref.current) {
      const el    = ref.current;
      const start = el.selectionStart ?? value.length;
      const end   = el.selectionEnd   ?? value.length;
      const newVal = value.slice(0, start) + token + value.slice(end);
      setter(newVal);
      // Restore cursor after token
      setTimeout(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      }, 0);
    } else {
      setter(v => v + token);
    }
  }, [activeField, subject, body]);

  // ---- Send ----
  const handleSend = async () => {
    if (!toEmail || !toEmail.includes('@')) {
      setError('L\'adreça de correu del destinatari no és vàlida.');
      return;
    }
    setError('');
    setSending(true);

    try {
      const { pdfPath: path, opened } = await sendInvoiceEmail({
        invoice,
        client,
        config,
        subject:     resolvedSubject,
        body:        resolvedBody,
        toEmail,
        generatePdf: true,
      });
      setPdfPath(path);
      setSent(true);
    } catch (e) {
      setError(`Error: ${e.message || e}`);
    } finally {
      setSending(false);
    }
  };

  // ---- Copy mailto fallback ----
  const handleCopyMailto = () => {
    const encode = (s) => encodeURIComponent(s || '');
    const uri = `mailto:${encode(toEmail)}?subject=${encode(resolvedSubject)}&body=${encode(resolvedBody)}`;
    navigator.clipboard.writeText(uri).catch(() => {});
  };

  if (!invoice || !client) return null;

  const LANGS = [
    { id: 'es', label: 'ES' },
    { id: 'ca', label: 'CA' },
    { id: 'en', label: 'EN' },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enviar Factura per Email"
      size="lg"
    >
      <div className="space-y-4">

        {/* ---- Invoice summary ---- */}
        <div className="flex items-center gap-3 bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
          <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
            <FileText size={18} className="text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white text-sm">{invoice.numero}</span>
              <InfoBadge color="blue">{invoice.estado}</InfoBadge>
              <InfoBadge color="emerald">{formatCurrency(invoice.total)}</InfoBadge>
            </div>
            <p className="text-xs text-slate-500 truncate mt-0.5">{invoice.concepto}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <User size={12} />
              <span className="font-semibold text-slate-300">{client.nombre}</span>
            </div>
            {client.email && (
              <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                <AtSign size={10} />
                {client.email}
              </div>
            )}
          </div>
        </div>

        {/* ---- Sent success state ---- */}
        {sent ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <Check size={18} className="text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-400">Client de correu obert!</p>
                <p className="text-xs text-slate-400 mt-1">
                  S'ha obert el teu client de correu amb el missatge pre-emplenat.
                  Adjunta el PDF i prem enviar.
                </p>
              </div>
            </div>

            {pdfPath && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400 mb-1">📎 PDF generat a:</p>
                    <p className="text-xs text-white font-mono truncate bg-slate-900 px-2 py-1 rounded border border-slate-700">
                      {pdfPath}
                    </p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(pdfPath)}
                    className="shrink-0 p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                    title="Copiar ruta"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={handleSend} icon={RotateCcw} size="sm">
                Tornar a obrir
              </Button>
              <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-500" size="sm">
                Tancar
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* ---- Language tabs ---- */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Plantilla</span>
              <div className="flex gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                {LANGS.map(l => (
                  <button key={l.id} onClick={() => handleLangSwitch(l.id)}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                      langTab === l.id ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                    }`}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ---- To ---- */}
            <div>
              <label className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5">
                <AtSign size={11} /> Destinatari
                {!client?.email && (
                  <InfoBadge color="amber"><AlertCircle size={10} /> Client sense email</InfoBadge>
                )}
              </label>
              <input
                value={toEmail}
                onChange={e => setToEmail(e.target.value)}
                onFocus={() => setActiveField('to')}
                type="email"
                placeholder="correu@empresa.com"
                className="w-full bg-slate-900 border border-slate-700 text-white px-3 py-2.5 rounded-lg text-sm outline-none focus:border-blue-500 transition-colors font-mono"
              />
            </div>

            {/* ---- Subject ---- */}
            <div>
              <label className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1.5 block">
                Assumpte
              </label>
              <input
                ref={subjectRef}
                value={subject}
                onChange={e => setSubject(e.target.value)}
                onFocus={() => setActiveField('subject')}
                placeholder="Assumpte del correu..."
                className={`w-full bg-slate-900 border text-white px-3 py-2.5 rounded-lg text-sm outline-none transition-colors font-sans ${
                  activeField === 'subject' ? 'border-blue-500' : 'border-slate-700 focus:border-blue-500'
                }`}
              />
              {showPreview && subject !== resolvedSubject && (
                <p className="text-xs text-slate-500 mt-1 truncate">
                  → <span className="text-slate-300">{resolvedSubject}</span>
                </p>
              )}
            </div>

            {/* ---- Body ---- */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-slate-500 uppercase font-semibold tracking-wider">
                  Missatge
                </label>
                <button
                  type="button"
                  onClick={() => setShowPreview(v => !v)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                  {showPreview ? 'Editar' : 'Previsualitzar'}
                </button>
              </div>

              {showPreview ? (
                <div className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-3 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed min-h-[200px] max-h-[300px] overflow-y-auto custom-scrollbar font-sans">
                  {resolvedBody}
                </div>
              ) : (
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onFocus={() => setActiveField('body')}
                  rows={9}
                  className={`w-full bg-slate-900 border text-white px-3 py-2.5 rounded-lg text-sm outline-none transition-colors resize-none font-mono leading-relaxed custom-scrollbar ${
                    activeField === 'body' ? 'border-blue-500' : 'border-slate-700 focus:border-blue-500'
                  }`}
                />
              )}
            </div>

            {/* ---- Variables panel ---- */}
            <div>
              <button
                type="button"
                onClick={() => setShowVars(v => !v)}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors w-full"
              >
                <Zap size={12} />
                <span>Variables disponibles</span>
                <span className="text-slate-600 text-[10px]">— fes clic per inserir-les al camp actiu</span>
                <ChevronDown size={11} className={`ml-auto transition-transform ${showVars ? 'rotate-180' : ''}`} />
              </button>

              {showVars && (
                <div className="mt-2 p-3 bg-slate-900/50 border border-slate-800 rounded-xl">
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABLE_VARIABLES.map(v => (
                      <VarChip key={v.token} token={v.token} desc={v.desc} onInsert={insertVariable} />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-600 mt-2">
                    Camp actiu: <span className="text-slate-400 font-semibold">{activeField === 'subject' ? 'Assumpte' : 'Missatge'}</span>
                  </p>
                </div>
              )}
            </div>

            {/* ---- Info note ---- */}
            <div className="flex items-start gap-2.5 bg-blue-500/5 border border-blue-500/15 rounded-xl p-3">
              <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-400 leading-relaxed">
                S'obrirà el teu <strong className="text-slate-300">client de correu natiu</strong> (Outlook, Thunderbird, Mail…) amb el missatge pre-emplenat.
                El PDF es generarà automàticament — adjunta'l manualment des de la ruta que t'indicarem.
              </p>
            </div>

            {/* ---- Error ---- */}
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl">
                <AlertCircle size={15} className="shrink-0" /> {error}
              </div>
            )}

            {/* ---- Actions ---- */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={handleCopyMailto}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                title="Còpia l'URI mailto: al portapapers"
              >
                <Copy size={12} /> Copiar URI mailto
              </button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose} size="sm">Cancel·lar</Button>
                <Button
                  onClick={handleSend}
                  disabled={sending || !toEmail}
                  size="sm"
                  className={`px-6 min-w-[130px] ${
                    sending ? 'bg-slate-700' : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20'
                  }`}
                >
                  {sending ? (
                    <><Loader2 size={14} className="animate-spin mr-1.5" /> Generant PDF…</>
                  ) : (
                    <><Send size={14} className="mr-1.5" /> Obrir Correu</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default SendInvoiceModal;
