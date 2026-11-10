import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clamp } from './model';
import type { Recipe, RenderInfo } from './model';
import type { Point } from './workspace';
import { nextRequest } from './useRenderedImage';

/** Temporary display state never enters recipes, history, exports or persistence. */
export function useGrayscalePreview(id: string | undefined, recipe: Recipe | undefined, onError: (error: string) => void) {
  const [held, setHeld] = useState(false);
  const [frame, setFrame] = useState<{ key: string; render: RenderInfo } | null>(null);
  const key = JSON.stringify([id, recipe]);
  const errorRef = useRef(onError); errorRef.current = onError;
  useEffect(() => { setHeld(false); }, [id]);
  useEffect(() => {
    const release = () => setHeld(false);
    window.addEventListener('blur', release); window.addEventListener('pointerup', release); window.addEventListener('keyup', release);
    return () => { window.removeEventListener('blur', release); window.removeEventListener('pointerup', release); window.removeEventListener('keyup', release); };
  }, []);
  useEffect(() => {
    if (!held || !id || !recipe) return;
    let cancelled = false;
    // Color amount zero guarantees processed grayscale even for RGB sources.
    void invoke<RenderInfo>('render_snapshot', { id, recipe: { ...recipe, version: 2, colorize: true, colorStrength: 0 }, requestId: nextRequest() })
      .then(render => { if (!cancelled) setFrame({ key, render }); })
      .catch(error => { if (!cancelled) { errorRef.current(`Grayscale preview failed: ${String(error)}`); setHeld(false); } });
    return () => { cancelled = true; };
  }, [held, key]);
  const render = held && frame?.key === key ? frame.render : null;
  return { held, setHeld, render, busy: held && !render };
}

/** Context changes invalidate both armed picks and requests already in flight. */
export function useReferencePicker(context: string, onError: (error: string) => void) {
  const [picking, setPicking] = useState(false);
  const generation = useRef(0);
  const currentContext = useRef(context);
  if (currentContext.current !== context) { currentContext.current = context; generation.current++; }
  useEffect(() => { setPicking(false); }, [context]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!picking) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); generation.current++; setPicking(false); } };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [picking]);
  const toggle = () => { generation.current++; setPicking(value => !value); };
  const sample = async (source: string | (() => Promise<{ id: string; dispose: () => Promise<unknown> }>), recipe: Recipe, point: Point, apply: (level: number) => void) => {
    if (!picking) return;
    setPicking(false);
    const token = ++generation.current;
    let temporary: { id: string; dispose: () => Promise<unknown> } | undefined;
    try {
      if (typeof source !== 'string') temporary = await source();
      if (token !== generation.current) return;
      const id = typeof source === 'string' ? source : temporary!.id;
      const value = await invoke<number>('sample_reference', { id, recipe, x: Math.floor(point.x), y: Math.floor(point.y) });
      if (token !== generation.current) return;
      if (!Number.isFinite(value)) throw new Error('Invalid reference sample');
      apply(clamp(value, .05, .95));
    } catch (error) { if (token === generation.current) onError(`Reference sampling failed: ${String(error)}`); }
    finally { if (temporary) await temporary.dispose().catch(error => onError(`Could not release reference image: ${String(error)}`)); }
  };
  return { picking, toggle, sample };
}
