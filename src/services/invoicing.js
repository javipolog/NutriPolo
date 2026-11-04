/**
 * invoicing.js — NutriPolo
 * Invoice rules that do not depend on React or the store (pure, tested):
 *
 *  - Draft → issued. A draft has no number and can be edited or deleted.
 *    Issuing gives it the next number of its series and freezes the issuer's
 *    and the client's data as they are that day (`emisor`, `destinatario`),
 *    so the PDF of an old invoice never changes when a record does.
 *  - An issued invoice is not edited or deleted: only how and when it was
 *    paid. Mistakes are corrected with a corrective invoice (series R).
 *  - Income book (CSV for the accountant) and quarterly summary.
 *
 * Tax wording here is a sensible default: the accountant must confirm it.
 */

export const SERIES = { ordinaria: 'NP', rectificativa: 'R' };

/** Fields an issued invoice may still change: they do not appear as invoice data. */
export const PAYMENT_FIELDS = ['estado', 'metodoPago', 'fechaCobro'];

export const DEFAULT_VAT_EXEMPTION_TEXT =
  'Operación exenta de IVA conforme al artículo 20.Uno.3º de la Ley 37/1992 del Impuesto sobre el Valor Añadido (asistencia sanitaria).';

export const isIssued = (invoice) => !!invoice?.emitidaAt;
export const isCorrective = (invoice) => invoice?.tipo === 'rectificativa';
export const seriesOf = (invoice) => (isCorrective(invoice) ? SERIES.rectificativa : SERIES.ordinaria);

const clean = (v) => (typeof v === 'string' ? v.trim() : v) || '';

/** The issuer's data as printed on the invoice. */
export function issuerSnapshot(config = {}) {
  return {
    nombre: clean(config.nombre),
    nif: clean(config.nif),
    direccion: clean(config.direccion),
    numColegiada: clean(config.numColegiada),
    email: clean(config.email),
    telefono: clean(config.telefono),
    web: clean(config.web),
    iban: clean(config.iban),
  };
}

/** The client's data as printed on the invoice. */
export function recipientSnapshot(client = {}) {
  return {
    nombre: clean(client.nombre),
    nif: clean(client.nif || client.cifNif),
    calle: clean(client.calle),
    codigoPostal: clean(client.codigoPostal),
    ciudad: clean(client.ciudad),
    provincia: clean(client.provincia),
    email: clean(client.email),
    telefono: clean(client.telefono),
  };
}

/** Issuer and recipient to print: frozen ones once issued, current ones for a draft. */
export function invoiceParties(invoice, client, config) {
  return {
    emisor: invoice?.emisor || issuerSnapshot(config),
    destinatario: invoice?.destinatario || recipientSnapshot(client),
  };
}

/** Postal address lines of a recipient snapshot. */
export function recipientAddressLines(d = {}) {
  return [d.calle, [d.codigoPostal, d.ciudad].filter(Boolean).join(' '), d.provincia].filter(Boolean);
}

/** Display name of an invoice's client: frozen on issue, so it survives deleting the record. */
export function invoiceClientName(invoice, clients = []) {
  return invoice?.destinatario?.nombre || clients.find(c => c.id === invoice?.clienteId)?.nombre || '';
}

// ---- numbering -------------------------------------------------------------

const NUMBER_RE = /^([A-Z]+)-(\d{4})-(\d+)$/;

/** Next number of the series for the year of `fecha`: NP-2026-001, R-2026-001… */
export function nextInvoiceNumber(invoices = [], fecha, serie = SERIES.ordinaria) {
  const year = /^\d{4}/.test(fecha || '') ? fecha.slice(0, 4) : String(new Date().getFullYear());
  const max = invoices.reduce((m, inv) => {
    const match = NUMBER_RE.exec(inv?.numero || '');
    return match && match[1] === serie && match[2] === year ? Math.max(m, parseInt(match[3], 10)) : m;
  }, 0);
  return `${serie}-${year}-${String(max + 1).padStart(3, '0')}`;
}

