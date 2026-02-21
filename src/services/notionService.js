/**
 * Notion API Service
 * Integración bidireccional con base de datos de Notion
 * 
 * Requiere configurar:
 * - NOTION_API_KEY: Token de integración interna de Notion
 * - NOTION_DATABASE_ID: ID de la base de datos
 */

import { fetch } from '@tauri-apps/api/http';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

class NotionService {
  constructor() {
    this.apiKey = null;
    this.databaseId = null;
  }

  /**
   * Configura las credenciales de Notion
   */
  configure(apiKey, databaseId) {
    this.apiKey = apiKey;
    // Normalizar el database ID (remover guiones si los tiene)
    this.databaseId = databaseId?.replace(/-/g, '');
  }

  /**
   * Verifica si está configurado
   */
  isConfigured() {
    return !!(this.apiKey && this.databaseId);
  }

  /**
   * Headers comunes para las peticiones
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION
    };
  }

  /**
   * Obtiene la estructura de la base de datos
   */
  async getDatabaseSchema() {
    if (!this.isConfigured()) {
      throw new Error('Notion no está configurado');
    }

    const response = await fetch(`${NOTION_API_BASE}/databases/${this.databaseId}`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = response.data;
      throw new Error(error?.message || `Error ${response.status}: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Obtiene todas las páginas (facturas) de la base de datos
   */
  async queryDatabase(filter = null, sorts = null) {
    if (!this.isConfigured()) {
      throw new Error('Notion no está configurado');
    }

    const body = {};
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;

    const response = await fetch(`${NOTION_API_BASE}/databases/${this.databaseId}/query`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: { type: 'Json', payload: body }
    });

    if (!response.ok) {
      const error = response.data;
      throw new Error(error?.message || `Error ${response.status}: ${response.statusText}`);
    }

    return response.data.results;
  }

  /**
   * Crea una nueva página (factura) en la base de datos
   */
  async createPage(properties) {
    if (!this.isConfigured()) {
      throw new Error('Notion no está configurado');
    }

    const response = await fetch(`${NOTION_API_BASE}/pages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: {
        type: 'Json',
        payload: {
          parent: { database_id: this.databaseId },
          properties
        }
      }
    });

    if (!response.ok) {
      const error = response.data;
      throw new Error(error?.message || `Error ${response.status}: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Actualiza una página existente
   */
  async updatePage(pageId, properties) {
    if (!this.isConfigured()) {
      throw new Error('Notion no está configurado');
    }

    const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: { type: 'Json', payload: { properties } }
    });

    if (!response.ok) {
      const error = response.data;
      throw new Error(error?.message || `Error ${response.status}: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Archiva (elimina) una página
   */
  async archivePage(pageId) {
    if (!this.isConfigured()) {
      throw new Error('Notion no está configurado');
    }

    const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: { type: 'Json', payload: { archived: true } }
    });

    if (!response.ok) {
      const error = response.data;
      throw new Error(error?.message || `Error ${response.status}: ${response.statusText}`);
    }

    return response.data;
  }

  // ============================================
  // MAPEO DE FACTURAS A NOTION
  // ============================================

  /**
   * Convierte una factura local al formato de propiedades de Notion
   * Este mapeo debe ajustarse según las propiedades de tu base de datos
   */
  invoiceToNotionProperties(invoice, client) {
    return {
      // Title - WORK (Nombre del trabajo/Concepto)
      'WORK': {
        title: [{ text: { content: invoice.concepto || '' } }]
      },
      // Text - COMENTARIO (Notas adicionales)
      'COMENTARIO': {
        rich_text: [{ text: { content: '' } }] // Ya no usamos esto para concepto principal
      },
      // Select - CLIENTE
      'CLIENTE': {
        select: { name: client?.nombre || '' }
      },
      // Date - FECHA (amb rang si hi ha fechaFin)
      'FECHA': {
        date: invoice.fecha ? { start: invoice.fecha, ...(invoice.fechaFin ? { end: invoice.fechaFin } : {}) } : null
      },
      // Number - IMPORTE (subtotal/base imponible)
      'IMPORTE': {
        number: invoice.subtotal || 0
      },
      // Number - IVA
      'IVA': {
        number: invoice.iva || 0
      },
      // Number - IRPF
      'IRPF': {
        number: invoice.irpf || 0
      },
      // Number - IMP FACTURA (total)
      'IMP FACTURA': {
        number: invoice.total || 0
      },
      // Status - STATUS (estado)
      'STATUS': {
        status: { name: this.mapEstadoToNotion(invoice.estado) }
      },
      // Text - COD (Número de factura)
      'COD': {
        rich_text: [{ text: { content: invoice.numero || '' } }]
      },
      // Date - FAC.DATA (Fecha de envío/facturación)
      'FAC.DATA': {
        date: invoice.fechaFacturacion ? { start: invoice.fechaFacturacion } : null
      },
      // Url - DROPBOX (Link a la factura en Dropbox)
      'DROPBOX': {
        url: invoice.dropboxLink || null
      }
    };
  }

  /**
   * Convierte las propiedades de Notion a una factura local
   */
  notionPropertiesToInvoice(page) {
    const props = page.properties;

    // Helper para buscar propiedades ignorando mayúsculas/minúsculas
    const getProp = (name) => {
      if (props[name]) return props[name];
      const found = Object.keys(props).find(k => k.toUpperCase() === name.toUpperCase());
      return found ? props[found] : null;
    };

    // Obtener valores base
    const subtotal = this.getNumberValue(getProp('IMPORTE'));
    const iva = this.getNumberValue(getProp('IVA'));
    const irpf = this.getNumberValue(getProp('IRPF'));
    let total = this.getNumberValue(getProp('IMP FACTURA'));

    // Si no hay total calculado, calcularlo
    if (!total && subtotal) {
      total = subtotal + iva - irpf;
    }

    // Obtener jornadas y tarifa si existen
    const jornadas = this.getNumberValue(getProp('JORNADAS'));
    const tarifaDia = this.getNumberValue(getProp('TARIFA'));

    // Determinar tipo de factura
    const tipo = (jornadas > 0 && tarifaDia > 0) ? 'days' : 'classic';

    return {
      notionId: page.id,
      id: this.getTextValue(getProp('COD')) || page.id,
      numero: this.getTextValue(getProp('COD')),
      concepto: this.getTitleValue(getProp('WORK')),
      clienteNombre: this.getSelectValue(getProp('CLIENTE')),
      fecha: this.getDateValue(getProp('FECHA')),
      fechaFin: this.getDateEndValue(getProp('FECHA')),
      subtotal: subtotal,
      baseImponible: subtotal, // Alias para compatibilidad
      iva: iva,
      irpf: irpf,
      total: total,
      estado: this.mapEstadoFromNotion(this.getStatusValue(getProp('STATUS'))),
      // Campos adicionales de Notion
      tipo: tipo,
      jornadas: jornadas,
      tarifaDia: tarifaDia,
      ivaPorcentaje: 21, // Default
      irpfPorcentaje: 15, // Default
      importePagado: this.getNumberValue(getProp('PAGADO')),
      fechaFacturacion: this.getDateValue(getProp('FAC.DATA')),
      fechaPago: this.getDateValue(getProp('P.PAGO')),
      dropboxLink: this.getUrlValue(getProp('DROPBOX')) || this.getTextValue(getProp('LINK')),
      lastSynced: new Date().toISOString()
    };
  }

  // Helpers para extraer valores de Notion
  getTitleValue(prop) {
    return prop?.title?.[0]?.text?.content || '';
  }

  getTextValue(prop) {
    return prop?.rich_text?.[0]?.text?.content || '';
  }

  getNumberValue(prop) {
    return prop?.number || 0;
  }

  getDateValue(prop) {
    return prop?.date?.start || null;
  }

  getDateEndValue(prop) {
    return prop?.date?.end || null;
  }

  getSelectValue(prop) {
    // Soporta Select y Multi-select (toma el primero)
    return prop?.select?.name || prop?.multi_select?.[0]?.name || '';
  }

  getStatusValue(prop) {
    // Soporta Status y Select
    return prop?.status?.name || prop?.select?.name || '';
  }

  getUrlValue(prop) {
    return prop?.url || '';
  }

  // Mapeo de estados
  mapEstadoToNotion(estado) {
    const mapping = {
      'borrador': 'Borrador',
      'emitida': 'Emitida',
      'pagada': 'Pagada',
      'anulada': 'Anulada'
    };
    return mapping[estado] || 'Borrador';
  }

  mapEstadoFromNotion(estado) {
    if (!estado) return 'borrador';
    const normalized = estado.toUpperCase().trim();
    const mapping = {
      'BORRADOR': 'borrador',
      'EMITIDA': 'emitida',
      'ENVIADA': 'emitida',
      'PAGADA': 'pagada',
      'ANULADA': 'anulada',
      'A DEBER': 'emitida', // Pendiente de pago
      'PENDIENTE': 'emitida',
      'COBRADA': 'pagada'
    };
    return mapping[normalized] || 'borrador';
  }
}

// Instancia singleton
export const notionService = new NotionService();

export default notionService;
