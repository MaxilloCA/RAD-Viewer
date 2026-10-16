import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { experimentalPreset, sameRecipe, withProcessingLevel } from './model';
import type { History, ImageEntry, ImageInfo, PatientIdentity, Recipe, RenderInfo } from './model';
import { nextRequest } from './useRenderedImage';
import { SettingsWriter } from './settingsWriter';
import type { Ellipse, ReviewOverlay } from './workspace';
import type { SetStateAction } from 'react';

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
  const autoOpen = useRef<{ epoch: number; paths: Set<string>; first?: string; pinStarted: boolean } | null>(null);
  const pinJobs = useRef(new Map<string, PinJob>());
  const pinRunning = useRef(false);
  const releasing = useRef(new Map<string, Promise<void>>());
  const errorRef = useRef(onError); errorRef.current = onError;
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const writer = useRef<SettingsWriter | null>(null);
  if (!writer.current) writer.current = new SettingsWriter(value => { if (alive.current) setSaveStatus(value); }, error => { if (alive.current) errorRef.current(error); });
  const persist = useCallback((entry: ImageEntry) => {
    if (!entry.settingsKey || entry.settingsBlocked || !entry.history) return;
    const overlay = entry.overlay;
    writer.current!.queue(entry.settingsKey, { recipe: entry.history.present, rotationQuarterTurns: entry.rotationQuarterTurns, ellipses: entry.ellipses ?? [], overlay: overlay && !overlay.error && overlay.region.width >= 16 && overlay.region.height >= 16 ? { region: overlay.region, sensitivity: overlay.sensitivity, visible: overlay.visible } : null });
  }, []);
  const flushSettings = useCallback(() => writer.current!.flush(), []);
  const retrySettings = useCallback(() => writer.current!.retry(), []);
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
  const togglePinEntry = useCallback(async (key: string, visibleFrame?: RenderInfo | null) => {
    const entry = entriesRef.current.find(item => item.key === key);
    if (!entry || !alive.current) return;
    if (entry.pinned || entry.pinPending) {
      cancelPin(key);
      update(previous => previous.map(item => item.key === key ? { ...item, pinned: false, pinPending: false, pinError: undefined, pinOrder: undefined, pinnedRender: undefined } : item));
      return;
    }
    if (!entry.image || !entry.history) { errorRef.current('Wait for the image to open before pinning it.'); return; }
    const pinOrder = ++tick.current;
    update(previous => previous.map(item => item.key === key ? { ...item, pinOrder, pinnedRender: visibleFrame?.id === item.details?.id ? visibleFrame ?? undefined : item.pinnedRender } : item));
    pinJobs.current.set(key, { epoch: epoch.current, waiters: [] });
    await requestPinSnapshot(key);
  }, [cancelPin, requestPinSnapshot, update]);
  const cancelAutoOpen = useCallback(() => {
    const pending = autoOpen.current; autoOpen.current = null;
    if (pending?.pinStarted && pending.first) {
      const first = entriesRef.current.find(entry => entry.key === pending.first);
      if (first?.pinPending && !first.pinned) {
        cancelPin(first.key);
        update(previous => previous.map(entry => entry.key === first.key ? { ...entry, pinPending: false, pinOrder: undefined, pinError: undefined } : entry));
      }
    }
  }, [cancelPin, update]);
  const togglePin = useCallback(async (key: string, visibleFrame?: RenderInfo | null) => {
    const cancelledInitialPin = autoOpen.current?.pinStarted && autoOpen.current.first === key && entriesRef.current.some(entry => entry.key === key && entry.pinPending && !entry.pinned);
    cancelAutoOpen();
    if (!cancelledInitialPin) await togglePinEntry(key, visibleFrame);
  }, [cancelAutoOpen, togglePinEntry]);
  const selectEntry = useCallback((key: string | null) => {
    selectedRef.current = key; setSelectedKey(key);
    update(previous => previous.map(entry => entry.key === key ? { ...entry, error: undefined, lastUsed: ++tick.current } : entry));
    pumpRef.current();
  }, [update]);
  const advanceAutoOpen = useCallback(async (key: string) => {
    const pending = autoOpen.current;
    const candidate = entriesRef.current.find(entry => entry.key === key);
    if (!pending || pending.epoch !== epoch.current || !candidate || !pending.paths.has(candidate.path)) return;
    if (!pending.first) { pending.first = key; selectEntry(key); return; }
    if (pending.first === key) return;
    pending.pinStarted = true;
    // Finish each snapshot before advancing. Large latest-day studies stay within
    // the decoded-source limit, while completed panes survive cache eviction.
    await togglePinEntry(pending.first);
    if (!alive.current || autoOpen.current !== pending || pending.epoch !== epoch.current) return;
    const first = entriesRef.current.find(entry => entry.key === pending.first);
    if (!first?.pinnedRender) { autoOpen.current = null; return; }
    pending.first = key; pending.pinStarted = false;
    selectEntry(key);
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
        if (!target) { autoOpen.current = null; break; }
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
            const victim = decoded.filter(entry => entry.key !== selectedRef.current).sort((a, b) => Number(pinBusy(pinJobs.current.get(a.key))) - Number(pinBusy(pinJobs.current.get(b.key))) || a.lastUsed - b.lastUsed)[0];
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
          if (!target.details && info.settingsKey) {
            writer.current!.register(info.settingsKey, info.settingsRevision ?? null);
            if (info.settingsError) errorRef.current(`${target.name}: ${info.settingsError}. Automatic saving is disabled for this image to protect its existing settings.`);
            update(previous => previous.map(entry => entry.key === target.key ? { ...entry, settingsKey: info.settingsKey, settingsBlocked: Boolean(info.settingsError), rotationQuarterTurns: info.savedAppearance?.rotationQuarterTurns ?? entry.rotationQuarterTurns, ellipses: info.savedAppearance?.ellipses ?? [], overlay: info.savedAppearance?.overlay ?? undefined, history: info.savedAppearance ? { past: [], present: info.savedAppearance.recipe, future: [] } : entry.history } : entry));
          }
          const defaultRecipe = target.defaultRecipe ?? withProcessingLevel(experimentalPreset('med', info.neutral, info.suggested, info.metadata.photometric), info.suggested ?? info.neutral, 4);
          let history = entriesRef.current.find(entry => entry.key === target.key)?.history ?? { past: [], present: defaultRecipe, future: [] };
          let initial: RenderInfo;
          let thumbnail: string;
          // Ctrl+wheel can edit a pinned pane while its evicted source reloads.
          // Never overwrite those newer settings with the import's older recipe.
          while (true) {
            initial = await invoke<RenderInfo>('render_image', { id: info.id, recipe: history.present, requestId: nextRequest() });
            if (!current()) break;
            thumbnail = await invoke<string>('image_thumbnail', { id: info.id, requestId: initial.requestId });
            if (typeof thumbnail !== 'string' || !thumbnail.startsWith('data:image/')) throw new Error('The image preview could not be prepared.');
            const latestHistory = entriesRef.current.find(entry => entry.key === target.key)?.history;
            if (!latestHistory || sameRecipe(history.present, latestHistory.present)) { history = latestHistory ?? history; break; }
            history = latestHistory;
          }
          if (!current()) { await release(info.id); continue; }
          update(previous => previous.map(entry => entry.key === target.key ? {
            ...entry, details: info, defaultRecipe, history, thumbnail: thumbnail!, error: undefined,
            lastUsed: ++tick.current, image: { info, path: target.path, initial, defaultRecipe, history },
          } : entry));
          if (pinJobs.current.has(target.key)) void requestPinSnapshot(target.key);
          await advanceAutoOpen(target.key);
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
  }, [advanceAutoOpen, release, requestPinSnapshot, update]);
  pumpRef.current = () => { void pump(); };
  const select = useCallback((key: string | null) => { cancelAutoOpen(); selectEntry(key); }, [cancelAutoOpen, selectEntry]);
  const append = useCallback((paths: string[], patient?: PatientIdentity, latestDatePaths?: string[]) => {
    if (!paths.length) return;
    cancelAutoOpen();
    if (latestDatePaths) autoOpen.current = { epoch: epoch.current, paths: new Set(latestDatePaths), pinStarted: false };
    const added = paths.map(path => ({ key: `image-${++entrySerial}`, path, name: path.split(/[\\/]/).pop() ?? path, patient, lastUsed: ++tick.current, rotationQuarterTurns: 0 }));
    update(previous => [...previous, ...added]); selectEntry(added[0].key);
  }, [cancelAutoOpen, selectEntry, update]);
  const replace = useCallback(async (paths: string[], patient: PatientIdentity, latestDatePaths: string[] = paths) => {
    if (!paths.length) throw new Error('No radiographs were found for this patient.');
    if (!await flushSettings()) throw new Error('Save pending adjustments or retry saving before switching patients.');
    cancelAutoOpen();
    const replacementEpoch = ++epoch.current;
    const old = entriesRef.current;
    for (const key of pinJobs.current.keys()) cancelPin(key);
    update(() => []); selectedRef.current = null; setSelectedKey(null);
    await Promise.all(old.flatMap(entry => entry.image ? [release(entry.image.info.id)] : []));
    if (!alive.current || epoch.current !== replacementEpoch) return;
    append(paths, patient, latestDatePaths);
  }, [append, cancelAutoOpen, cancelPin, flushSettings, release, update]);
  const changeHistory = useCallback((operation: (history: History) => History, key: string | null = selectedRef.current) => {
    cancelAutoOpen();
    update(previous => previous.map(entry => {
      if (entry.key !== key || !entry.history) return entry;
      const history = operation(entry.history);
      return { ...entry, history, image: entry.image ? { ...entry.image, history } : undefined };
    }));
    if (key && pinJobs.current.has(key)) void requestPinSnapshot(key);
    const changed = entriesRef.current.find(entry => entry.key === key); if (changed) persist(changed);
  }, [cancelAutoOpen, persist, requestPinSnapshot, update]);
  const setEllipses = useCallback((operation: SetStateAction<Record<string, Ellipse[]>>) => {
    const before = Object.fromEntries(entriesRef.current.map(entry => [entry.key, entry.ellipses ?? []]));
    const after = typeof operation === 'function' ? operation(before) : operation;
    update(previous => previous.map(entry => { const ellipses = after[entry.key] ?? []; if (JSON.stringify(ellipses) === JSON.stringify(entry.ellipses ?? [])) return entry; const next = { ...entry, ellipses }; persist(next); return next; }));
  }, [persist, update]);
  const setOverlays = useCallback((operation: SetStateAction<Record<string, ReviewOverlay>>) => {
    const before = Object.fromEntries(entriesRef.current.filter(entry => entry.overlay).map(entry => [entry.key, entry.overlay!]));
    const after = typeof operation === 'function' ? operation(before) : operation;
    update(previous => previous.map(entry => { if (entry.overlay === after[entry.key]) return entry; const next = { ...entry, overlay: after[entry.key] }; if (!next.overlay?.error) persist(next); return next; }));
  }, [persist, update]);
  const dismissPane = useCallback((key: string, nextVisibleKey: string | null) => {
    cancelAutoOpen();
    cancelPin(key);
    update(previous => previous.map(entry => entry.key === key ? { ...entry, pinned: false, pinPending: false, pinError: undefined, pinOrder: undefined, pinnedRender: undefined } : entry));
    if (selectedRef.current === key) selectEntry(nextVisibleKey);
  }, [cancelAutoOpen, cancelPin, selectEntry, update]);
  const close = useCallback(async () => {
    const current = entriesRef.current.find(entry => entry.key === selectedRef.current);
    if (!current) return;
    if (!await flushSettings()) { errorRef.current('Could not save adjustments. Retry saving before closing this image.'); return; }
    cancelAutoOpen();
    cancelPin(current.key);
    update(previous => previous.filter(entry => entry.key !== current.key));
    const released = current.image ? release(current.image.info.id) : Promise.resolve();
    if (selectedRef.current === current.key) select(entriesRef.current[0]?.key ?? null);
    await released;
  }, [cancelAutoOpen, cancelPin, flushSettings, release, select, update]);
  const rotate = useCallback((key: string | null = selectedRef.current) => {
    cancelAutoOpen();
    update(previous => previous.map(entry => entry.key === key ? { ...entry, rotationQuarterTurns: (entry.rotationQuarterTurns + 1) % 4 } : entry));
    const changed = entriesRef.current.find(entry => entry.key === key); if (changed) persist(changed);
  }, [cancelAutoOpen, persist, update]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; ++epoch.current; autoOpen.current = null;
      for (const key of pinJobs.current.keys()) cancelPin(key);
      for (const entry of entriesRef.current) if (entry.image) void release(entry.image.info.id);
      entriesRef.current = [];
    };
  }, [cancelPin, release]);
  return { entries, selectedKey, loading, select, append, replace, changeHistory, close, dismissPane, rotate, togglePin, refreshPinned, cancelAutoOpen, setEllipses, setOverlays, saveStatus, flushSettings, retrySettings };
}
