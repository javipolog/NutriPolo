import React, { useState, useEffect } from 'react';
import { Cloud, CloudOff, RefreshCw, Check, AlertCircle, Settings, Trash2, Eye, EyeOff, Download, Upload, Link, ExternalLink, Clock, CheckCircle, XCircle, Info } from 'lucide-react';
import { useNotionStore } from '../stores/notionStore';
import { useStore, generateId, generateClientCode } from '../stores/store';
import { Button, Input, Card, Modal, Spinner } from './UI';

/**
 * Panel de configuración y sincronización con Notion
 */
export const NotionSync = () => {
  const {
    apiKey,
    databaseId,
    isConfigured,
    isSyncing,
    lastSync,
    syncError,
    autoSync,
    syncLogs,
    setConfig,
    clearConfig,
    testConnection,
    pushToNotion,
    pullFromNotion,
    fullSync,
    setAutoSync,
    clearLogs
  } = useNotionStore();

  const { invoices, clients, setInvoices, addClient } = useStore();

  const [showConfig, setShowConfig] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [tempDatabaseId, setTempDatabaseId] = useState(databaseId);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    setTempApiKey(apiKey);
    setTempDatabaseId(databaseId);
  }, [apiKey, databaseId]);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setConfig(tempApiKey, tempDatabaseId);
      const schema = await testConnection();
      setTestResult({ success: true, title: schema.title?.[0]?.plain_text || 'Base de datos conectada' });
    } catch (error) {
      setTestResult({ success: false, message: error.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = () => {
    setConfig(tempApiKey, tempDatabaseId);
    setShowConfig(false);
  };

  const handlePush = async () => {
    try {
      await pushToNotion(invoices, clients);
    } catch (error) {
      console.error('Push error:', error);
    }
  };

  const handlePull = async () => {
    try {
      const notionInvoices = await pullFromNotion();

      if (notionInvoices && notionInvoices.length > 0) {
        // Cache de clientes existentes para búsqueda rápida
        const clientsByName = {};
        clients.forEach(c => {
          if (c.nombre) {
            clientsByName[c.nombre.toLowerCase().trim()] = c;
          }
        });

        // Lista de nuevos clientes a crear
        const newClients = [];

        // Procesar cada factura
        const processedInvoices = notionInvoices.map(inv => {
          const nombreCliente = inv.clienteNombre?.trim();

          if (!nombreCliente) {
            // Sin cliente asignado
            return { ...inv, clienteId: null };
          }

          const nombreKey = nombreCliente.toLowerCase();

          // Buscar cliente existente
          let client = clientsByName[nombreKey];

          // Si no existe, crear uno nuevo
          if (!client) {
            const codigo = generateClientCode(nombreCliente);
            client = {
              id: generateId(),
              nombre: nombreCliente,
              codigo: codigo,
              cifNif: '',
              direccion: '',
              email: '',
              telefono: ''
            };

            // Añadir a cache y lista de nuevos
            clientsByName[nombreKey] = client;
            newClients.push(client);
          }

          return { ...inv, clienteId: client.id };
        });

        // Añadir nuevos clientes al store
        newClients.forEach(client => addClient(client));

        // Guardar las facturas procesadas
        setInvoices(processedInvoices);

        console.log(`Importadas ${processedInvoices.length} facturas, creados ${newClients.length} clientes nuevos`);
      }
    } catch (error) {
      console.error('Pull error:', error);
    }
  };

  const handleFullSync = async () => {
    try {
      await fullSync(invoices, clients);
    } catch (error) {
      console.error('Sync error:', error);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Nunca';
    return new Date(dateStr).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getLogIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircle size={14} className="text-emerald-400" />;
      case 'error': return <XCircle size={14} className="text-red-400" />;
      case 'info': return <Info size={14} className="text-blue-400" />;
      default: return <Info size={14} className="text-slate-400" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Estado de conexión */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isConfigured ? (
              <div className="p-2 bg-emerald-500/20 rounded-lg">
                <Cloud size={20} className="text-emerald-400" />
              </div>
            ) : (
              <div className="p-2 bg-slate-700 rounded-lg">
                <CloudOff size={20} className="text-slate-400" />
              </div>
            )}
            <div>
              <h3 className="text-white font-medium">Sincronización con Notion</h3>
              <p className="text-sm text-slate-400">
                {isConfigured ? 'Conectado' : 'No configurado'}
                {lastSync && ` • Última sync: ${formatDate(lastSync)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={Settings}
              onClick={() => setShowConfig(true)}
              title="Configuración"
            />
            {isConfigured && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Clock}
                  onClick={() => setShowLogs(true)}
                  title="Ver logs"
                />
              </>
            )}
          </div>
        </div>

        {/* Botones de sincronización */}
        {isConfigured && (
          <div className="mt-4 pt-4 border-t border-slate-800">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={Upload}
                onClick={handlePush}
                disabled={isSyncing}
              >
                Enviar a Notion
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                onClick={handlePull}
                disabled={isSyncing}
              >
                Traer de Notion
              </Button>
              <Button
                size="sm"
                icon={RefreshCw}
                onClick={handleFullSync}
                disabled={isSyncing}
                className={isSyncing ? 'animate-pulse' : ''}
              >
                {isSyncing ? 'Sincronizando...' : 'Sincronizar Todo'}
              </Button>
            </div>

            {/* Toggle de auto-sync */}
            <div className="mt-3 flex items-center gap-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
              <span className="text-sm text-slate-400">Sincronización automática al guardar</span>
            </div>

            {syncError && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
                <AlertCircle size={16} className="text-red-400" />
                <span className="text-sm text-red-400">{syncError}</span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Modal de configuración */}
      <Modal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        title="Configuración de Notion"
        size="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <h4 className="text-blue-400 font-medium text-sm mb-2">📋 Pasos para configurar:</h4>
            <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
              <li>Ve a <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener" className="text-blue-400 hover:underline">notion.so/my-integrations</a></li>
              <li>Crea una nueva integración y copia el token</li>
              <li>En tu base de datos, haz clic en "..." → "Add connections" → tu integración</li>
              <li>Pega el token y el ID de la base de datos aquí</li>
            </ol>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              API Key (Internal Integration Token)
            </label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                placeholder="secret_..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Database ID
            </label>
            <Input
              value={tempDatabaseId}
              onChange={(e) => setTempDatabaseId(e.target.value)}
              placeholder="556517bbc95945aca9f4c3a3f92d922c"
            />
            <p className="text-xs text-slate-500 mt-1">
              El ID está en la URL de tu base de datos, entre notion.so/ y el ?
            </p>
          </div>

          {testResult && (
            <div className={`p-3 rounded-lg flex items-center gap-2 ${testResult.success
              ? 'bg-emerald-500/10 border border-emerald-500/30'
              : 'bg-red-500/10 border border-red-500/30'
              }`}>
              {testResult.success ? (
                <>
                  <Check size={18} className="text-emerald-400" />
                  <span className="text-emerald-400 text-sm">✓ {testResult.title}</span>
                </>
              ) : (
                <>
                  <AlertCircle size={18} className="text-red-400" />
                  <span className="text-red-400 text-sm">{testResult.message}</span>
                </>
              )}
            </div>
          )}

          <div className="flex justify-between pt-4 border-t border-slate-800">
            {isConfigured && (
              <Button
                variant="ghost"
                icon={Trash2}
                onClick={() => {
                  clearConfig();
                  setTempApiKey('');
                  setTempDatabaseId('556517bbc95945aca9f4c3a3f92d922c');
                  setTestResult(null);
                }}
                className="text-red-400 hover:text-red-300"
              >
                Desconectar
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button
                variant="secondary"
                onClick={handleTestConnection}
                disabled={!tempApiKey || !tempDatabaseId || testing}
              >
                {testing ? <Spinner size="sm" /> : 'Probar conexión'}
              </Button>
              <Button
                onClick={handleSaveConfig}
                disabled={!tempApiKey || !tempDatabaseId}
              >
                Guardar
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal de logs */}
      <Modal
        open={showLogs}
        onClose={() => setShowLogs(false)}
        title="Registro de sincronización"
        size="md"
      >
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {syncLogs.length === 0 ? (
            <p className="text-slate-500 text-center py-4">No hay registros</p>
          ) : (
            syncLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-2 p-2 bg-slate-800/50 rounded-lg"
              >
                {getLogIcon(log.type)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300">{log.message}</p>
                  <p className="text-xs text-slate-500">{formatDate(log.timestamp)}</p>
                </div>
              </div>
            ))
          )}
        </div>
        {syncLogs.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-800">
            <Button variant="ghost" size="sm" onClick={clearLogs}>
              Limpiar registros
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
};

/**
 * Badge pequeño de estado de Notion para el header
 */
export const NotionStatusBadge = () => {
  const { isConfigured, isSyncing, lastSync } = useNotionStore();

  if (!isConfigured) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800/50 rounded-lg text-xs">
      {isSyncing ? (
        <>
          <RefreshCw size={12} className="text-blue-400 animate-spin" />
          <span className="text-blue-400">Sincronizando...</span>
        </>
      ) : (
        <>
          <Cloud size={12} className="text-emerald-400" />
          <span className="text-slate-400">Notion</span>
        </>
      )}
    </div>
  );
};

export default NotionSync;
