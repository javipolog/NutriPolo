import { useEffect, useMemo, useState } from 'react';
import useStore from '../stores/store';
import { loadFoodLibrary, buildFoodLibrary, applyFoodEdits } from '../services/foodCatalog';

// Mentre es carrega Mercadona ja es poden fer servir els genèrics
const GENERIC_ONLY = { alimentos: buildFoodLibrary(), mercadona: false, loading: true };
const NO_EDITS = {};

/**
 * Biblioteca d'aliments (genèrics + Mercadona), carregada un cop per sessió,
 * amb les fotos i els valors que s'hi hagin canviat a mà.
 */
export function useFoodLibrary() {
  const [library, setLibrary] = useState(GENERIC_ONLY);
  const edits = useStore(s => s.planLibrary.alimentos) || NO_EDITS;
  useEffect(() => {
    let cancelled = false;
    loadFoodLibrary().then(lib => { if (!cancelled) setLibrary({ ...lib, loading: false }); });
    return () => { cancelled = true; };
  }, []);
  return useMemo(() => ({ ...library, alimentos: applyFoodEdits(library.alimentos, edits) }), [library, edits]);
}
