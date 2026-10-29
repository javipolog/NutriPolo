import React, { useMemo, useState } from 'react';
import { Search, RefreshCw, ExternalLink, Clock, BookOpen, AlertTriangle, Link2, Trash2 } from 'lucide-react';
import { open as openUrl } from '@tauri-apps/api/shell';
import { Modal, Badge, Spinner, EmptyState, SegmentedControl, useToast, useConfirm } from '../UI';
import useStore, { errMsg } from '../../stores/store';
import { useT, useLocale } from '../../i18n';
import { useWebRecipes, loadWebRecipeNow } from '../../hooks/useWebRecipes';
import { filterWebRecipes, isDetailPending, dishFromWebRecipe, RECIPES_PAGE_URL } from '../../services/webRecipes';
import { linesOf, summarizeIngredients } from '../../services/planificacion';

const NO_RECIPES = [];
const CARD = 'w-full h-full text-left bg-white border border-sage-200 rounded-soft hover:border-wellness-400 hover:bg-wellness-50 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/25 transition-colors';

/**
 * Llista del receptari de la web, amb cerca i sincronització. La llista ve de
 * la memòria cau i s'actualitza sola en segon pla quan és vella. Amb
 * `needsDetail`, una recepta triada abans que se n'hagin baixat els
 * ingredients es baixa en aquell moment. Amb `onPickOwn`, també mostra la
 * pestanya "Mis recetas" (els plats propis desats en desar una planificació).
 */
