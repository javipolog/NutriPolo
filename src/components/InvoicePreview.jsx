import React, { useEffect } from 'react';
import { useDesignStore, loadGoogleFonts } from '../stores/designStore';
import { formatCurrency } from '../stores/store';

export const InvoicePreviewModern = ({ invoice, client, config, scale = 1 }) => {
  const { design, getLabels } = useDesignStore();
  const labels = getLabels(invoice?.idioma || 'es');

  useEffect(() => { loadGoogleFonts(design.fonts); }, [design.fonts]);

  const formatDateShort = (d) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getFullYear()).slice(-2)}`;
  };

  const fonts = design.fonts || {};
  const colors = design.colors || {};
  const fontSizes = design.fontSizes || {};
  const sections = design.sections || {};
  const logo = design.logo || {};
  const layout = design.layout || {};
  const table = design.table || {};
  const blocks = design.blocks || {};
  const p = layout.pageMargin || 30;

  // ---- Table row style ----
  const getRowBg = (i) => {
    if (table.style === 'zebra') return i % 2 === 0 ? 'transparent' : `${colors.accent}0D`;
    return 'transparent';
  };
  const getRowBorder = () => {
    if (table.style === 'lines' || table.style === 'bordered') return `1px solid ${colors.divider}30`;
    if (table.style === 'minimal') return 'none';
    return 'none';
  };
  const getTableHeaderBg = () => table.headerBg ? colors.tableHead || '#f5f5f5' : 'transparent';

  const s = {
    page: { width: '210mm', minHeight: '297mm', backgroundColor: colors.background, color: colors.primary, fontFamily: `"${fonts.secondary}", Arial, sans-serif`, fontSize: fontSizes.body, padding: `${p}px`, boxSizing: 'border-box', position: 'relative', transform: `scale(${scale})`, transformOrigin: 'top left' },
    headerRow: { display: 'flex', justifyContent: layout.headerLayout === 'logo-right' ? 'flex-end' : layout.headerLayout === 'logo-center' ? 'center' : 'space-between', alignItems: 'flex-start', marginBottom: `${(blocks.header||{}).marginBottom ?? 60}px`, gap: '20px' },
    logo: { fontFamily: `"${fonts.primary}", Arial, sans-serif`, fontWeight: '700', fontSize: '24px', letterSpacing: '2px', color: colors.accent },
    logoImage: { maxWidth: `${logo.width}px`, maxHeight: `${logo.height}px`, objectFit: 'contain' },
    invoiceInfo: { textAlign: 'right', fontSize: fontSizes.small, flexShrink: 0 },
    infoRow: { display: 'flex', justifyContent: 'flex-end', gap: '30px', marginBottom: '4px' },
    infoLabel: { fontWeight: '700', fontFamily: `"${fonts.secondary}", Arial, sans-serif` },
    infoValue: { width: '100px', textAlign: 'right', fontFamily: `"${fonts.mono}", monospace` },
    partiesContainer: { display: 'flex', justifyContent: 'space-between', marginBottom: `${(blocks.parties||{}).marginBottom ?? 60}px`, gap: '40px', flexDirection: layout.partyLayout === 'stacked' ? 'column' : 'row' },
    partySection: { width: layout.partyLayout === 'stacked' ? '100%' : '45%' },
    partyTitle: { fontFamily: `"${fonts.secondary}", Arial, sans-serif`, fontWeight: '700', fontSize: fontSizes.header, marginBottom: '15px', color: colors.accent },
    partyContent: { borderBottom: `${layout.borderWidth}px ${layout.borderStyle} ${colors.divider}`, paddingBottom: '15px' },
    partyName: { fontFamily: `"${fonts.primary}", Arial, sans-serif`, fontSize: fontSizes.body, marginBottom: '5px' },
    partyDetail: { fontFamily: `"${fonts.primary}", Arial, sans-serif`, fontSize: fontSizes.body, lineHeight: '1.6', whiteSpace: 'pre-line' },
    conceptSection: { marginBottom: `${(blocks.concept||{}).marginBottom ?? 80}px` },
    thCell: { fontFamily: `"${fonts.secondary}", Arial, sans-serif`, fontWeight: '700', fontSize: fontSizes.small, color: colors.accent, padding: `6px ${table.rowPadding || 8}px`, backgroundColor: getTableHeaderBg(), borderBottom: `${layout.borderWidth}px ${layout.borderStyle} ${colors.divider}`, ...(table.style === 'bordered' ? { border: `1px solid ${colors.divider}` } : {}) },
    tdCell: { fontFamily: `"${fonts.secondary}", Arial, sans-serif`, fontSize: fontSizes.header, padding: `${table.rowPadding || 8}px` },
    totalsSection: { display: 'flex', justifyContent: layout.totalsAlign === 'left' ? 'flex-start' : layout.totalsAlign === 'center' ? 'center' : 'flex-end', marginBottom: `${(blocks.totals||{}).marginBottom ?? 40}px` },
    totalsBox: { width: '280px' },
    totalRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontFamily: `"${fonts.primary}", Arial, sans-serif`, fontSize: fontSizes.header },
    grandTotalRow: { display: 'flex', justifyContent: 'space-between', padding: '15px 0', marginTop: '10px', fontFamily: `"${fonts.primary}", Arial, sans-serif`, fontSize: fontSizes.total, fontWeight: '700', borderTop: `${layout.borderWidth}px ${layout.borderStyle} ${colors.highlight || colors.accent}`, color: colors.highlight || colors.accent },
    footer: { position: 'absolute', bottom: `${p}px`, left: `${p}px`, right: `${p}px` },
    paymentSection: { borderTop: `${layout.borderWidth}px ${layout.borderStyle} ${colors.divider}`, paddingTop: '20px' },
    paymentRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: fontSizes.body, fontFamily: `"${fonts.primary}", Arial, sans-serif` },
    contactRow: { display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${colors.divider}20`, paddingTop: '15px', marginTop: '15px', fontSize: fontSizes.small, color: colors.muted },
  };

  const renderLogo = () => {
    if (!sections.showLogo) return null;
    if (logo.type === 'image' && logo.imageUrl) return <img src={logo.imageUrl} alt="Logo" style={s.logoImage} />;
    if (logo.type === 'svg' && logo.svgContent) return <div style={{ width: logo.width, height: logo.height }} dangerouslySetInnerHTML={{ __html: logo.svgContent }} />;
    return <div style={s.logo}>{logo.text || config?.nombre?.split(' ')[0]?.toUpperCase() || 'LOGO'}</div>;
  };

  const tableStyle = { width: '100%', borderCollapse: table.style === 'bordered' ? 'collapse' : 'collapse', marginBottom: 0 };

  return (
    <div className="invoice-preview-modern print-area" style={s.page}>
      {/* HEADER */}
      <div style={s.headerRow}>
        {renderLogo()}
        {layout.headerLayout !== 'logo-only' && (
          <div style={s.invoiceInfo}>
            <div style={s.infoRow}><span style={s.infoLabel}>{labels.invoiceNumber}</span><span style={s.infoValue}>{invoice?.numero || '---'}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>{labels.date}</span><span style={s.infoValue}>{invoice?.fecha ? formatDateShort(invoice.fecha) : '--/--/--'}</span></div>
          </div>
        )}
      </div>

      {/* PARTIES */}
      <div style={s.partiesContainer}>
        <div style={s.partySection}>
          <div style={s.partyTitle}>{labels.freelance}</div>
          <div style={s.partyContent}>
            <div style={s.partyName}>{config?.nombre || '---'}</div>
            <div style={s.partyDetail}>{labels.nif}: {config?.nif || '---'}</div>
            <div style={s.partyDetail}>{config?.direccion || '---'}</div>
          </div>
        </div>
        <div style={s.partySection}>
          <div style={s.partyTitle}>{labels.client}</div>
          <div style={s.partyContent}>
            <div style={s.partyName}>{client?.nombre || '---'}</div>
            <div style={s.partyDetail}>{labels.nif}: {client?.cifNif || '---'}</div>
            <div style={s.partyDetail}>{client?.direccion || '---'}</div>
          </div>
        </div>
      </div>

      {/* CONCEPT TABLE */}
      <div style={s.conceptSection}>
        <table style={tableStyle}>
          <thead>
            {invoice?.tipo === 'jornadas' ? (
              <tr>
                <th style={{ ...s.thCell, textAlign: 'left', width: '50%' }}>{labels.concept}</th>
                <th style={{ ...s.thCell, textAlign: 'center' }}>{labels.days}</th>
                <th style={{ ...s.thCell, textAlign: 'center' }}>{labels.rate}</th>
                <th style={{ ...s.thCell, textAlign: 'right' }}>{labels.taxBase}</th>
              </tr>
            ) : (
              <tr>
                <th style={{ ...s.thCell, textAlign: 'left' }}>{labels.concept}</th>
                <th style={{ ...s.thCell, textAlign: 'right' }}>{labels.taxBase}</th>
              </tr>
            )}
          </thead>
          <tbody>
            {invoice?.tipo === 'jornadas' ? (
              <tr style={{ backgroundColor: getRowBg(0), borderBottom: getRowBorder() }}>
                <td style={{ ...s.tdCell, textAlign: 'left' }}>{invoice?.concepto || '---'}</td>
                <td style={{ ...s.tdCell, textAlign: 'center' }}>{invoice?.jornadas || 0}</td>
                <td style={{ ...s.tdCell, textAlign: 'center' }}>{formatCurrency(invoice?.tarifaDia)}</td>
                <td style={{ ...s.tdCell, textAlign: 'right', fontFamily: `"${fonts.mono}", monospace` }}>{formatCurrency(invoice?.subtotal)}</td>
              </tr>
            ) : (
              <tr style={{ backgroundColor: getRowBg(0), borderBottom: getRowBorder() }}>
                <td style={{ ...s.tdCell, textAlign: 'left' }}>{invoice?.concepto || '---'}</td>
                <td style={{ ...s.tdCell, textAlign: 'right', fontFamily: `"${fonts.mono}", monospace` }}>{formatCurrency(invoice?.subtotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {sections.showConceptNote && labels.conceptNote && (
          <div style={{ fontSize: fontSizes.small, color: colors.muted, marginTop: '8px', fontStyle: 'italic' }}>{labels.conceptNote}</div>
        )}
      </div>

      {/* TOTALS */}
      <div style={s.totalsSection}>
        <div style={s.totalsBox}>
          <div style={s.totalRow}>
            <span>+ {invoice?.ivaPorcentaje || 21}% {labels.iva}</span>
            <span style={{ fontFamily: `"${fonts.mono}", monospace` }}>{formatCurrency(invoice?.iva)}</span>
          </div>
          <div style={s.totalRow}>
            <span>- {invoice?.irpfPorcentaje || 15}% {labels.irpf}</span>
            <span style={{ fontFamily: `"${fonts.mono}", monospace` }}>{formatCurrency(invoice?.irpf)}</span>
          </div>
          <div style={s.grandTotalRow}>
            <span>{labels.total}</span>
            <span style={{ fontFamily: `"${fonts.mono}", monospace` }}>{formatCurrency(invoice?.total)}</span>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={s.footer}>
        <div style={s.paymentSection}>
          {sections.showPaymentMethod && (
            <div style={s.paymentRow}><span style={{ fontWeight: '500' }}>{labels.paymentMethod}</span><span>{labels.transfer}</span></div>
          )}
          {sections.showBankDetails && (
            <div style={s.paymentRow}><span style={{ fontWeight: '500' }}>{labels.bankDetails}</span><span style={{ fontFamily: `"${fonts.mono}", monospace` }}>{config?.iban || '---'}</span></div>
          )}
          <div style={s.paymentRow}><span style={{ fontWeight: '500' }}>{labels.paymentConcept}</span><span>{invoice?.numero || '---'}</span></div>
          {sections.showFooterContact && (
            <div style={s.contactRow}>
              <span>{config?.email || '---'}</span>
              <span style={{ textDecoration: 'underline', fontWeight: '500' }}>{config?.web || '---'}</span>
              <span>{config?.telefono || '---'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const InvoicePreviewThumbnail = ({ invoice, client, config }) => (
  <div className="w-full aspect-[210/297] bg-white rounded shadow-sm overflow-hidden">
    <InvoicePreviewModern invoice={invoice} client={client} config={config} scale={0.25} />
  </div>
);

export default InvoicePreviewModern;
