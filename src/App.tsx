import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { clamp, commit, contrastValue, dragAdjustment, experimentalPreset, redo, sameRecipe, sourcePixelScale, toneValue, undo, withContrast, withTone } from './model';
import type { CustomPreset, History, ImageInfo, OpenImage, Recipe, RenderInfo } from './model';
import { nextRequest, useRenderedImage } from './useRenderedImage';

const desktop = isTauri();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const presetOptions = [['bitewing', 'Bitewing'], ['detail', 'Detail']] as const;
type View = { scale: number; x: number; y: number; fit: boolean };

function Histogram({ render, pixels }: { render: RenderInfo; pixels: number }) {
  const maximum = Math.max(1, ...render.histogram);
  const path = render.histogram.map((value, index) => `${index === 0 ? 'M' : 'L'}${index / Math.max(1, render.histogram.length - 1) * 256},${78 - value / maximum * 76}`).join(' ');
  return <div className="histogram"><svg viewBox="0 0 256 80" preserveAspectRatio="none" role="img" aria-label="Monochrome intensity histogram before false color, linear count scale"><path d={`${path} L256,80 L0,80 Z`} /></svg><div className="histogram-tonal-strip" /><div className="histogram-scale"><span>Black</span><span>Midtones</span><span>White</span></div><div className="clipping"><span>Black <b>{(render.clippedLow / pixels * 100).toFixed(2)}%</b></span><span>White <b>{(render.clippedHigh / pixels * 100).toFixed(2)}%</b></span></div></div>;
}

function ImagePane({ info, render, view, setView, processing, onSize, pixelRatio, onAdjustStart, onAdjustMove, onAdjustEnd, badge }: {
  info: ImageInfo; render: RenderInfo; view: View; setView: Dispatch<SetStateAction<View>>; processing: boolean;
  onSize: (width: number, height: number) => void; pixelRatio: number; badge: string;
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
      <img src={render.url} alt={`Enhanced: ${info.metadata.name}`} draggable={false} onError={() => setFailedUrl(render.url)} style={{ width: info.width, height: info.height, visibility: failedUrl === render.url ? 'hidden' : 'visible', imageRendering: view.scale * pixelRatio >= 1 ? 'pixelated' : 'auto', transform: `translate(-50%, -50%) translate(${view.x * view.scale}px, ${view.y * view.scale}px) scale(${view.scale})` }} />
      {failedUrl === render.url && <div className="image-load-error" role="alert"><strong>Image display failed</strong><span>The rendered image could not be loaded. Try reopening this image.</span></div>}
      {processing && <div className="processing-pill"><span className="spinner" /> Updating · last completed image</div>}
    </div><footer><span>{info.width} × {info.height}</span><span>{processing ? 'Updating' : 'Full-resolution processing'}</span></footer></section>;
}

function Slider({ label, value, min, max, step = .01, onChange, onCommit, endpoints }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (value: number) => void; onCommit: () => void; endpoints?: [string, string];
}) {
  const decimals = step >= 1 ? 0 : step >= .01 ? 2 : step >= .001 ? 3 : 4;
  return <label className="slider-control"><span>{label}<output>{value.toFixed(decimals)}</output></span>
    <input type="range" min={min} max={max} step={step} value={clamp(value, min, max)} aria-label={label} onChange={event => onChange(Number(event.target.value))} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    {endpoints && <span className="slider-endpoints"><span>{endpoints[0]}</span><span>{endpoints[1]}</span></span>}
    {(value < min || value > max) && <span className="stored-value-note">Stored value {value.toFixed(decimals)} is outside {min}–{max}. Adjusting this slider selects a new value in that range.</span>}
  </label>;
}

