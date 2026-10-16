import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ExportAllDialog from './ExportAllDialog';
import type { ExportItem } from './ExportAllDialog';
import { clamp, commit, contrastValue, dateSourceLabel, dragAdjustment, processingLevel, withProcessingLevel, formatImageDate, orientedDimensions, redo, sameRecipe, sliderPosition, sliderValue, sourcePixelScale, toneValue, undo, withContrast, withTone } from './model';
import type { CustomPreset, History, ImageEntry, PatientDiscovery, Recipe, RenderInfo } from './model';
import { useRenderedImage } from './useRenderedImage';
import { useImageLibrary } from './useImageLibrary';
import ImagePane, { defaultPaneView, paneGrid } from './ImagePane';
import type { PaneView } from './ImagePane';
import { reconcilePaneOrder, swapPanes } from './workspace';
import type { Ellipse, ImageTool, Region, ReviewOverlay } from './workspace';

const desktop = isTauri();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type View = PaneView;

function PatientOpenDialog({ onClose, onOpen, inline = false }: { onClose: () => void; onOpen: (patient: PatientDiscovery) => Promise<void>; inline?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const [patientNumber, setPatientNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const trimmed = patientNumber.trim();
  const valid = /^[0-9]{2,64}$/.test(trimmed);
  const folder = valid ? `D:\\ABELDent\\DATA\\NOTES\\${trimmed.slice(-2)}\\${trimmed}` : null;
  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    input.current?.focus();
    return () => { alive.current = false; element?.close(); previousFocus?.focus(); };
  }, []);
  const submit = async () => {
    if (pending.current) return;
    if (!valid) { setError('Enter a patient number containing 2–64 digits only.'); input.current?.focus(); return; }
    pending.current = true; setBusy('Finding patient radiographs…'); setError(null);
    try {
      const patient = await invoke<PatientDiscovery>('open_patient', { patientNumber: trimmed });
      if (!alive.current) return;
      if (!patient.paths.length) throw new Error('No radiographs were found for this patient. Your current images remain open.');
      setBusy('Opening patient…');
      await onOpen(patient);
      if (alive.current) onClose();
    } catch (problem) { if (alive.current) setError(message(problem)); }
    finally { pending.current = false; if (alive.current) setBusy(null); }
  };
  const form = <form aria-label="Open patient" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id="patient-dialog-title">Open patient</h2>
      <p id="patient-dialog-description">Enter the patient number to open all their radiographs.</p>
      <label className="patient-number-label" htmlFor="patient-number">Patient number</label>
      <input ref={input} id="patient-number" type="text" inputMode="numeric" autoComplete="off" maxLength={64} value={patientNumber} disabled={Boolean(busy)} aria-invalid={Boolean(error) && !valid} aria-describedby={error ? 'patient-number-error patient-folder-preview' : 'patient-folder-preview'}
        onChange={event => { setPatientNumber(event.target.value); setError(null); }} />
      <div id="patient-folder-preview" className="patient-folder-preview"><span>Folder</span><code>{folder ?? 'Enter at least two digits to preview the folder.'}</code></div>
      <p className="patient-selection-note">All radiographs load automatically. The viewer checks current and older folder layouts on the local drive and the C04577 and SERVER shares.</p>
      {error && <p id="patient-number-error" className="patient-dialog-error" role="alert">{error}</p>}
      {busy && <p className="patient-dialog-status" role="status"><span className="spinner" />{busy}</p>}
      <div className="patient-dialog-actions">{!inline && <button type="button" disabled={Boolean(busy)} onClick={onClose}>Cancel</button>}<button type="submit" className="primary" disabled={Boolean(busy) || !desktop}>Open all radiographs</button></div>
    </form>;
  return inline ? <section className="patient-start" aria-busy={Boolean(busy)}>{form}</section> : <dialog ref={dialog} className="patient-dialog" aria-labelledby="patient-dialog-title" aria-describedby="patient-dialog-description" aria-busy={Boolean(busy)}
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) onClose(); } }}>{form}</dialog>;
}

function Histogram({ render, pixels }: { render: RenderInfo; pixels: number }) {
  if (render.preview) pixels = Math.max(1, render.histogram.reduce((sum, value) => sum + value, 0));
  const maximum = Math.max(1, ...render.histogram);
  const path = render.histogram.map((value, index) => `${index === 0 ? 'M' : 'L'}${index / Math.max(1, render.histogram.length - 1) * 256},${78 - value / maximum * 76}`).join(' ');
  return <div className="histogram"><svg viewBox="0 0 256 80" preserveAspectRatio="none" role="img" aria-label="Monochrome intensity histogram before false color, linear count scale"><path d={`${path} L256,80 L0,80 Z`} /></svg><div className="histogram-tonal-strip" /><div className="histogram-scale"><span>Black</span><span>Midtones</span><span>White</span></div><div className="clipping"><span>Black <b>{(render.clippedLow / pixels * 100).toFixed(2)}%</b></span><span>White <b>{(render.clippedHigh / pixels * 100).toFixed(2)}%</b></span></div></div>;
}


function Slider({ label, value, min, max, step = .01, center, onChange, onCommit, endpoints, formatValue }: {
  label: string; value: number; min: number; max: number; step?: number; center?: number;
  onChange: (value: number) => void; onCommit: () => void; endpoints?: [string, string]; formatValue?: (value: number) => string;
}) {
  const decimals = step >= 1 ? 0 : step >= .01 ? 2 : step >= .001 ? 3 : 4;
  const display = formatValue ? formatValue(value) : value.toFixed(decimals);
  const snap = (actual: number) => Number(clamp(min + Math.round((actual - min) / step) * step, min, max).toFixed(decimals));
  const centered = center !== undefined;
  return <label className="slider-control"><span>{label}<output>{display}</output></span>
    <span className={`slider-track ${centered ? 'centered' : ''}`}>
      {centered && <span className="slider-center-tick" aria-hidden="true" />}
      <input type="range" min={centered ? 0 : min} max={centered ? 100 : max} step={centered ? 'any' : step} value={centered ? sliderPosition(value, min, center, max) : clamp(value, min, max)} aria-label={label}
        aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={display}
        onChange={event => onChange(centered ? snap(sliderValue(Number(event.target.value), min, center, max)) : Number(event.target.value))}
        onKeyDown={event => {
          if (!centered) return;
          const changes: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 };
          if (event.key === 'Home' || event.key === 'End' || event.key in changes) {
            event.preventDefault(); onChange(event.key === 'Home' ? min : event.key === 'End' ? max : snap(value + changes[event.key]));
          }
        }} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    </span>
    {endpoints && <span className="slider-endpoints"><span>{endpoints[0]}</span><span>{endpoints[1]}</span></span>}
    {(value < min || value > max) && <span className="stored-value-note">Stored value {value.toFixed(decimals)} is outside {min}–{max}. Adjusting this slider selects a new value in that range.</span>}
  </label>;
}

