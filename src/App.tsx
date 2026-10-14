import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { clamp, commit, contrastValue, dateSourceLabel, dragAdjustment, experimentalPreset, formatImageDate, orientedDimensions, redo, sameRecipe, sourcePixelScale, toneValue, undo, withContrast, withTone } from './model';
import type { CustomPreset, History, ImageInfo, PatientDiscovery, Recipe, RenderInfo } from './model';
import { useRenderedImage } from './useRenderedImage';
import { useImageLibrary } from './useImageLibrary';

const desktop = isTauri();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const presetOptions = [['bitewing', 'Bitewing'], ['detail', 'Detail']] as const;
type View = { scale: number; x: number; y: number; fit: boolean };

function PatientOpenDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (patient: PatientDiscovery) => Promise<void> }) {
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
  return <dialog ref={dialog} className="patient-dialog" aria-labelledby="patient-dialog-title" aria-describedby="patient-dialog-description" aria-busy={Boolean(busy)}
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) onClose(); } }}>
    <form aria-label="Open patient" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id="patient-dialog-title">Open patient</h2>
      <p id="patient-dialog-description">Enter the patient number to open all their radiographs.</p>
      <label className="patient-number-label" htmlFor="patient-number">Patient number</label>
      <input ref={input} id="patient-number" type="text" inputMode="numeric" autoComplete="off" maxLength={64} value={patientNumber} disabled={Boolean(busy)} aria-invalid={Boolean(error) && !valid} aria-describedby={error ? 'patient-number-error patient-folder-preview' : 'patient-folder-preview'}
        onChange={event => { setPatientNumber(event.target.value); setError(null); }} />
      <div id="patient-folder-preview" className="patient-folder-preview"><span>Folder</span><code>{folder ?? 'Enter at least two digits to preview the folder.'}</code></div>
      <p className="patient-selection-note">All radiographs load automatically. If the local patient folder is unavailable, the viewer checks the shared ABELDent folder on C04577.</p>
      {error && <p id="patient-number-error" className="patient-dialog-error" role="alert">{error}</p>}
      {busy && <p className="patient-dialog-status" role="status"><span className="spinner" />{busy}</p>}
      <div className="patient-dialog-actions"><button type="button" disabled={Boolean(busy)} onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={Boolean(busy)}>Open all radiographs</button></div>
    </form>
  </dialog>;
}

function Histogram({ render, pixels }: { render: RenderInfo; pixels: number }) {
  const maximum = Math.max(1, ...render.histogram);
  const path = render.histogram.map((value, index) => `${index === 0 ? 'M' : 'L'}${index / Math.max(1, render.histogram.length - 1) * 256},${78 - value / maximum * 76}`).join(' ');
  return <div className="histogram"><svg viewBox="0 0 256 80" preserveAspectRatio="none" role="img" aria-label="Monochrome intensity histogram before false color, linear count scale"><path d={`${path} L256,80 L0,80 Z`} /></svg><div className="histogram-tonal-strip" /><div className="histogram-scale"><span>Black</span><span>Midtones</span><span>White</span></div><div className="clipping"><span>Black <b>{(render.clippedLow / pixels * 100).toFixed(2)}%</b></span><span>White <b>{(render.clippedHigh / pixels * 100).toFixed(2)}%</b></span></div></div>;
}

