/**
 * folderWatcher.js
 * ================
 * Servei de vigilància de carpetes en temps real.
 * Connecta amb el watcher natiu de Rust (notify crate) via Tauri events
 * i processa automàticament els PDFs nous detectats.
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { processSinglePdf } from './pdfScanner';

// ============================================
// ESTAT INTERN DEL WATCHER
// ============================================

let _unlisten = null;
let _listeners = new Set();
let _processedPaths = new Set();       // PDFs ja processats (evitar duplicats)
let _processingQueue = [];             // Cua de PDFs pendents
let _isProcessingQueue = false;        // Flag de processament actiu
let _debounceTimers = new Map();       // Debounce per path (evitar events duplicats)

const DEBOUNCE_MS = 800;              // Temps d'espera per debounce
const PROCESS_DELAY_MS = 500;         // Delay entre processaments per no saturar

// ============================================
// GESTIÓ DE LISTENERS (Patró Observer)
// ============================================

/**
 * Registra un callback que rebrà tots els events del watcher
 * @param {Function} callback - fn(event: WatcherEvent)
 * @returns {Function} unlisten - Crida per desregistrar
 */
export const onWatcherEvent = (callback) => {
    _listeners.add(callback);
    return () => _listeners.delete(callback);
};

const emitToListeners = (event) => {
    _listeners.forEach(cb => {
        try { cb(event); } catch (e) { console.error('[FolderWatcher] Listener error:', e); }
    });
};

// ============================================
// PROCESSAMENT DE PDFs
// ============================================

/**
 * Processa un PDF individual detectat pel watcher
 * Retorna les dades extretes o null si falla
 */
const processPdfFile = async (filePath, config = {}) => {
    try {
        const pathParts = filePath.replace(/\\/g, '/').split('/');
        const fileName = pathParts[pathParts.length - 1];

        // Extraure context de la ruta (any, mes, trimestre)
        const context = extractPathContext(pathParts);

        const result = await processSinglePdf(filePath, {
            ...context,
            config,
            existingExpenses: config.existingExpenses || []
        });

        if (result) {
            return {
                ...result,
                file: filePath,
                filename: fileName,
                inferredQuarter: context.inferredQuarter
            };
        }
        return null;
    } catch (err) {
        console.error(`[FolderWatcher] Error processant ${filePath}:`, err);
        return null;
    }
};

/**
 * Extrau informació contextual del path (any, mes, trimestre)
 * Reutilitza la mateixa lògica que tenia scanFolderForReceipts
 */
const extractPathContext = (pathParts) => {
    const monthsEs = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const monthsShortEs = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const monthsEn = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthsShortEn = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    // Any
    const yearMatch = pathParts.find(p => /^(20)\d{2}$/.test(p));
    const inferredYear = yearMatch ? parseInt(yearMatch) : new Date().getFullYear();

    // Mes
    let inferredMonth = null;
    for (let i = pathParts.length - 1; i >= 0; i--) {
        const part = pathParts[i].toLowerCase();
        for (let m = 1; m <= 12; m++) {
            if (part.includes(monthsEs[m - 1]) || part.includes(monthsShortEs[m - 1]) ||
                part.includes(monthsEn[m - 1]) || part.includes(monthsShortEn[m - 1])) {
                inferredMonth = m;
                break;
            }
        }
        if (inferredMonth) break;

        const numericMatch = part.match(/\b(0[1-9]|1[0-2])\b/);
        if (numericMatch) {
            inferredMonth = parseInt(numericMatch[1]);
            break;
        }
    }

    // Trimestre
    const quarterMatch = pathParts.find(p => /^T[1-4]$/i.test(p));
    const inferredQuarter = quarterMatch ? parseInt(quarterMatch.toUpperCase().replace('T', '')) : null;

    return { inferredYear, inferredMonth, inferredQuarter };
};

/**
 * Processa la cua de PDFs pendents de forma seqüencial
 * Evita saturar el sistema processant tot de cop
 */
const processQueue = async (config) => {
    if (_isProcessingQueue) return;
    _isProcessingQueue = true;

    while (_processingQueue.length > 0) {
        const filePath = _processingQueue.shift();

        if (_processedPaths.has(filePath)) continue;

        emitToListeners({
            type: 'processing',
            path: filePath,
            filename: filePath.split(/[\\\/]/).pop(),
            queueSize: _processingQueue.length
        });

        const result = await processPdfFile(filePath, config);

        if (result) {
            _processedPaths.add(filePath);
            emitToListeners({
                type: 'pdf_processed',
                path: filePath,
                data: result,
                queueSize: _processingQueue.length
            });
        } else {
            emitToListeners({
                type: 'pdf_error',
                path: filePath,
                filename: filePath.split(/[\\\/]/).pop(),
                queueSize: _processingQueue.length
            });
        }

        // Petit delay entre processaments
        if (_processingQueue.length > 0) {
            await new Promise(r => setTimeout(r, PROCESS_DELAY_MS));
        }
    }

    _isProcessingQueue = false;
    emitToListeners({ type: 'queue_empty' });
};

