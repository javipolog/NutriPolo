import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { notionService } from '../services/notionService';

/**
 * Store para la sincronización bidireccional con Notion
 */
export const useNotionStore = create(
  persist(
    (set, get) => ({
      // Configuración
      apiKey: '',
      databaseId: '556517bbc95945aca9f4c3a3f92d922c', // Tu database ID por defecto
      isConfigured: false,

      // Estado de sincronización
      isSyncing: false,
      lastSync: null,
      syncError: null,
      autoSync: false, // Sincronización automática

      // Mapeo de IDs locales a IDs de Notion
      idMapping: {}, // { localId: notionPageId }

      // Logs de sincronización
      syncLogs: [],

      // ============================================
      // CONFIGURACIÓN
      // ============================================

      setConfig: (apiKey, databaseId) => {
        notionService.configure(apiKey, databaseId);
        set({
          apiKey,
          databaseId,
          isConfigured: notionService.isConfigured()
        });
      },

      clearConfig: () => {
        set({
          apiKey: '',
          databaseId: '',
          isConfigured: false,
          idMapping: {},
          syncLogs: []
        });
      },

      setAutoSync: (enabled) => set({ autoSync: enabled }),

      // ============================================
      // VERIFICACIÓN DE CONEXIÓN
      // ============================================

      testConnection: async () => {
        const { apiKey, databaseId } = get();
        if (!apiKey || !databaseId) {
          throw new Error('API Key y Database ID son requeridos');
        }

        notionService.configure(apiKey, databaseId);

        try {
          const schema = await notionService.getDatabaseSchema();
          set({ isConfigured: true, syncError: null });
          get().addLog('success', 'Conexión exitosa con Notion');
          return schema;
        } catch (error) {
          set({ isConfigured: false, syncError: error.message });
          get().addLog('error', `Error de conexión: ${error.message}`);
          throw error;
        }
      },

      // ============================================
      // SINCRONIZACIÓN BIDIRECCIONAL
      // ============================================

      /**
       * Sincroniza facturas locales → Notion
       */
      pushToNotion: async (invoices, clients) => {
        const { idMapping, isConfigured } = get();
        if (!isConfigured) {
          throw new Error('Notion no está configurado');
        }

        set({ isSyncing: true, syncError: null });
        const newMapping = { ...idMapping };
        let created = 0, updated = 0, errors = 0;

        try {
          for (const invoice of invoices) {
            const client = clients.find(c => c.id === invoice.clienteId);
            const properties = notionService.invoiceToNotionProperties(invoice, client);

            try {
              if (newMapping[invoice.id]) {
                // Actualizar existente
                await notionService.updatePage(newMapping[invoice.id], properties);
                updated++;
              } else {
                // Crear nuevo
                const result = await notionService.createPage(properties);
                newMapping[invoice.id] = result.id;
                created++;
              }
            } catch (err) {
              errors++;
              get().addLog('error', `Error con factura ${invoice.numero}: ${err.message}`);
            }
          }

          set({
            idMapping: newMapping,
            lastSync: new Date().toISOString(),
            isSyncing: false
          });

          get().addLog('success', `Push completado: ${created} creadas, ${updated} actualizadas, ${errors} errores`);

          return { created, updated, errors };
        } catch (error) {
          set({ isSyncing: false, syncError: error.message });
          get().addLog('error', `Error en push: ${error.message}`);
          throw error;
        }
      },

      /**
       * Sincroniza Notion → facturas locales
       */
      pullFromNotion: async () => {
        const { isConfigured } = get();
        if (!isConfigured) {
          throw new Error('Notion no está configurado');
        }

        set({ isSyncing: true, syncError: null });

        try {
          // Consultar sin ordenación específica para evitar errores si la propiedad no existe
          const pages = await notionService.queryDatabase();

          const invoices = pages.map(page =>
            notionService.notionPropertiesToInvoice(page)
          );

          // Actualizar mapping con los IDs de Notion
          const newMapping = {};
          pages.forEach(page => {
            const localId = notionService.getTextValue(page.properties['COD']);
            if (localId) {
              newMapping[localId] = page.id;
            }
          });

          set({
            idMapping: newMapping,
            lastSync: new Date().toISOString(),
            isSyncing: false
          });

          get().addLog('success', `Pull completado: ${invoices.length} facturas obtenidas`);

          return invoices;
        } catch (error) {
          set({ isSyncing: false, syncError: error.message });
          get().addLog('error', `Error en pull: ${error.message}`);
          throw error;
        }
      },

      /**
       * Sincronización completa bidireccional
       * Estrategia: Pull primero, luego push las que no existen en Notion
       */
      fullSync: async (localInvoices, clients, updateLocalStore) => {
        const { isConfigured, idMapping } = get();
        if (!isConfigured) {
          throw new Error('Notion no está configurado');
        }

        set({ isSyncing: true, syncError: null });

        try {
          // 1. Pull desde Notion
          const notionInvoices = await get().pullFromNotion();

          // 2. Identificar facturas locales que no están en Notion
          const notionLocalIds = new Set(notionInvoices.map(i => i.id));
          const localOnlyInvoices = localInvoices.filter(i => !idMapping[i.id]);

          // 3. Push facturas locales nuevas
          if (localOnlyInvoices.length > 0) {
            await get().pushToNotion(localOnlyInvoices, clients);
          }

          // 4. Opcional: actualizar store local con datos de Notion
          // Esto requiere lógica de merge que depende de tu caso de uso

          set({
            lastSync: new Date().toISOString(),
            isSyncing: false
          });

          get().addLog('success', 'Sincronización completa finalizada');

          return {
            fromNotion: notionInvoices,
            pushedToNotion: localOnlyInvoices.length
          };
        } catch (error) {
          set({ isSyncing: false, syncError: error.message });
          throw error;
        }
      },

      /**
       * Sincroniza una factura individual
       */
      syncSingleInvoice: async (invoice, client) => {
        const { idMapping, isConfigured } = get();
        if (!isConfigured) return;

        const properties = notionService.invoiceToNotionProperties(invoice, client);

        try {
          if (idMapping[invoice.id]) {
            await notionService.updatePage(idMapping[invoice.id], properties);
            get().addLog('info', `Factura ${invoice.numero} actualizada en Notion`);
          } else {
            const result = await notionService.createPage(properties);
            set({
              idMapping: { ...idMapping, [invoice.id]: result.id }
            });
            get().addLog('info', `Factura ${invoice.numero} creada en Notion`);
          }
        } catch (error) {
          get().addLog('error', `Error sincronizando ${invoice.numero}: ${error.message}`);
        }
      },

      /**
       * Elimina una factura de Notion
       */
      deleteFromNotion: async (localId) => {
        const { idMapping, isConfigured } = get();
        if (!isConfigured || !idMapping[localId]) return;

        try {
          await notionService.archivePage(idMapping[localId]);
          const newMapping = { ...idMapping };
          delete newMapping[localId];
          set({ idMapping: newMapping });
          get().addLog('info', 'Factura archivada en Notion');
        } catch (error) {
          get().addLog('error', `Error eliminando de Notion: ${error.message}`);
        }
      },

      // ============================================
      // LOGS
      // ============================================

      addLog: (type, message) => {
        const { syncLogs } = get();
        const newLog = {
          id: Date.now(),
          type,
          message,
          timestamp: new Date().toISOString()
        };
        set({
          syncLogs: [newLog, ...syncLogs].slice(0, 50) // Mantener últimos 50 logs
        });
      },

      clearLogs: () => set({ syncLogs: [] }),
    }),
    {
      name: 'notion-sync-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        apiKey: state.apiKey,
        databaseId: state.databaseId,
        isConfigured: state.isConfigured,
        idMapping: state.idMapping,
        autoSync: state.autoSync,
        lastSync: state.lastSync,
      }),
      onRehydrateStorage: () => (state) => {
        // Reconfigurar el servicio al cargar
        if (state?.apiKey && state?.databaseId) {
          notionService.configure(state.apiKey, state.databaseId);
        }
      }
    }
  )
);

export default useNotionStore;