export default function App() {
  const [draft, setDraft] = useState<Recipe | null>(null);
  const draftRef = useRef<Recipe | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { entries: images, selectedKey: selected, loading, select: selectImage, append: appendImages, replace: replaceImages, changeHistory: updateHistory, close: closeLibraryImage, dismissPane, rotate: rotateImage, togglePin, cancelAutoOpen, setEllipses, setOverlays, saveStatus, flushSettings, retrySettings } = useImageLibrary(setError);
  const [presets, setPresets] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [tool, setTool] = useState<ImageTool>('adjust');
  const [ellipseColor, setEllipseColor] = useState<'red' | 'yellow'>('red');
  const ellipses: Record<string, Ellipse[]> = Object.fromEntries(images.map(entry => [entry.key, entry.ellipses ?? []]));
  const overlays: Record<string, ReviewOverlay> = Object.fromEntries(images.filter(entry => entry.overlay).map(entry => [entry.key, entry.overlay!]));
  const [exportJob, setExportJob] = useState<{ items: ExportItem[]; patientName: string } | null>(null);
  const exportBusy = useRef(false);
  const setExportBusy = useCallback((busy: boolean) => { exportBusy.current = busy; }, []);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const overlayRequests = useRef<Record<string, number>>({});
  useEffect(() => () => { overlayRequests.current = {}; }, []);
  const [sensitivity, setSensitivity] = useState(50);
  const [mouseShortcuts, setMouseShortcuts] = useState(true);
  const [compareHeld, setCompareHeld] = useState(false);
  const [neutralFrame, setNeutralFrame] = useState<RenderInfo | null>(null);
  const [neutralBusy, setNeutralBusy] = useState(false);
  const neutralCache = useRef(new Map<string, RenderInfo>());
  const [paneOrder, setPaneOrder] = useState<string[]>([]);
  const [move, setMove] = useState<{ source: string | null; target: string | null }>({ source: null, target: null });
  const [dragging, setDragging] = useState(false);
  const [patientDialogOpen, setPatientDialogOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenMode = useRef({ desired: false, applied: false, running: false });
  const requestFullscreen = useCallback(async (next: boolean) => {
    const mode = fullscreenMode.current;
    mode.desired = next;
    if (mode.running) return;
    mode.running = true;
    try {
      while (mode.applied !== mode.desired) {
        const target = mode.desired;
        if (desktop) await invoke('set_viewer_fullscreen', { fullscreen: target });
        mode.applied = target; setFullscreen(target);
      }
    } catch (problem) {
      mode.desired = mode.applied;
      setError(`Could not change fullscreen mode: ${message(problem)}`);
    } finally { mode.running = false; }
  }, []);
  const [currentPatient, setCurrentPatient] = useState<PatientDiscovery | null>(null);
  const [launchBusy, setLaunchBusy] = useState(false);
  const startupCancelled = useRef(false);
  const [paneViews, setPaneViews] = useState<Record<string, View>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState({ width: 1000, height: 600 });
  const [pixelRatio, setPixelRatio] = useState(window.devicePixelRatio || 1);
  const [paneSizes, setPaneSizes] = useState<Record<string, { width: number; height: number }>>({});
  const activeEntry = images.find(image => image.key === selected);
  const headerPatient = activeEntry?.patient ?? currentPatient;
  const windowTitle = headerPatient ? `${headerPatient.patientName || 'Name unavailable'} · Patient ID ${headerPatient.patientNumber} — RAD Viewer` : 'RAD Viewer';
  useEffect(() => { document.title = windowTitle; if (desktop) void invoke('set_viewer_title', { title: windowTitle }).catch(problem => setError(`Could not update window title: ${message(problem)}`)); }, [windowTitle]);
  const active = activeEntry?.image;
  const rotationQuarterTurns = activeEntry?.rotationQuarterTurns ?? 0;
  const recipe = draft ?? active?.history.present;
  const base = active?.info.suggested ?? active?.info.neutral;
  const photometric = active?.info.metadata.photometric ?? 'MONOCHROME2';
  const activeRef = useRef(active); activeRef.current = active;
  const recipeRef = useRef(recipe); recipeRef.current = recipe;
  const dragRecipe = useRef<{ id: string; start: Recipe; base: Recipe; photometric: string } | null>(null);
  const { rendered, processing } = useRenderedImage(active, recipe, setError, Boolean(draft));
  useEffect(() => {
    if (!compareHeld || !active) { setNeutralBusy(false); return; }
    const id = active.info.id;
    const cached = neutralCache.current.get(id);
    if (cached) { setNeutralFrame(cached); setNeutralBusy(false); return; }
    let cancelled = false; setNeutralBusy(true);
    void invoke<RenderInfo>('render_snapshot', { id, recipe: active.info.neutral, requestId: Date.now() }).then(frame => {
      if (cancelled) return;
      if (neutralCache.current.size >= 8) neutralCache.current.delete(neutralCache.current.keys().next().value!);
      neutralCache.current.set(id, frame); setNeutralFrame(frame);
    }).catch(problem => { if (!cancelled) { setError(`Neutral comparison failed: ${message(problem)}`); setCompareHeld(false); } }).finally(() => { if (!cancelled) setNeutralBusy(false); });
    return () => { cancelled = true; };
  }, [compareHeld, active?.info.id]);
  useEffect(() => { const release = () => setCompareHeld(false); window.addEventListener('blur', release); window.addEventListener('pointerup', release); window.addEventListener('keyup', release); return () => { window.removeEventListener('blur', release); window.removeEventListener('pointerup', release); window.removeEventListener('keyup', release); }; }, []);
  const comparing = compareHeld && neutralFrame?.id === active?.info.id;
  const level = recipe && base ? processingLevel(recipe, base) : null;
  const currentPreset = level ? (level.exact ? `Level ${level.level}` : presets.find(preset => sameRecipe(recipe!, preset.recipe))?.name ?? 'Custom adjustments') : null;
  const onPaneSize = useCallback((key: string, width: number, height: number) => setPaneSizes(previous => previous[key]?.width === width && previous[key]?.height === height ? previous : { ...previous, [key]: { width, height } }), []);
  const viewFor = (entry: ImageEntry): View => {
    const stored = paneViews[entry.key] ?? defaultPaneView;
    const size = paneSizes[entry.key] ?? { width: 500, height: 500 };
    const dimensions = entry.details ? orientedDimensions(entry.details.width, entry.details.height, entry.rotationQuarterTurns) : null;
    const fitScale = dimensions ? Math.min((size.width - 28) / dimensions.width, (size.height - 28) / dimensions.height) : 1;
    return { ...stored, scale: stored.fit ? Math.max(.025, fitScale) : stored.scale };
  };
  const view = selected ? paneViews[selected] ?? defaultPaneView : defaultPaneView;
  const effectiveView = activeEntry ? viewFor(activeEntry) : defaultPaneView;
  const setView: Dispatch<SetStateAction<View>> = update => {
    cancelAutoOpen();
    if (!selected) return;
    setPaneViews(previous => ({ ...previous, [selected]: typeof update === 'function' ? update(previous[selected] ?? defaultPaneView) : update }));
  };
  const updatePaneView = (entry: ImageEntry, update: SetStateAction<View>) => {
    cancelAutoOpen();
    const current = viewFor(entry);
    setPaneViews(previous => ({ ...previous, [entry.key]: typeof update === 'function' ? update(current) : update }));
  };
  const nativePixelScale = sourcePixelScale(pixelRatio);
  const candidates = [...images.filter(image => image.pinned || image.pinPending).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0)), ...activeEntry && !activeEntry.pinned && !activeEntry.pinPending ? [activeEntry] : []];
  const orderedKeys = reconcilePaneOrder(paneOrder, candidates.map(entry => entry.key));
  const visibleEntries = orderedKeys.map(key => candidates.find(entry => entry.key === key)!);
  const orderSignature = JSON.stringify(orderedKeys);
  useEffect(() => { setPaneOrder(JSON.parse(orderSignature) as string[]); }, [orderSignature]);
  const grid = paneGrid(visibleEntries.length, gridSize.width, gridSize.height);
  const swap = (source: string, target: string) => { cancelAutoOpen(); commitDraft(); setPaneOrder(swapPanes(orderedKeys, source, target)); };
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setGridSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element); return () => observer.disconnect();
  }, [Boolean(visibleEntries.length)]);
  useEffect(() => {
    const updatePixelRatio = () => setPixelRatio(window.devicePixelRatio || 1);
    const query = window.matchMedia?.(`(resolution: ${pixelRatio}dppx)`);
    window.addEventListener('resize', updatePixelRatio); query?.addEventListener('change', updatePixelRatio);
    return () => { window.removeEventListener('resize', updatePixelRatio); query?.removeEventListener('change', updatePixelRatio); };
  }, [pixelRatio]);
  useEffect(() => { if (desktop) void invoke<CustomPreset[]>('load_presets').then(setPresets).catch(problem => setError(`Could not load saved presets: ${message(problem)}`)); }, []);

  const importPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    startupCancelled.current = true; setCurrentPatient(null);
    if (draftRef.current) { const value = draftRef.current; updateHistory(history => commit(history, value)); }
    setError(null); setDraft(null); draftRef.current = null; dragRecipe.current = null;
    appendImages(paths);
  }, [appendImages, updateHistory]);
  const openPatient = useCallback(async (patient: PatientDiscovery) => {
    if (draftRef.current) { const value = draftRef.current; updateHistory(history => commit(history, value)); }
    if (!await flushSettings()) throw new Error('Could not save image adjustments. Retry saving before changing patients.');
    setCurrentPatient(patient);
    setError(null); setDraft(null); draftRef.current = null; dragRecipe.current = null;
    setPaneViews({}); setPaneSizes({}); setPaneOrder([]); overlayRequests.current = {}; setCompareHeld(false); setSensitivity(50); neutralCache.current.clear();
    await replaceImages(patient.paths, { patientNumber: patient.patientNumber, patientName: patient.patientName, directory: patient.directory }, patient.latestDatePaths);
    setNotice(patient.warnings.length ? patient.warnings.join('\n') : null);
  }, [flushSettings, replaceImages, updateHistory]);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    const available = () => !cancelled && !startupCancelled.current;
    void (async () => {
      try {
        const number = await invoke<string | null>('launch_patient_number');
        if (!number || !available()) return;
        setLaunchBusy(true);
        setCurrentPatient({ patientNumber: number, patientName: null, directory: '', paths: [], latestDatePaths: [], warnings: [] });
        const patient = await invoke<PatientDiscovery>('open_patient', { patientNumber: number });
        if (!available()) return;
        await openPatient(patient);
      } catch (problem) { if (available()) setError(`Could not open launch patient: ${message(problem)}`); }
      finally { if (!cancelled) setLaunchBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [openPatient]);
  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined; let cancelled = false;
    void getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === 'over' || event.payload.type === 'enter') setDragging(true);
      if (event.payload.type === 'leave' || event.payload.type === 'drop') setDragging(false);
      if (event.payload.type === 'drop') void importPaths(event.payload.paths);
    }).then(unlisten => { if (cancelled) unlisten(); else stop = unlisten; }).catch(problem => setError(message(problem)));
    return () => { cancelled = true; stop?.(); };
  }, [importPaths]);
  const changeHistory = useCallback((operation: (history: History) => History) => {
    if (!activeRef.current) return;
    draftRef.current = null; setDraft(null);
    updateHistory(operation);
  }, [updateHistory]);
  const commitDraft = () => { if (draftRef.current) { const value = draftRef.current; changeHistory(history => commit(history, value)); } };
  const activateImage = (key: string) => {
    setCompareHeld(false);
    setSensitivity(overlays[key]?.sensitivity ?? 50);
    // Selecting another visible pane must not remove the working image beside it.
    if (activeEntry && activeEntry.key !== key && activeEntry.image && !activeEntry.pinned && !activeEntry.pinPending && visibleEntries.some(entry => entry.key === key)) void togglePin(activeEntry.key, rendered);
    commitDraft(); dragRecipe.current = null; selectImage(key); setDraft(null); draftRef.current = null; setError(null);
  };
  const updateDraft = (value: Recipe) => { cancelAutoOpen(); draftRef.current = value; setDraft(value); };
  const changeValue = (key: keyof Recipe, value: number | string | boolean) => {
    if (recipe) updateDraft({ ...recipe, [key]: value, version: key === 'localContrast' || key === 'sharpen' || key === 'colorStrength' || key === 'colorScale' ? 2 : recipe.version });
  };
  const applyRecipe = (value: Recipe) => changeHistory(history => commit(history, value));
  const stepEnhancement = (entry: ImageEntry, direction: number) => {
    if (!entry.details || compareHeld) return;
    commitDraft();
    const entryBase = entry.details.suggested ?? entry.details.neutral;
    updateHistory(history => commit(history, withProcessingLevel(history.present, entryBase, processingLevel(history.present, entryBase).level + direction)), entry.key);
    if (entry.key !== selected) activateImage(entry.key);
  };
  const reviewRegion = async (entry: ImageEntry, region: Region, value = sensitivity) => {
    if (!entry.image) return;
    const current = overlays[entry.key];
    if (current && !current.error && (current.url || current.busy) && current.sensitivity === value && JSON.stringify(current.region) === JSON.stringify(region)) return;
    const request = Date.now() + Math.random(); overlayRequests.current[entry.key] = request;
    setOverlays(previous => ({ ...previous, [entry.key]: { region, sensitivity: value, visible: true, busy: true } }));
    try {
      const result = await invoke<{ url: string; region: Region }>('review_dark_regions', { id: entry.image.info.id, region, sensitivity: value / 100 });
      if (overlayRequests.current[entry.key] !== request) return;
      setOverlays(previous => ({ ...previous, [entry.key]: { region: result.region, url: result.url, sensitivity: value, visible: true } }));
    } catch (problem) { if (overlayRequests.current[entry.key] === request) setOverlays(previous => ({ ...previous, [entry.key]: { region, sensitivity: value, visible: true, error: message(problem) } })); }
  };
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        if (!event.repeat && (fullscreenMode.current.desired || (images.length > 0 && !patientDialogOpen))) void requestFullscreen(!fullscreenMode.current.desired);
        return;
      }
      if (event.key === 'Escape' && (fullscreenMode.current.desired || fullscreenMode.current.applied)) { event.preventDefault(); void requestFullscreen(false); return; }
      if (event.target instanceof Element && event.target.closest('input, textarea, select, dialog')) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); changeHistory(event.shiftKey ? redo : undo); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); changeHistory(redo); }
    };
    window.addEventListener('keydown', down); return () => window.removeEventListener('keydown', down);
  }, [changeHistory, images.length, patientDialogOpen, requestFullscreen]);
  useEffect(() => {
    if (fullscreen) document.querySelector<HTMLElement>('.selected-pane .image-viewport')?.focus();
  }, [fullscreen]);
  const chooseImages = async () => { try { await importPaths(await invoke<string[]>('choose_images')); } catch (problem) { setError(message(problem)); } };
  const exportAll = () => {
    if (exportJob || !visibleEntries.length) return;
    const patientNumbers = new Set(visibleEntries.map(entry => entry.patient?.patientNumber ?? ''));
    if (patientNumbers.size > 1) { setError('Export one patient at a time. Close images from other patients before exporting.'); return; }
    commitDraft();
    setExportJob({ patientName: visibleEntries[0].patient?.patientName ?? '', items: visibleEntries.map(entry => ({ path: entry.path, sourceSha256: entry.details!.sourceSha256!, appearance: { recipe: entry.key === selected ? recipe! : entry.history!.present, rotationQuarterTurns: entry.rotationQuarterTurns, ellipses: entry.ellipses ?? [], overlay: entry.overlay && !entry.overlay.busy && !entry.overlay.error && entry.overlay.url ? { region: entry.overlay.region, sensitivity: entry.overlay.sensitivity, visible: entry.overlay.visible } : null }, annotationStroke: 3 / viewFor(entry).scale })) });
  };
  const closeHandler = useRef<() => Promise<void>>(async () => {});
  closeHandler.current = async () => {
    if (exportBusy.current) { setNotice('Export is still running. Please wait for it to finish before closing the viewer.'); return; }
    commitDraft();
    if (await flushSettings()) await invoke('finish_close'); else { await requestFullscreen(false); setCloseBlocked(true); }
  };
  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined; let cancelled = false;
    void getCurrentWindow().onCloseRequested(event => { event.preventDefault(); void closeHandler.current().catch(problem => setError(message(problem))); }).then(unlisten => { if (cancelled) unlisten(); else stop = unlisten; }).catch(problem => setError(`Could not enable save-on-close: ${message(problem)}`));
    return () => { cancelled = true; stop?.(); };
  }, []);
  const restoredSensitivity = overlays[selected ?? '']?.sensitivity ?? 50;
  useEffect(() => { setSensitivity(restoredSensitivity); }, [selected, restoredSensitivity]);
  const exportImage = async () => {
    if (!active || !recipe) return;
    try { const path = await invoke<string | null>('export_image', { id: active.info.id, recipe, rotationQuarterTurns, ellipses: ellipses[selected!] ?? [], annotationStroke: 3 / effectiveView.scale }); if (path) setNotice(`Full-resolution PNG saved with ellipse annotations: ${path}${overlays[selected!]?.visible ? '\nExperimental dark-area overlay is screen-only and is not exported.' : ''}`); }
    catch (problem) { setError(`Export failed: ${message(problem)}`); }
  };
  const saveReview = async () => {
    if (!active) return;
    try {
      const path = await invoke<string | null>('save_review', { review: { version: 1, processingVersion: recipe?.version ?? 2, createdAt: new Date().toISOString(), qualityAcceptance: 'Pending user review', selectedImageId: active.info.id,
        paneOrder: visibleEntries.map(image => image.path), images: images.map(image => ({ source: image.path, pinned: Boolean(image.pinned), pinOrder: image.pinOrder, view: viewFor(image), ellipses: ellipses[image.key] ?? [], darkAreaReview: overlays[image.key] ? { region: overlays[image.key].region, sensitivity: overlays[image.key].sensitivity, experimental: true } : null, rotationQuarterTurns: image.rotationQuarterTurns, patient: image.patient, metadata: image.details?.metadata, width: image.details?.width, height: image.details?.height, recipe: image.key === selected ? recipe : image.history?.present ?? null })), view: effectiveView } });
      if (path) setNotice(`Viewer settings saved: ${path}`);
    } catch (problem) { setError(`Save failed: ${message(problem)}`); }
  };
  const savePreset = async () => {
    if (!recipe || !presetName.trim()) return;
    const name = presetName.trim();
    if (presets.some(preset => preset.name.toLowerCase() === name.toLowerCase())) { setError('A preset with that name already exists. Choose a different name.'); return; }
    const updated = [...presets, { name, recipe }];
    try { await invoke('save_presets', { presets: updated }); setPresets(updated); setPresetName(''); setNotice(`Preset “${name}” saved.`); }
    catch (problem) { setError(`Could not save preset: ${message(problem)}`); }
  };
  const closeImage = async () => {
    commitDraft();
    setDraft(null); draftRef.current = null; dragRecipe.current = null;
    setCompareHeld(false);
    if (selected) {
      delete overlayRequests.current[selected];
      if (active) neutralCache.current.delete(active.info.id);
    }
    await closeLibraryImage();
  };
  const range = (key: keyof Recipe, label: string, min: number, max: number, step?: number, center?: number) => recipe && <Slider label={label} center={center} value={recipe[key] as number} min={min} max={max} step={step} onChange={value => changeValue(key, value)} onCommit={commitDraft} />;

  return <main className={`app-shell${fullscreen ? ' radiographs-fullscreen' : ''}`} onPointerDownCapture={event => { startupCancelled.current = true; if (!(event.target as HTMLElement).closest('.pin-button')) cancelAutoOpen(); }} onKeyDownCapture={event => { if (event.key === 'F11' || event.key === 'Escape') return; startupCancelled.current = true; if (!(event.target as HTMLElement).closest('.pin-button')) cancelAutoOpen(); }} onWheelCapture={cancelAutoOpen}><header className="app-header">
    <div className="brand"><span className="brand-symbol" aria-hidden="true">R</span><div><strong>RAD <span>Viewer</span></strong><small>RADIOGRAPH VIEWER</small></div></div>
    <div className="header-divider" />{headerPatient ? <div className="patient-identity" aria-label="Current patient"><strong title={headerPatient.patientName || 'Name unavailable'}>{headerPatient.patientName || (launchBusy ? 'Loading patient…' : 'Name unavailable')}</strong><small>Patient ID <b>{headerPatient.patientNumber}</b></small></div> : <div className="header-context"><span className="status-dot" />Local processing<small>Original files preserved</small></div>}
    <div className="header-actions"><button onClick={exportAll} disabled={!visibleEntries.length || compareHeld || visibleEntries.some(entry => !entry.history || !entry.details?.sourceSha256 || entry.overlay?.busy)} title="Export visible radiographs as native-resolution JPGs, quality 7/10">Export all JPGs</button><button onClick={() => void saveReview()} disabled={!active}>Save settings</button><button onClick={() => void exportImage()} disabled={!active}>Export PNG</button><button onClick={() => void chooseImages()} disabled={!desktop}>＋ Open images</button><button className="primary" onClick={() => setPatientDialogOpen(true)} disabled={!desktop}>Open patient</button></div></header>
    {!desktop && <div className="browser-banner"><strong>Desktop application required.</strong> Open RAD Viewer to import local radiographs and use the Rust processing engine. This browser view is the interface only.</div>}
    {error && <div role="alert" className="notice error"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
    {notice && <div role="status" className="notice"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
    <div className="main-body"><div className="workspace"><div className="toolbar">
      <div className="document-title"><strong>{active?.info.metadata.name ?? activeEntry?.name ?? 'Radiograph workspace'}</strong>{activeEntry && <time className="image-date" title={dateSourceLabel(activeEntry.details?.metadata.dateSource)}>{formatImageDate(activeEntry.details?.metadata.imageDate)}</time>}<span>{active ? `${active.info.metadata.format} · ${active.info.metadata.bitsStored}-bit · ${active.info.metadata.photometric}` : 'Enhanced, full-resolution viewing'}</span></div>
      <div className="view-tools"><button disabled={!active} aria-label="Rotate 90 degrees clockwise" title="Rotate clockwise; separate from adjustment undo" onClick={() => { commitDraft(); rotateImage(); setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); }}>↻ Rotate 90°{rotationQuarterTurns ? ` · ${rotationQuarterTurns * 90}°` : ''}</button><button className={view.fit ? 'active' : ''} disabled={!active} onClick={() => setView(previous => ({ ...previous, fit: true, x: 0, y: 0 }))}>Fit</button><button className={!view.fit && Math.abs(view.scale - nativePixelScale) < .00001 ? 'active' : ''} disabled={!active} title="One source pixel per physical display pixel" onClick={() => setView({ scale: nativePixelScale, x: 0, y: 0, fit: false })}>100%</button><span className="zoom-label" title="Source pixels relative to physical display pixels">{active ? `${Math.round(effectiveView.scale * pixelRatio * 100)}%` : '—'}</span></div></div>
      {activeEntry && <div className="interaction-toolbar" aria-label="Image tools">
        <div className="tool-modes">{(['adjust', 'pan', 'magnify', 'ellipse'] as const).map(mode => <button key={mode} className={tool === mode ? 'active' : ''} aria-pressed={tool === mode} onClick={() => { commitDraft(); setTool(mode); }}>{({ adjust: 'Adjust', pan: 'Pan', magnify: 'Magnify', ellipse: 'Ellipse' })[mode]}</button>)}</div>
        {tool === 'ellipse' ? <div className="annotation-tools"><button className={`color-choice red ${ellipseColor === 'red' ? 'active' : ''}`} aria-pressed={ellipseColor === 'red'} onClick={() => setEllipseColor('red')}>Red</button><button className={`color-choice yellow ${ellipseColor === 'yellow' ? 'active' : ''}`} aria-pressed={ellipseColor === 'yellow'} onClick={() => setEllipseColor('yellow')}>Yellow</button><span>3 px</span><button disabled={!ellipses[selected!]?.length} onClick={() => setEllipses(previous => ({ ...previous, [selected!]: (previous[selected!] ?? []).slice(0, -1) }))}>Remove last</button><button disabled={!ellipses[selected!]?.length} onClick={() => setEllipses(previous => ({ ...previous, [selected!]: [] }))}>Clear ellipses</button></div> : <span className="tool-hint">{tool === 'pan' ? 'Drag to move within the image' : tool === 'magnify' ? 'Click to zoom in · Alt-click to zoom out' : tool === 'region' ? 'Draw a rectangle around the tooth area to review' : 'Drag ↔ tone · ↕ gamma'}</span>}
        <button className="fit-all" disabled={!active} onClick={() => setPaneViews(previous => { const next = { ...previous }; for (const entry of visibleEntries) next[entry.key] = { ...defaultPaneView }; return next; })}>Fit all</button>
      </div>}
      {visibleEntries.length > 0 ? <div ref={gridRef} className="image-grid" aria-label="Image panes" style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}>
        {visibleEntries.map(entry => {
          const isActive = entry.key === selected;
          const paneRender = isActive ? comparing ? neutralFrame : rendered ?? entry.pinnedRender : entry.pinnedRender;
          return <ImagePane key={entry.key} entry={entry} render={paneRender} active={isActive} view={viewFor(entry)} setView={update => updatePaneView(entry, update)} processing={(isActive && processing) || Boolean(entry.pinPending)} onSize={onPaneSize} pixelRatio={pixelRatio}
            tool={tool} ellipseColor={ellipseColor} ellipses={ellipses[entry.key]} overlay={overlays[entry.key]} comparing={isActive && compareHeld} mouseShortcuts={mouseShortcuts}
            onEllipse={ellipse => setEllipses(previous => ({ ...previous, [entry.key]: [...(previous[entry.key] ?? []), ellipse] }))}
            onRegion={region => { void reviewRegion(entry, region); setTool('pan'); }}
            onSwap={swap} onMoveOver={(source, target) => { cancelAutoOpen(); setMove({ source, target }); }} moveSource={move.source} moveTarget={move.target}
            onMoveStep={(key, direction) => { const index = orderedKeys.indexOf(key); const target = orderedKeys[index + direction]; if (target) swap(key, target); }}
            badge={isActive && comparing ? 'Neutral comparison' : isActive ? `${currentPreset ?? 'Enhanced'}${recipe?.colorize ? ' · Local color' : ''}` : 'Enhanced'}
            onClose={() => { if (isActive) { commitDraft(); setCompareHeld(false); dragRecipe.current = null; } dismissPane(entry.key, orderedKeys.find(key => key !== entry.key) ?? null); }}
            onEnhance={direction => stepEnhancement(entry, direction)} onSelect={() => activateImage(entry.key)} onRotate={() => { if (isActive) commitDraft(); rotateImage(entry.key); updatePaneView(entry, previous => ({ ...previous, fit: true, x: 0, y: 0 })); }} onPin={() => { if (isActive) commitDraft(); void togglePin(entry.key); }}
            onAdjustStart={() => { if (isActive && activeRef.current && recipeRef.current) dragRecipe.current = { id: activeRef.current.info.id, start: recipeRef.current, base: activeRef.current.info.suggested ?? activeRef.current.info.neutral, photometric: activeRef.current.info.metadata.photometric }; }}
            onAdjustMove={(dx, dy) => { const snapshot = dragRecipe.current; if (isActive && snapshot && snapshot.id === activeRef.current?.info.id) updateDraft(dragAdjustment(snapshot.start, snapshot.base, dx, dy, snapshot.photometric)); }}
            onAdjustEnd={() => { const snapshot = dragRecipe.current; dragRecipe.current = null; if (isActive && snapshot?.id === activeRef.current?.info.id) commitDraft(); }} />;
        })}
      </div> : <div className="empty-workspace">{images.length > 0 ? <p>Select a thumbnail below to show a radiograph.</p> : !patientDialogOpen && <PatientOpenDialog inline onClose={() => {}} onOpen={openPatient} />}<button className="text-button" onClick={() => void chooseImages()} disabled={!desktop}>Open radiographs</button><span className="supported-formats">Or drop RVG · PANO · SC · DICOM · PNG · JPEG files</span></div>}
      <div className="workspace-help"><span>{launchBusy ? <><span className="spinner" /> Finding patient radiographs…</> : loading ? <><span className="spinner" /> {loading}</> : move.source ? 'Drop onto another image to swap positions' : active ? `F11 fullscreen · Ctrl+scroll enhancement · Scroll zooms at pointer · Shift/middle drag pans · Grab ⠿ to swap${mouseShortcuts ? ' · Right-click rotates · Double right-click pins' : ''}` : 'Drop radiographs anywhere in the desktop window'}</span>{activeEntry && <button className="text-button" onClick={() => void closeImage()}>Close selected</button>}</div>
      <div className="filmstrip" aria-label="Open images">{images.map((image, index) => <button key={image.key} aria-label={`${String(index + 1).padStart(2, '0')} ${image.name}`} aria-describedby={`date-${image.key}`} className={`thumbnail ${selected === image.key ? 'selected' : ''}`} title={image.error ?? image.path} onClick={() => activateImage(image.key)} aria-pressed={selected === image.key}>{image.thumbnail ? <span className={`thumbnail-image ${image.rotationQuarterTurns % 2 ? 'quarter-turned' : ''}`}><img src={image.thumbnail} alt="" style={{ transform: `translate(-50%, -50%) rotate(${image.rotationQuarterTurns * 90}deg)` }} /></span> : <span className="thumbnail-placeholder" aria-hidden="true">{image.error ? 'Unavailable' : 'Loading…'}</span>}<span className="thumbnail-number">{String(index + 1).padStart(2, '0')}</span>{image.pinned && <span className="thumbnail-pin" aria-label="Pinned">◆</span>}<span className="thumbnail-name">{image.name}</span><time id={`date-${image.key}`} className="thumbnail-date" title={dateSourceLabel(image.details?.metadata.dateSource)}>{formatImageDate(image.details?.metadata.imageDate)}</time></button>)}<button className="add-thumbnail" onClick={() => void chooseImages()} disabled={!desktop}><span>＋</span>{images.length ? 'Add images' : 'Open images'}</button></div>
    </div><aside className="adjustments"><div className="panel-title"><h2>Adjustments</h2><span>NON-DESTRUCTIVE</span></div>
      {activeEntry && <div className="selected-image-card" aria-label="Adjusting selected image">{activeEntry.thumbnail && <img src={activeEntry.thumbnail} alt="" style={{ transform: `rotate(${rotationQuarterTurns * 90}deg)` }} />}<div><span>EDITING SELECTED IMAGE</span><strong title={activeEntry.name}>{activeEntry.name}</strong><time>{formatImageDate(activeEntry.details?.metadata.imageDate)}</time><small>{activeEntry.pinned ? 'Pinned · stays visible' : 'Working image'}</small></div></div>}
      <fieldset disabled={!active || compareHeld} className="adjustment-fields">
      <div className="history-tools"><button disabled={!active?.history.past.length} title="Undo (Ctrl+Z)" onClick={() => changeHistory(undo)}>↶ Undo</button><button disabled={!active?.history.future.length} title="Redo (Ctrl+Y)" onClick={() => changeHistory(redo)}>↷ Redo</button><button onClick={() => active && applyRecipe(active.defaultRecipe)}>Reset</button></div>
      <div className="section-label">PROCESSING LEVEL</div>
      {recipe && base && level && <div className="processing-level">
        <Slider label="Processing level" value={level.level} min={1} max={7} step={1} formatValue={value => level.exact ? `${value} / 7` : `Custom · near ${value}`} endpoints={['Least processing', 'Most processing']} onChange={value => updateDraft(withProcessingLevel(recipe, base, value))} onCommit={commitDraft} />
        <div className="processing-stops" aria-hidden="true">{[1, 2, 3, 4, 5, 6, 7].map(stop => <span key={stop} className={level.exact && level.level === stop ? 'active' : ''}>{stop}</span>)}</div>
        <p className="control-note">Sharpness, contrast and adaptive contrast. Drag each image to adjust tone and gamma independently.</p>
      </div>}
      {currentPreset && <div className="current-recipe" aria-label="Current processing preset"><span>Current: <strong>{currentPreset}</strong></span><span>v{recipe?.version}</span></div>}
      {recipe && base ? <><div className="section-label">TONE</div>
        <Slider label="Tone" center={35} value={toneValue(recipe, base, photometric)} min={-100} max={100} step={1} endpoints={['Darker', 'Lighter']} onChange={value => updateDraft(withTone(recipe, base, value, photometric))} onCommit={commitDraft} />
      </> : <div className="controls-empty">Open an image to adjust its tone and detail.</div>}
      </fieldset>
      <button className={`compare-button ${compareHeld ? 'active' : ''}`} disabled={!active} aria-pressed={compareHeld} onPointerDown={event => { if (event.button !== 0) return; commitDraft(); event.currentTarget.setPointerCapture(event.pointerId); setCompareHeld(true); }} onPointerUp={() => setCompareHeld(false)} onPointerCancel={() => setCompareHeld(false)} onLostPointerCapture={() => setCompareHeld(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setCompareHeld(true); } }} onKeyUp={() => setCompareHeld(false)} onBlur={() => setCompareHeld(false)}>{neutralBusy ? 'Preparing neutral image…' : comparing ? 'Neutral · release to restore' : 'Hold to compare with neutral'}</button>
      <fieldset disabled={!active || compareHeld} className="adjustment-fields">
      {recipe && base && <details className="control-section"><summary>Detailed adjustments</summary><div className="control-section-content">{range('gamma', 'Gamma', .1, .9, .01, .5)}
        <Slider label="Contrast" center={-50} value={contrastValue(recipe, base)} min={-100} max={100} step={1} endpoints={['Softer', 'Stronger']} onChange={value => updateDraft(withContrast(recipe, base, value))} onCommit={commitDraft} />
        <div className="section-label">DETAIL</div>{range('sharpen', 'Sharpness strength', 1, 10, .1, 6)}
        <button className={`colorize-button ${recipe.colorize ? 'active' : ''}`} aria-pressed={Boolean(recipe.colorize)} onClick={() => applyRecipe({ ...recipe, colorize: !recipe.colorize, colorStrength: recipe.colorStrength ?? .8, colorScale: recipe.colorScale ?? 8, version: 2 })}>Colorize <span>{recipe.colorize ? 'On' : 'Off'}</span></button>
        {recipe.colorize && <div className="local-color-controls">
          <Slider label="Color amount" formatValue={value => `${Math.round(value * 100)}%`} value={recipe.colorStrength ?? .8} min={0} max={1} step={.01} onChange={value => changeValue('colorStrength', value)} onCommit={commitDraft} />
          <Slider label="Feature size" formatValue={value => `${value} px`} value={recipe.colorScale ?? 8} min={2} max={24} step={1} endpoints={['Small · 2 px', 'Broad · 24 px']} onChange={value => changeValue('colorScale', value)} onCommit={commitDraft} />
          <div className="color-legend local-color-legend" aria-label="Local contrast color legend"><div><span><i className="color-swatch amber" />Darker than nearby</span><span><i className="color-swatch cyan" />Lighter than nearby</span></div><p>Color emphasizes local midtone differences. Flat areas and extremes stay grayscale.</p></div>
        </div>}
        <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><span>{advanced ? '−' : '+'} Advanced processing</span></button>
        {advanced && <div className="advanced-controls"><label className="select-control">Detail method<select value={recipe.detailMode} onChange={event => applyRecipe({ ...recipe, detailMode: event.target.value, version: event.target.value === 'radiograph' ? 2 : recipe.version })}><option value="radiograph">Radiograph multiscale</option><option value="unsharp">Unsharp</option><option value="multiscale">Legacy two-scale</option></select></label>
          {range('radius', 'Radius / detail scale (px)', .5, 8, .1)}{range('threshold', 'Noise threshold', 0, .05, .0005)}{range('halo', 'Halo suppression', 0, 1)}{range('denoise', 'Noise reduction', 0, 1)}{range('localContrast', 'Local contrast', 0, 1)}{range('clahe', 'Adaptive contrast (CLAHE)', 0, 1)}
          <label className="checkbox-control"><input type="checkbox" checked={recipe.invert} onChange={event => applyRecipe({ ...recipe, invert: event.target.checked })} /> Invert display</label><p className="control-note">Spatial scales use source pixels and stay unchanged when you zoom.</p></div>}
      </div></details>}
      <details className="control-section"><summary>Dark-area review <small>Experimental</small></summary><div className="control-section-content"><p className="review-disclaimer">Not a decay detector. Highlights darker regions within a tooth area you select. Normal anatomy and artifacts can also be highlighted; decay can be missed.</p><button className={tool === 'region' ? 'active region-button' : 'region-button'} aria-pressed={tool === 'region'} onClick={() => { commitDraft(); setTool(tool === 'region' ? 'adjust' : 'region'); }}>Select tooth area</button><p className="control-note">Draw a rectangle around one tooth region, including nearby tooth structure for comparison.</p>
        <Slider label="Dark-area sensitivity" value={sensitivity} min={0} max={100} step={1} formatValue={value => `${value}%`} onChange={setSensitivity} onCommit={() => { if (activeEntry && overlays[activeEntry.key]) void reviewRegion(activeEntry, overlays[activeEntry.key].region); }} endpoints={['Fewer highlights', 'More highlights']} />
        {selected && overlays[selected] && <><div className="overlay-actions"><button aria-pressed={overlays[selected].visible} onClick={() => setOverlays(previous => ({ ...previous, [selected]: { ...previous[selected], visible: !previous[selected].visible } }))}>{overlays[selected].visible ? 'Hide overlay' : 'Show overlay'}</button><button onClick={() => { delete overlayRequests.current[selected]; setOverlays(previous => { const next = { ...previous }; delete next[selected]; return next; }); }}>Clear region</button></div>{overlays[selected].busy && <p role="status">Analyzing selected region…</p>}{overlays[selected].error && <p className="review-disclaimer" role="alert">{overlays[selected].error}</p>}</>}
        <p className="control-note">Yellow → red = increasing local darkness, not disease probability. Screen-only overlay; excluded from PNG exports.</p>
      </div></details>
      <details className="control-section"><summary>Intensity histogram</summary><div className="control-section-content">{rendered && active && <Histogram render={rendered} pixels={active.info.width * active.info.height} />}<p className="control-note">Monochrome intensity before false color. Clipping includes background.</p></div></details>
      <details className="control-section"><summary>Saved presets</summary><div className="control-section-content">{presets.length > 0 && <label className="select-control"><span className="sr-only">Apply saved preset</span><select value="" onChange={event => { const preset = presets.find(item => item.name === event.target.value); if (preset) applyRecipe(preset.recipe); }}><option value="">Apply a saved preset…</option>{presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</select></label>}
      <div className="save-preset"><input aria-label="New preset name" placeholder="Name these settings" value={presetName} maxLength={80} onChange={event => setPresetName(event.target.value)} /><button disabled={!active || !presetName.trim()} onClick={() => void savePreset()}>Save</button></div>
      </div></details></fieldset>
      <details className="control-section"><summary>Mouse shortcuts</summary><div className="control-section-content"><label className="checkbox-control"><input type="checkbox" checked={mouseShortcuts} onChange={event => setMouseShortcuts(event.target.checked)} />Right-click rotates; double right-click pins</label><p className="control-note">Shift or middle-drag pans in every tool. Magnify: click to zoom in, Alt-click to zoom out. Use the grab handle to swap panes.</p></div></details>
    </aside></div>
    {exportJob && <ExportAllDialog items={exportJob.items} patientName={exportJob.patientName} onBusy={setExportBusy} onClose={() => setExportJob(null)} />}
    {closeBlocked && <div className="notice error" role="alert"><span>Some adjustments could not be saved. Keep the viewer open to retry, or close without saving those changes.</span><button onClick={() => { void retrySettings().then(ok => { if (ok) void invoke('finish_close'); }); }}>Retry and close</button><button onClick={() => void invoke('finish_close')}>Close without saving</button><button onClick={() => setCloseBlocked(false)}>Keep open</button></div>}
    <footer className="status-bar"><span className="autosave-status" role="status">{saveStatus === 'saving' ? <><span className="spinner" /> Saving adjustments…</> : saveStatus === 'error' ? <>Adjustments not saved <button onClick={() => void retrySettings()}>Retry save</button></> : images.some(entry => entry.settingsBlocked) ? 'Saved adjustments unavailable for some images' : 'Adjustments saved automatically · XML beside originals'}</span><span><span className="status-dot amber" />Image-quality review pending</span><span>{active ? `${Math.round(active.info.decodeMs)} ms decode · ${Math.round(rendered?.renderMs ?? 0)} ms processing · ${images.length} image${images.length === 1 ? '' : 's'}` : 'Offline · CPU processing'}</span></footer>
    {dragging && <div className="drop-overlay"><strong>Drop radiographs to open</strong><span>RVG · PANO · SC · DICOM · PNG · JPEG</span></div>}
    {patientDialogOpen && <PatientOpenDialog onClose={() => setPatientDialogOpen(false)} onOpen={openPatient} />}
  </main>;
}