// ============================================
// API PÚBLICA
// ============================================

/**
 * Inicia la vigilància d'una carpeta.
 * 1. Registra listener d'events Tauri
 * 2. Crida start_watcher al backend Rust (que retorna PDFs existents)
 * 3. Processa els PDFs existents
 * 4. Escolta events en temps real per PDFs nous
 *
 * @param {string} folder - Ruta de la carpeta a vigilar
 * @param {object} config - Configuració (nif, nombre, existingExpenses...)
 * @returns {Promise<{ existingPdfs: string[] }>}
 */
export const startWatching = async (folder, config = {}) => {
    // Netejar watcher anterior si existeix
    await stopWatching();

    // Reset estat
    _processedPaths.clear();
    _processingQueue = [];
    _isProcessingQueue = false;

    // Marcar PDFs ja importats com a processats (evitar re-importació)
    if (config.existingExpenses) {
        config.existingExpenses.forEach(exp => {
            if (exp.archivo) _processedPaths.add(exp.archivo);
        });
    }

    // Registrar listener d'events del backend
    _unlisten = await listen('watcher-event', (event) => {
        const payload = event.payload;
        console.log('[FolderWatcher] Event rebut:', payload.event_type, payload.path);

        switch (payload.event_type) {
            case 'pdf_detected': {
                const path = payload.path;
                if (!path || _processedPaths.has(path)) return;

                // Debounce: els file systems poden emetre múltiples events per un sol fitxer
                if (_debounceTimers.has(path)) {
                    clearTimeout(_debounceTimers.get(path));
                }
                _debounceTimers.set(path, setTimeout(() => {
                    _debounceTimers.delete(path);
                    if (!_processedPaths.has(path) && !_processingQueue.includes(path)) {
                        _processingQueue.push(path);
                        emitToListeners({
                            type: 'pdf_found',
                            path,
                            filename: path.split(/[\\\/]/).pop(),
                            queueSize: _processingQueue.length
                        });
                        processQueue(config);
                    }
                }, DEBOUNCE_MS));
                break;
            }

            case 'pdf_removed': {
                emitToListeners({
                    type: 'pdf_removed',
                    path: payload.path,
                    filename: payload.path?.split(/[\\\/]/).pop()
                });
                break;
            }

            case 'error': {
                emitToListeners({
                    type: 'watcher_error',
                    message: payload.message
                });
                break;
            }

            case 'started':
                emitToListeners({ type: 'watcher_started', folder: payload.folder, message: payload.message });
                break;

            case 'stopped':
                emitToListeners({ type: 'watcher_stopped' });
                break;
        }
    });

    // Iniciar watcher natiu al backend → retorna llista de PDFs existents
    const existingPdfs = await invoke('start_watcher', { folder });

    return { existingPdfs };
};

/**
 * Processa una llista de PDFs (usada per l'escaneig inicial)
 * @param {string[]} pdfPaths - Llista de paths
 * @param {object} config - Configuració
 */
export const processInitialPdfs = async (pdfPaths, config = {}) => {
    // Filtrar els que ja estan processats
    const newPdfs = pdfPaths.filter(p => !_processedPaths.has(p));
    _processingQueue.push(...newPdfs);

    emitToListeners({
        type: 'initial_scan',
        total: newPdfs.length,
        skipped: pdfPaths.length - newPdfs.length
    });

    await processQueue(config);
};

/**
 * Para la vigilància
 */
export const stopWatching = async () => {
    // Cancel·lar debounce timers
    _debounceTimers.forEach(timer => clearTimeout(timer));
    _debounceTimers.clear();

    // Desregistrar listener Tauri
    if (_unlisten) {
        _unlisten();
        _unlisten = null;
    }

    // Parar watcher backend
    try {
        await invoke('stop_watcher');
    } catch (e) {
        // Pot fallar si ja estava parat
        console.log('[FolderWatcher] Stop watcher:', e);
    }

    _processingQueue = [];
    _isProcessingQueue = false;
};

/**
 * Obté l'estat actual del watcher
 */
export const getWatcherStatus = async () => {
    try {
        return await invoke('get_watcher_status');
    } catch {
        return { active: false, folder: null };
    }
};

/**
 * Comprova si un path ja ha sigut processat
 */
export const isPathProcessed = (path) => _processedPaths.has(path);

/**
 * Marca un path com a processat (per evitar re-importació)
 */
export const markAsProcessed = (path) => _processedPaths.add(path);

/**
 * Obté estadístiques del watcher
 */
export const getStats = () => ({
    processedCount: _processedPaths.size,
    queueSize: _processingQueue.length,
    isProcessing: _isProcessingQueue
});
