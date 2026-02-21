/**
 * providerMemory.js
 * ==================
 * Sistema de memòria intel·ligent per a proveïdors.
 * Quan l'usuari corregeix manualment una categoria, import o proveïdor,
 * el sistema recorda estes correccions per a futures importacions.
 * 
 * Persisteix via Zustand (mateixa capa que la resta del store).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';

// ============================================
// STORAGE ADAPTER (reutilitza el de store.js)
// ============================================

const tauriStorage = {
    getItem: async (name) => {
        try { return await invoke('load_data', { key: name }); }
        catch { return null; }
    },
    setItem: async (name, value) => {
        try { await invoke('save_data', { key: name, value }); }
        catch (e) { console.error('[ProviderMemory] Save error:', e); }
    },
    removeItem: async (name) => {
        try { await invoke('delete_data', { key: name }); }
        catch (e) { console.error('[ProviderMemory] Delete error:', e); }
    },
};

const storage = window.__TAURI__
    ? createJSONStorage(() => tauriStorage)
    : createJSONStorage(() => localStorage);

// ============================================
// NORMALITZACIÓ
// ============================================

/**
 * Normalitza el nom d'un proveïdor per fer matching fiable
 */
const normalizeKey = (name) => {
    if (!name) return '';
    return name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Treure accents
        .replace(/[^a-z0-9\s]/g, '')                       // Només alfanumèric
        .replace(/\b(sl|slu|sa|ltd|inc|corp|gmbh|limitada|anonima)\b/g, '') // Treure sufixos legals
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Genera claus alternatives per matching fuzzy
 * Ex: "Adobe Systems SL" → ["adobe systems", "adobe", "systems"]
 */
const generateAliases = (name) => {
    const normalized = normalizeKey(name);
    const words = normalized.split(' ').filter(w => w.length > 2);
    const aliases = [normalized];
    
    // Afegir cada paraula significativa com a alias
    words.forEach(w => {
        if (w.length >= 4 && !aliases.includes(w)) aliases.push(w);
    });
    
    // Afegir combinacions de 2 paraules
    for (let i = 0; i < words.length - 1; i++) {
        const combo = `${words[i]} ${words[i + 1]}`;
        if (!aliases.includes(combo)) aliases.push(combo);
    }
    
    return aliases;
};

// ============================================
// PROVIDER MEMORY STORE
// ============================================

export const useProviderMemory = create(
    persist(
        (set, get) => ({
            /**
             * Mapa de proveïdors apresos:
             * {
             *   "normalizedKey": {
             *     originalName: "Adobe Systems SL",
             *     categoria: "Software y suscripciones",
             *     cifNif: "B12345678",
             *     aliases: ["adobe systems", "adobe"],
             *     corrections: 3,        // Vegades corregit manualment
             *     confidence: 0.95,      // Confiança (puja amb correccions)
             *     lastSeen: "2025-02-09",
             *     ivaPorcentaje: 21,      // IVA habitual d'este proveïdor
             *   }
             * }
             */
            providers: {},

            /**
             * Mapa de regles per paraules clau personalitzades
             * L'usuari pot afegir regles com:
             * "Si el PDF conté 'MAXOIDO' → categoria 'Equipos informáticos'"
             */
            customRules: [],

            // ============================================
            // ACCIONS PRINCIPALS
            // ============================================

            /**
             * Aprèn d'una correcció manual de l'usuari.
             * Es crida quan l'usuari edita un gasto importat.
             */
            learnFromCorrection: (originalData, correctedData) => {
                const providers = { ...get().providers };
                const key = normalizeKey(correctedData.proveedor || originalData.proveedor);
                if (!key || key.length < 2) return;

                const existing = providers[key] || {};
                const corrections = (existing.corrections || 0) + 1;
                const confidence = Math.min(0.99, 0.6 + corrections * 0.1);

                providers[key] = {
                    originalName: correctedData.proveedor || existing.originalName || originalData.proveedor,
                    categoria: correctedData.categoria || existing.categoria,
                    cifNif: correctedData.cifProveedor || existing.cifNif || '',
                    aliases: generateAliases(correctedData.proveedor || originalData.proveedor),
                    corrections,
                    confidence,
                    lastSeen: new Date().toISOString().split('T')[0],
                    ivaPorcentaje: correctedData.ivaPorcentaje ?? existing.ivaPorcentaje ?? null,
                };

                // Si el nom del proveïdor ha canviat, registrar l'antic com a alias
                if (originalData.proveedor && originalData.proveedor !== correctedData.proveedor) {
                    const oldKey = normalizeKey(originalData.proveedor);
                    if (oldKey && oldKey !== key) {
                        // Crear redirecció: el nom antic apunta al nou
                        providers[oldKey] = {
                            ...providers[key],
                            _redirectTo: key,
                            aliases: [...(providers[key].aliases || []), ...generateAliases(originalData.proveedor)],
                        };
                    }
                }

                console.log(`[ProviderMemory] Après de correcció: "${key}" → ${correctedData.categoria} (confiança: ${confidence.toFixed(2)}, correccions: ${corrections})`);
                set({ providers });
            },

            /**
             * Aprèn d'una importació confirmada (sense correcció explícita).
             * Reforça el coneixement existent.
             */
            learnFromImport: (data) => {
                const providers = { ...get().providers };
                const key = normalizeKey(data.proveedor);
                if (!key || key.length < 2) return;

                const existing = providers[key];
                if (existing) {
                    // Reforçar confiança si la categoria coincideix
                    if (existing.categoria === data.categoria) {
                        existing.confidence = Math.min(0.99, (existing.confidence || 0.5) + 0.02);
                    }
                    existing.lastSeen = new Date().toISOString().split('T')[0];
                    if (data.cifProveedor && !existing.cifNif) {
                        existing.cifNif = data.cifProveedor;
                    }
                } else {
                    // Primer cop que veiem este proveïdor
                    providers[key] = {
                        originalName: data.proveedor,
                        categoria: data.categoria,
                        cifNif: data.cifProveedor || '',
                        aliases: generateAliases(data.proveedor),
                        corrections: 0,
                        confidence: 0.4,  // Confiança baixa per auto-detect
                        lastSeen: new Date().toISOString().split('T')[0],
                        ivaPorcentaje: data.ivaPorcentaje ?? null,
                    };
                }

                set({ providers });
            },

            /**
             * Busca un proveïdor a la memòria.
             * Retorna les dades recordades o null.
             * 
             * @param {string} detectedName - Nom detectat del PDF
             * @returns {Object|null} - { categoria, cifNif, originalName, confidence, ivaPorcentaje }
             */
            findProvider: (detectedName) => {
                const { providers } = get();
                if (!detectedName) return null;

                const searchKey = normalizeKey(detectedName);
                if (searchKey.length < 2) return null;

                // 1. Coincidència exacta
                if (providers[searchKey]) {
                    const match = providers[searchKey];
                    // Seguir redirecció si existeix
                    if (match._redirectTo && providers[match._redirectTo]) {
                        return { ...providers[match._redirectTo], matchType: 'redirect', matchScore: 95 };
                    }
                    return { ...match, matchType: 'exact', matchScore: 100 };
                }

                // 2. Coincidència per aliases
                let bestMatch = null;
                let bestScore = 0;

                for (const [key, data] of Object.entries(providers)) {
                    if (!data.aliases) continue;
                    
                    for (const alias of data.aliases) {
                        let score = 0;

                        // Coincidència d'alias exacta
                        if (alias === searchKey) {
                            score = 95;
                        }
                        // Contingut parcial
                        else if (searchKey.includes(alias) && alias.length >= 4) {
                            score = 70 + (alias.length / searchKey.length) * 20;
                        }
                        else if (alias.includes(searchKey) && searchKey.length >= 4) {
                            score = 65 + (searchKey.length / alias.length) * 20;
                        }

                        // Bonus per confiança i correccions
                        score += (data.confidence || 0) * 5;
                        score += Math.min((data.corrections || 0) * 3, 15);

                        if (score > bestScore && score >= 55) {
                            bestScore = score;
                            bestMatch = { ...data, matchType: 'alias', matchScore: Math.round(score) };
                        }
                    }
                }

                return bestMatch;
            },

            /**
             * Obté totes les categories apreses ordenades per freqüència
             */
            getLearnedCategories: () => {
                const { providers } = get();
                const catCount = {};
                Object.values(providers).forEach(p => {
                    if (p.categoria) {
                        catCount[p.categoria] = (catCount[p.categoria] || 0) + 1;
                    }
                });
                return Object.entries(catCount)
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat]) => cat);
            },

            /**
             * Obté estadístiques de la memòria
             */
            getMemoryStats: () => {
                const { providers, customRules } = get();
                const entries = Object.values(providers);
                return {
                    totalProviders: entries.length,
                    withCorrections: entries.filter(p => p.corrections > 0).length,
                    highConfidence: entries.filter(p => (p.confidence || 0) >= 0.8).length,
                    customRules: customRules.length,
                    categories: [...new Set(entries.map(p => p.categoria).filter(Boolean))],
                };
            },

            // ============================================
            // REGLES PERSONALITZADES
            // ============================================

            // ============================================
            // REGLES PERSONALITZADES
            // ============================================

            addCustomRule: (rule) => set(state => {
                const newRule = {
                    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
                    name: rule.name || '',
                    keywords: rule.keywords || '',
                    categoria: rule.categoria || '',
                    matchField: rule.matchField || 'any',
                    matchMode: rule.matchMode || 'any',
                    priority: rule.priority ?? (state.customRules.length + 1),
                    enabled: rule.enabled ?? true,
                    createdAt: new Date().toISOString(),
                };
                return { customRules: [...state.customRules, newRule] };
            }),

            updateCustomRule: (id, changes) => set(state => ({
                customRules: state.customRules.map(r => r.id === id ? { ...r, ...changes } : r)
            })),

            removeCustomRule: (id) => set(state => ({
                customRules: state.customRules.filter(r => r.id !== id)
            })),

            reorderCustomRules: (orderedIds) => set(state => {
                const byId = Object.fromEntries(state.customRules.map(r => [r.id, r]));
                const reordered = orderedIds
                    .filter(id => byId[id])
                    .map((id, idx) => ({ ...byId[id], priority: idx + 1 }));
                const rest = state.customRules
                    .filter(r => !orderedIds.includes(r.id))
                    .map((r, i) => ({ ...r, priority: reordered.length + i + 1 }));
                return { customRules: [...reordered, ...rest] };
            }),

            /**
             * Aplica regles personalitzades a les dades d'un expense candidat.
             * @param {Object|string} data - { proveedor, concepto, filename, rawText } o string (compat. legacy)
             * @returns {{ categoria, ruleName, ruleId } | null}
             */
            applyCustomRules: (data) => {
                const { customRules } = get();
                const sorted = [...customRules]
                    .filter(r => r.enabled !== false && r.keywords && r.categoria)
                    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

                // Compatibilitat: si data és string (API antiga), envoltem-lo
                const d = typeof data === 'string' ? { proveedor: data, any: data } : data;

                const fields = {
                    proveedor: (d.proveedor || '').toLowerCase(),
                    concepto: (d.concepto || '').toLowerCase(),
                    filename: (d.filename || '').toLowerCase(),
                    rawText: (d.rawText || '').toLowerCase(),
                };
                fields.any = [fields.proveedor, fields.concepto, fields.filename, fields.rawText].join(' ');

                for (const rule of sorted) {
                    const searchIn = fields[rule.matchField] ?? fields.any;
                    const keywords = rule.keywords
                        .split(',')
                        .map(k => k.trim().toLowerCase())
                        .filter(Boolean);
                    if (keywords.length === 0) continue;

                    const mode = rule.matchMode || 'any';
                    const matched = mode === 'all'
                        ? keywords.every(kw => searchIn.includes(kw))
                        : keywords.some(kw => searchIn.includes(kw));

                    if (matched) {
                        return { categoria: rule.categoria, ruleName: rule.name || rule.keywords, ruleId: rule.id };
                    }
                }
                return null;
            },

            /**
             * Neteja proveïdors antics o amb baixa confiança
             */
            cleanup: (maxAgeDays = 365) => {
                const providers = { ...get().providers };
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - maxAgeDays);
                const cutoffStr = cutoff.toISOString().split('T')[0];

                let removed = 0;
                for (const [key, data] of Object.entries(providers)) {
                    if (data.lastSeen < cutoffStr && (data.confidence || 0) < 0.5 && (data.corrections || 0) === 0) {
                        delete providers[key];
                        removed++;
                    }
                }

                if (removed > 0) {
                    console.log(`[ProviderMemory] Netejats ${removed} proveïdors antics`);
                    set({ providers });
                }
                return removed;
            },

            /**
             * Reset total de la memòria
             */
            resetMemory: () => set({ providers: {}, customRules: [] }),
        }),
        {
            name: 'provider-memory-storage',
            storage,
            partialize: (state) => ({
                providers: state.providers,
                customRules: state.customRules,
            }),
        }
    )
);
