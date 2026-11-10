import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, SetStateAction } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ComparisonView from './ComparisonView';
import Icon from './Icon';
import CalibrationDialog from './CalibrationDialog';
import { isMac, modifierLabel, selectionModifier, supportsPatientLookup, supportsPrinting, patientLookupUnavailable, printingUnavailable } from './platform';
import AboutDialog from './AboutDialog';
import ColorControls from './ColorControls';
import { useGrayscalePreview, useReferencePicker } from './useColorTools';
import { colorModeName, withColorMode } from './model';
import { groupByDate } from './filmstrip';
import PrintDialog from './PrintDialog';
import type { PrintImage } from './printLayout';
import ExportAllDialog from './ExportAllDialog';
import DeleteDialog from './DeleteDialog';
import type { DeletePreview } from './DeleteDialog';
import type { DeleteResult } from './model';
import type { ExportItem } from './ExportAllDialog';
import { clamp, contrastValue, defaultContrast, defaultGamma, dateSourceLabel, dragAdjustment, processingLevel, withProcessingLevel, formatImageDate, orientedDimensions, redo, sameRecipe, sliderPosition, sliderValue, sourcePixelScale, toneValue, undo, withContrast, withTone } from './model';
import type { CustomPreset, History, ImageEntry, ImageInfo, PatientDiscovery, Recipe, RenderInfo } from './model';
import { useRenderedImage } from './useRenderedImage';
import { useImageLibrary } from './useImageLibrary';
import ImagePane, { defaultPaneView, paneGrid } from './ImagePane';
import { transferChanges, transferRecipe } from './selection';
import type { PaneView } from './ImagePane';
import { reconcilePaneOrder, swapPanes } from './workspace';
import type { Calibration, Ellipse, ImageTool, Measurement } from './workspace';

