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
             * Mapa de regles per paraules clau personalitzades (v2 — amb conditions/actions).
             * Cada regla pot sobreescriure: proveedor, categoria, ivaPorcentaje, cifNif, concepto,
             * deducible, deduciblePct i dateStrategy.
             */
            customRules: [],

            /**
             * Índex CIF → providerKey per matching ràpid per CIF/NIF
             */
            cifIndex: {},

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

                // Actualitzar cifIndex si tenim CIF
                const cifIndex = { ...get().cifIndex };
                const newCif = (correctedData.cifProveedor || '').replace(/[\s-]/g, '').toUpperCase();
                if (newCif && newCif.length >= 8) {
                    cifIndex[newCif] = key;
                }

                console.log(`[ProviderMemory] Après de correcció: "${key}" → ${correctedData.categoria} (confiança: ${confidence.toFixed(2)}, correccions: ${corrections})`);
                set({ providers, cifIndex });
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
            // REGLES PERSONALITZADES (v2 — conditions/actions)
            // ============================================

            addCustomRule: (rule) => set(state => {
                // Acceptem tant format v1 (keywords/categoria) com v2 (conditions/actions)
                const isV2 = !!rule.conditions;
                const newRule = {
                    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
                    name: rule.name || '',
                    enabled: rule.enabled ?? true,
                    priority: rule.priority ?? (state.customRules.length + 1),
                    conditions: isV2 ? rule.conditions : {
                        keywords: rule.keywords || '',
                        matchField: rule.matchField || 'any',
                        matchMode: rule.matchMode || 'any',
                    },
                    actions: isV2 ? rule.actions : {
                        categoria: rule.categoria || null,
                        proveedor: null, ivaPorcentaje: null, cifNif: null,
                        concepto: null, deducible: null, deduciblePct: null,
                        dateStrategy: null,
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                return { customRules: [...state.customRules, newRule] };
            }),

            updateCustomRule: (id, changes) => set(state => ({
                customRules: state.customRules.map(r =>
                    r.id === id ? { ...r, ...changes, updatedAt: new Date().toISOString() } : r
                )
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
             * Aplica regles avançades (v2) al pipeline de scanning.
             * Retorna l'objecte complet { actions, ruleName, ruleId } o null.
             * BREAK al primer match.
             */
            applyAdvancedRules: (data) => {
                const { customRules } = get();
                const sorted = [...customRules]
                    .filter(r => r.enabled !== false)
                    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

                // Compatibilitat: si data és string, envoltem-lo
                const d = typeof data === 'string' ? { proveedor: data } : data;

                const fields = {
                    proveedor: (d.proveedor || '').toLowerCase(),
                    concepto: (d.concepto || '').toLowerCase(),
                    filename: (d.filename || '').toLowerCase(),
                    rawText: (d.rawText || '').toLowerCase(),
                    cif: (d.cif || '').replace(/[\s-]/g, '').toUpperCase(),
                };
                fields.any = [fields.proveedor, fields.concepto, fields.filename, fields.rawText].join(' ');

                for (const rule of sorted) {
                    // Obtenir condicions (suport v1 i v2)
                    const cond = rule.conditions || {
                        keywords: rule.keywords || '',
                        matchField: rule.matchField || 'any',
                        matchMode: rule.matchMode || 'any',
                    };

                    const keywords = (cond.keywords || '')
                        .split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
                    if (keywords.length === 0) continue;

                    // Decidir camp on buscar
                    const matchField = cond.matchField || 'any';
                    let searchIn;
                    if (matchField === 'cif') {
                        // Matching per CIF: comparar directament
                        searchIn = fields.cif;
                    } else {
                        searchIn = fields[matchField] ?? fields.any;
                    }

                    const mode = cond.matchMode || 'any';
                    let matched;
                    if (matchField === 'cif') {
                        // Per CIF, comparem directament (case-insensitive)
                        matched = keywords.some(kw => searchIn === kw.replace(/[\s-]/g, '').toUpperCase());
                    } else {
                        matched = mode === 'all'
                            ? keywords.every(kw => searchIn.includes(kw))
                            : keywords.some(kw => searchIn.includes(kw));
                    }

                    if (matched) {
                        // Obtenir accions (suport v1 i v2)
                        const actions = rule.actions || {
                            categoria: rule.categoria || null,
                        };
                        return {
                            actions,
                            ruleName: rule.name || cond.keywords,
                            ruleId: rule.id,
                        };
                    }
                }
                return null;
            },

            /**
             * Compat legacy: Aplica regles i retorna { categoria, ruleName, ruleId } o null.
             */
            applyCustomRules: (data) => {
                const result = get().applyAdvancedRules(data);
                if (!result) return null;
                return {
                    categoria: result.actions?.categoria || null,
                    ruleName: result.ruleName,
                    ruleId: result.ruleId,
                };
            },

            // ============================================
            // MATCHING PER CIF/NIF
            // ============================================

            /**
             * Busca un proveïdor per CIF/NIF a l'índex de CIFs.
             */
            findByCif: (cif) => {
                const { cifIndex, providers } = get();
                const cleanCif = (cif || '').replace(/[\s-]/g, '').toUpperCase();
                if (!cleanCif || cleanCif.length < 8) return null;
                const providerKey = cifIndex[cleanCif];
                return providerKey && providers[providerKey]
                    ? { ...providers[providerKey], matchType: 'cif', matchScore: 100 }
                    : null;
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
            resetMemory: () => set({ providers: {}, customRules: [], cifIndex: {} }),
        }),
        {
            name: 'provider-memory-storage',
            storage,
            partialize: (state) => ({
                providers: state.providers,
                customRules: state.customRules,
                cifIndex: state.cifIndex,
            }),
            // Migració v1→v2: convertir regles antigues al nou format conditions/actions
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                let needsMigration = false;
                const migrated = state.customRules.map(rule => {
                    // Si ja té conditions/actions → v2, no cal migrar
                    if (rule.conditions && rule.actions) return rule;
                    needsMigration = true;
                    return {
                        id: rule.id,
                        name: rule.name || '',
                        enabled: rule.enabled ?? true,
                        priority: rule.priority ?? 999,
                        conditions: {
                            keywords: rule.keywords || '',
                            matchField: rule.matchField || 'any',
                            matchMode: rule.matchMode || 'any',
                        },
                        actions: {
                            categoria: rule.categoria || null,
                            proveedor: null,
                            ivaPorcentaje: null,
                            cifNif: null,
                            concepto: null,
                            deducible: null,
                            deduciblePct: null,
                            dateStrategy: null,
                        },
                        createdAt: rule.createdAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };
                });
                if (needsMigration) {
                    console.log(`[ProviderMemory] Migrades ${migrated.length} regles v1→v2`);
                    state.customRules = migrated;
                }

                // Reconstruir cifIndex des de providers si no existeix
                if (!state.cifIndex || Object.keys(state.cifIndex).length === 0) {
                    const cifIndex = {};
                    for (const [key, data] of Object.entries(state.providers || {})) {
                        if (data.cifNif) {
                            const cleanCif = data.cifNif.replace(/[\s-]/g, '').toUpperCase();
                            if (cleanCif.length >= 8) cifIndex[cleanCif] = key;
                        }
                    }
                    if (Object.keys(cifIndex).length > 0) {
                        console.log(`[ProviderMemory] Reconstruït cifIndex: ${Object.keys(cifIndex).length} entrades`);
                        state.cifIndex = cifIndex;
                    }
                }
            },
        }
    )
);
