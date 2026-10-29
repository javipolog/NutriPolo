import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import useStore from '../stores/store';
import { syncWebRecipes, fetchWebRecipeDetail, isDetailPending, isStale, EMPTY_WEB_RECIPES } from '../services/webRecipes';

// Estat de la sincronització (no es desa): compartit per tots els components
const useSyncState = create(() => ({ syncing: false, done: 0, total: 0, error: null }));

let inFlight = null;
// Una sola baixada per recepta (i versió), tant si la demana la sincronització com l'usuari
const pending = new Map();
const loaded = new Map();
const key = (r) => `${r.id}@${r.modified}`;

const cacheNow = () => useStore.getState().planLibrary.recetasWeb || EMPTY_WEB_RECIPES;

function loadDetail(r) {
  const k = key(r);
  if (loaded.has(k)) return Promise.resolve(loaded.get(k));
  if (!pending.has(k)) {
    pending.set(k, fetchWebRecipeDetail(r)
      .then(full => { loaded.set(k, full); return full; })
      .finally(() => pending.delete(k)));
  }
  return pending.get(k);
}

// Una recepta ja baixada en aquesta sessió no torna a quedar pendent
const withLoaded = (items) => items.map(r => (isDetailPending(r) && loaded.get(key(r))) || r);

/** Ingredients d'una recepta encara pendent, ara mateix (en triar-la). */
export async function loadWebRecipeNow(r) {
  const full = await loadDetail(r);
  const { items, syncedAt } = cacheNow();
  useStore.getState().setWebRecipes({ items: items.map(x => (x.id === full.id ? full : x)), syncedAt });
  return full;
}

function runSync() {
  if (!inFlight) {
    const { setWebRecipes } = useStore.getState();
    useSyncState.setState({ syncing: true, done: 0, total: 0, error: null });
    inFlight = syncWebRecipes(cacheNow(), {
      loadDetail,
      // Es desa a mesura que arriba: si es tanca l'app, no es perd el que ja s'ha baixat
      onProgress: ({ items, done, total }) => {
        setWebRecipes({ items: withLoaded(items), syncedAt: cacheNow().syncedAt });
        useSyncState.setState({ done, total });
      },
    })
      .then(res => { setWebRecipes({ items: withLoaded(res.items), syncedAt: res.syncedAt }); return res; })
      .catch(e => { useSyncState.setState({ error: e }); throw e; })
      .finally(() => { inFlight = null; useSyncState.setState({ syncing: false }); });
  }
  return inFlight;
}

/**
 * Receptes de la web en memòria cau. Si són velles (o no n'hi ha) es
 * tornen a baixar en segon pla; `refresh()` ho força i propaga l'error.
 */
export function useWebRecipes({ auto = true } = {}) {
  const cache = useStore(s => s.planLibrary.recetasWeb) || EMPTY_WEB_RECIPES;
  const { syncing, done, total, error } = useSyncState();
  const refresh = useCallback(() => runSync(), []);

  useEffect(() => {
    if (auto && !inFlight && isStale(cacheNow())) runSync().catch(() => {});
  }, [auto]);

  return { items: cache.items, syncedAt: cache.syncedAt, syncing, done, total, error, refresh };
}
