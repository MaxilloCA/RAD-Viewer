import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { sameRecipe } from './model';
import type { OpenImage, Recipe, RenderInfo } from './model';

let requestCounter = 0;
export const nextRequest = () => ++requestCounter;
type Work = { id: string; recipe: Recipe; preview: boolean };
const sameWork = (a: Work, b: Work) => a.id === b.id && a.preview === b.preview && sameRecipe(a.recipe, b.recipe);

/** One render in flight; newest adjustment wins. Drafts use bounded previews,
 * followed immediately by an exact full-resolution render on commit. */
export function useRenderedImage(active: OpenImage | undefined, recipe: Recipe | undefined, onError: (message: string) => void, interactive = false) {
  const [rendered, setRendered] = useState<RenderInfo | null>(null);
  const [processing, setProcessing] = useState(false);
  const latest = useRef<Work | null>(null);
  const cache = useRef(new Map<string, { recipe: Recipe; rendered: RenderInfo }>());
  const busy = useRef(false);
  const alive = useRef(true);
  const pumpRef = useRef<() => void>(() => {});
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const pump = useCallback(() => {
    if (!alive.current || busy.current || !latest.current) return;
    const work = latest.current;
    const cached = cache.current.get(work.id);
    if (cached && sameRecipe(cached.recipe, work.recipe)) {
      setRendered(cached.rendered); setProcessing(false); return;
    }
    busy.current = true;
    const requestId = nextRequest();
    void invoke<RenderInfo>('render_image', { id: work.id, recipe: work.recipe, requestId, preview: work.preview }).then(result => {
      if (!alive.current || result.requestId !== requestId) return;
      if (!work.preview) cache.current.set(work.id, { recipe: work.recipe, rendered: result });
      if (latest.current?.id === work.id && latest.current.preview === work.preview) {
        setRendered(result);
        setProcessing(!sameWork(latest.current, work));
      }
    }).catch(error => {
      if (alive.current && latest.current && sameWork(latest.current, work)) {
        errorRef.current(`Rendering failed: ${String(error)}`); setProcessing(false);
      }
    }).finally(() => {
      busy.current = false;
      if (alive.current && latest.current && !sameWork(latest.current, work)) pumpRef.current();
    });
  }, []);
  pumpRef.current = pump;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!active || !recipe) { latest.current = null; setRendered(null); setProcessing(false); return; }
    if (!cache.current.has(active.info.id)) cache.current.set(active.info.id, { recipe: active.history.present, rendered: active.initial });
    latest.current = { id: active.info.id, recipe, preview: interactive };
    const previous = cache.current.get(active.info.id)!;
    setRendered(current => current?.id === active.info.id ? current : previous.rendered);
    setProcessing(!sameRecipe(previous.recipe, recipe));
    pump();
  }, [active?.info.id, recipe, interactive, pump]);

  return { rendered: rendered?.id === active?.info.id ? rendered : null, processing };
}
