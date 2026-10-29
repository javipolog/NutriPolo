import { useEffect, useState } from 'react';
import { loadFoodLibrary, buildFoodLibrary } from '../services/foodCatalog';

// Mentre es carrega Mercadona ja es poden fer servir els genèrics
const GENERIC_ONLY = { alimentos: buildFoodLibrary(), mercadona: false, loading: true };

/** Biblioteca d'aliments (genèrics + Mercadona), carregada un cop per sessió. */
export function useFoodLibrary() {
  const [library, setLibrary] = useState(GENERIC_ONLY);
  useEffect(() => {
    let cancelled = false;
    loadFoodLibrary().then(lib => { if (!cancelled) setLibrary({ ...lib, loading: false }); });
    return () => { cancelled = true; };
  }, []);
  return library;
}