export default function App() {
  const [images, setImages] = useState<OpenImage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const draftRef = useRef<Recipe | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<View>({ scale: .4, x: 0, y: 0, fit: true });
  const [pixelRatio, setPixelRatio] = useState(window.devicePixelRatio || 1);
  const [paneSize, setPaneSize] = useState({ width: 500, height: 500 });
  const importBusy = useRef(false);
  const active = images.find(image => image.info.id === selected);
  const recipe = draft ?? active?.history.present;
  const base = active?.info.suggested ?? active?.info.neutral;
  const photometric = active?.info.metadata.photometric ?? 'MONOCHROME2';
  const activeRef = useRef(active); activeRef.current = active;
  const recipeRef = useRef(recipe); recipeRef.current = recipe;
  const dragRecipe = useRef<{ id: string; start: Recipe; base: Recipe; photometric: string } | null>(null);
  const { rendered, processing } = useRenderedImage(active, recipe, setError);
  const currentPreset = active && recipe ? presetOptions.find(([key]) => sameRecipe({ ...recipe, colorize: false }, experimentalPreset(key, active.info.neutral, active.info.suggested)))?.[1]
    ?? presets.find(preset => sameRecipe(recipe, preset.recipe))?.name ?? 'Custom adjustments' : null;
  const onPaneSize = useCallback((width: number, height: number) => setPaneSize({ width, height }), []);
  const fitScale = active ? Math.min((paneSize.width - 28) / active.info.width, (paneSize.height - 28) / active.info.height) : 1;
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

  const loadImage = useCallback(async (path: string): Promise<OpenImage> => {
    const info = await invoke<ImageInfo>('import_image', { path });
    try {
      const defaultRecipe = experimentalPreset('bitewing', info.neutral, info.suggested);
      const initial = await invoke<RenderInfo>('render_image', { id: info.id, recipe: defaultRecipe, requestId: nextRequest() });
      return { path, info, initial, defaultRecipe, history: { past: [], present: defaultRecipe, future: [] } };
    } catch (problem) { await invoke('release_image', { id: info.id }).catch(() => {}); throw problem; }
  }, []);
  const importPaths = useCallback(async (paths: string[]) => {
    if (!paths.length || importBusy.current) return;
    importBusy.current = true; setError(null); let first = true; const failures: string[] = [];
    for (let index = 0; index < paths.length; index++) {
      setLoading(`Opening ${index + 1} of ${paths.length}`);
      try {
        const entry = await loadImage(paths[index]); setImages(previous => [...previous, entry]);
        if (first) { setSelected(entry.info.id); setDraft(null); draftRef.current = null; dragRecipe.current = null; setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); first = false; }
      } catch (problem) { failures.push(`${paths[index].split(/[\\/]/).pop()}: ${message(problem)}`); }
    }
    setLoading(null); importBusy.current = false; if (failures.length) setError(failures.join('\n'));
  }, [loadImage]);
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
    const id = activeRef.current?.info.id; if (!id) return;
    draftRef.current = null; setDraft(null);
    setImages(previous => previous.map(image => image.info.id === id ? { ...image, history: operation(image.history) } : image));
  }, []);
  const commitDraft = () => { if (draftRef.current) { const value = draftRef.current; changeHistory(history => commit(history, value)); } };
  const updateDraft = (value: Recipe) => { draftRef.current = value; setDraft(value); };
  const changeValue = (key: keyof Recipe, value: number | string | boolean) => {
    if (recipe) updateDraft({ ...recipe, [key]: value, version: key === 'localContrast' || key === 'sharpen' ? 2 : recipe.version });
  };
  const applyRecipe = (value: Recipe) => changeHistory(history => commit(history, value));
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select')) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); changeHistory(event.shiftKey ? redo : undo); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); changeHistory(redo); }
    };
    window.addEventListener('keydown', down); return () => window.removeEventListener('keydown', down);
  }, [changeHistory]);
  const chooseImages = async () => { try { await importPaths(await invoke<string[]>('choose_images')); } catch (problem) { setError(message(problem)); } };
  const exportImage = async () => {
    if (!active || !recipe) return;
    try { const path = await invoke<string | null>('export_image', { id: active.info.id, recipe }); if (path) setNotice(`Full-resolution PNG saved: ${path}`); }
    catch (problem) { setError(`Export failed: ${message(problem)}`); }
  };
  const saveReview = async () => {
    if (!active) return;
    try {
      const path = await invoke<string | null>('save_review', { review: { version: 1, processingVersion: recipe?.version ?? 2, createdAt: new Date().toISOString(), qualityAcceptance: 'Pending user review', selectedImageId: active.info.id,
        images: images.map(image => ({ source: image.path, metadata: image.info.metadata, width: image.info.width, height: image.info.height, recipe: image.info.id === active.info.id ? recipe : image.history.present })), view: effectiveView } });
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
    if (!active) return;
    const remaining = images.filter(image => image.info.id !== active.info.id);
    setImages(remaining); setSelected(remaining[0]?.info.id ?? null); setDraft(null); draftRef.current = null; dragRecipe.current = null;
    try { await invoke('release_image', { id: active.info.id }); } catch (problem) { setError(message(problem)); }
  };
  const range = (key: keyof Recipe, label: string, min: number, max: number, step?: number) => recipe && <Slider label={label} value={recipe[key] as number} min={min} max={max} step={step} onChange={value => changeValue(key, value)} onCommit={commitDraft} />;

  return <main className="app-shell"><header className="app-header">
    <div className="brand"><span className="brand-symbol" aria-hidden="true">R</span><div><strong>RAD <span>Viewer</span></strong><small>RADIOGRAPH VIEWER</small></div></div>
    <div className="header-divider" /><div className="header-context"><span className="status-dot" />Local processing<small>Original files preserved</small></div>
    <div className="header-actions"><button onClick={() => void saveReview()} disabled={!active}>Save settings</button><button onClick={() => void exportImage()} disabled={!active}>Export PNG</button><button className="primary" onClick={() => void chooseImages()} disabled={!desktop || !!loading}>＋ Open images</button></div></header>
    {!desktop && <div className="browser-banner"><strong>Desktop application required.</strong> Open RAD Viewer to import local radiographs and use the Rust processing engine. This browser view is the interface only.</div>}
    {error && <div role="alert" className="notice error"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
    {notice && <div role="status" className="notice"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
    <div className="main-body"><div className="workspace"><div className="toolbar">
      <div className="document-title"><strong>{active?.info.metadata.name ?? 'Radiograph workspace'}</strong><span>{active ? `${active.info.metadata.format} · ${active.info.metadata.bitsStored}-bit · ${active.info.metadata.photometric}` : 'Enhanced, full-resolution viewing'}</span></div>
      <div className="view-tools"><button className={view.fit ? 'active' : ''} disabled={!active} onClick={() => setView(previous => ({ ...previous, fit: true, x: 0, y: 0 }))}>Fit</button><button className={!view.fit && Math.abs(view.scale - nativePixelScale) < .00001 ? 'active' : ''} disabled={!active} title="One source pixel per physical display pixel" onClick={() => setView({ scale: nativePixelScale, x: 0, y: 0, fit: false })}>100%</button><span className="zoom-label" title="Source pixels relative to physical display pixels">{active ? `${Math.round(effectiveView.scale * pixelRatio * 100)}%` : '—'}</span></div></div>
      {active && rendered ? <div className="single-image-workspace"><ImagePane key={active.info.id} info={active.info} render={rendered} view={effectiveView} setView={updateView} processing={processing} onSize={onPaneSize} pixelRatio={pixelRatio} badge={`${currentPreset ?? 'Enhanced'}${recipe?.colorize ? ' · False color' : ''}`}
        onAdjustStart={() => { if (activeRef.current && recipeRef.current) dragRecipe.current = { id: activeRef.current.info.id, start: recipeRef.current, base: activeRef.current.info.suggested ?? activeRef.current.info.neutral, photometric: activeRef.current.info.metadata.photometric }; }}
        onAdjustMove={(dx, dy) => { const snapshot = dragRecipe.current; if (snapshot && snapshot.id === activeRef.current?.info.id) updateDraft(dragAdjustment(snapshot.start, snapshot.base, dx, dy, snapshot.photometric)); }}
        onAdjustEnd={() => { const snapshot = dragRecipe.current; dragRecipe.current = null; if (snapshot?.id === activeRef.current?.info.id) commitDraft(); }} /></div>
      : <div className="empty-workspace"><div className="empty-frame"><span /><span /><span /><span /><svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><path d="M17 13h30v38H17zM25 24h14M25 32h14M25 40h8" /></svg></div><h1>{loading ? 'Preparing your image…' : 'Open a radiograph.'}</h1><p>Review enhanced images with responsive tone<br />and detail controls, processed on this computer.</p><button className="primary" onClick={() => void chooseImages()} disabled={!desktop || !!loading}>Open radiographs</button><span className="supported-formats">RVG · PANO · DICOM · PNG · JPEG</span></div>}
      <div className="workspace-help"><span>{loading ? <><span className="spinner" /> {loading}</> : active ? 'Drag ↑↓ gamma · Drag ←→ tone · Shift-drag or middle-drag to pan · Scroll to zoom' : 'Drop radiographs anywhere in the desktop window'}</span>{active && <button className="text-button" onClick={() => void closeImage()}>Close selected</button>}</div>
      <div className="filmstrip" aria-label="Open images">{images.map((image, index) => <button key={image.info.id} className={`thumbnail ${selected === image.info.id ? 'selected' : ''}`} onClick={() => { commitDraft(); dragRecipe.current = null; setSelected(image.info.id); setDraft(null); draftRef.current = null; setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); }} aria-pressed={selected === image.info.id}><img src={image.initial.url} alt="" /><span className="thumbnail-number">{String(index + 1).padStart(2, '0')}</span><span>{image.info.metadata.name}</span></button>)}<button className="add-thumbnail" onClick={() => void chooseImages()} disabled={!desktop || !!loading}><span>＋</span>{images.length ? 'Add images' : 'Open images'}</button></div>
    </div><aside className="adjustments"><div className="panel-title"><h2>Adjustments</h2><span>NON-DESTRUCTIVE</span></div><fieldset disabled={!active} className="adjustment-fields">
      <div className="history-tools"><button disabled={!active?.history.past.length} title="Undo (Ctrl+Z)" onClick={() => changeHistory(undo)}>↶ Undo</button><button disabled={!active?.history.future.length} title="Redo (Ctrl+Y)" onClick={() => changeHistory(redo)}>↷ Redo</button><button onClick={() => active && applyRecipe(active.defaultRecipe)}>Reset</button></div>
      <div className="section-label">PROCESSING PRESET <span>Experimental</span></div><div className="preset-grid">{presetOptions.map(([key, label]) => <button key={key} className={currentPreset === label ? 'active' : ''} onClick={() => active && applyRecipe({ ...experimentalPreset(key, active.info.neutral, active.info.suggested), colorize: Boolean(recipe?.colorize) })}>{label}</button>)}</div>
      {currentPreset && <div className="current-recipe" aria-label="Current processing preset"><span>Current: <strong>{currentPreset}</strong></span><span>v{recipe?.version}</span></div>}
      {recipe && base ? <><div className="section-label">TONE & CONTRAST</div>{range('gamma', 'Gamma', .1, .9)}
        <Slider label="Tone" value={toneValue(recipe, base, photometric)} min={-100} max={100} step={1} endpoints={['Darker', 'Lighter']} onChange={value => updateDraft(withTone(recipe, base, value, photometric))} onCommit={commitDraft} />
        <Slider label="Contrast" value={contrastValue(recipe, base)} min={-100} max={100} step={1} endpoints={['Softer', 'Stronger']} onChange={value => updateDraft(withContrast(recipe, base, value))} onCommit={commitDraft} />
        <div className="section-label">DETAIL</div>{range('sharpen', 'Sharpness strength', 5, 10, .1)}
        <button className={`colorize-button ${recipe.colorize ? 'active' : ''}`} aria-pressed={Boolean(recipe.colorize)} onClick={() => applyRecipe({ ...recipe, colorize: !recipe.colorize, version: 2 })}>Colorize <span>{recipe.colorize ? 'On' : 'Off'}</span></button>
        {recipe.colorize && <div className="color-legend" aria-label="False-color intensity legend"><div className="color-legend-ramp" /><div><span>Low intensity</span><span>High intensity</span></div><p>False-color intensity</p></div>}
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
    {dragging && <div className="drop-overlay"><strong>Drop radiographs to open</strong><span>RVG · PANO · DICOM · PNG · JPEG</span></div>}
  </main>;
}