export const WebRecipeList = ({ onPick, onPickOwn, needsDetail = true, autoFocus = false }) => {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { items, syncedAt, syncing, done, total, error, refresh } = useWebRecipes();
  const ownRecipes = useStore(s => s.planLibrary.recetas) || NO_RECIPES;
  const deleteOwnRecipe = useStore(s => s.deleteOwnRecipe);
  const [tab, setTab] = useState('web');
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(0);
  const [loadingId, setLoadingId] = useState(null);
  const shown = useMemo(() => filterWebRecipes(items, query), [items, query]);
  const ownShown = useMemo(
    () => filterWebRecipes([...ownRecipes].sort((a, b) => a.titulo.localeCompare(b.titulo)), query),
    [ownRecipes, query],
  );

  const manualRefresh = () => refresh().then(r => setFailed(r.failed)).catch(() => {});

  const pick = async (r) => {
    if (!needsDetail || !isDetailPending(r)) { onPick(r); return; }
    setLoadingId(r.id);
    try {
      onPick(await loadWebRecipeNow(r));
    } catch {
      toast.error(t.pf_web_detail_error.replace('{name}', r.titulo));
    } finally {
      setLoadingId(null);
    }
  };
  const removeOwn = async (r) => {
    if (await confirm({ message: t.pf_own_delete_confirm.replace('{name}', r.titulo), danger: true })) deleteOwnRecipe(r.id);
  };
  const when = syncedAt ? new Date(syncedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '';
  const showOwn = onPickOwn && tab === 'own';

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t.pf_web_search_ph}
          aria-label={t.pf_web_search_ph}
          className="w-full text-sm text-sage-800 bg-white border border-sage-300 rounded-button pl-9 pr-3 py-2 placeholder-sage-400 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10"
          autoFocus={autoFocus}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-sage-500">
        {onPickOwn && (
          <SegmentedControl
            ariaLabel={t.pf_recipes}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'web', label: `${t.pf_recipes_web} (${items.length})` },
              { value: 'own', label: `${t.pf_recipes_own} (${ownRecipes.length})` },
            ]}
          />
        )}
        {!showOwn && (
          <>
            <span aria-live="polite">
              {syncing ? (
                <span className="flex items-center gap-2 tabular-nums">
                  <Spinner size="sm" />
                  {total > 0 ? t.pf_web_loading_details.replace('{done}', done).replace('{total}', total) : t.pf_web_syncing}
                </span>
              ) : syncedAt ? (
                <span className="tabular-nums">{t.pf_web_synced.replace('{n}', items.length).replace('{when}', when)}</span>
              ) : null}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => openUrl(RECIPES_PAGE_URL).catch(() => {})}
                className="flex items-center gap-1 px-2 py-1 rounded-button hover:bg-sage-100 hover:text-sage-700 transition-colors"
              >
                <ExternalLink size={13} aria-hidden="true" />{t.pf_web_open}
              </button>
              <button
                type="button"
                onClick={manualRefresh}
                disabled={syncing}
                className="flex items-center gap-1 px-2 py-1 rounded-button hover:bg-sage-100 hover:text-sage-700 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />{t.pf_web_refresh}
              </button>
            </div>
          </>
        )}
      </div>

      {showOwn ? (
        ownRecipes.length === 0 ? (
          <EmptyState icon={BookOpen} title={t.pf_recipes_own} description={t.pf_own_none} />
        ) : ownShown.length === 0 ? (
          <p className="text-sm text-sage-500 py-10 text-center">{t.pf_web_empty}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {ownShown.map(r => (
              <li key={r.id} className="relative">
                <button type="button" onClick={() => onPickOwn(r)} className={`${CARD} block p-3 pr-9 space-y-1`}>
                  <span className="block text-sm font-medium text-sage-800 leading-snug">
                    {r.receta && <Link2 size={12} className="inline mr-1 -mt-0.5 text-terra-600" aria-hidden="true" />}
                    {r.titulo}
                  </span>
                  <span className="text-xs text-sage-500 line-clamp-2">{linesOf(r.alimentos).join(' · ')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeOwn(r)}
                  aria-label={`${t.pf_own_delete}: ${r.titulo}`}
                  title={t.pf_own_delete}
                  className="absolute top-1.5 right-1.5 p-1.5 rounded-button text-sage-400 hover:text-danger hover:bg-danger-light transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {error && !syncing && items.length > 0 && (
            <p role="alert" title={errMsg(error)} className="text-xs text-danger bg-danger-light rounded-button px-3 py-2 flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />
              {t.pf_web_error}
            </p>
          )}
          {failed > 0 && !error && !syncing && (
            <p className="text-xs text-warning bg-warning-light rounded-button px-3 py-2">{t.pf_web_failed.replace('{n}', failed)}</p>
          )}

          {items.length === 0 ? (
            syncing
              ? <div className="flex justify-center py-16"><Spinner /></div>
              : <EmptyState icon={BookOpen} title={t.pf_web_recipes} description={t.pf_web_none} />
          ) : shown.length === 0 ? (
            <p className="text-sm text-sage-500 py-10 text-center">{t.pf_web_empty}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {shown.map(r => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    disabled={loadingId !== null}
                    aria-busy={loadingId === r.id || undefined}
                    className={`${CARD} flex gap-3 p-2 disabled:cursor-wait`}
                  >
                    {r.imagen
                      // La web talla les imatges si s'envia un Referer d'un altre lloc
                      ? <img src={r.imagen} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-16 h-16 shrink-0 rounded-button object-cover bg-sage-100" />
                      : <span className="w-16 h-16 shrink-0 rounded-button bg-sage-100 flex items-center justify-center"><BookOpen size={18} className="text-sage-400" /></span>}
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block text-sm font-medium text-sage-800 leading-snug">{r.titulo}</span>
                      <span className="flex flex-wrap gap-1">
                        {r.minutos && <Badge icon={Clock}><span className="tabular-nums">{t.pf_web_minutes.replace('{n}', r.minutos)}</span></Badge>}
                        {(r.etiquetas || []).map(tag => <Badge key={tag}>{tag}</Badge>)}
                      </span>
                      {loadingId === r.id ? (
                        <span className="flex items-center gap-2 text-xs text-sage-500"><Spinner size="sm" />{t.pf_web_loading_one}</span>
                      ) : isDetailPending(r) ? (
                        <span className="block text-xs text-sage-400 italic">{t.pf_web_pending}</span>
                      ) : r.ingredientes.length > 0 && (
                        <span className="text-xs text-sage-500 line-clamp-2">{summarizeIngredients(r.ingredientes).join(' · ')}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {ConfirmDialog}
    </div>
  );
};

/**
 * Tria una recepta per a un plat: del receptari de la web o de "Mis recetas".
 * `onPick` rep un plat `{ titulo, alimentos, receta, nota?, source: 'web' | 'own' }`.
 */
export const WebRecipePicker = ({ open, onClose, onPick }) => {
  const t = useT();
  const ownRecipes = useStore(s => s.planLibrary.recetas) || NO_RECIPES;
  return (
    <Modal open={open} onClose={onClose} title={t.pf_recipes} size="lg">
      <WebRecipeList
        autoFocus
        onPick={r => onPick({ ...dishFromWebRecipe(r, ownRecipes), source: 'web' })}
        onPickOwn={r => onPick({ titulo: r.titulo, alimentos: r.alimentos, receta: r.receta || '', nota: r.nota || '', source: 'own' })}
      />
    </Modal>
  );
};

export default WebRecipePicker;