/** Latest issued invoice of the series and year of `fecha` (by number). */
export function lastIssuedOfSeries(invoices = [], fecha, serie = SERIES.ordinaria) {
  const year = (fecha || '').slice(0, 4);
  let last = null;
  let lastSeq = 0;
  for (const inv of invoices) {
    const match = NUMBER_RE.exec(inv?.numero || '');
    if (!match || match[1] !== serie || match[2] !== year || !isIssued(inv)) continue;
    const seq = parseInt(match[3], 10);
    if (seq > lastSeq) { lastSeq = seq; last = inv; }
  }
  return last;
}

// ---- checks before issuing ---------------------------------------------------

/**
 * What stops an invoice from being issued, as { code, ... } objects:
 *   issuer_nif         → the issuer's NIF is missing (Settings)
 *   recipient_nif      → invoice with IRPF withholding (a company or a
 *   recipient_address    professional) without the client's NIF / address
 *   date_before_last   → dated before the last issued invoice of its series
 *                        (numbers must follow the dates): { last }
 *   corrective_reason  → a corrective invoice without its reason
 */
export function issueProblems(invoice, client, config, invoices = []) {
  const problems = [];
  const emisor = issuerSnapshot(config);
  const destinatario = recipientSnapshot(client);
  if (!emisor.nif) problems.push({ code: 'issuer_nif' });
  if ((Number(invoice?.irpfPct) || 0) > 0) {
    if (!destinatario.nif) problems.push({ code: 'recipient_nif' });
    if (!destinatario.calle) problems.push({ code: 'recipient_address' });
  }
  const last = lastIssuedOfSeries(invoices.filter(i => i.id !== invoice?.id), invoice?.fecha, seriesOf(invoice));
  if (last && (invoice?.fecha || '') < (last.fecha || '')) problems.push({ code: 'date_before_last', last });
  if (isCorrective(invoice) && !clean(invoice?.motivoRectificacion)) problems.push({ code: 'corrective_reason' });
  return problems;
}

/**
 * Fields set when a draft is issued: its number and the frozen data.
 * `now` is an ISO timestamp.
 */
export function issueFields(invoice, client, config, invoices, now) {
  return {
    numero: nextInvoiceNumber(invoices.filter(i => i.id !== invoice.id), invoice.fecha, seriesOf(invoice)),
    emitidaAt: now,
    emisor: issuerSnapshot(config),
    destinatario: recipientSnapshot(client),
  };
}

// ---- corrective invoices -----------------------------------------------------

/**
 * Draft of a corrective invoice that cancels `original` in full: same lines
 * with negative prices, same taxes and client. The lines can then be edited
 * to correct only part of it.
 */
export function correctiveDraft(original, { fecha, generateId }) {
  return {
    tipo: 'rectificativa',
    rectificaA: original.id,
    rectificaNumero: original.numero,
    rectificaFecha: original.fecha,
    motivoRectificacion: '',
    clienteId: original.clienteId,
    fecha,
    estado: 'pendiente',
    metodoPago: original.metodoPago || '',
    locationId: original.locationId || null,
    notas: '',
    ivaPct: original.ivaPct ?? 0,
    irpfPct: original.irpfPct ?? 0,
    items: (original.items || []).map(item => ({
      ...item,
      id: generateId(),
      consultationId: null,
      precioUnitario: -(Number(item.precioUnitario) || 0),
    })),
  };
}

/** Whether issuing `corrective` cancels its original in full (totals add up to zero). */
export function cancelsInFull(corrective, original) {
  return Math.round(((corrective?.total ?? 0) + (original?.total ?? 0)) * 100) === 0;
}

// ---- consultations -------------------------------------------------------------

/**
 * Consultations already on an invoice (drafts included, so they are not
 * offered twice). A cancelled invoice frees its consultations again.
 */