const desktop = isTauri();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type View = PaneView;
type RecipeEdit = (recipe: Recipe, info: ImageInfo) => Recipe;

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
  const folder = valid ? `Configured patient root / ${trimmed.slice(-2)} / ${trimmed}` : null;
  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    input.current?.focus();
    return () => { alive.current = false; element?.close(); previousFocus?.focus(); };
  }, []);
  const submit = async (demo = false) => {
    if (pending.current) return;
    if (!demo && !valid) { setError('Enter a patient number containing 2–64 digits only.'); input.current?.focus(); return; }
    pending.current = true; setBusy('Finding patient radiographs…'); setError(null);
    try {
      const patient = demo ? await invoke<PatientDiscovery>('open_demo_patient') : await invoke<PatientDiscovery>('open_patient', { patientNumber: trimmed });
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
      <p className="patient-selection-note">Patient lookup requires RAD_VIEWER_PATIENT_ROOT to be set before launch. Use Open Images to choose files without configuring integration.</p>
      {error && <p id="patient-number-error" className="patient-dialog-error" role="alert">{error}</p>}
      {busy && <p className="patient-dialog-status" role="status"><span className="spinner" />{busy}</p>}
      <div className="patient-dialog-actions">{!inline && <button type="button" disabled={Boolean(busy)} onClick={onClose}>Cancel</button>}<button type="submit" className="primary" disabled={Boolean(busy) || !desktop}>Open all radiographs</button></div>
      <button className="demo-open-button" type="button" disabled={Boolean(busy) || !desktop} onClick={() => void submit(true)}>Open Synthetic Sample demo</button>
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
        style={{ "--range-progress": `${centered ? sliderPosition(value, min, center!, max) : (clamp(value, min, max) - min) / (max - min) * 100}%` } as CSSProperties}
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { entries: images, selectedKey: selected, loading, select: selectImage, append: appendImages, replace: replaceImages, mergePatient, changeHistory: updateHistory, commitRecipes, editRecipes, close: closeLibraryImage, dismissPane, rotate: rotateImage, togglePin, ensurePinned, cancelAutoOpen, setEllipses, saveStatus, flushSettings, retrySettings, removePaths } = useImageLibrary(setError);
  const [selection, setSelection] = useState<string[]>([]);
  const draftGroup = useRef<Record<string, Recipe>>({});
  const commitDraft = useCallback(() => {
    commitRecipes(draftGroup.current);
    draftGroup.current = {}; draftRef.current = null; setDraft(null);
  }, [commitRecipes]);
  const [comparison, setComparison] = useState<ImageEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshPending = useRef(false);
  const refreshGeneration = useRef(0);
  const [presets, setPresets] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [annotationSelection, setAnnotationSelection] = useState<{ key: string; kind: 'ellipse' | 'measurement' | 'calibration'; value: Ellipse | Measurement | Calibration } | null>(null);
  const [tool, setTool] = useState<ImageTool>('adjust');
  const [calibrations, setCalibrations] = useState<Record<string, Calibration | undefined>>({});
  const [calibrationDraft, setCalibrationDraft] = useState<{ key: string; name: string; reference: Measurement } | null>(null);
  const [measurements, setMeasurements] = useState<Record<string, Measurement[]>>({});
  const [ellipseColor, setEllipseColor] = useState<'red' | 'yellow'>('red');
  const ellipses: Record<string, Ellipse[]> = Object.fromEntries(images.map(entry => [entry.key, entry.ellipses ?? []]));
  const annotationItems = annotationSelection ? annotationSelection.kind === 'ellipse' ? ellipses[annotationSelection.key] ?? [] : annotationSelection.kind === 'measurement' ? measurements[annotationSelection.key] ?? [] : calibrations[annotationSelection.key] ? [calibrations[annotationSelection.key]!] : [] : [];
  const annotationIndex = annotationSelection ? (annotationItems as unknown[]).indexOf(annotationSelection.value) : -1;
  const deleteAnnotation = () => {
    if (!annotationSelection || annotationIndex < 0) return;
    const { key, kind, value } = annotationSelection;
    if (kind === 'ellipse') setEllipses(previous => ({ ...previous, [key]: (previous[key] ?? []).filter(item => item !== value) }));
    else if (kind === 'measurement') setMeasurements(previous => ({ ...previous, [key]: (previous[key] ?? []).filter(item => item !== value) }));
    else setCalibrations(previous => ({ ...previous, [key]: undefined }));
    setAnnotationSelection(null);
  };
  useEffect(() => { setAnnotationSelection(null); }, [tool, annotationsVisible, selected]);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(true);
  const [previewsOpen, setPreviewsOpen] = useState(true);
  const [printImages, setPrintImages] = useState<PrintImage[] | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const printBusy = useRef(false);
  const [exportJob, setExportJob] = useState<{ items: ExportItem[]; patientName: string; patientId: string } | null>(null);
  const [deleteJob, setDeleteJob] = useState<DeletePreview[] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [preparingDelete, setPreparingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletePending = useRef(false);
  const previousFullscreen = useRef(false);
  const deletionReviewOpen = useRef(false);
  deletionReviewOpen.current = Boolean(deleteJob) || preparingDelete;
  const exportBusy = useRef(false);
  const setExportBusy = useCallback((busy: boolean) => { exportBusy.current = busy; }, []);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [mouseShortcuts, setMouseShortcuts] = useState(true);
  const [compareHeld, setCompareHeld] = useState(false);
  const [neutralFrame, setNeutralFrame] = useState<RenderInfo | null>(null);
  const [neutralBusy, setNeutralBusy] = useState(false);
  const neutralCache = useRef(new Map<string, RenderInfo>());
  const [paneOrder, setPaneOrder] = useState<string[]>([]);
  const [move, setMove] = useState<{ source: string | null; target: string | null }>({ source: null, target: null });
  const [dragging, setDragging] = useState(false);
  const [patientDialogOpen, setPatientDialogOpen] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
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
        mode.applied = target; setFullscreen(target); if (!target) setFullscreenImage(null);
      }
    } catch (problem) {
      mode.desired = mode.applied; if (!mode.applied) setFullscreenImage(null);
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
  const dragRecipe = useRef<{ key: string; entries: { key: string; recipe: Recipe; info: ImageInfo }[] } | null>(null);
  const { rendered, processing } = useRenderedImage(active, recipe, setError, Boolean(draft));
  const gray = useGrayscalePreview(active?.info.id, recipe, setError);
  const picker = useReferencePicker(JSON.stringify([selected, recipe, comparison?.key, images.map(entry => [entry.key, entry.image?.info.id, entry.history?.present])]), setError);
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
    const fitScale = dimensions ? Math.min((size.width - 6) / dimensions.width, (size.height - 6) / dimensions.height) : 1;
    return { ...stored, scale: stored.fit ? Math.max(.025, fitScale) : stored.scale };
  };
  const view = selected ? paneViews[selected] ?? defaultPaneView : defaultPaneView;
  const effectiveView = activeEntry ? viewFor(activeEntry) : defaultPaneView;
  const updatePaneView = (entry: ImageEntry, update: SetStateAction<View>, group = false) => {
    cancelAutoOpen();
    const current = viewFor(entry);
    const changed = typeof update === 'function' ? update(current) : update;
    const targets = group && selectedKeys.includes(entry.key) ? selectedEntries : [entry];
    setPaneViews(previous => {
      const next = { ...previous, [entry.key]: changed };
      for (const target of targets) if (target.key !== entry.key) {
        const other = viewFor(target);
        next[target.key] = { ...other, fit: changed.fit, scale: clamp(other.scale * changed.scale / current.scale, .025, 8), x: other.x + changed.x - current.x, y: other.y + changed.y - current.y };
      }
      return next;
    });
  };
  // Pin each newly opened active pane once; respect a subsequent manual unpin.
  const defaultPinnedSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) { defaultPinnedSelection.current = null; return; }
    if (defaultPinnedSelection.current !== selected && activeEntry?.image) {
      defaultPinnedSelection.current = selected;
      void ensurePinned(selected);
    }
  }, [selected, activeEntry?.image, ensurePinned]);
  const nativePixelScale = sourcePixelScale(pixelRatio);
  const candidates = [...images.filter(image => image.pinned || image.pinPending).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0)), ...activeEntry && !activeEntry.pinned && !activeEntry.pinPending ? [activeEntry] : []];
  const orderedKeys = reconcilePaneOrder(paneOrder, candidates.map(entry => entry.key));
  const visibleEntries = orderedKeys.map(key => candidates.find(entry => entry.key === key)!);
  const orderSignature = JSON.stringify(orderedKeys);
  useEffect(() => { setPaneOrder(JSON.parse(orderSignature) as string[]); }, [orderSignature]);
  const selectedKeys = selection.includes(selected ?? '') ? selection.filter(key => visibleEntries.some(entry => entry.key === key)) : selected ? [selected] : [];
  const selectedEntries = images.filter(entry => selectedKeys.includes(entry.key));
  const selectionRef = useRef(selectedKeys); selectionRef.current = selectedKeys;
  const selectionReady = selectedEntries.length > 0 && selectedEntries.every(entry => entry.history && entry.details);
  const displayedEntries = fullscreen && fullscreenImage ? visibleEntries.filter(entry => entry.key === fullscreenImage) : visibleEntries;
  const grid = paneGrid(displayedEntries.length, gridSize.width, gridSize.height);
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
    if (deletePending.current || deletionReviewOpen.current) return;
    if (!paths.length) return;
    refreshGeneration.current++;
    startupCancelled.current = true; setCurrentPatient(null);
    commitDraft(); setSelection([]);
    setError(null); setDraft(null); draftRef.current = null; dragRecipe.current = null;
    appendImages(paths);
  }, [appendImages, commitDraft]);
  const openPatient = useCallback(async (patient: PatientDiscovery) => {
    refreshGeneration.current++;
    commitDraft(); setSelection([]);
    if (!await flushSettings()) throw new Error('Could not save image adjustments. Retry saving before changing patients.');
    setCurrentPatient(patient);
    setError(null); setDraft(null); draftRef.current = null; dragRecipe.current = null;
    setPaneViews({}); setPaneSizes({}); setPaneOrder([]); setCompareHeld(false); neutralCache.current.clear();
    await replaceImages(patient.paths, { patientNumber: patient.patientNumber, patientName: patient.patientName, firstName: patient.firstName, lastName: patient.lastName, directory: patient.directory }, patient.latestDatePaths);
    setNotice(patient.warnings.length ? patient.warnings.join('\n') : null);
  }, [flushSettings, replaceImages, commitDraft]);
  useEffect(() => {
    if (!desktop || !supportsPatientLookup) return;
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
    draftGroup.current = {};
    for (const key of selectionRef.current) updateHistory(operation, key);
  }, [updateHistory]);
  const activateImage = (key: string, toggle = false) => {
    commitDraft();
    if (toggle && selectedKeys.includes(key)) {
      const remaining = selectedKeys.filter(item => item !== key);
      if (!remaining.length) return;
      setSelection(remaining);
      if (key === selected) {
        if (activeEntry?.image && !activeEntry.pinned && !activeEntry.pinPending) void togglePin(key, rendered);
        selectImage(remaining[0]);
      }
      return;
    }
    setSelection(toggle ? [...selectedKeys, key] : [key]);
    setCompareHeld(false);
    // Selecting another visible pane must not remove the working image beside it.
    if (activeEntry && activeEntry.key !== key && activeEntry.image && !activeEntry.pinned && !activeEntry.pinPending && (toggle || visibleEntries.some(entry => entry.key === key))) void togglePin(activeEntry.key, rendered);
    commitDraft(); dragRecipe.current = null; selectImage(key); setDraft(null); draftRef.current = null; setError(null);
  };
  const updateDraft = (value: Recipe, edit?: RecipeEdit) => {
    cancelAutoOpen();
    if (!active || !selectionReady) return;
    for (const entry of selectedEntries) {
      const current = draftGroup.current[entry.key] ?? entry.history!.present;
      draftGroup.current[entry.key] = entry.key === selected ? value : edit
        ? edit(current, entry.details!) : transferChanges(active.history.present, value, active.info, current, entry.details!);
    }
    draftRef.current = value; setDraft(value);
  };
  const applyEdit = (edit: RecipeEdit) => {
    commitDraft();
    editRecipes(selectedKeys, edit);
  };
  const editViews = (update: (view: View) => View) => {
    cancelAutoOpen(); setPaneViews(previous => { const next = { ...previous }; for (const key of selectedKeys) next[key] = update(previous[key] ?? defaultPaneView); return next; });
  };
  const rotateSelection = () => {
    commitDraft(); for (const key of selectedKeys) rotateImage(key);
    editViews(previous => ({ ...previous, fit: true, x: 0, y: 0 }));
  };
  const resetSelection = () => {
    commitDraft(); editRecipes(selectedKeys, (_current, _info, defaultRecipe) => defaultRecipe);
  };
  const showImageFullscreen = (key: string) => {
    commitDraft(); setFullscreenImage(key); void requestFullscreen(true);
  };
  const changeValue = (key: keyof Recipe, value: number | string | boolean) => {
    if (recipe) updateDraft({ ...recipe, [key]: value, version: key === 'localContrast' || key === 'sharpen' || key === 'colorStrength' || key === 'colorScale' || key === 'midtoneLevel' ? 2 : recipe.version }, current => ({ ...current, [key]: value, version: key === 'localContrast' || key === 'sharpen' || key === 'colorStrength' || key === 'colorScale' || key === 'midtoneLevel' ? 2 : current.version }));
  };
  const applyRecipe = (value: Recipe) => { if (active) applyEdit((_current, info) => transferRecipe(value, active.info, info)); };
  const stepEnhancement = (entry: ImageEntry, direction: number) => {
    if (!entry.details || compareHeld) return;
    commitDraft();
    const targets = selectedKeys.includes(entry.key) ? selectedEntries : [entry];
    editRecipes(targets.map(target => target.key), (current, info) => {
      const entryBase = info.suggested ?? info.neutral;
      return withProcessingLevel(current, entryBase, processingLevel(current, entryBase).level + direction);
    });
    if (!selectedKeys.includes(entry.key)) activateImage(entry.key);
  };
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (comparison || deleteJob || preparingDelete || aboutOpen || patientDialogOpen || calibrationDraft || exportJob || printImages || preparingPrint) return;
      if (event.key === 'F11') {
        event.preventDefault();
        if (!event.repeat && (fullscreenMode.current.desired || (images.length > 0 && !patientDialogOpen))) void requestFullscreen(!fullscreenMode.current.desired);
        return;
      }
      if (event.key === 'Escape' && (fullscreenMode.current.desired || fullscreenMode.current.applied)) { event.preventDefault(); void requestFullscreen(false); return; }
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || target?.closest('input:not([type="range"]), textarea, select, dialog, [contenteditable="true"], [role="dialog"]')) return;
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && /^[0-7]$/.test(event.key)) {
        const button = document.querySelector<HTMLButtonElement>(`button[data-processing-stop="${event.key}"]`);
        if (!button) return;
        event.preventDefault();
        if (!event.repeat) button.click();
        return;
      }
      if (target?.closest('input')) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        const key = event.key.toLowerCase();
        if (['a', 'f', 'c', 'q', 'e', 'p', 'o', 'r'].includes(key)) {
          event.preventDefault();
          if (!event.repeat) document.querySelector<HTMLButtonElement>(`button[data-shortcut="${key}"]:not(:disabled)`)?.click();
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); changeHistory(event.shiftKey ? redo : undo); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); changeHistory(redo); }
    };
    window.addEventListener('keydown', down); return () => window.removeEventListener('keydown', down);
  }, [changeHistory, images.length, patientDialogOpen, requestFullscreen, comparison, deleteJob, preparingDelete, aboutOpen, calibrationDraft, exportJob, printImages, preparingPrint]);
  useEffect(() => {
    if (fullscreen && !comparison) document.querySelector<HTMLElement>('.image-pane:not([hidden]) .image-viewport')?.focus();
  }, [fullscreen, comparison]);
  const refreshPatient = async () => {
    if (!headerPatient || refreshPending.current) return;
    const generation = refreshGeneration.current;
    const identity = headerPatient;
    refreshPending.current = true; setRefreshing(true); commitDraft();
    try {
      const found = identity.patientNumber === 'DEMO' ? await invoke<PatientDiscovery>('open_demo_patient') : await invoke<PatientDiscovery>('open_patient', { patientNumber: identity.patientNumber });
      if (generation !== refreshGeneration.current) return;
      const added = mergePatient(found.paths, found);
      setCurrentPatient(found);
      setNotice(`${added} new radiograph${added === 1 ? '' : 's'} found.${found.warnings.length ? ' ' + found.warnings.join(' ') : ''}`);
    } catch (problem) { if (generation === refreshGeneration.current) setError(`Refresh failed: ${message(problem)}`); }
    finally { refreshPending.current = false; setRefreshing(false); }
  };
  const startComparison = async () => {
    if (!activeEntry?.image) return;
    commitDraft(); setSelection([activeEntry.key]);
    setComparison({ ...activeEntry, ellipses: annotationsVisible ? activeEntry.ellipses : [], history: { ...activeEntry.history!, present: recipe! } });
    await requestFullscreen(true);
  };
  const endComparison = () => { setComparison(null); void requestFullscreen(false); };
  const chooseImages = async () => { try { await importPaths(await invoke<string[]>('choose_images')); } catch (problem) { setError(message(problem)); } };
  const closeDelete = () => {
    if (deletePending.current) return;
    setDeleteJob(null); setDeleteError(null);
    void requestFullscreen(previousFullscreen.current);
  };
  const reviewDelete = async () => {
    if (deletePending.current || deleteJob || preparingDelete || !selectedEntries.length) return;
    deletePending.current = true; setPreparingDelete(true); commitDraft(); setCompareHeld(false);
    try {
      const items: DeletePreview[] = [];
      const includedPaths = new Set<string>();
      for (const entry of selectedEntries) {
        const normalized = entry.path.replace(/\\/g, '/').toLowerCase();
        if (includedPaths.has(normalized)) continue;
        includedPaths.add(normalized);
        if (!entry.details?.sourceSha256 || !entry.history) throw new Error('Wait for selected radiographs to finish loading.');
        const frame = entry.image
          ? await invoke<RenderInfo>('render_snapshot', { id: entry.image.info.id, recipe: entry.key === selected ? recipe! : entry.history.present, requestId: Date.now() })
          : entry.pinnedRender;
        if (!frame || frame.preview || entry.pinPending || entry.pinError) throw new Error('Wait for selected radiographs to finish updating.');
        items.push({ entry, url: frame.url });
      }
      previousFullscreen.current = fullscreenMode.current.desired;
      setDeleteError(null); setDeleteJob(items); await requestFullscreen(true);
    } catch (problem) { setError(`Could not prepare deletion: ${message(problem)}`); }
    finally { deletePending.current = false; setPreparingDelete(false); }
  };
  const confirmDelete = async () => {
    if (!deleteJob || deletePending.current) return;
    deletePending.current = true; setDeleteBusy(true); setDeleteError(null);
    try {
      if (!await flushSettings()) throw new Error('Could not save adjustments. Retry saving before deleting.');
      // Invalidate any patient refresh started before this move.
      refreshGeneration.current++;
      const results = await invoke<DeleteResult[]>('delete_images', { items: deleteJob.map(({ entry }) => ({ path: entry.path, directory: entry.patient?.directory ?? null, sourceSha256: entry.details!.sourceSha256! })) });
      const moved = results.filter(result => result.destination).map(result => result.path);
      await removePaths(moved);
      setSelection([]); neutralCache.current.clear();
      const failures = results.filter(result => result.error);
      const warnings = results.flatMap(result => result.warning ? [result.warning] : []);
      setNotice(`${moved.length} radiograph${moved.length === 1 ? '' : 's'} moved to DELETED.${warnings.length ? ' ' + warnings.join(' ') : ''}`);
      if (failures.length) {
        const failedPaths = new Set(failures.map(result => result.path));
        setDeleteJob(deleteJob.filter(item => failedPaths.has(item.entry.path)));
        setDeleteError(failures.map(result => `${result.path}: ${result.error}`).join('\n'));
      } else {
        setDeleteJob(null); await requestFullscreen(previousFullscreen.current);
      }
    } catch (problem) { setDeleteError(message(problem)); }
    finally { deletePending.current = false; setDeleteBusy(false); }
  };
  const exportAll = () => {
    if (exportJob || !visibleEntries.length) return;
    const patientNumbers = new Set(visibleEntries.map(entry => entry.patient?.patientNumber ?? ''));
    if (patientNumbers.size > 1) { setError('Export one patient at a time. Close images from other patients before exporting.'); return; }
    commitDraft();
    const identity = visibleEntries[0].patient;
    const exportName = identity?.lastName && identity?.firstName ? `${identity.lastName}, ${identity.firstName}` : identity?.patientName ?? '';
    setExportJob({ patientName: exportName, patientId: identity?.patientNumber ?? '', items: visibleEntries.map(entry => ({ path: entry.path, sourceSha256: entry.details!.sourceSha256!, appearance: { recipe: entry.key === selected ? recipe! : entry.history!.present, rotationQuarterTurns: entry.rotationQuarterTurns, ellipses: entry.ellipses ?? [], overlay: null }, annotationStroke: 3 / viewFor(entry).scale, view: viewFor(entry) })) });
  };
  const preparePrint = async () => {
    if (preparingPrint || !visibleEntries.length) return;
    commitDraft(); setPreparingPrint(true); printBusy.current = true;
    try {
      const items: PrintImage[] = [];
      for (const entry of visibleEntries) {
        const frame = entry.key === selected && entry.image && recipe
          ? await invoke<RenderInfo>('render_snapshot', { id: entry.image.info.id, recipe, requestId: Date.now() })
          : entry.pinnedRender;
        if (!frame || frame.preview || !entry.details || entry.pinError) throw new Error('Wait for all visible images to finish updating before printing.');
        items.push({ url: frame.url, width: entry.details.width, height: entry.details.height, rotation: entry.rotationQuarterTurns, scale: viewFor(entry).scale, ellipses: entry.ellipses ?? [] });
      }
      setPrintImages(items);
    } catch (problem) { setError(`Print preparation failed: ${message(problem)}`); }
    finally { setPreparingPrint(false); printBusy.current = false; }
  };
  const closeHandler = useRef<() => Promise<void>>(async () => {});
  closeHandler.current = async () => {
    if (deletePending.current || deleteJob) { setNotice('Finish or cancel the deletion review before closing the viewer.'); return; }
    if (exportBusy.current || printBusy.current) { setNotice('Printing or export is still running. Please wait before closing the viewer.'); return; }
    commitDraft();
    if (await flushSettings()) await invoke('finish_close'); else { await requestFullscreen(false); setCloseBlocked(true); }
  };
  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined; let cancelled = false;
    void getCurrentWindow().onCloseRequested(event => { event.preventDefault(); void closeHandler.current().catch(problem => setError(message(problem))); }).then(unlisten => { if (cancelled) unlisten(); else stop = unlisten; }).catch(problem => setError(`Could not enable save-on-close: ${message(problem)}`));
    return () => { cancelled = true; stop?.(); };
  }, []);
  const exportImage = async () => {
    if (!selectionReady || exportBusy.current) return;
    const patientNumbers = new Set(selectedEntries.map(entry => entry.patient?.patientNumber ?? ''));
    if (patientNumbers.size > 1) { setError('Export one patient at a time. Select images from only one patient.'); return; }
    const identity = selectedEntries[0].patient;
    const patientName = identity?.lastName && identity?.firstName ? `${identity.lastName}, ${identity.firstName}` : identity?.patientName ?? '';
    commitDraft(); exportBusy.current = true;
    try {
      const directory = await invoke<string | null>('choose_jpeg_export_directory', { patientName });
      if (!directory) return;
      let count = 0;
      for (const entry of selectedEntries) {
        let imported: ImageInfo | undefined;
        try {
          if (!entry.image) imported = await invoke<ImageInfo>('import_image', { path: entry.path });
          const id = entry.image?.info.id ?? imported!.id;
          if (imported && entry.details?.sourceSha256 && imported.sourceSha256 !== entry.details.sourceSha256) throw new Error(`${entry.name} changed on disk. Reload it before exporting.`);
          const path = await invoke<string | null>('export_image', { id, directory, recipe: entry.key === selected ? recipe : entry.history!.present, rotationQuarterTurns: entry.rotationQuarterTurns, ellipses: entry.ellipses ?? [], annotationStroke: 3 / viewFor(entry).scale });
          if (!path) break;
          count++;
          setNotice(selectedEntries.length === 1 ? `Full-resolution JPEG (70% quality) saved with adjustments and annotations: ${path}` : `${count} selected radiographs exported as full-resolution JPEGs at 70% quality.`);
        } finally { if (imported) await invoke('release_image', { id: imported.id }); }
      }
    } catch (problem) { setError(`Export failed: ${message(problem)}`); }
    finally { exportBusy.current = false; }
  };
  const saveReview = async () => {
    if (!active) return;
    try {
      const path = await invoke<string | null>('save_review', { review: { version: 1, processingVersion: recipe?.version ?? 2, createdAt: new Date().toISOString(), qualityAcceptance: 'Pending user review', selectedImageId: active.info.id,
        paneOrder: visibleEntries.map(image => image.path), images: images.map(image => ({ source: image.path, pinned: Boolean(image.pinned), pinOrder: image.pinOrder, view: viewFor(image), ellipses: ellipses[image.key] ?? [], rotationQuarterTurns: image.rotationQuarterTurns, patient: image.patient, metadata: image.details?.metadata, width: image.details?.width, height: image.details?.height, recipe: image.key === selected ? recipe : image.history?.present ?? null })), view: effectiveView } });
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
      if (active) neutralCache.current.delete(active.info.id);
    }
    await closeLibraryImage();
  };
  const range = (key: keyof Recipe, label: string, min: number, max: number, step?: number, center?: number) => recipe && <Slider label={label} center={center} value={recipe[key] as number} min={min} max={max} step={step} onChange={value => changeValue(key, value)} onCommit={commitDraft} />;

  return <main className={`app-shell${images.length ? ' has-images' : ''}${fullscreen ? ' radiographs-fullscreen' : ''}`} onPointerDownCapture={event => { startupCancelled.current = true; if (!(event.target as HTMLElement).closest('.pin-button')) cancelAutoOpen(); }} onKeyDownCapture={event => { if (event.key === 'F11' || event.key === 'Escape') return; startupCancelled.current = true; if (!(event.target as HTMLElement).closest('.pin-button')) cancelAutoOpen(); }} onWheelCapture={cancelAutoOpen}><header className="app-header">
    <div className="brand"><img className="brand-symbol" src="/rad-viewer-icon.svg" alt="" aria-hidden="true" /><div><strong>RAD <span>Viewer</span></strong><small>RADIOGRAPH VIEWER</small></div></div>
    <div className="header-divider" />{headerPatient ? <div className="patient-identity" aria-label="Current patient"><strong title={headerPatient.patientName || 'Name unavailable'}>{headerPatient.patientName || (launchBusy ? 'Loading patient…' : 'Name unavailable')}</strong><small>Patient ID <b>{headerPatient.patientNumber}</b></small></div> : <div className="header-context"><span className="status-dot" />Local processing<small>Original files preserved</small></div>}
    <div className="header-actions">
      <button data-shortcut="r" title="Reload Images (Ctrl+R)" onClick={() => void refreshPatient()} disabled={!headerPatient || refreshing || preparingDelete}><Icon name="reload" />{refreshing ? 'Reloading…' : 'Reload Images'}</button>
      <span className="action-separator" role="separator" aria-orientation="vertical" />
      <button data-shortcut="p" onClick={() => void preparePrint()} title={supportsPrinting ? undefined : printingUnavailable} disabled={!supportsPrinting || !visibleEntries.length || compareHeld || preparingPrint || processing || visibleEntries.some(entry => entry.pinPending || entry.pinError)}><Icon name="print" />{preparingPrint ? 'Preparing…' : 'Print Current View'}</button>
      <button data-shortcut="e" onClick={exportAll} disabled={!visibleEntries.length || compareHeld || visibleEntries.some(entry => !entry.history || !entry.details?.sourceSha256)} title="Export the visible radiographs together with dates and office logo"><Icon name="letter" />Export for Letter</button>
      <button onClick={() => void exportImage()} disabled={!selectionReady || compareHeld}><Icon name="export" />Export to JPEG</button>
      <span className="action-separator" role="separator" aria-orientation="vertical" />
      <button className="danger" onClick={() => void reviewDelete()} disabled={!desktop || !selectionReady || compareHeld || processing || preparingDelete || selectedEntries.some(entry => !entry.details?.sourceSha256 || entry.pinPending || entry.pinError)}><Icon name="trash" />{preparingDelete ? 'Preparing…' : 'Delete'}</button>
      <span className="action-separator" role="separator" aria-orientation="vertical" />
      <button data-shortcut="o" title="Open Images (Ctrl+O)" onClick={() => void chooseImages()} disabled={!desktop || preparingDelete}><Icon name="folder" />Open Images</button>
      <button className="primary" onClick={() => setPatientDialogOpen(true)} title={supportsPatientLookup ? undefined : patientLookupUnavailable} disabled={!desktop || !supportsPatientLookup || preparingDelete}><Icon name="patient" />Open Patient</button>
    </div></header>
    {!desktop && <div className="browser-banner"><strong>Desktop application required.</strong> Open RAD Viewer to import local radiographs and use the Rust processing engine. This browser view is the interface only.</div>}
    {error && <div role="alert" className="notice error"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
    {calibrationDraft && <CalibrationDialog imageName={calibrationDraft.name} reference={calibrationDraft.reference} onCancel={() => setCalibrationDraft(null)} onApply={value => { setCalibrations(previous => ({ ...previous, [calibrationDraft.key]: value })); setCalibrationDraft(null); }} />}
    {notice && <div role="status" className="notice"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
    <div className="main-body"><div className="workspace"><div className="toolbar">
      <div className="view-tools" aria-label="Image tools">
        <div className="adjust-tool-group" role="group" aria-label="Image adjustment"><button disabled={!active} className={tool === 'adjust' ? 'active' : ''} aria-pressed={tool === 'adjust'} onClick={() => { commitDraft(); setTool('adjust'); }}><Icon name="adjust" />Adjust</button></div>
        <div className="tool-modes annotation-tool-group" role="group" aria-label="Annotation controls">{(isMac ? ['ellipse'] as const : ['ellipse', 'measure'] as const).map(mode => <button disabled={!active} key={mode} className={tool === mode ? 'active' : ''} aria-pressed={tool === mode} onClick={() => { commitDraft(); setAnnotationsVisible(true); setTool(mode); }}><Icon name={mode} />{({ ellipse: 'Ellipse', measure: 'Measure' })[mode]}</button>)}
          <button disabled={!active} aria-pressed={annotationsVisible} title="Show or hide marks in the viewer. Saved annotations and exports are unchanged." onClick={() => { setAnnotationsVisible(value => !value); setTool('adjust'); }}>{annotationsVisible ? 'Hide annotations' : 'Show annotations'}</button>
          <button disabled={!active} aria-pressed={tool === 'selectAnnotation'} onClick={() => { commitDraft(); setAnnotationsVisible(true); setTool(tool === 'selectAnnotation' ? 'adjust' : 'selectAnnotation'); }}>Select annotation</button>
          <button disabled={!annotationsVisible || tool !== 'selectAnnotation' || annotationIndex < 0} onClick={deleteAnnotation}>Delete selected annotation</button>
        </div>
<button data-shortcut="q" disabled={!active} aria-label="Rotate 90 degrees clockwise" title="Rotate clockwise; separate from adjustment undo" onClick={rotateSelection}><Icon name="rotate" />Rotate 90°{rotationQuarterTurns ? ` · ${rotationQuarterTurns * 90}°` : ''}</button><button className={view.fit ? 'active' : ''} disabled={!active} onClick={() => editViews(previous => ({ ...previous, fit: true, x: 0, y: 0 }))}><Icon name="fit" />Fit</button><button className={!view.fit && Math.abs(view.scale - nativePixelScale) < .00001 ? 'active' : ''} disabled={!active} title="One source pixel per physical display pixel" onClick={() => editViews(() => ({ scale: nativePixelScale, x: 0, y: 0, fit: false }))}>100%</button><button disabled={!active} onClick={() => setPaneViews({})}><Icon name="fitAll" />Fit all</button><button data-shortcut="f" className="fullscreen-button" disabled={!visibleEntries.length} title="Fullscreen (Ctrl+F or F11); Escape returns to the viewer" onClick={() => { commitDraft(); void requestFullscreen(true); }}><Icon name="fullscreen" />Fullscreen</button><button data-shortcut="a" title="A/B comparison (Ctrl+A)" disabled={!active} onClick={() => void startComparison()}><Icon name="compare" />A/B compare</button><span className="zoom-label" title="Source pixels relative to physical display pixels">{active ? `${Math.round(effectiveView.scale * pixelRatio * 100)}%` : '—'}</span></div></div>
        <div className="annotation-selection-hint">          {tool === 'selectAnnotation' && <span>{annotationIndex >= 0 ? annotationSelection?.kind === 'calibration' ? 'Deleting this reference returns measurements to uncalibrated values.' : 'Selected mark highlighted; delete removes only this mark.' : 'Click an ellipse or measurement to select it.'}</span>}</div>
        {activeEntry && tool === 'ellipse' && <div className="annotation-tools"><button className={`color-choice red ${ellipseColor === 'red' ? 'active' : ''}`} aria-pressed={ellipseColor === 'red'} onClick={() => setEllipseColor('red')}>Red</button><button className={`color-choice yellow ${ellipseColor === 'yellow' ? 'active' : ''}`} aria-pressed={ellipseColor === 'yellow'} onClick={() => setEllipseColor('yellow')}>Yellow</button><span>3 px</span><button disabled={!ellipses[selected!]?.length} onClick={() => setEllipses(previous => ({ ...previous, [selected!]: (previous[selected!] ?? []).slice(0, -1) }))}>Remove last</button><button disabled={!ellipses[selected!]?.length} onClick={() => setEllipses(previous => ({ ...previous, [selected!]: [] }))}>Clear ellipses</button></div>}
      {activeEntry && (tool === 'measure' || tool === 'calibrate') && <div className="annotation-tools measurement-tools"><span>{tool === 'calibrate' ? 'Drag across a structure of known length' : calibrations[selected!] ? 'Drag to measure · Calibrated estimates' : 'Drag to measure · Uncalibrated (temporary 1 mm/pixel)'}</span><button aria-pressed={tool === 'calibrate'} onClick={() => { commitDraft(); setTool(tool === 'calibrate' ? 'measure' : 'calibrate'); }}>{tool === 'calibrate' ? 'Cancel calibration' : calibrations[selected!] ? 'Recalibrate' : 'Calibrate'}</button><button disabled={!calibrations[selected!]} onClick={() => setCalibrations(previous => ({ ...previous, [selected!]: undefined }))}>Clear calibration</button><button disabled={!measurements[selected!]?.length} onClick={() => setMeasurements(previous => ({ ...previous, [selected!]: (previous[selected!] ?? []).slice(0, -1) }))}>Remove last</button><button disabled={!measurements[selected!]?.length} onClick={() => setMeasurements(previous => ({ ...previous, [selected!]: [] }))}>Clear measurements</button><span>Session only · not saved, exported or printed</span></div>}
      {visibleEntries.length > 0 ? <div ref={gridRef} className="image-grid" aria-label="Image panes" style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}>
        {visibleEntries.map(entry => {
          const isActive = entry.key === selected;
          const paneRender = isActive ? comparing ? neutralFrame : gray.render ?? rendered ?? entry.pinnedRender : entry.pinnedRender;
          return <ImagePane key={entry.key} entry={entry} render={paneRender} active={isActive} highlighted={selectedKeys.includes(entry.key)} hidden={fullscreen && Boolean(fullscreenImage) && entry.key !== fullscreenImage} onToggleSelect={() => activateImage(entry.key, true)} onFullscreen={() => showImageFullscreen(entry.key)} view={viewFor(entry)} setView={update => updatePaneView(entry, update, true)} processing={(isActive && processing) || Boolean(entry.pinPending)} onSize={onPaneSize} pixelRatio={pixelRatio}
            pickingReference={picker.picking} onPickReference={point => { if (!entry.history) return; const original = entry.history.present; const source = entry.image?.info.id ?? (async () => { const info = await invoke<ImageInfo>('import_image', { path: entry.path }); return { id: info.id, dispose: () => invoke('release_image', { id: info.id }) }; }); void picker.sample(source, original, point, level => commitRecipes({ [entry.key]: { ...withColorMode(original, 'midtoneContrast'), colorize: true, midtoneLevel: level } })); }}
            annotationsVisible={annotationsVisible} selectedAnnotation={annotationSelection?.key === entry.key && annotationIndex >= 0 ? { kind: annotationSelection.kind, index: annotationIndex } : null}
            onAnnotationSelect={mark => { const value = mark?.kind === 'ellipse' ? entry.ellipses?.[mark.index] : mark?.kind === 'measurement' ? measurements[entry.key]?.[mark.index] : mark ? calibrations[entry.key] : undefined; setAnnotationSelection(mark && value ? { key: entry.key, kind: mark.kind, value } : null); }}
            tool={tool} ellipseColor={ellipseColor} ellipses={ellipses[entry.key]} comparing={isActive && (compareHeld || gray.held)} mouseShortcuts={mouseShortcuts}
            measurements={measurements[entry.key]} calibration={calibrations[entry.key]} calibrationReference={calibrationDraft?.key === entry.key ? calibrationDraft.reference : undefined} onMeasurement={line => { if (tool === 'calibrate') { setCalibrationDraft({ key: entry.key, name: entry.name, reference: line }); setTool('measure'); } else setMeasurements(previous => ({ ...previous, [entry.key]: [...(previous[entry.key] ?? []), line] })); }}
            onEllipse={ellipse => setEllipses(previous => ({ ...previous, [entry.key]: [...(previous[entry.key] ?? []), ellipse] }))}
            onSwap={swap} onMoveOver={(source, target) => { cancelAutoOpen(); setMove({ source, target }); }} moveSource={move.source} moveTarget={move.target}
            onMoveStep={(key, direction) => { const index = orderedKeys.indexOf(key); const target = orderedKeys[index + direction]; if (target) swap(key, target); }}
            badge={isActive && comparing ? 'Neutral comparison' : isActive ? `${currentPreset ?? 'Enhanced'}${gray.render ? ' · Grayscale preview' : recipe?.colorize ? ` · ${colorModeName(recipe)}` : ''}` : 'Enhanced'}
            onReset={() => { commitDraft(); editRecipes([entry.key], (_current, _info, defaults) => defaults); }}
            onClose={() => { setAnnotationSelection(null); setSelection(previous => previous.filter(key => key !== entry.key)); if (isActive) { commitDraft(); setCompareHeld(false); dragRecipe.current = null; } dismissPane(entry.key, orderedKeys.find(key => key !== entry.key) ?? null); }}
            onEnhance={direction => stepEnhancement(entry, direction)} onSelect={() => activateImage(entry.key)} onRotate={() => { if (isActive) commitDraft(); rotateImage(entry.key); updatePaneView(entry, previous => ({ ...previous, fit: true, x: 0, y: 0 })); }} onPin={() => { if (isActive) commitDraft(); if (entry.pinned && !isActive) setSelection(previous => previous.filter(key => key !== entry.key)); void togglePin(entry.key); }}
            onAdjustStart={() => {
              if (!selectionReady || !selectedKeys.includes(entry.key)) return;
              dragRecipe.current = { key: entry.key, entries: selectedEntries.map(item => ({ key: item.key, recipe: item.key === selected ? recipeRef.current! : item.history!.present, info: item.details! })) };
            }}
            onAdjustMove={(dx, dy) => {
              const snapshot = dragRecipe.current; if (snapshot?.key !== entry.key) return;
              cancelAutoOpen();
              for (const item of snapshot.entries) draftGroup.current[item.key] = dragAdjustment(item.recipe, item.info.suggested ?? item.info.neutral, dx, dy);
              if (selected && draftGroup.current[selected]) { draftRef.current = draftGroup.current[selected]; setDraft(draftGroup.current[selected]); }
            }}
            onAdjustEnd={() => { if (dragRecipe.current?.key === entry.key) { dragRecipe.current = null; commitDraft(); } }} />;
        })}
      </div> : <div className="empty-workspace">{images.length > 0 ? <p>Select a thumbnail below to show a radiograph.</p> : !patientDialogOpen && (supportsPatientLookup ? <PatientOpenDialog inline onClose={() => {}} onOpen={openPatient} /> : <section className="patient-start"><h2>Open local radiographs</h2><p>{patientLookupUnavailable}</p><p>{printingUnavailable}</p><button disabled={!desktop} onClick={() => { void invoke<PatientDiscovery>('open_demo_patient').then(openPatient).catch(problem => setError(message(problem))); }}>Open Synthetic Sample demo</button></section>)}<button className="text-button" onClick={() => void chooseImages()} disabled={!desktop}>Open radiographs</button><span className="supported-formats">Or drop RVG · PANO · SC · DICOM · PNG · JPEG files</span></div>}
      <div className="preview-header"><div className="workspace-help"><span>{launchBusy ? <><span className="spinner" /> Finding patient radiographs…</> : loading ? <><span className="spinner" /> {loading}</> : move.source ? 'Drop onto another image to swap positions' : active ? '' : 'Drop radiographs anywhere in the desktop window'}</span>{activeEntry && <button className="text-button" onClick={() => void closeImage()}>Close selected</button>}</div>
      <button className="preview-toggle" aria-expanded={previewsOpen} aria-controls="preview-drawer" onClick={() => setPreviewsOpen(value => !value)}><Icon name="chevron" style={{ transform: previewsOpen ? 'rotate(90deg)' : 'rotate(-90deg)' }} />Previews <span className="preview-count">{images.length}</span><span className="visible-count">{visibleEntries.length} visible</span></button></div><div id="preview-drawer" className={`preview-drawer ${previewsOpen ? 'open' : ''}`} inert={!previewsOpen}><div className="filmstrip" aria-label="Open images">{groupByDate(images).map(group => <section className="filmstrip-date-group" key={group.date} aria-label={group.label}><h3>{group.label} <span>{group.items.length}</span></h3><div className="filmstrip-date-images">{group.items.map(({ image, index }) => <button key={image.key} aria-label={`${String(index + 1).padStart(2, '0')} ${image.name}`} aria-describedby={`date-${image.key}`} className={`thumbnail ${selectedKeys.includes(image.key) ? 'selected' : ''}`} title={image.error ?? image.path} onClick={event => activateImage(image.key, selectionModifier(event))} aria-pressed={selectedKeys.includes(image.key)}>{image.thumbnail ? <span className={`thumbnail-image ${image.rotationQuarterTurns % 2 ? 'quarter-turned' : ''}`}><img src={image.thumbnail} alt="" style={{ transform: `translate(-50%, -50%) rotate(${image.rotationQuarterTurns * 90}deg)` }} /></span> : <span className="thumbnail-placeholder" aria-hidden="true">{image.error ? 'Unavailable' : 'Loading…'}</span>}<span className="thumbnail-number">{String(index + 1).padStart(2, '0')}</span>{image.pinned && <span className="thumbnail-pin" aria-label="Pinned"><Icon name="pin" /></span>}<span className="thumbnail-name">{image.name}</span><time id={`date-${image.key}`} className="thumbnail-date" title={dateSourceLabel(image.details?.metadata.dateSource)}>{formatImageDate(image.details?.metadata.imageDate)}</time></button>)}</div></section>)}<button className="add-thumbnail" onClick={() => void chooseImages()} disabled={!desktop}><span>＋</span>{images.length ? 'Add images' : 'Open images'}</button></div>
    </div></div><button className="adjustments-toggle" aria-label={adjustmentsOpen ? 'Hide adjustments' : 'Show adjustments'} aria-expanded={adjustmentsOpen} aria-controls="adjustments-drawer" onClick={() => setAdjustmentsOpen(value => !value)}><Icon name="chevron" style={{ transform: adjustmentsOpen ? undefined : 'rotate(180deg)' }} /><span>Adjustments</span></button><div id="adjustments-drawer" className={`adjustments-drawer ${adjustmentsOpen ? 'open' : ''}`} inert={!adjustmentsOpen}><aside className="adjustments"><div className="panel-title"><h2>Adjustments</h2><Icon name="adjust" /></div>
      {activeEntry && <div className="selected-image-card" aria-label="Adjusting selected image">{activeEntry.thumbnail && <img src={activeEntry.thumbnail} alt="" style={{ transform: `rotate(${rotationQuarterTurns * 90}deg)` }} />}<div><strong className="selection-count" role="status">{selectedKeys.length} {selectedKeys.length === 1 ? 'image' : 'images'} selected</strong><strong title={activeEntry.name}>{activeEntry.name}</strong><time>{formatImageDate(activeEntry.details?.metadata.imageDate)}</time></div></div>}
      <fieldset disabled={!active || !selectionReady || compareHeld} className="adjustment-fields">
      <div className="history-tools"><button disabled={!selectedEntries.some(entry => entry.history?.past.length)} title={`Undo (${modifierLabel}+Z)`} onClick={() => changeHistory(undo)}><Icon name="undo" />Undo</button><button disabled={!selectedEntries.some(entry => entry.history?.future.length)} title={`Redo (${modifierLabel}+${isMac ? 'Shift+Z' : 'Y'})`} onClick={() => changeHistory(redo)}><Icon name="redo" />Redo</button><button onClick={resetSelection}><Icon name="reset" />Reset</button></div>
      {recipe && base && level && <div className="processing-level">
        <Slider label="Processing level" value={level.level} min={0} max={7} step={1} formatValue={value => level.exact ? `${value} / 7` : `Custom · near ${value}`} endpoints={['No processing', 'Most processing']} onChange={value => updateDraft(withProcessingLevel(recipe, base, value), (current, info) => withProcessingLevel(current, info.suggested ?? info.neutral, value))} onCommit={commitDraft} />
        <div className="processing-stops" role="group" aria-label="Choose processing level">{[0, 1, 2, 3, 4, 5, 6, 7].map(stop => <button key={stop} data-processing-stop={stop} aria-keyshortcuts={`Control+${stop}`} aria-label={`Processing level ${stop}`} aria-pressed={level.exact && level.level === stop} className={level.exact && level.level === stop ? 'active' : ''} onClick={() => applyEdit((current, info) => withProcessingLevel(current, info.suggested ?? info.neutral, stop))}>{stop}</button>)}</div>
      </div>}
      {currentPreset && <div className="current-recipe" aria-label="Current processing preset"><span>Current: <strong>{currentPreset}</strong></span><span>v{recipe?.version}</span></div>}
      {recipe && base ? <>
        <Slider label="Tone" center={35} value={toneValue(recipe, base, photometric)} min={-100} max={100} step={1} endpoints={['Darker', 'Lighter']} onChange={value => updateDraft(withTone(recipe, base, value, photometric), (current, info) => withTone(current, info.suggested ?? info.neutral, value, info.metadata.photometric))} onCommit={commitDraft} />
      </> : <div className="controls-empty">Open an image to adjust its tone and detail.</div>}
      </fieldset>
      <button className={`compare-button ${compareHeld ? 'active' : ''}`} disabled={!active} aria-pressed={compareHeld} onPointerDown={event => { if (event.button !== 0) return; commitDraft(); event.currentTarget.setPointerCapture(event.pointerId); setCompareHeld(true); }} onPointerUp={() => setCompareHeld(false)} onPointerCancel={() => setCompareHeld(false)} onLostPointerCapture={() => setCompareHeld(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setCompareHeld(true); } }} onKeyUp={() => setCompareHeld(false)} onBlur={() => setCompareHeld(false)}><Icon name="compare" />{neutralBusy ? 'Preparing neutral image…' : comparing ? 'Neutral · release to restore' : 'Hold to compare with neutral'}</button>
      <fieldset disabled={!active || !selectionReady || compareHeld} className="adjustment-fields">
      {recipe && base && <details className="control-section"><summary>Detailed adjustments</summary><div className="control-section-content">{range('gamma', 'Gamma', .1, .9, .01, defaultGamma)}
        <Slider label="Contrast" center={defaultContrast} value={contrastValue(recipe, base)} min={-100} max={100} step={1} endpoints={['Softer', 'Stronger']} onChange={value => updateDraft(withContrast(recipe, base, value), (current, info) => withContrast(current, info.suggested ?? info.neutral, value))} onCommit={commitDraft} />
        <div className="section-label">DETAIL</div>{range('sharpen', 'Sharpness strength', 0, 12, .1, 7)}
        <button data-shortcut="c" title="Colorize (Ctrl+C)" className={`colorize-button ${recipe.colorize ? 'active' : ''}`} aria-pressed={Boolean(recipe.colorize)} onClick={() => applyEdit(current => ({ ...current, colorize: !recipe.colorize, colorStrength: current.colorStrength ?? .8, colorScale: current.colorScale ?? 8, midtoneLevel: current.midtoneLevel ?? null, version: 2 }))}>Colorize <span>{recipe.colorize ? 'On' : 'Off'}</span></button>
        {recipe.colorize && <ColorControls recipe={recipe} onChange={patch => updateDraft({ ...recipe, ...patch, version: 2 }, current => ({ ...current, ...patch, version: 2 }))}
          onCommit={commitDraft} onMode={mode => applyEdit(current => withColorMode(current, mode))} picking={picker.picking}
          onPick={() => { commitDraft(); picker.toggle(); }} onHold={held => { setCompareHeld(false); gray.setHeld(held); }} held={gray.held} busy={gray.busy}/>}
        <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><span>{advanced ? '−' : '+'} Advanced processing</span></button>
        {advanced && <div className="advanced-controls"><p className="control-note">Detail method: Radiograph multiscale</p>
          {range('radius', 'Radius / detail scale (px)', .5, 8, .1)}{range('threshold', 'Noise threshold', 0, .05, .0005)}{range('halo', 'Halo suppression', 0, 1)}{range('denoise', 'Noise reduction', 0, 1)}{range('localContrast', 'Local contrast', 0, 1)}{range('clahe', 'Adaptive contrast (CLAHE)', 0, 1)}
          <label className="checkbox-control"><input type="checkbox" checked={recipe.invert} onChange={event => { const invert = event.target.checked; applyEdit(current => ({ ...current, invert })); }} /> Invert display</label><p className="control-note">Spatial scales use source pixels and stay unchanged when you zoom.</p></div>}
      </div></details>}
      <details className="control-section"><summary>Intensity histogram</summary><div className="control-section-content">{rendered && active && <Histogram render={rendered} pixels={active.info.width * active.info.height} />}<p className="control-note">Monochrome intensity before false color. Clipping includes background.</p></div></details>
      <details className="control-section"><summary>Saved presets</summary><div className="control-section-content">{presets.length > 0 && <label className="select-control"><span className="sr-only">Apply saved preset</span><select value="" onChange={event => { const preset = presets.find(item => item.name === event.target.value); if (preset) applyRecipe(preset.recipe); }}><option value="">Apply a saved preset…</option>{presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</select></label>}
      <div className="save-preset"><input aria-label="New preset name" placeholder="Name these settings" value={presetName} maxLength={80} onChange={event => setPresetName(event.target.value)} /><button disabled={!active || !presetName.trim()} onClick={() => void savePreset()}>Save</button></div>
      </div></details></fieldset>
      <button className="save-settings-button" disabled={!active} onClick={() => void saveReview()}><Icon name="save" />Save settings</button>
      <details className="control-section"><summary>Mouse shortcuts</summary><div className="control-section-content"><label className="checkbox-control"><input type="checkbox" checked={mouseShortcuts} onChange={event => setMouseShortcuts(event.target.checked)} />Right-click rotates; double right-click pins</label><dl className="mouse-shortcuts">
        <dt>Keyboard shortcuts</dt><dd>Ctrl+A: A/B comparison; Ctrl+F: fullscreen; Ctrl+C: colorize; Ctrl+Q: rotate; Ctrl+E: Export for Letter; Ctrl+P: print; Ctrl+O: open images; Ctrl+R: reload images.</dd><dt>Scroll wheel</dt><dd>Zoom in or out around the pointer.</dd>
        <dt>Shift + left-drag · Middle-drag</dt><dd>Pan the image in either tool.</dd>
        <dt>{modifierLabel} + scroll wheel</dt><dd>Increase (up) or decrease (down) the processing level.</dd>
        <dt>Left-drag in Adjust</dt><dd>Right/left changes contrast; up/down changes gamma.</dd>
        <dt>{modifierLabel} + left-click</dt><dd>Add or remove an image from the selection. Adjustments apply to all selected images; sliders show the active image’s values.</dd>
        <dt>Double left-click</dt><dd>Show only that image fullscreen. Esc restores the previous layout; F11 shows all visible images fullscreen.</dd>
        <dt>Right-click · Double right-click</dt><dd>Rotate 90° or toggle the pin on the clicked image, even when it is not selected.</dd>
        <dt>Drag an image header</dt><dd>Drop onto another image to swap positions. Arrow keys on a focused title also reorder.</dd>
      </dl></div></details>
    </aside></div></div>
    {comparison && <ComparisonView entry={comparison} onClose={endComparison} onApply={(value, rotation) => { commitRecipes({ [comparison.key]: value }); for (let i = 0; i < (rotation - comparison.rotationQuarterTurns + 4) % 4; i++) rotateImage(comparison.key); endComparison(); }} />}
    {deleteJob && <DeleteDialog items={deleteJob} busy={deleteBusy} error={deleteError} onClose={closeDelete} onConfirm={() => void confirmDelete()} />}
    {printImages && <PrintDialog images={printImages} onBusy={busy => { printBusy.current = busy; }} onClose={() => setPrintImages(null)} />}
    {exportJob && <ExportAllDialog items={exportJob.items} patientName={exportJob.patientName} patientId={exportJob.patientId} onBusy={setExportBusy} onClose={() => setExportJob(null)} />}
    {closeBlocked && <div className="notice error" role="alert"><span>Some adjustments could not be saved. Keep the viewer open to retry, or close without saving those changes.</span><button onClick={() => { void retrySettings().then(ok => { if (ok) void invoke('finish_close'); }); }}>Retry and close</button><button onClick={() => void invoke('finish_close')}>Close without saving</button><button onClick={() => setCloseBlocked(false)}>Keep open</button></div>}
    <footer className="status-bar"><span className="autosave-status" role="status">{saveStatus === 'saving' ? <><span className="spinner" /> Saving adjustments…</> : saveStatus === 'error' ? <>Adjustments not saved <button onClick={() => void retrySettings()}>Retry save</button></> : images.some(entry => entry.settingsBlocked) ? 'Saved adjustments unavailable for some images' : <><Icon name="check" />Saved</>}</span><span className="status-shortcuts">Scroll to zoom<span>·</span>Shift + drag to pan<span>·</span>{modifierLabel} + click to select<span>·</span>F11 fullscreen</span><button className="about-trigger" onClick={() => { commitDraft(); setAboutOpen(true); }}>About &amp; help</button></footer>
    {dragging && <div className="drop-overlay"><strong>Drop radiographs to open</strong><span>RVG · PANO · SC · DICOM · PNG · JPEG</span></div>}
    {patientDialogOpen && <PatientOpenDialog onClose={() => setPatientDialogOpen(false)} onOpen={openPatient} />}
    {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
  </main>;
}