function ImagePane({ info, render, view, setView, processing, onSize, pixelRatio, onAdjustStart, onAdjustMove, onAdjustEnd, badge, rotationQuarterTurns }: {
  info: ImageInfo; render: RenderInfo; view: View; setView: Dispatch<SetStateAction<View>>; processing: boolean;
  onSize: (width: number, height: number) => void; pixelRatio: number; badge: string; rotationQuarterTurns: number;
  onAdjustStart: () => void; onAdjustMove: (dx: number, dy: number) => void; onAdjustEnd: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; originalX: number; originalY: number; scale: number; mode: 'pan' | 'adjust' } | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => onSize(entries[0].contentRect.width, entries[0].contentRect.height));
    observer.observe(element); return () => observer.disconnect();
  }, [onSize]);
  const finish = () => { const current = drag.current; drag.current = null; if (current?.mode === 'adjust') onAdjustEnd(); };
  return <section className="image-pane" aria-label="Enhanced image"><header><strong>Enhanced</strong><span>{badge}</span></header>
    <div ref={viewport} className="image-viewport enhanced-viewport" data-testid="image-viewport" onContextMenu={event => event.preventDefault()} onWheel={event => setView(previous => ({ ...previous, fit: false, scale: clamp(previous.scale * Math.exp(-event.deltaY * .0015), .025, 8) }))}
      onPointerDown={event => {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        const mode = event.button === 1 || event.shiftKey ? 'pan' : 'adjust';
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originalX: view.x, originalY: view.y, scale: view.scale, mode };
        if (mode === 'adjust') onAdjustStart();
      }} onPointerMove={event => {
        const origin = drag.current;
        if (!origin || event.pointerId !== origin.pointerId) return;
        const dx = event.clientX - origin.x; const dy = event.clientY - origin.y;
        if (origin.mode === 'adjust') onAdjustMove(dx, dy);
        else setView(previous => ({ ...previous, fit: false, x: origin.originalX + dx / origin.scale, y: origin.originalY + dy / origin.scale }));
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onDoubleClick={() => setView(previous => ({ ...previous, fit: true, x: 0, y: 0 }))}>
      <img src={render.url} alt={`Enhanced: ${info.metadata.name}`} draggable={false} onError={() => setFailedUrl(render.url)} style={{ width: info.width, height: info.height, visibility: failedUrl === render.url ? 'hidden' : 'visible', imageRendering: view.scale * pixelRatio >= 1 ? 'pixelated' : 'auto', transform: `translate(-50%, -50%) translate(${view.x * view.scale}px, ${view.y * view.scale}px) scale(${view.scale}) rotate(${rotationQuarterTurns * 90}deg)` }} />
      {failedUrl === render.url && <div className="image-load-error" role="alert"><strong>Image display failed</strong><span>The rendered image could not be loaded. Try reopening this image.</span></div>}
      {processing && <div className="processing-pill"><span className="spinner" /> Updating · last completed image</div>}
    </div><footer><span>{info.width} × {info.height}</span><span>{processing ? 'Updating' : 'Full-resolution processing'}</span></footer></section>;
}

function Slider({ label, value, min, max, step = .01, onChange, onCommit, endpoints, formatValue }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (value: number) => void; onCommit: () => void; endpoints?: [string, string]; formatValue?: (value: number) => string;
}) {
  const decimals = step >= 1 ? 0 : step >= .01 ? 2 : step >= .001 ? 3 : 4;
  return <label className="slider-control"><span>{label}<output>{formatValue ? formatValue(value) : value.toFixed(decimals)}</output></span>
    <input type="range" min={min} max={max} step={step} value={clamp(value, min, max)} aria-label={label} aria-valuetext={formatValue?.(value)} onChange={event => onChange(Number(event.target.value))} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    {endpoints && <span className="slider-endpoints"><span>{endpoints[0]}</span><span>{endpoints[1]}</span></span>}
    {(value < min || value > max) && <span className="stored-value-note">Stored value {value.toFixed(decimals)} is outside {min}–{max}. Adjusting this slider selects a new value in that range.</span>}
  </label>;
}