export function billedConsultationIds(invoices = []) {
  return new Set(invoices
    .filter(inv => inv.estado !== 'anulada' && !isCorrective(inv))
    .flatMap(inv => (inv.items || []).map(item => item.consultationId).filter(Boolean)));
}

// ---- income book -----------------------------------------------------------------

export const quarterOf = (fecha) => (fecha ? Math.floor((parseInt(fecha.slice(5, 7), 10) - 1) / 3) + 1 : 0);

/** Issued invoices of `year` (and `quarter` 1–4, or all), oldest first. */
export function issuedInPeriod(invoices = [], year, quarter = 0) {
  return invoices
    .filter(inv => isIssued(inv) && inv.fecha?.startsWith(String(year)) && (!quarter || quarterOf(inv.fecha) === quarter))
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.numero || '').localeCompare(b.numero || '', undefined, { numeric: true }));
}

const cents = (n) => Math.round((Number(n) || 0) * 100);

/**
 * An invoice that adds to the period totals. A cancelled one with its
 * corrective invoice counts (the corrective, negative, cancels it out, as in
 * the books); one marked "anulada" by hand before corrective invoices
 * existed does not.
 */
export const countsInTotals = (inv) => inv.estado !== 'anulada' || !!inv.rectificadaPor?.length;

/**
 * Totals of issued invoices (see countsInTotals). `cobrado` is what was
 * actually received (paid invoices).
 */
export function periodTotals(invoices = []) {
  const sum = { base: 0, iva: 0, irpf: 0, total: 0, cobrado: 0 };
  for (const inv of invoices) {
    if (!countsInTotals(inv)) continue;
    sum.base += cents(inv.baseImponible);
    sum.iva += cents(inv.ivaImporte);
    sum.irpf += cents(inv.irpfImporte);
    sum.total += cents(inv.total);
    if (inv.estado === 'pagada') sum.cobrado += cents(inv.total);
  }
  return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / 100]));
}

const csvNumber = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');
const csvDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const csvText = (v) => {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const BOOK_COLUMNS = [
  'Fecha', 'Número', 'Tipo', 'Rectifica a', 'Cliente', 'NIF cliente',
  'Base imponible', '% IVA', 'Cuota IVA', '% IRPF', 'Retención IRPF', 'Total',
  'Estado', 'Fecha de cobro', 'Forma de pago',
];

/**
 * Income book as CSV for a Spanish Excel: `;` separator, decimal comma,
 * dd/mm/yyyy dates and a BOM so accents open right.
 */
export function incomeBookCsv(invoices = []) {
  const rows = invoices.map(inv => [
    csvDate(inv.fecha),
    inv.numero,
    isCorrective(inv) ? 'Rectificativa' : 'Ordinaria',
    inv.rectificaNumero || '',
    inv.destinatario?.nombre || '',
    inv.destinatario?.nif || '',
    csvNumber(inv.baseImponible),
    csvNumber(inv.ivaPct),
    csvNumber(inv.ivaImporte),
    csvNumber(inv.irpfPct),
    csvNumber(inv.irpfImporte),
    csvNumber(inv.total),
    inv.estado === 'pagada' ? 'Cobrada' : inv.estado === 'anulada' ? 'Anulada' : 'Pendiente',
    csvDate(inv.fechaCobro),
    inv.metodoPago || '',
  ]);
  const totals = periodTotals(invoices);
  rows.push(['', '', '', '', 'TOTAL', '', csvNumber(totals.base), '', csvNumber(totals.iva), '', csvNumber(totals.irpf), csvNumber(totals.total), '', '', '']);
  return '﻿' + [BOOK_COLUMNS, ...rows].map(r => r.map(csvText).join(';')).join('\r\n') + '\r\n';
}

// ---- IBAN ------------------------------------------------------------------------

/** IBAN with its check digits right (any country). Spaces are ignored. */
export function isValidIban(value) {
  const iban = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** IBAN in groups of four, as it is usually printed. */
export const formatIban = (value) => String(value || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
