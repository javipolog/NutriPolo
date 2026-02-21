/**
 * emailService.js
 * ===============
 * Servei d'enviament de factures per correu electrònic.
 *
 * Estratègia:
 *   1. Genera el PDF a una carpeta temporal
 *   2. Obre el client de correu natiu via `mailto:` (shell.open)
 *      → El client de correu obri amb To, Subject i Body pre-emplenat
 *   3. L'usuari adjunta el PDF des de la ubicació temporal (o el guardà on vulgui)
 *
 * Per a sistemes amb xdg-open / macOS Mail / Outlook, el mailto: estàndard
 * no permet adjuntar fitxers per seguretat, per tant:
 *   - Guardem el PDF en una ubicació accessible
 *   - Mostrem la ruta clarament per adjuntar-la manualment
 *   - O (si l'usuari ho configura) usem SMTP directe via Rust
 */

import { invoke } from '@tauri-apps/api/tauri';
import { open as openUrl } from '@tauri-apps/api/shell';

// ============================================
// VARIABLES DE PLANTILLA
// ============================================

/**
 * Substitueix les variables {{nom}} en una plantilla de text.
 *
 * Variables disponibles:
 *   {{clientNom}}       → Nom del client
 *   {{clientEmail}}     → Email del client
 *   {{facturaNum}}      → Número de factura
 *   {{facturaData}}     → Data de la factura
 *   {{facturaTotal}}    → Total de la factura
 *   {{facturaConcepte}} → Concepte de la factura
 *   {{freelanceNom}}    → Nom del freelance (config)
 *   {{freelanceEmail}}  → Email del freelance (config)
 *   {{freelanceTel}}    → Telèfon del freelance (config)
 */
export const resolveTemplate = (template, { invoice, client, config }) => {
  if (!template) return '';

  const formatDate = (d) => {
    if (!d) return '---';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  };

  const formatCurrency = (n) => {
    if (n == null) return '---';
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
  };

  const vars = {
    '{{clientNom}}':        client?.nombre        || '---',
    '{{clientEmail}}':      client?.email         || '---',
    '{{facturaNum}}':       invoice?.numero       || '---',
    '{{facturaData}}':      formatDate(invoice?.fecha),
    '{{facturaTotal}}':     formatCurrency(invoice?.total),
    '{{facturaConcepte}}':  invoice?.concepto     || '---',
    '{{freelanceNom}}':     config?.nombre        || '---',
    '{{freelanceEmail}}':   config?.email         || '---',
    '{{freelanceTel}}':     config?.telefono      || '---',
    '{{freelanceWeb}}':     config?.web           || '---',
    '{{freelanceIban}}':    config?.iban          || '---',
  };

  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(key, value);
  }
  return result;
};

// ============================================
// PLANTILLES PER DEFECTE
// ============================================

export const DEFAULT_EMAIL_TEMPLATES = {
  es: {
    subject: 'Factura {{facturaNum}} – {{freelanceNom}}',
    body: `Estimado/a {{clientNom}},

Adjunto encontrará la factura {{facturaNum}} de fecha {{facturaData}} por un importe de {{facturaTotal}}.

Concepto: {{facturaConcepte}}

Para cualquier consulta no dude en contactarme.

Un saludo,
{{freelanceNom}}
{{freelanceEmail}} | {{freelanceTel}}
{{freelanceWeb}}`,
  },
  ca: {
    subject: 'Factura {{facturaNum}} – {{freelanceNom}}',
    body: `Benvolgut/da {{clientNom}},

Adjunt trobareu la factura {{facturaNum}} de data {{facturaData}} per un import de {{facturaTotal}}.

Concepte: {{facturaConcepte}}

Per a qualsevol consulta no dubteu en contactar-me.

Una salutació,
{{freelanceNom}}
{{freelanceEmail}} | {{freelanceTel}}
{{freelanceWeb}}`,
  },
  en: {
    subject: 'Invoice {{facturaNum}} – {{freelanceNom}}',
    body: `Dear {{clientNom}},

Please find attached invoice {{facturaNum}} dated {{facturaData}} for a total of {{facturaTotal}}.

Description: {{facturaConcepte}}

Please don't hesitate to contact me if you have any questions.

Best regards,
{{freelanceNom}}
{{freelanceEmail}} | {{freelanceTel}}
{{freelanceWeb}}`,
  },
};

// ============================================
// GENERACIÓ PDF TEMPORAL
// ============================================

/**
 * Genera el PDF de la factura a una carpeta temporal de l'app.
 * Retorna la ruta del fitxer generat.
 */
export const generateInvoicePdfTemp = async ({ invoice, client, config }) => {
  try {
    const outputPath = await invoke('generate_invoice_pdf_temp', {
      invoice,
      client,
      config,
    });
    return outputPath;
  } catch (e) {
    console.error('[EmailService] Error generant PDF temp:', e);
    throw new Error(`No s'ha pogut generar el PDF: ${e}`);
  }
};

// ============================================
// OBERTURA DEL CLIENT DE CORREU
// ============================================

/**
 * Construeix un URI `mailto:` i l'obre amb el client de correu natiu.
 *
 * @param {Object} params
 * @param {string} params.to      - Destinatari
 * @param {string} params.subject - Assumpte (ja resolt)
 * @param {string} params.body    - Cos (ja resolt)
 */
export const openMailClient = async ({ to, subject, body }) => {
  const encode = (s) => encodeURIComponent(s || '');
  const uri = `mailto:${encode(to)}?subject=${encode(subject)}&body=${encode(body)}`;

  try {
    await openUrl(uri);
    return true;
  } catch (e) {
    console.error('[EmailService] Error obrint client de correu:', e);
    // Fallback: obrir en finestra del navegador
    window.open(uri, '_blank');
    return false;
  }
};

// ============================================
// FLUX COMPLET
// ============================================

/**
 * Flux complet: genera PDF + obre client de correu.
 *
 * @returns {{ pdfPath: string|null, opened: boolean }}
 */
export const sendInvoiceEmail = async ({
  invoice,
  client,
  config,
  subject,
  body,
  toEmail,
  generatePdf = true,
}) => {
  let pdfPath = null;

  if (generatePdf) {
    try {
      pdfPath = await generateInvoicePdfTemp({ invoice, client, config });
    } catch (e) {
      console.warn('[EmailService] PDF no generat, continuant sense ell:', e.message);
    }
  }

  const opened = await openMailClient({
    to:      toEmail || client?.email || '',
    subject: subject,
    body:    pdfPath
      ? `${body}\n\n📎 PDF guardat a: ${pdfPath}`
      : body,
  });

  return { pdfPath, opened };
};

// ============================================
// VARIABLES HELPER PER UI
// ============================================

export const AVAILABLE_VARIABLES = [
  { token: '{{clientNom}}',       desc: 'Nom del client'        },
  { token: '{{clientEmail}}',     desc: 'Email del client'      },
  { token: '{{facturaNum}}',      desc: 'Número de factura'     },
  { token: '{{facturaData}}',     desc: 'Data de la factura'    },
  { token: '{{facturaTotal}}',    desc: 'Total de la factura'   },
  { token: '{{facturaConcepte}}', desc: 'Concepte'              },
  { token: '{{freelanceNom}}',    desc: 'El teu nom'            },
  { token: '{{freelanceEmail}}',  desc: 'El teu email'          },
  { token: '{{freelanceTel}}',    desc: 'El teu telèfon'        },
  { token: '{{freelanceWeb}}',    desc: 'La teua web'           },
  { token: '{{freelanceIban}}',   desc: 'El teu IBAN'           },
];