export default function App() {
  const [draft, setDraft] = useState<Recipe | null>(null);
  const draftRef = useRef<Recipe | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { entries: images, selectedKey: selected, loading, select: selectImage, append: appendImages, replace: replaceImages, changeHistory: updateHistory, close: closeLibraryImage, rotate: rotateImage } = useImageLibrary(setError);
  const [presets, setPresets] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [patientDialogOpen, setPatientDialogOpen] = useState(false);
  const [view, setView] = useState<View>({ scale: .4, x: 0, y: 0, fit: true });
  const [pixelRatio, setPixelRatio] = useState(window.devicePixelRatio || 1);
  const [paneSize, setPaneSize] = useState({ width: 500, height: 500 });
  const activeEntry = images.find(image => image.key === selected);
  const active = activeEntry?.image;
  const rotationQuarterTurns = activeEntry?.rotationQuarterTurns ?? 0;
  const displayDimensions = active ? orientedDimensions(active.info.width, active.info.height, rotationQuarterTurns) : null;
  const recipe = draft ?? active?.history.present;
  const base = active?.info.suggested ?? active?.info.neutral;
  const photometric = active?.info.metadata.photometric ?? 'MONOCHROME2';
  const activeRef = useRef(active); activeRef.current = active;
  const recipeRef = useRef(recipe); recipeRef.current = recipe;
  const dragRecipe = useRef<{ id: string; start: Recipe; base: Recipe; photometric: string } | null>(null);
  const { rendered, processing } = useRenderedImage(active, recipe, setError);
  const currentPreset = active && recipe ? presetOptions.find(([key]) => sameRecipe({ ...recipe, colorize: false, colorStrength: .8, colorScale: 8 }, experimentalPreset(key, active.info.neutral, active.info.suggested)))?.[1]
    ?? presets.find(preset => sameRecipe(recipe, preset.recipe))?.name ?? 'Custom adjustments' : null;
  const onPaneSize = useCallback((width: number, height: number) => setPaneSize({ width, height }), []);
  const fitScale = displayDimensions ? Math.min((paneSize.width - 28) / displayDimensions.width, (paneSize.height - 28) / displayDimensions.height) : 1;
  const effectiveView = { ...view, scale: view.fit ? Math.max(.025, fitScale) : view.scale };
  const nativePixelScale = sourcePixelScale(pixelRatio);
  const updateView: Dispatch<SetStateAction<View>> = update => setView(previous => {
    const current = { ...previous, scale: previous.fit ? Math.max(.025, fitScale) : previous.scale };
    return typeof update === 'function' ? update(current) : update;
  });
  useEffect(() => {
    const updatePixelRatio = () => setPixelRatio(window.devicePixelRatio || 1);
    const query = window.matchMedia?.(`(resolution: ${pixelRatio}dppx)`);
    window.addEventListener('resize', updatePixelRatio); query?.addEventListener('change', updatePixelRatio);
    return () => { window.removeEventListener('resize', updatePixelRatio); query?.removeEventListener('change', updatePixelRatio); };
  }, [pixelRatio]);
  useEffect(() => { if (desktop) void invoke<CustomPreset[]>('load_presets').then(setPresets).catch(problem => setError(`Could not load saved presets: ${message(problem)}`)); }, []);

  const importPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    if (draftRef.current) { const value = draftRef.current; updateHistory(history => commit(history, value)); }
    setError(null); setDraft(null); draftRef.current = null; dragRecipe.current = null;
    setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); appendImages(paths);
  }, [appendImages, updateHistory]);
  const openPatient = async (patient: PatientDiscovery) => {
    setError(null); setDraft(null); draftRef.current = null; dragRecipe.current = null;
    setView(previous => ({ ...previous, fit: true, x: 0, y: 0 }));
    await replaceImages(patient.paths, { patientNumber: patient.patientNumber, patientName: patient.patientName, directory: patient.directory });
    setNotice(patient.warnings.length ? patient.warnings.join('\n') : null);
  };
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
  const updateDraft = (value: Recipe) => { draftRef.current = value; setDraft(value); };
  const changeValue = (key: keyof Recipe, value: number | string | boolean) => {
    if (recipe) updateDraft({ ...recipe, [key]: value, version: key === 'localContrast' || key === 'sharpen' || key === 'colorStrength' || key === 'colorScale' ? 2 : recipe.version });
  };
  const applyRecipe = (value: Recipe) => changeHistory(history => commit(history, value));
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, dialog')) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); changeHistory(event.shiftKey ? redo : undo); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); changeHistory(redo); }
    };
    window.addEventListener('keydown', down); return () => window.removeEventListener('keydown', down);
  }, [changeHistory]);
  const chooseImages = async () => { try { await importPaths(await invoke<string[]>('choose_images')); } catch (problem) { setError(message(problem)); } };
  const exportImage = async () => {
    if (!active || !recipe) return;
    try { const path = await invoke<string | null>('export_image', { id: active.info.id, recipe, rotationQuarterTurns }); if (path) setNotice(`Full-resolution PNG saved: ${path}`); }
    catch (problem) { setError(`Export failed: ${message(problem)}`); }
  };
  const saveReview = async () => {
    if (!active) return;
    try {
      const path = await invoke<string | null>('save_review', { review: { version: 1, processingVersion: recipe?.version ?? 2, createdAt: new Date().toISOString(), qualityAcceptance: 'Pending user review', selectedImageId: active.info.id,
        images: images.map(image => ({ source: image.path, rotationQuarterTurns: image.rotationQuarterTurns, patient: image.patient, metadata: image.details?.metadata, width: image.details?.width, height: image.details?.height, recipe: image.key === selected ? recipe : image.history?.present ?? null })), view: effectiveView } });
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
    setDraft(null); draftRef.current = null; dragRecipe.current = null;
    await closeLibraryImage();
  };
  const range = (key: keyof Recipe, label: string, min: number, max: number, step?: number) => recipe && <Slider label={label} value={recipe[key] as number} min={min} max={max} step={step} onChange={value => changeValue(key, value)} onCommit={commitDraft} />;

  return <main className="app-shell"><header className="app-header">
    <div className="brand"><span className="brand-symbol" aria-hidden="true">R</span><div><strong>RAD <span>Viewer</span></strong><small>RADIOGRAPH VIEWER</small></div></div>
    <div className="header-divider" />{activeEntry?.patient ? <div className="patient-identity" aria-label="Current patient"><strong>{activeEntry.patient.patientName || 'Name unavailable'}</strong><small>Patient {activeEntry.patient.patientNumber}</small></div> : <div className="header-context"><span className="status-dot" />Local processing<small>Original files preserved</small></div>}
    <div className="header-actions"><button onClick={() => void saveReview()} disabled={!active}>Save settings</button><button onClick={() => void exportImage()} disabled={!active}>Export PNG</button><button onClick={() => setPatientDialogOpen(true)} disabled={!desktop}>Open patient</button><button className="primary" onClick={() => void chooseImages()} disabled={!desktop}>＋ Open images</button></div></header>
    {!desktop && <div className="browser-banner"><strong>Desktop application required.</strong> Open RAD Viewer to import local radiographs and use the Rust processing engine. This browser view is the interface only.</div>}
    {error && <div role="alert" className="notice error"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
    {notice && <div role="status" className="notice"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
    <div className="main-body"><div className="workspace"><div className="toolbar">
      <div className="document-title"><strong>{active?.info.metadata.name ?? activeEntry?.name ?? 'Radiograph workspace'}</strong>{activeEntry && <time className="image-date" title={dateSourceLabel(activeEntry.details?.metadata.dateSource)}>{formatImageDate(activeEntry.details?.metadata.imageDate)}</time>}<span>{active ? `${active.info.metadata.format} · ${active.info.metadata.bitsStored}-bit · ${active.info.metadata.photometric}` : 'Enhanced, full-resolution viewing'}</span></div>
      <div className="view-tools"><button disabled={!active} aria-label="Rotate 90 degrees clockwise" title="Rotate clockwise; separate from adjustment undo" onClick={() => { commitDraft(); rotateImage(); setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); }}>↻ Rotate 90°{rotationQuarterTurns ? ` · ${rotationQuarterTurns * 90}°` : ''}</button><button className={view.fit ? 'active' : ''} disabled={!active} onClick={() => setView(previous => ({ ...previous, fit: true, x: 0, y: 0 }))}>Fit</button><button className={!view.fit && Math.abs(view.scale - nativePixelScale) < .00001 ? 'active' : ''} disabled={!active} title="One source pixel per physical display pixel" onClick={() => setView({ scale: nativePixelScale, x: 0, y: 0, fit: false })}>100%</button><span className="zoom-label" title="Source pixels relative to physical display pixels">{active ? `${Math.round(effectiveView.scale * pixelRatio * 100)}%` : '—'}</span></div></div>
      {active && rendered ? <div className="single-image-workspace"><ImagePane key={active.info.id} info={active.info} rotationQuarterTurns={rotationQuarterTurns} render={rendered} view={effectiveView} setView={updateView} processing={processing} onSize={onPaneSize} pixelRatio={pixelRatio} badge={`${currentPreset ?? 'Enhanced'}${recipe?.colorize ? ' · Local color' : ''}`}
        onAdjustStart={() => { if (activeRef.current && recipeRef.current) dragRecipe.current = { id: activeRef.current.info.id, start: recipeRef.current, base: activeRef.current.info.suggested ?? activeRef.current.info.neutral, photometric: activeRef.current.info.metadata.photometric }; }}
        onAdjustMove={(dx, dy) => { const snapshot = dragRecipe.current; if (snapshot && snapshot.id === activeRef.current?.info.id) updateDraft(dragAdjustment(snapshot.start, snapshot.base, dx, dy, snapshot.photometric)); }}
        onAdjustEnd={() => { const snapshot = dragRecipe.current; dragRecipe.current = null; if (snapshot?.id === activeRef.current?.info.id) commitDraft(); }} /></div>
      : <div className="empty-workspace"><div className="empty-frame"><span /><span /><span /><span /><svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><path d="M17 13h30v38H17zM25 24h14M25 32h14M25 40h8" /></svg></div><h1>{activeEntry?.error ? 'Image unavailable' : activeEntry ? 'Preparing your image…' : 'Open a radiograph.'}</h1><p>{activeEntry?.error ?? 'Review enhanced images with responsive tone and detail controls, processed on this computer.'}</p>{activeEntry?.error ? <button className="primary" onClick={() => selectImage(activeEntry.key)}>Retry image</button> : !activeEntry && <button className="primary" onClick={() => void chooseImages()} disabled={!desktop}>Open radiographs</button>}<span className="supported-formats">RVG · PANO · SC · DICOM · PNG · JPEG</span></div>}
      <div className="workspace-help"><span>{loading ? <><span className="spinner" /> {loading}</> : active ? 'Drag ↑↓ gamma · Drag ←→ tone · Shift-drag or middle-drag to pan · Scroll to zoom' : 'Drop radiographs anywhere in the desktop window'}</span>{activeEntry && <button className="text-button" onClick={() => void closeImage()}>Close selected</button>}</div>
      <div className="filmstrip" aria-label="Open images">{images.map((image, index) => <button key={image.key} aria-label={`${String(index + 1).padStart(2, '0')} ${image.name}`} aria-describedby={`date-${image.key}`} className={`thumbnail ${selected === image.key ? 'selected' : ''}`} title={image.error ?? image.path} onClick={() => { commitDraft(); dragRecipe.current = null; selectImage(image.key); setDraft(null); draftRef.current = null; setError(null); setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); }} aria-pressed={selected === image.key}>{image.thumbnail ? <span className={`thumbnail-image ${image.rotationQuarterTurns % 2 ? 'quarter-turned' : ''}`}><img src={image.thumbnail} alt="" style={{ transform: `translate(-50%, -50%) rotate(${image.rotationQuarterTurns * 90}deg)` }} /></span> : <span className="thumbnail-placeholder" aria-hidden="true">{image.error ? 'Unavailable' : 'Loading…'}</span>}<span className="thumbnail-number">{String(index + 1).padStart(2, '0')}</span><span className="thumbnail-name">{image.name}</span><time id={`date-${image.key}`} className="thumbnail-date" title={dateSourceLabel(image.details?.metadata.dateSource)}>{formatImageDate(image.details?.metadata.imageDate)}</time></button>)}<button className="add-thumbnail" onClick={() => void chooseImages()} disabled={!desktop}><span>＋</span>{images.length ? 'Add images' : 'Open images'}</button></div>
    </div><aside className="adjustments"><div className="panel-title"><h2>Adjustments</h2><span>NON-DESTRUCTIVE</span></div><fieldset disabled={!active} className="adjustment-fields">
      <div className="history-tools"><button disabled={!active?.history.past.length} title="Undo (Ctrl+Z)" onClick={() => changeHistory(undo)}>↶ Undo</button><button disabled={!active?.history.future.length} title="Redo (Ctrl+Y)" onClick={() => changeHistory(redo)}>↷ Redo</button><button onClick={() => active && applyRecipe(active.defaultRecipe)}>Reset</button></div>
      <div className="section-label">PROCESSING PRESET <span>Experimental</span></div><div className="preset-grid">{presetOptions.map(([key, label]) => <button key={key} className={currentPreset === label ? 'active' : ''} onClick={() => active && applyRecipe({ ...experimentalPreset(key, active.info.neutral, active.info.suggested), colorize: Boolean(recipe?.colorize), colorStrength: recipe?.colorStrength ?? .8, colorScale: recipe?.colorScale ?? 8 })}>{label}</button>)}</div>
      {currentPreset && <div className="current-recipe" aria-label="Current processing preset"><span>Current: <strong>{currentPreset}</strong></span><span>v{recipe?.version}</span></div>}
      {recipe && base ? <><div className="section-label">TONE & CONTRAST</div>{range('gamma', 'Gamma', .1, .9)}
        <Slider label="Tone" value={toneValue(recipe, base, photometric)} min={-100} max={100} step={1} endpoints={['Darker', 'Lighter']} onChange={value => updateDraft(withTone(recipe, base, value, photometric))} onCommit={commitDraft} />
        <Slider label="Contrast" value={contrastValue(recipe, base)} min={-100} max={100} step={1} endpoints={['Softer', 'Stronger']} onChange={value => updateDraft(withContrast(recipe, base, value))} onCommit={commitDraft} />
        <div className="section-label">DETAIL</div>{range('sharpen', 'Sharpness strength', 5, 10, .1)}
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
        <div className="section-label">INTENSITY HISTOGRAM {processing && <span>Updating</span>}</div>{rendered && <Histogram render={rendered} pixels={active!.info.width * active!.info.height} />}<p className="control-note">Monochrome intensity before false color. Clipping includes background.</p>
      </> : <div className="controls-empty">Open an image to adjust its tone and detail.</div>}
      <div className="section-label">SAVED PRESETS</div>{presets.length > 0 && <label className="select-control"><span className="sr-only">Apply saved preset</span><select value="" onChange={event => { const preset = presets.find(item => item.name === event.target.value); if (preset) applyRecipe(preset.recipe); }}><option value="">Apply a saved preset…</option>{presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</select></label>}
      <div className="save-preset"><input aria-label="New preset name" placeholder="Name these settings" value={presetName} maxLength={80} onChange={event => setPresetName(event.target.value)} /><button disabled={!active || !presetName.trim()} onClick={() => void savePreset()}>Save</button></div>
    </fieldset></aside></div>
    <footer className="status-bar"><span><span className="status-dot amber" />Image-quality review pending</span><span>{active ? `${Math.round(active.info.decodeMs)} ms decode · ${Math.round(rendered?.renderMs ?? 0)} ms processing · ${images.length} image${images.length === 1 ? '' : 's'}` : 'Offline · CPU processing'}</span></footer>
    {dragging && <div className="drop-overlay"><strong>Drop radiographs to open</strong><span>RVG · PANO · SC · DICOM · PNG · JPEG</span></div>}
    {patientDialogOpen && <PatientOpenDialog onClose={() => setPatientDialogOpen(false)} onOpen={openPatient} />}
  </main>;
}
