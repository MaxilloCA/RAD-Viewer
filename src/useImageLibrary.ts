import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { experimentalPreset } from './model';
import type { History, ImageEntry, ImageInfo, PatientIdentity, RenderInfo } from './model';
import { nextRequest } from './useRenderedImage';

export const DECODED_IMAGE_LIMIT = 8;
let entrySerial = 0;

/** Keep every file/thumbnail/history, but only eight decoded sources. One loader gives selection priority. */
export function useImageLibrary(onError: (error: string) => void) {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const entriesRef = useRef<ImageEntry[]>([]);
  const selectedRef = useRef<string | null>(null);
  const epoch = useRef(0);
  const tick = useRef(0);
  const running = useRef(false);
  const alive = useRef(true);
  const pumpRef = useRef<() => void>(() => {});
  const errorRef = useRef(onError); errorRef.current = onError;
  const update = useCallback((operation: (previous: ImageEntry[]) => ImageEntry[]) => {
    entriesRef.current = operation(entriesRef.current);
    if (alive.current) setEntries(entriesRef.current);
  }, []);
  const release = useCallback(async (id: string) => {
    await invoke('release_image', { id }).catch(error => { if (alive.current) errorRef.current(`Could not release an image: ${String(error)}`); });
  }, []);
  const pump = useCallback(async () => {
    if (running.current || !alive.current) return;
    running.current = true;
    try {
      while (alive.current) {
        const selected = entriesRef.current.find(entry => entry.key === selectedRef.current);
        const target = selected && !selected.image && !selected.error ? selected : entriesRef.current.find(entry => !entry.thumbnail && !entry.error);
        if (!target) break;
        const operationEpoch = epoch.current;
        const current = () => alive.current && epoch.current === operationEpoch && entriesRef.current.some(entry => entry.key === target.key);
        setLoading(target.key === selectedRef.current ? `Opening ${target.name}…` : `Preparing previews · ${entriesRef.current.filter(entry => entry.thumbnail).length} of ${entriesRef.current.length}`);
        let importedId: string | undefined;
        try {
          const decoded = entriesRef.current.filter(entry => entry.image);
          if (decoded.length >= DECODED_IMAGE_LIMIT) {
            const victim = decoded.filter(entry => entry.key !== selectedRef.current).sort((a, b) => a.lastUsed - b.lastUsed)[0];
            if (!victim?.image) throw new Error('No decoded-image cache slot is available.');
            update(previous => previous.map(entry => entry.key === victim.key ? { ...entry, image: undefined } : entry));
            await release(victim.image.info.id);
          }
          if (!current()) continue;
          const priority = entriesRef.current.find(entry => entry.key === selectedRef.current);
          if (priority && !priority.image && !priority.error && priority.key !== target.key) continue;
          const info = await invoke<ImageInfo>('import_image', { path: target.path });
          importedId = info.id;
          if (!current()) { await release(info.id); continue; }
          const defaultRecipe = target.defaultRecipe ?? experimentalPreset('bitewing', info.neutral, info.suggested);
          const history = target.history ?? { past: [], present: defaultRecipe, future: [] };
          const initial = await invoke<RenderInfo>('render_image', { id: info.id, recipe: history.present, requestId: nextRequest() });
          if (!current()) { await release(info.id); continue; }
          const thumbnail = await invoke<string>('image_thumbnail', { id: info.id, requestId: initial.requestId });
          if (typeof thumbnail !== 'string' || !thumbnail.startsWith('data:image/')) throw new Error('The image preview could not be prepared.');
          if (!current()) { await release(info.id); continue; }
          update(previous => previous.map(entry => entry.key === target.key ? {
            ...entry, details: info, defaultRecipe, history, thumbnail, error: undefined,
            lastUsed: ++tick.current, image: { info, path: target.path, initial, defaultRecipe, history },
          } : entry));
        } catch (error) {
          if (importedId) await release(importedId);
          if (current()) {
            const detail = error instanceof Error ? error.message : String(error);
            update(previous => previous.map(entry => entry.key === target.key ? { ...entry, error: detail, image: undefined } : entry));
            if (selectedRef.current === target.key) errorRef.current(`${target.name}: ${detail}`);
          }
        }
      }
    } finally { running.current = false; if (alive.current) setLoading(null); }
  }, [release, update]);
  pumpRef.current = () => { void pump(); };
  const select = useCallback((key: string | null) => {
    selectedRef.current = key; setSelectedKey(key);
    update(previous => previous.map(entry => entry.key === key ? { ...entry, error: undefined, lastUsed: ++tick.current } : entry));
    pumpRef.current();
  }, [update]);
  const append = useCallback((paths: string[], patient?: PatientIdentity) => {
    if (!paths.length) return;
    const added = paths.map(path => ({ key: `image-${++entrySerial}`, path, name: path.split(/[\\/]/).pop() ?? path, patient, lastUsed: ++tick.current }));
    update(previous => [...previous, ...added]); select(added[0].key);
  }, [select, update]);
  const replace = useCallback(async (paths: string[], patient: PatientIdentity) => {
    if (!paths.length) throw new Error('No radiographs were found for this patient.');
    const replacementEpoch = ++epoch.current;
    const old = entriesRef.current;
    update(() => []); selectedRef.current = null; setSelectedKey(null);
    await Promise.all(old.flatMap(entry => entry.image ? [release(entry.image.info.id)] : []));
    if (!alive.current || epoch.current !== replacementEpoch) return;
    append(paths, patient);
  }, [append, release, update]);
  const changeHistory = useCallback((operation: (history: History) => History) => {
    const key = selectedRef.current;
    update(previous => previous.map(entry => {
      if (entry.key !== key || !entry.history) return entry;
      const history = operation(entry.history);
      return { ...entry, history, image: entry.image ? { ...entry.image, history } : undefined };
    }));
  }, [update]);
  const close = useCallback(async () => {
    const current = entriesRef.current.find(entry => entry.key === selectedRef.current);
    if (!current) return;
    update(previous => previous.filter(entry => entry.key !== current.key));
    if (current.image) await release(current.image.info.id);
    select(entriesRef.current[0]?.key ?? null);
  }, [release, select, update]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; ++epoch.current;
      for (const entry of entriesRef.current) if (entry.image) void release(entry.image.info.id);
    };
  }, [release]);
  return { entries, selectedKey, loading, select, append, replace, changeHistory, close };
}
