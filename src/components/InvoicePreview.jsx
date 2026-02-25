import React, { useEffect } from 'react';
import { useDesignStore, loadGoogleFonts } from '../stores/designStore';
import { formatCurrency } from '../stores/store';

/**
 * InvoicePreviewModern — Layout CSS Grid 8 columnes (A-H)
 * Replica fidelment l'estructura del template Excel FACTURES_POLO.
 *
 * Estructura de columnes (mapping Excel):
 *   A (gutter esq.) | B-C-D (freelance/concepte) | E (separador) | F-G-H (client/totals/import)
 *
 * Totes les dimensions són configurables via design.grid (designStore).
 */
export const InvoicePreviewModern = ({ invoice, client, config, scale = 1 }) => {
  const { design, getLabels } = useDesignStore();
  const labels = getLabels(invoice?.idioma || 'es');

  useEffect(() => { loadGoogleFonts(design.fonts); }, [design.fonts]);

  // ---------- helpers ----------
  const formatDateShort = (d) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`;
  };

  // ---------- design tokens ----------
  const fonts = design.fonts || {};
  const colors = design.colors || {};
  const fontSizes = design.fontSizes || {};
  const sections = design.sections || {};
  const logo = design.logo || {};
  const grid = design.grid || {};
  const cols = grid.columns || [41, 110, 110, 110, 51, 110, 110, 110];
  const rows = grid.rows || {};
  const prefix = grid.labelPrefix ?? ': ';
  const footerPad = grid.footerPadding ?? 30;

  // Calcular ample total de la graella
  const totalWidth = cols.reduce((a, b) => a + b, 0);
  // Padding dret per centrar dins d'A4 (794px)
  const rightPad = Math.max(0, 794 - totalWidth);

  // ---------- estilos base ----------
  const fontPrimary = `"${fonts.primary}", Arial, sans-serif`;
  const fontSecondary = `"${fonts.secondary}", Arial, sans-serif`;
  const fontMono = `"${fonts.mono}", monospace`;

  // Calcular gridTemplateRows dinàmicament
  const r = {
    topPad: rows.topPadding ?? 15,
    infoH: rows.invoiceInfoHeight ?? 20,
    headerImgH: rows.headerImageHeight ?? 100,
    headerGap: rows.headerGap ?? 15,
    sectionLbl: rows.sectionLabelHeight ?? 22,
    partyGap: rows.partyGap ?? 8,
    partyLine: rows.partyLineHeight ?? 18,
    conceptGap: rows.conceptGap ?? 50,
    conceptHdr: rows.conceptHeaderHeight ?? 22,
    conceptRow: rows.conceptRowHeight ?? 20,
    totalsGap: rows.totalsGap ?? 35,
    totalRow: rows.totalRowHeight ?? 22,
    grandGap: rows.grandTotalGap ?? 15,
    grandH: rows.grandTotalHeight ?? 28,
  };

  // gridTemplateRows: mapeig a les files del template Excel
  // 1=topPad, 2=infoRow1(Nº), 3=infoRow2(FECHA), 4=headerImage, 5=headerGap,
  // 6=sectionLabels, 7=partyGap, 8=partyName, 9=partyNif, 10=partyAddress,
  // 11=conceptGap, 12=conceptHeader, 13=conceptRow,
  // 14=totalsGap, 15=ivaRow, 16=irpfRow, 17=grandGap, 18=grandTotal, 19=1fr(footer push)
  const gridRows = [
    `${r.topPad}px`,       // 1
    `${r.infoH}px`,        // 2 (Nº)
    `${r.infoH}px`,        // 3 (FECHA)
    `${Math.max(1, r.headerImgH - 2 * r.infoH)}px`, // 4 (logo remainder, files 2-3 ja compten infoH×2)
    `${r.headerGap}px`,    // 5
    `${r.sectionLbl}px`,   // 6 (: FREELANCE / : CLIENTE)
    `${r.partyGap}px`,     // 7
    `${r.partyLine}px`,    // 8 (nom)
    `${r.partyLine}px`,    // 9 (NIF)
    'auto',                // 10 (adreça - auto per multiline)
    `${r.conceptGap}px`,   // 11
    `${r.conceptHdr}px`,   // 12 (: CONCEPTO / : BASE IMPONIBLE)
    `${r.conceptRow}px`,   // 13 (concepte row)
    `${r.totalsGap}px`,    // 14
    `${r.totalRow}px`,     // 15 (+IVA)
    `${r.totalRow}px`,     // 16 (-IRPF)
    `${r.grandGap}px`,     // 17
    `${r.grandH}px`,       // 18 (TOTAL)
    '1fr',                 // 19 (espai flexible fins al footer)
  ].join(' ');

  // ---------- page container ----------
  const pageStyle = {
    display: 'grid',
    gridTemplateColumns: cols.map(c => `${c}px`).join(' '),
    gridTemplateRows: gridRows,
    width: '210mm',
    minHeight: '297mm',
    backgroundColor: colors.background,
    color: colors.primary,
    fontFamily: fontSecondary,
    fontSize: fontSizes.body,
    boxSizing: 'border-box',
    position: 'relative',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    paddingRight: `${rightPad}px`,
    lineHeight: '1.4',
  };

  // ---------- cell helper ----------
  const cell = (colStart, colEnd, rowStart, rowEnd, extra = {}) => ({
    gridColumn: `${colStart} / ${colEnd}`,
    gridRow: `${rowStart} / ${rowEnd}`,
    display: 'flex',
    alignItems: 'flex-start',
    ...extra,
  });

  // ---------- logo rendering ----------
  const renderLogo = () => {
    if (!sections.showLogo) return null;
    if (logo.type === 'image' && logo.imageUrl) {
      return (
        <img src={logo.imageUrl} alt="Logo"
          style={{ maxWidth: `${logo.width || 200}px`, maxHeight: `${r.headerImgH}px`, objectFit: 'contain' }} />
      );
    }
    if (logo.type === 'svg' && logo.svgContent) {
      return (
        <div style={{ width: logo.width || 200, height: Math.min(logo.height || 80, r.headerImgH) }}
          dangerouslySetInnerHTML={{ __html: logo.svgContent }} />
      );
    }
    // Text logo
    return (
      <div style={{
        fontFamily: fontPrimary, fontWeight: '700',
        fontSize: '28px', letterSpacing: '3px', color: colors.accent,
      }}>
        {logo.text || config?.nombre?.split(' ')[0]?.toUpperCase() || 'LOGO'}
      </div>
    );
  };

  // ---------- render ----------
  return (
    <div className="invoice-preview-modern print-area" style={pageStyle}>

      {/* ===== FILA 2-3: Nº + FECHA (span G-H, label esquerra / valor dreta) ===== */}
      <div style={cell(7, 9, 2, 3, {
        justifyContent: 'space-between', alignItems: 'center',
        fontSize: fontSizes.small,
      })}>
        <span style={{ fontFamily: fontSecondary, fontWeight: '700' }}>{labels.invoiceNumber}</span>
        <span style={{ fontFamily: fontMono }}>{invoice?.numero || '---'}</span>
      </div>

      <div style={cell(7, 9, 3, 4, {
        justifyContent: 'space-between', alignItems: 'center',
        fontSize: fontSizes.small,
      })}>
        <span style={{ fontFamily: fontSecondary, fontWeight: '700' }}>{labels.date}</span>
        <span style={{ fontFamily: fontMono }}>
          {invoice?.fecha ? formatDateShort(invoice.fecha) : '--/--/--'}
        </span>
      </div>

      {/* ===== FILES 2-5: Logo / Header image (cols A-E, ESQUERRA de Nº/FECHA) ===== */}
      {/* Logo ocupa la zona esquerra del header al mateix nivell vertical que Nº i FECHA */}
      <div style={cell(1, 6, 2, 5, {
        justifyContent: logo.align === 'center' ? 'center' : logo.align === 'right' ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start',
        paddingLeft: logo.align !== 'center' ? `${cols[0]}px` : '0',
        paddingTop: '2px',
      })}>
        {renderLogo()}
      </div>

      {/* ===== FILA 5 (gap) — implícita ===== */}

      {/* ===== FILA 6: Section labels ": FREELANCE" | ": CLIENTE" ===== */}
      <div style={cell(2, 5, 6, 7, {
        fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
        color: colors.accent, alignItems: 'flex-end',
        borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
        paddingBottom: '4px',
      })}>
        {prefix}{labels.freelance}
      </div>

      <div style={cell(6, 9, 6, 7, {
        fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
        color: colors.accent, alignItems: 'flex-end',
        borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
        paddingBottom: '4px',
      })}>
        {prefix}{labels.client}
      </div>

      {/* ===== FILA 7 (gap) — implícita ===== */}

      {/* ===== FILA 8: Noms ===== */}
      <div style={cell(2, 5, 8, 9, {
        fontFamily: fontPrimary, fontSize: fontSizes.body, fontWeight: '500',
      })}>
        {config?.nombre || '---'}
      </div>
      <div style={cell(6, 9, 8, 9, {
        fontFamily: fontPrimary, fontSize: fontSizes.body, fontWeight: '500',
      })}>
        {client?.nombre || '---'}
      </div>

      {/* ===== FILA 9: NIF ===== */}
      <div style={cell(2, 5, 9, 10, {
        fontFamily: fontPrimary, fontSize: fontSizes.body,
      })}>
        {labels.nif}: {config?.nif || '---'}
      </div>
      <div style={cell(6, 9, 9, 10, {
        fontFamily: fontPrimary, fontSize: fontSizes.body,
      })}>
        {labels.nif}: {client?.cifNif || '---'}
      </div>

      {/* ===== FILA 10: Adreça (auto height) + border-bottom que tanca el bloc de parties ===== */}
      <div style={cell(2, 5, 10, 11, {
        fontFamily: fontPrimary, fontSize: fontSizes.body,
        whiteSpace: 'pre-line', lineHeight: '1.5',
        borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
        paddingBottom: '8px',
        alignItems: 'flex-start',
      })}>
        {config?.direccion || '---'}
      </div>
      <div style={cell(6, 9, 10, 11, {
        fontFamily: fontPrimary, fontSize: fontSizes.body,
        whiteSpace: 'pre-line', lineHeight: '1.5',
        borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
        paddingBottom: '8px',
        alignItems: 'flex-start',
      })}>
        {client?.direccion || '---'}
      </div>

      {/* ===== FILA 11 (conceptGap) — implícita ===== */}

      {/* ===== FILA 12: Headers concepte ===== */}
      {invoice?.tipo === 'jornadas' ? (
        <>
          {/* CONCEPTO col 2-6 (B fins E inclòs): borde continu fins col F on comença JORNADES */}
          <div style={cell(2, 6, 12, 13, {
            fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
            color: colors.accent, alignItems: 'flex-end',
            borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
            paddingBottom: '4px',
          })}>
            {prefix}{labels.concept}
          </div>
          <div style={cell(6, 7, 12, 13, {
            fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
            color: colors.accent, alignItems: 'flex-end', justifyContent: 'center',
            borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
            paddingBottom: '4px',
          })}>
            {labels.days}
          </div>
          <div style={cell(7, 8, 12, 13, {
            fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
            color: colors.accent, alignItems: 'flex-end', justifyContent: 'center',
            borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
            paddingBottom: '4px',
          })}>
            {labels.rate}
          </div>
          <div style={cell(8, 9, 12, 13, {
            fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
            color: colors.accent, alignItems: 'flex-end', justifyContent: 'flex-end',
            borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
            paddingBottom: '4px',
          })}>
            {prefix}{labels.taxBase}
          </div>
        </>
      ) : (
        <>
          {/* CONCEPTO col 2-6 (B fins E inclòs): borde continu fins col F on comença BASE IMPONIBLE */}
          <div style={cell(2, 6, 12, 13, {
            fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
            color: colors.accent, alignItems: 'flex-end',
            borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
            paddingBottom: '4px',
          })}>
            {prefix}{labels.concept}
          </div>
          {/* BASE IMPONIBLE: span F-H, right-aligned */}
          <div style={cell(6, 9, 12, 13, {
            fontWeight: '700', fontSize: fontSizes.header, fontFamily: fontSecondary,
            color: colors.accent, alignItems: 'flex-end', justifyContent: 'flex-end',
            borderBottom: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`,
            paddingBottom: '4px',
          })}>
            {prefix}{labels.taxBase}
          </div>
        </>
      )}

      {/* ===== FILA 13: Concepte data row ===== */}
      {invoice?.tipo === 'jornadas' ? (
        <>
          <div style={cell(2, 5, 13, 14, {
            fontFamily: fontSecondary, fontSize: fontSizes.body, paddingTop: '6px',
          })}>
            {invoice?.concepto || '---'}
          </div>
          <div style={cell(6, 7, 13, 14, {
            fontFamily: fontMono, fontSize: fontSizes.body, justifyContent: 'center', paddingTop: '6px',
          })}>
            {invoice?.jornadas || 0}
          </div>
          <div style={cell(7, 8, 13, 14, {
            fontFamily: fontMono, fontSize: fontSizes.body, justifyContent: 'center', paddingTop: '6px',
          })}>
            {formatCurrency(invoice?.tarifaDia)}
          </div>
          <div style={cell(8, 9, 13, 14, {
            fontFamily: fontMono, fontSize: fontSizes.body, justifyContent: 'flex-end', paddingTop: '6px',
          })}>
            {formatCurrency(invoice?.subtotal)}
          </div>
        </>
      ) : (
        <>
          {/* Excel: B18:D18 = concepte (cols B-D), H18 = valor (col H) */}
          <div style={cell(2, 5, 13, 14, {
            fontFamily: fontSecondary, fontSize: fontSizes.body, paddingTop: '6px',
          })}>
            {invoice?.concepto || '---'}
          </div>
          <div style={cell(8, 9, 13, 14, {
            fontFamily: fontMono, fontSize: fontSizes.body, justifyContent: 'flex-end', paddingTop: '6px',
          })}>
            {formatCurrency(invoice?.subtotal)}
          </div>
        </>
      )}

      {/* ===== FILA 14 (totalsGap) — implícita ===== */}

      {/* ===== FILA 15: + IVA ===== */}
      {/* Excel: F22="+ 21% IVA" (col F=6), H22=valor (col H=8) */}
      <div style={cell(6, 7, 15, 16, {
        fontFamily: fontPrimary, fontSize: fontSizes.header, alignItems: 'center',
      })}>
        + {invoice?.ivaPorcentaje || 21}% {labels.iva}
      </div>
      <div style={cell(8, 9, 15, 16, {
        fontFamily: fontMono, fontSize: fontSizes.header, justifyContent: 'flex-end', alignItems: 'center',
      })}>
        {formatCurrency(invoice?.iva)}
      </div>

      {/* ===== FILA 16: - IRPF ===== */}
      {/* Excel: F23="- 15% IRPF" (col F=6), H23=valor (col H=8) */}
      <div style={cell(6, 7, 16, 17, {
        fontFamily: fontPrimary, fontSize: fontSizes.header, alignItems: 'center',
      })}>
        - {invoice?.irpfPorcentaje || 15}% {labels.irpf}
      </div>
      <div style={cell(8, 9, 16, 17, {
        fontFamily: fontMono, fontSize: fontSizes.header, justifyContent: 'flex-end', alignItems: 'center',
      })}>
        {formatCurrency(invoice?.irpf)}
      </div>

      {/* ===== FILA 17 (grandGap) — implícita ===== */}

      {/* ===== FILA 18: TOTAL ===== */}
      {/* Excel: F26="TOTAL" (col F=6, spanning F-G), H26=valor (col H=8) */}
      <div style={cell(6, 8, 18, 19, {
        fontFamily: fontPrimary, fontSize: fontSizes.total, fontWeight: '700',
        alignItems: 'center', color: colors.highlight || colors.accent,
        borderTop: `${design.layout?.borderWidth || 1}px solid ${colors.highlight || colors.accent}`,
        paddingTop: '6px',
      })}>
        {labels.total}
      </div>
      <div style={cell(8, 9, 18, 19, {
        fontFamily: fontMono, fontSize: fontSizes.total, fontWeight: '700',
        justifyContent: 'flex-end', alignItems: 'center',
        color: colors.highlight || colors.accent,
        borderTop: `${design.layout?.borderWidth || 1}px solid ${colors.highlight || colors.accent}`,
        paddingTop: '6px',
      })}>
        {formatCurrency(invoice?.total)}
      </div>

      {/* ===== FOOTER (position absolute al bottom) ===== */}
      <div style={{
        position: 'absolute',
        bottom: `${footerPad}px`,
        left: `${cols[0]}px`,
        right: `${rightPad + 12}px`,
        fontFamily: fontPrimary,
        fontSize: fontSizes.body,
      }}>
        {/* Línia divisòria superior del footer */}
        <div style={{ borderTop: `${design.layout?.borderWidth || 1}px solid ${colors.divider}`, paddingTop: '15px' }}>

          {/* Forma de pagament */}
          {sections.showPaymentMethod && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ fontWeight: '600', fontSize: fontSizes.small }}>{labels.paymentMethod}</span>
              <span style={{ fontSize: fontSizes.small }}>{labels.transfer}</span>
            </div>
          )}

          {/* Dades bancàries */}
          {sections.showBankDetails && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ fontWeight: '600', fontSize: fontSizes.small }}>{labels.bankDetails}</span>
              <span style={{ fontFamily: fontMono, fontSize: fontSizes.small }}>{config?.iban || '---'}</span>
            </div>
          )}

          {/* Concepte pagament — Excel C44 adjacent al label B44 (no space-between) */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '5px', alignItems: 'center' }}>
            <span style={{ fontWeight: '600', fontSize: fontSizes.small, flexShrink: 0 }}>{labels.paymentConcept}</span>
            <span style={{ fontSize: fontSizes.small }}>{invoice?.numero || '---'}</span>
          </div>

          {/* Contacte */}
          {sections.showFooterContact && (
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              borderTop: `1px solid ${colors.divider}20`,
              paddingTop: '10px', marginTop: '10px',
              fontSize: fontSizes.small, color: colors.muted,
            }}>
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
