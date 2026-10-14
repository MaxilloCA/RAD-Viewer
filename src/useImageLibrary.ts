import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { experimentalPreset, sameRecipe, withProcessingLevel } from './model';
import type { History, ImageEntry, ImageInfo, PatientIdentity, Recipe, RenderInfo } from './model';
import { nextRequest } from './useRenderedImage';

export const DECODED_IMAGE_LIMIT = 8;
let entrySerial = 0;
type PinWork = { id: string; recipe: Recipe; requestId: number };
type PinJob = { epoch: number; desired?: PinWork; active?: PinWork; completedRecipe?: Recipe; waiters: (() => void)[] };
const pinBusy = (job?: PinJob) => Boolean(job?.active || job?.desired);
const settlePin = (job: PinJob) => { for (const resolve of job.waiters.splice(0)) resolve(); };
const waitForPin = (job: PinJob): Promise<void> => pinBusy(job) ? new Promise(resolve => job.waiters.push(resolve)) : Promise.resolve();

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
  const autoPair = useRef<{ epoch: number; first?: string; second?: string; pinStarted: boolean } | null>(null);
  const pinJobs = useRef(new Map<string, PinJob>());
  const pinRunning = useRef(false);
  const releasing = useRef(new Map<string, Promise<void>>());
  const errorRef = useRef(onError); errorRef.current = onError;
  const update = useCallback((operation: (previous: ImageEntry[]) => ImageEntry[]) => {
    entriesRef.current = operation(entriesRef.current);
    if (alive.current) setEntries(entriesRef.current);
  }, []);
  const release = useCallback((id: string): Promise<void> => {
    const existing = releasing.current.get(id);
    if (existing) return existing;
    const completion = invoke<void>('release_image', { id }).catch(error => { if (alive.current) errorRef.current(`Could not release an image: ${String(error)}`); }).finally(() => releasing.current.delete(id));
    releasing.current.set(id, completion);
    return completion;
  }, []);
  // One global snapshot worker bounds retained sources and IPC buffers. Each pin
  // has only one queued recipe; edits replace it while its current render runs.
  const pumpPins = useCallback(async () => {
    if (pinRunning.current || !alive.current) return;
    pinRunning.current = true;
    try {
      while (alive.current) {
        const pending = [...pinJobs.current].filter(([, job]) => job.desired);
        const next = pending.find(([key]) => key === selectedRef.current) ?? pending[0];
        if (!next) break;
        const [key, job] = next;
        const work = job.desired!;
        job.desired = undefined; job.active = work;
        const current = () => alive.current && epoch.current === job.epoch && pinJobs.current.get(key) === job;
        try {
          const rendered = await invoke<RenderInfo>('render_snapshot', work);
          if (!current()) continue;
          const entry = entriesRef.current.find(item => item.key === key);
          if (!entry || entry.details?.id !== work.id || !entry.history || !sameRecipe(entry.history.present, work.recipe) || job.desired) continue;
          if (rendered.id !== work.id || rendered.requestId !== work.requestId || !rendered.url.startsWith('data:image/png;base64,')) throw new Error('The full-resolution pin could not be prepared.');
          job.completedRecipe = work.recipe;
          update(previous => previous.map(item => item.key === key ? { ...item, pinned: true, pinnedRender: rendered, pinError: undefined } : item));
        } catch (error) {
          if (current() && !job.desired) {
            const entry = entriesRef.current.find(item => item.key === key);
            const message = `Could not update pinned image ${entry?.name ?? ''}: ${String(error)}`;
            update(previous => previous.map(item => item.key === key ? { ...item, pinError: message } : item));
            errorRef.current(message);
          }
        } finally {
          job.active = undefined;
          if (!job.desired) {
            if (current()) update(previous => previous.map(item => item.key === key ? { ...item, pinPending: false } : item));
            settlePin(job);
          }
        }
      }
    } finally { pinRunning.current = false; }
  }, [update]);
  const requestPinSnapshot = useCallback((key: string): Promise<void> => {
    const entry = entriesRef.current.find(item => item.key === key);
    const job = pinJobs.current.get(key);
    if (!entry?.image || !entry.history || !job || !alive.current) return Promise.resolve();
    const recipe = entry.history.present;
    const id = entry.image.info.id;
    const newest = job.desired ?? job.active;
    if (newest?.id === id && sameRecipe(newest.recipe, recipe)) return waitForPin(job);
    if (!pinBusy(job) && job.completedRecipe && sameRecipe(job.completedRecipe, recipe)) return Promise.resolve();
    job.desired = { id, recipe, requestId: nextRequest() };
    update(previous => previous.map(item => item.key === key ? { ...item, pinPending: true, pinError: undefined } : item));
    const completion = waitForPin(job);
    void pumpPins();
    return completion;
  }, [pumpPins, update]);
  const cancelPin = useCallback((key: string) => {
    const job = pinJobs.current.get(key);
    if (job) { job.desired = undefined; pinJobs.current.delete(key); settlePin(job); }
  }, []);
  const togglePinEntry = useCallback(async (key: string) => {
    const entry = entriesRef.current.find(item => item.key === key);
    if (!entry || !alive.current) return;
    if (entry.pinned || entry.pinPending) {
      cancelPin(key);
      update(previous => previous.map(item => item.key === key ? { ...item, pinned: false, pinPending: false, pinError: undefined, pinOrder: undefined, pinnedRender: undefined } : item));
      return;
    }
    if (!entry.image || !entry.history) { errorRef.current('Wait for the image to open before pinning it.'); return; }
    const pinOrder = ++tick.current;
    update(previous => previous.map(item => item.key === key ? { ...item, pinOrder } : item));
    pinJobs.current.set(key, { epoch: epoch.current, waiters: [] });
    await requestPinSnapshot(key);
  }, [cancelPin, requestPinSnapshot, update]);
  const cancelAutoPair = useCallback(() => {
    const pending = autoPair.current; autoPair.current = null;
    if (pending?.pinStarted && pending.first) {
      const first = entriesRef.current.find(entry => entry.key === pending.first);
      if (first?.pinPending && !first.pinned) {
        cancelPin(first.key);
        update(previous => previous.map(entry => entry.key === first.key ? { ...entry, pinPending: false, pinOrder: undefined, pinError: undefined } : entry));
      }
    }
  }, [cancelPin, update]);
  const togglePin = useCallback(async (key: string) => {
    const cancelledInitialPin = autoPair.current?.pinStarted && autoPair.current.first === key && entriesRef.current.some(entry => entry.key === key && entry.pinPending && !entry.pinned);
    cancelAutoPair();
    if (!cancelledInitialPin) await togglePinEntry(key);
  }, [cancelAutoPair, togglePinEntry]);
  const selectEntry = useCallback((key: string | null) => {
    selectedRef.current = key; setSelectedKey(key);
    update(previous => previous.map(entry => entry.key === key ? { ...entry, error: undefined, lastUsed: ++tick.current } : entry));
    pumpRef.current();
  }, [update]);
  const advanceAutoPair = useCallback((key: string) => {
    const pending = autoPair.current;
    if (!pending || pending.epoch !== epoch.current || pending.pinStarted) return;
    if (!pending.first) { pending.first = key; selectEntry(key); return; }
    if (pending.first === key) return;
    pending.second = key; pending.pinStarted = true;
    void togglePinEntry(pending.first).then(() => {
      if (!alive.current || autoPair.current !== pending || pending.epoch !== epoch.current) return;
      autoPair.current = null;
      const first = entriesRef.current.find(entry => entry.key === pending.first);
      const second = entriesRef.current.find(entry => entry.key === pending.second);
      if (first?.pinnedRender && second?.image) selectEntry(second.key);
    });
  }, [selectEntry, togglePinEntry]);
  const refreshPinned = useCallback((key: string): Promise<void> => {
    const entry = entriesRef.current.find(item => item.key === key);
    return entry?.pinned || entry?.pinPending ? requestPinSnapshot(key) : Promise.resolve();
  }, [requestPinSnapshot]);
  const pump = useCallback(async () => {
    if (running.current || !alive.current) return;
    running.current = true;
    try {
      while (alive.current) {
        const selected = entriesRef.current.find(entry => entry.key === selectedRef.current);
        const target = selected && !selected.image && !selected.error ? selected : entriesRef.current.find(entry => !entry.thumbnail && !entry.error);
        if (!target) { if (autoPair.current && !autoPair.current.pinStarted) autoPair.current = null; break; }
        const operationEpoch = epoch.current;
        const current = () => alive.current && epoch.current === operationEpoch && entriesRef.current.some(entry => entry.key === target.key);
        setLoading(target.key === selectedRef.current ? `Opening ${target.name}…` : `Preparing previews · ${entriesRef.current.filter(entry => entry.thumbnail).length} of ${entriesRef.current.length}`);
        let importedId: string | undefined;
        try {
          const decoded = entriesRef.current.filter(entry => entry.image);
          if (decoded.length < DECODED_IMAGE_LIMIT && decoded.length + releasing.current.size >= DECODED_IMAGE_LIMIT) {
            await Promise.all(releasing.current.values());
            continue;
          }
          if (decoded.length >= DECODED_IMAGE_LIMIT) {
            const victim = decoded.filter(entry => entry.key !== selectedRef.current && entry.key !== autoPair.current?.second).sort((a, b) => Number(pinBusy(pinJobs.current.get(a.key))) - Number(pinBusy(pinJobs.current.get(b.key))) || a.lastUsed - b.lastUsed)[0];
            if (!victim?.image) throw new Error('No decoded-image cache slot is available.');
            const pinJob = pinJobs.current.get(victim.key);
            if (pinJob && pinBusy(pinJob)) { await waitForPin(pinJob); continue; }
            update(previous => previous.map(entry => entry.key === victim.key ? { ...entry, image: undefined } : entry));
            await release(victim.image.info.id);
          }
          if (!current()) continue;
          const priority = entriesRef.current.find(entry => entry.key === selectedRef.current);
          if (priority && !priority.image && !priority.error && priority.key !== target.key) continue;
          const info = await invoke<ImageInfo>('import_image', { path: target.path });
          importedId = info.id;
          if (!current()) { await release(info.id); continue; }
          const defaultRecipe = target.defaultRecipe ?? withProcessingLevel(experimentalPreset('med', info.neutral, info.suggested, info.metadata.photometric), info.suggested ?? info.neutral, 4);
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
          advanceAutoPair(target.key);
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
  }, [advanceAutoPair, release, update]);
  pumpRef.current = () => { void pump(); };
  const select = useCallback((key: string | null) => { cancelAutoPair(); selectEntry(key); }, [cancelAutoPair, selectEntry]);
  const append = useCallback((paths: string[], patient?: PatientIdentity, pairLatest = false) => {
    if (!paths.length) return;
    cancelAutoPair();
    if (pairLatest) autoPair.current = { epoch: epoch.current, pinStarted: false };
    const added = paths.map(path => ({ key: `image-${++entrySerial}`, path, name: path.split(/[\\/]/).pop() ?? path, patient, lastUsed: ++tick.current, rotationQuarterTurns: 0 }));
    update(previous => [...previous, ...added]); selectEntry(added[0].key);
  }, [cancelAutoPair, selectEntry, update]);
  const replace = useCallback(async (paths: string[], patient: PatientIdentity) => {
    if (!paths.length) throw new Error('No radiographs were found for this patient.');
    cancelAutoPair();
    const replacementEpoch = ++epoch.current;
    const old = entriesRef.current;
    for (const key of pinJobs.current.keys()) cancelPin(key);
    update(() => []); selectedRef.current = null; setSelectedKey(null);
    await Promise.all(old.flatMap(entry => entry.image ? [release(entry.image.info.id)] : []));
    if (!alive.current || epoch.current !== replacementEpoch) return;
    append(paths, patient, true);
  }, [append, cancelAutoPair, cancelPin, release, update]);
  const changeHistory = useCallback((operation: (history: History) => History) => {
    cancelAutoPair();
    const key = selectedRef.current;
    update(previous => previous.map(entry => {
      if (entry.key !== key || !entry.history) return entry;
      const history = operation(entry.history);
      return { ...entry, history, image: entry.image ? { ...entry.image, history } : undefined };
    }));
    if (key && pinJobs.current.has(key)) void requestPinSnapshot(key);
  }, [cancelAutoPair, requestPinSnapshot, update]);
  const close = useCallback(async () => {
    cancelAutoPair();
    const current = entriesRef.current.find(entry => entry.key === selectedRef.current);
    if (!current) return;
    cancelPin(current.key);
    update(previous => previous.filter(entry => entry.key !== current.key));
    const released = current.image ? release(current.image.info.id) : Promise.resolve();
    select(entriesRef.current[0]?.key ?? null);
    await released;
  }, [cancelAutoPair, cancelPin, release, select, update]);
  const rotate = useCallback((key: string | null = selectedRef.current) => {
    cancelAutoPair();
    update(previous => previous.map(entry => entry.key === key ? { ...entry, rotationQuarterTurns: (entry.rotationQuarterTurns + 1) % 4 } : entry));
  }, [cancelAutoPair, update]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; ++epoch.current; autoPair.current = null;
      for (const key of pinJobs.current.keys()) cancelPin(key);
      for (const entry of entriesRef.current) if (entry.image) void release(entry.image.info.id);
      entriesRef.current = [];
    };
  }, [cancelPin, release]);
  return { entries, selectedKey, loading, select, append, replace, changeHistory, close, rotate, togglePin, refreshPinned, cancelAutoPair };
}
