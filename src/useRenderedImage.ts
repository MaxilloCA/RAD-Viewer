import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { sameRecipe } from './model';
import type { OpenImage, Recipe, RenderInfo } from './model';

let requestCounter = 0;
export const nextRequest = () => ++requestCounter;
type Work = { id: string; recipe: Recipe };

/** One render in flight, latest pending recipe wins, and at most 10 starts/second. */
export function useRenderedImage(active: OpenImage | undefined, recipe: Recipe | undefined, onError: (message: string) => void) {
  const [rendered, setRendered] = useState<RenderInfo | null>(null);
  const [processing, setProcessing] = useState(false);
  const latest = useRef<Work | null>(null);
  const cache = useRef(new Map<string, { recipe: Recipe; rendered: RenderInfo }>());
  const busy = useRef(false);
  const alive = useRef(true);
  const lastStarted = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    const delay = Math.max(0, 100 - (performance.now() - lastStarted.current));
    if (delay > 0) {
      if (!timer.current) timer.current = setTimeout(() => { timer.current = undefined; pumpRef.current(); }, delay);
      return;
    }
    busy.current = true;
    lastStarted.current = performance.now();
    const requestId = nextRequest();
    void invoke<RenderInfo>('render_image', { id: work.id, recipe: work.recipe, requestId }).then(result => {
      if (!alive.current || result.requestId !== requestId) return;
      cache.current.set(work.id, { recipe: work.recipe, rendered: result });
      if (latest.current?.id === work.id) {
        setRendered(result);
        setProcessing(!sameRecipe(latest.current.recipe, work.recipe));
      }
    }).catch(error => {
      if (alive.current && latest.current?.id === work.id && sameRecipe(latest.current.recipe, work.recipe)) {
        errorRef.current(`Rendering failed: ${String(error)}`); setProcessing(false);
      }
    }).finally(() => {
      busy.current = false;
      if (alive.current && latest.current && (latest.current.id !== work.id || !sameRecipe(latest.current.recipe, work.recipe))) pumpRef.current();
    });
  }, []);
  pumpRef.current = pump;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); timer.current = undefined; };
  }, []);

  useEffect(() => {
    if (!active || !recipe) { latest.current = null; setRendered(null); setProcessing(false); return; }
    if (!cache.current.has(active.info.id)) cache.current.set(active.info.id, { recipe: active.history.present, rendered: active.initial });
    latest.current = { id: active.info.id, recipe };
    const previous = cache.current.get(active.info.id)!;
    setRendered(previous.rendered);
    setProcessing(!sameRecipe(previous.recipe, recipe));
    pump();
  }, [active?.info.id, recipe, pump]);

  return { rendered: rendered?.id === active?.info.id ? rendered : null, processing };
}
