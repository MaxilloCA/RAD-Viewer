import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { commit, experimentalPreset, redo, sameRecipe, sourcePixelScale, undo } from './model';
import type { CustomPreset, History, ImageInfo, OpenImage, Recipe, ReferenceNotes, RenderInfo } from './model';

const desktop = isTauri();
let requestCounter = 0;
const nextRequest = () => ++requestCounter;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const formatMs = (value: number) => `${Math.round(value)} ms`;
const initialNotes: ReferenceNotes = { preset: 'Dentin-to-enamel junction', sharpness: '', orientation: 'As exported', zoom: '', appearanceConfirmed: false };
const presetOptions = [['neutral', 'Neutral'], ['bitewing', 'Bitewing'], ['endo', 'Endo'], ['detail', 'Detail']] as const;
type View = { scale: number; x: number; y: number; fit: boolean };

function Histogram({ render, pixels }: { render: RenderInfo; pixels: number }) {
  const maximum = Math.max(1, ...render.histogram.map(value => Math.log1p(value)));
  const path = render.histogram.map((value, index) => `${index === 0 ? 'M' : 'L'}${index / Math.max(1, render.histogram.length - 1) * 256},${48 - Math.log1p(value) / maximum * 46}`).join(' ');
  return <div className="histogram">
    <svg viewBox="0 0 256 50" preserveAspectRatio="none" role="img" aria-label="Adjusted image histogram, logarithmic count scale"><path d={`${path} L256,50 L0,50 Z`} /></svg>
    <div className="histogram-scale"><span>0</span><span>Output · log count</span><span>255</span></div>
    <div className="clipping"><span>Black <b>{(render.clippedLow / pixels * 100).toFixed(2)}%</b></span><span>White <b>{(render.clippedHigh / pixels * 100).toFixed(2)}%</b></span></div>
  </div>;
}

function ImagePane({ title, badge, info, render, view, setView, processing, onSize, pixelRatio }: {
  title: string; badge: string; info: ImageInfo; render: RenderInfo; view: View;
  setView: Dispatch<SetStateAction<View>>; processing?: boolean; onSize?: (width: number, height: number) => void; pixelRatio: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; originalX: number; originalY: number } | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element || !onSize) return;
    const observer = new ResizeObserver(entries => onSize(entries[0].contentRect.width, entries[0].contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [onSize]);
  return <section className="image-pane" aria-label={title}>
    <header><strong>{title}</strong><span>{badge}</span></header>
    <div ref={viewport} className="image-viewport" onWheel={event => {
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView(previous => ({ ...previous, fit: false, scale: Math.min(8, Math.max(.025, previous.scale * factor)) }));
    }} onPointerDown={event => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, originalX: view.x, originalY: view.y };
    }} onPointerMove={event => {
      if (!drag.current) return;
      const origin = drag.current;
      setView(previous => ({ ...previous, fit: false, x: origin.originalX + (event.clientX - origin.x) / previous.scale, y: origin.originalY + (event.clientY - origin.y) / previous.scale }));
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => setView(previous => ({ ...previous, fit: true, x: 0, y: 0 }))}>
      <img src={render.url} alt={`${title}: ${info.metadata.name}`} draggable={false} onError={() => setFailedUrl(render.url)} style={{ width: info.width, height: info.height, visibility: failedUrl === render.url ? 'hidden' : 'visible', imageRendering: view.scale * pixelRatio >= 1 ? 'pixelated' : 'auto', transform: `translate(-50%, -50%) translate(${view.x * view.scale}px, ${view.y * view.scale}px) scale(${view.scale})` }} />
      {failedUrl === render.url && <div className="image-load-error" role="alert"><strong>Image display failed</strong><span>The rendered image could not be loaded. Try reopening this image.</span></div>}
      {processing && <div className="processing-pill"><span className="spinner" /> Processing · last completed image</div>}
    </div>
    <footer><span>{info.width} × {info.height}</span><span>{processing ? 'Updating' : 'Full resolution'}</span></footer>
  </section>;
}

function Slider({ label, value, min, max, step = .01, onChange, onCommit, hint }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (value: number) => void; onCommit: () => void; hint?: string;
}) {
  const decimals = step >= 1 ? 0 : step >= .01 ? 2 : step >= .001 ? 3 : 4;
  return <label className="slider-control" title={hint}>
    <span>{label}<output>{value.toFixed(decimals)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={event => onChange(Number(event.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
  </label>;
}

export default function App() {
  const [images, setImages] = useState<OpenImage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const draftRef = useRef<Recipe | null>(null);
  const [adjusted, setAdjusted] = useState<RenderInfo | null>(null);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<OpenImage | null>(null);
  const [referenceSourceId, setReferenceSourceId] = useState<string | null>(null);
  const [referenceNotes, setReferenceNotes] = useState<ReferenceNotes>(initialNotes);
  const [showReferenceNotes, setShowReferenceNotes] = useState(false);
  const [presets, setPresets] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [bypass, setBypass] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<View>({ scale: .4, x: 0, y: 0, fit: true });
  const [pixelRatio, setPixelRatio] = useState(window.devicePixelRatio || 1);
  const [paneSize, setPaneSize] = useState({ width: 500, height: 500 });
  const importBusy = useRef(false);
  const active = images.find(image => image.info.id === selected);
  const recipe = draft ?? active?.history.present;
  const currentPreset = active && recipe ? presetOptions.find(([key]) => sameRecipe(recipe, experimentalPreset(key, active.info.neutral, active.info.suggested)))?.[1]
    ?? presets.find(preset => sameRecipe(recipe, preset.recipe))?.name ?? 'Custom adjustments' : null;
  const activeRef = useRef(active);
  activeRef.current = active;
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
    window.addEventListener('resize', updatePixelRatio);
    query?.addEventListener('change', updatePixelRatio);
    return () => { window.removeEventListener('resize', updatePixelRatio); query?.removeEventListener('change', updatePixelRatio); };
  }, [pixelRatio]);

  useEffect(() => {
    if (!desktop) return;
    void invoke<CustomPreset[]>('load_presets').then(setPresets).catch(problem => setError(`Could not load saved presets: ${message(problem)}`));
  }, []);

  const loadImage = useCallback(async (path: string, enhance = false): Promise<OpenImage> => {
    const info = await invoke<ImageInfo>('import_image', { path });
    try {
      const neutral = await invoke<RenderInfo>('render_image', { id: info.id, recipe: info.neutral, requestId: nextRequest() });
      const autoEnhance = enhance && info.suggested?.version === 2;
      const initialRecipe = autoEnhance ? experimentalPreset('bitewing', info.neutral, info.suggested) : info.neutral;
      return { path, info, neutral, history: { past: autoEnhance ? [info.neutral] : [], present: initialRecipe, future: [] } };
    } catch (problem) {
      await invoke('release_image', { id: info.id }).catch(() => {});
      throw problem;
    }
  }, []);

  const importPaths = useCallback(async (paths: string[]) => {
    if (!paths.length || importBusy.current) return;
    importBusy.current = true;
    setError(null);
    let first = true;
    const failures: string[] = [];
    for (let index = 0; index < paths.length; index++) {
      setLoading(`Opening ${index + 1} of ${paths.length}`);
      try {
        const entry = await loadImage(paths[index], true);
        setImages(previous => [...previous, entry]);
        if (first) { setSelected(entry.info.id); setDraft(null); draftRef.current = null; setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); first = false; }
      } catch (problem) { failures.push(`${paths[index].split(/[\\/]/).pop()}: ${message(problem)}`); }
    }
    setLoading(null);
    importBusy.current = false;
    if (failures.length) setError(failures.join('\n'));
  }, [loadImage]);

  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === 'over' || event.payload.type === 'enter') setDragging(true);
      if (event.payload.type === 'leave' || event.payload.type === 'drop') setDragging(false);
      if (event.payload.type === 'drop') void importPaths(event.payload.paths);
    }).then(unlisten => { if (cancelled) unlisten(); else stop = unlisten; }).catch(problem => setError(message(problem)));
    return () => { cancelled = true; stop?.(); };
  }, [importPaths]);

  useEffect(() => {
    if (!active || !recipe) { setAdjusted(null); setProcessing(false); return; }
    if (sameRecipe(recipe, active.info.neutral)) { setAdjusted(active.neutral); setProcessing(false); return; }
    let cancelled = false;
    setProcessing(true);
    const requestId = nextRequest();
    const timeout = window.setTimeout(() => {
      void invoke<RenderInfo>('render_image', { id: active.info.id, recipe, requestId }).then(result => {
        if (!cancelled && result.requestId === requestId) { setAdjusted(result); setProcessing(false); }
      }).catch(problem => { if (!cancelled) { setError(`Rendering failed: ${message(problem)}`); setProcessing(false); } });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [active?.info.id, recipe]);

  const changeHistory = useCallback((operation: (history: History) => History) => {
    const id = activeRef.current?.info.id;
    if (!id) return;
    draftRef.current = null;
    setDraft(null);
    setImages(previous => previous.map(image => image.info.id === id ? { ...image, history: operation(image.history) } : image));
  }, []);
  const commitDraft = () => {
    if (draftRef.current) { const value = draftRef.current; changeHistory(history => commit(history, value)); }
  };
  const changeValue = (key: keyof Recipe, value: number | string | boolean) => {
    if (!recipe) return;
    const updated = { ...recipe, [key]: value, version: key === 'localContrast' ? 2 : recipe.version };
    draftRef.current = updated;
    setDraft(updated);
  };
  const applyRecipe = (value: Recipe) => changeHistory(history => commit(history, value));

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select')) return;
      if (event.code === 'Space') { event.preventDefault(); setBypass(true); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); changeHistory(event.shiftKey ? redo : undo); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); changeHistory(redo); }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setBypass(false); };
    const blur = () => setBypass(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [changeHistory]);

  const chooseImages = async () => {
    try { await importPaths(await invoke<string[]>('choose_images')); } catch (problem) { setError(message(problem)); }
  };
  const chooseReference = async () => {
    if (importBusy.current) return;
    try {
      const path = await invoke<string | null>('choose_reference');
      if (!path) return;
      setLoading('Opening Carestream reference');
      importBusy.current = true;
      const entry = await loadImage(path, false);
      if (reference) await invoke('release_image', { id: reference.info.id });
      setReference(entry); setReferenceSourceId(active?.info.id ?? null); setReferenceNotes(initialNotes); setShowReferenceNotes(true);
    } catch (problem) { setError(`Reference import failed: ${message(problem)}`); }
    finally { setLoading(null); importBusy.current = false; }
  };
  const exportImage = async () => {
    if (!active || !recipe) return;
    try {
      const path = await invoke<string | null>('export_image', { id: active.info.id, recipe });
      if (path) setNotice(`Full-resolution PNG saved: ${path}`);
    } catch (problem) { setError(`Export failed: ${message(problem)}`); }
  };
  const saveReview = async () => {
    if (!active) return;
    try {
      const path = await invoke<string | null>('save_review', { review: {
        version: 1, processingVersion: recipe?.version ?? 1, createdAt: new Date().toISOString(), qualityAcceptance: 'Pending user comparison',
        selectedImageId: active.info.id,
        images: images.map(image => ({ source: image.path, metadata: image.info.metadata, width: image.info.width, height: image.info.height, recipe: image.info.id === active.info.id ? recipe : image.history.present })),
        reference: reference ? { source: reference.path, sourceImageId: referenceSourceId, width: reference.info.width, height: reference.info.height, ...referenceNotes } : null,
        view: effectiveView, comparisonPrerequisite: 'Reference and source must represent matching crops, orientation, and scale. Screenshots and rendered exports are visual targets, not decoded pixel ground truth.',
      } });
      if (path) setNotice(`Comparison record saved: ${path}`);
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
    setImages(remaining); setSelected(remaining[0]?.info.id ?? null); setDraft(null); draftRef.current = null;
    try { await invoke('release_image', { id: active.info.id }); } catch (problem) { setError(message(problem)); }
  };
  const displayed = bypass ? active?.neutral : adjusted?.id === selected ? adjusted : active?.neutral;
  const mappedLow = active ? Math.min(active.info.metadata.min * active.info.metadata.slope + active.info.metadata.intercept, active.info.metadata.max * active.info.metadata.slope + active.info.metadata.intercept) : 0;
  const mappedHigh = active ? Math.max(active.info.metadata.min * active.info.metadata.slope + active.info.metadata.intercept, active.info.metadata.max * active.info.metadata.slope + active.info.metadata.intercept) : 4095;
  const windowRange = Math.max(1, mappedHigh - mappedLow);
  const range = (key: keyof Recipe, label: string, min: number, max: number, step?: number, hint?: string) => recipe && <Slider label={label} value={recipe[key] as number} min={Math.min(min, recipe[key] as number)} max={Math.max(max, recipe[key] as number)} step={step} hint={hint} onChange={value => changeValue(key, value)} onCommit={commitDraft} />;

  return <main className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-symbol" aria-hidden="true">R</span><div><strong>RAD <span>Viewer</span></strong><small>IMAGE COMPARISON</small></div></div>
      <div className="header-divider" /><div className="header-context"><span className="status-dot" />Local processing<small>Original files preserved</small></div>
      <div className="header-actions"><button onClick={() => void saveReview()} disabled={!active}>Save review</button><button onClick={() => void exportImage()} disabled={!active}>Export PNG</button><button className="primary" onClick={() => void chooseImages()} disabled={!desktop || !!loading}>＋ Open images</button></div>
    </header>
    {!desktop && <div className="browser-banner"><strong>Desktop application required.</strong> Open RAD Viewer to import local radiographs and use the Rust processing engine. This browser view is the interface only.</div>}
    {error && <div role="alert" className="notice error"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
    {notice && <div role="status" className="notice"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
    <div className="main-body">
      <div className="workspace">
        <div className="toolbar">
          <div className="document-title"><strong>{active?.info.metadata.name ?? 'Comparison workspace'}</strong><span>{active ? `${active.info.metadata.format} · ${active.info.metadata.bitsStored}-bit · ${active.info.metadata.photometric}` : 'Original · adjusted · Carestream reference'}</span></div>
          <div className="view-tools"><span className="linked-label" title="All comparison views share zoom and pan">↔ Linked</span><button className={view.fit ? 'active' : ''} disabled={!active} onClick={() => setView(previous => ({ ...previous, fit: true, x: 0, y: 0 }))}>Fit</button><button className={!view.fit && Math.abs(view.scale - nativePixelScale) < .00001 ? 'active' : ''} disabled={!active} title="One source pixel per physical display pixel" onClick={() => setView({ scale: nativePixelScale, x: 0, y: 0, fit: false })}>100%</button><span className="zoom-label" title="Source pixels relative to physical display pixels">{active ? `${Math.round(effectiveView.scale * pixelRatio * 100)}%` : '—'}</span></div>
        </div>
        {active && reference && referenceSourceId !== active.info.id && <div className="reference-warning" role="status">Reference was added for another image. Replace it with the Carestream rendering of the selected radiograph before comparing.</div>}
        {active && reference && (active.info.width !== reference.info.width || active.info.height !== reference.info.height) && <div className="reference-warning" role="status">Different reference dimensions · Match crop, orientation, and scale before judging detail. This reference is not registered to the source.</div>}
        {active && displayed ? <div className={`comparison-grid ${reference ? 'with-reference' : ''}`}>
          <ImagePane title="Original" badge="Neutral mapping" info={active.info} render={active.neutral} view={effectiveView} setView={updateView} onSize={onPaneSize} pixelRatio={pixelRatio} />
          <ImagePane title={bypass ? 'Adjusted · bypassed' : 'Adjusted'} badge={bypass ? 'Neutral mapping' : currentPreset === 'Neutral' ? 'Neutral · enhancement off' : currentPreset ?? 'Experimental processing'} info={active.info} render={displayed} view={effectiveView} setView={updateView} processing={processing && !bypass} pixelRatio={pixelRatio} />
          {reference && <ImagePane title="Carestream reference" badge="Rendered reference" info={reference.info} render={reference.neutral} view={effectiveView} setView={updateView} pixelRatio={pixelRatio} />}
        </div> : <div className="empty-workspace">
          <div className="empty-frame"><span /><span /><span /><span /><svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><path d="M17 13h30v38H17zM25 24h14M25 32h14M25 40h8" /></svg></div>
          <h1>Start with the original.</h1><p>Open a radiograph to compare a neutral rendering<br />with adjustable, full-resolution processing.</p>
          <button className="primary" onClick={() => void chooseImages()} disabled={!desktop || !!loading}>Open radiographs</button>
          <span className="supported-formats">RVG · PANO · DICOM · PNG · JPEG</span>
          <p className="empty-detail">Drop files anywhere in the desktop window.<br />Images and adjustments stay on this computer.</p>
        </div>}
        <div className="workspace-help"><span>{loading ? <><span className="spinner" /> {loading}</> : active ? 'Scroll to zoom · Drag to pan · Double-click to fit · Hold Space to bypass' : 'No images open'}</span>{active && <button className="text-button" onClick={() => void closeImage()}>Close selected</button>}</div>
        <div className="filmstrip" aria-label="Open images">
          {images.map((image, index) => <button key={image.info.id} className={`thumbnail ${selected === image.info.id ? 'selected' : ''}`} onClick={() => { commitDraft(); setSelected(image.info.id); setDraft(null); draftRef.current = null; setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); }} aria-pressed={selected === image.info.id}><img src={image.neutral.url} alt="" /><span className="thumbnail-number">{String(index + 1).padStart(2, '0')}</span><span>{image.info.metadata.name}</span></button>)}
          <button className="add-thumbnail" onClick={() => void chooseImages()} disabled={!desktop || !!loading}><span>＋</span>{images.length ? 'Add images' : 'Open images'}</button>
        </div>
      </div>
      <aside className="adjustments">
        <div className="panel-title"><h2>Adjustments</h2><span>NON-DESTRUCTIVE</span></div>
        <fieldset disabled={!active} className="adjustment-fields">
          <div className="history-tools"><button disabled={!active?.history.past.length} title="Undo (Ctrl+Z)" onClick={() => changeHistory(undo)}>↶ Undo</button><button disabled={!active?.history.future.length} title="Redo (Ctrl+Y)" onClick={() => changeHistory(redo)}>↷ Redo</button><button onClick={() => active && applyRecipe(active.info.neutral)}>Reset</button></div>
          <div className="section-label">PROCESSING PRESET <span>Experimental</span></div>
          <div className="preset-grid">{presetOptions.map(([key, label]) => <button key={key} className={active && recipe && sameRecipe(recipe, experimentalPreset(key, active.info.neutral, active.info.suggested)) ? 'active' : ''} onClick={() => active && applyRecipe(experimentalPreset(key, active.info.neutral, active.info.suggested))}>{label}</button>)}</div>
          {currentPreset && <div className="current-recipe" aria-label="Current processing preset"><span>Current: <strong>{currentPreset}</strong></span><span>v{recipe?.version}</span></div>}
          <p className="control-note">Starting points for visual review. Carestream comparison is pending.</p>
          {active?.info.suggested && <p className="control-note">Enhanced presets use an image-specific tone window. Neutral keeps the original mapping.</p>}
          {recipe ? <>
            <div className="section-label">TONE</div>
            {range('windowCenter', 'Window center', mappedLow - windowRange * .5, mappedHigh + windowRange * .5, windowRange > 100 ? 1 : .01)}
            {range('windowWidth', 'Window width', 1, windowRange * 2, windowRange > 100 ? 1 : .01)}
            {range('gamma', 'Gamma', .2, 3)}
            <div className="section-label">DETAIL</div>
            {range('sharpen', 'Sharpness strength', 0, recipe.version >= 2 ? 6 : 2)}
            <button className={`bypass-button ${bypass ? 'active' : ''}`} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setBypass(true); }} onPointerUp={() => setBypass(false)} onPointerCancel={() => setBypass(false)} onLostPointerCapture={() => setBypass(false)} onKeyDown={event => { if (event.key === 'Enter') setBypass(true); }} onKeyUp={() => setBypass(false)} onBlur={() => setBypass(false)}>Hold to bypass <kbd>Space</kbd></button>
            <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><span>{advanced ? '−' : '+'} Advanced processing</span></button>
            {advanced && <div className="advanced-controls">
              <label className="select-control">Detail method<select value={recipe.detailMode} onChange={event => applyRecipe({ ...recipe, detailMode: event.target.value, version: event.target.value === 'radiograph' ? 2 : recipe.version })}><option value="radiograph">Radiograph multiscale</option><option value="unsharp">Unsharp</option><option value="multiscale">Legacy two-scale</option></select></label>
              {range('radius', 'Radius / detail scale (px)', .5, 8, .1, 'Source-pixel units; independent of zoom')}
              {range('threshold', 'Noise threshold', 0, .05, .0005)}
              {range('halo', 'Halo suppression', 0, 1)}
              {range('denoise', 'Noise reduction', 0, 1)}
              {range('localContrast', 'Local contrast', 0, 1)}
              {range('clahe', 'Adaptive contrast (CLAHE)', 0, 1)}
              <label className="checkbox-control"><input type="checkbox" checked={recipe.invert} onChange={event => applyRecipe({ ...recipe, invert: event.target.checked })} /> Invert display</label>
              <p className="control-note">Modality → denoise → window / gamma → local contrast → detail → display. Local contrast and Radiograph multiscale use processing v2.</p>
            </div>}
            <div className="section-label">OUTPUT HISTOGRAM {processing && <span>Updating</span>}</div>
            {displayed && <Histogram render={displayed} pixels={active!.info.width * active!.info.height} />}
            <p className="control-note">Clipping shows final black and white pixels, including background.</p>
          </> : <div className="controls-empty">Open an image to inspect its tone, detail, and output histogram.</div>}
          <div className="section-label">SAVED PRESETS</div>
          {presets.length > 0 && <label className="select-control"><span className="sr-only">Apply saved preset</span><select value="" onChange={event => { const preset = presets.find(item => item.name === event.target.value); if (preset) applyRecipe(preset.recipe); }}><option value="">Apply a saved preset…</option>{presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</select></label>}
          <div className="save-preset"><input aria-label="New preset name" placeholder="Name these settings" value={presetName} maxLength={80} onChange={event => setPresetName(event.target.value)} /><button disabled={!active || !presetName.trim()} onClick={() => void savePreset()}>Save</button></div>
        </fieldset>
        <section className="reference-section"><div className="section-label">CARESTREAM V7 REFERENCE</div>
          <p className="control-note">Add a rendered export or screenshot of this image for a matched comparison.</p>
          <button className="reference-button" onClick={() => void chooseReference()} disabled={!desktop || !active || !!loading}>{reference ? 'Replace reference' : '＋ Add reference image'}</button>
          {reference && <><div className="reference-file">{reference.info.metadata.name}<button className="text-button" onClick={() => { void invoke('release_image', { id: reference.info.id }).catch(problem => setError(message(problem))); setReference(null); setReferenceSourceId(null); }}>Remove</button></div><button className="text-button" onClick={() => setShowReferenceNotes(value => !value)}>{showReferenceNotes ? 'Hide capture notes' : 'Edit capture notes'}</button>
            {showReferenceNotes && <div className="reference-notes">
              <label>Carestream preset<select value={referenceNotes.preset} onChange={event => setReferenceNotes(notes => ({ ...notes, preset: event.target.value }))}><option>Dentin-to-enamel junction</option><option>Endo</option><option>Other / neutral</option></select></label>
              <label>Sharpness setting<input value={referenceNotes.sharpness} placeholder="As shown in Carestream" onChange={event => setReferenceNotes(notes => ({ ...notes, sharpness: event.target.value }))} /></label>
              <label>Orientation<input value={referenceNotes.orientation} onChange={event => setReferenceNotes(notes => ({ ...notes, orientation: event.target.value }))} /></label>
              <label>Capture zoom<input value={referenceNotes.zoom} placeholder="e.g. 100%, export at native size" onChange={event => setReferenceNotes(notes => ({ ...notes, zoom: event.target.value }))} /></label>
              <label className="checkbox-control"><input type="checkbox" checked={referenceNotes.appearanceConfirmed} onChange={event => setReferenceNotes(notes => ({ ...notes, appearanceConfirmed: event.target.checked }))} /> I checked that this reference preserves Carestream’s displayed appearance.</label>
              <p className="control-note">Linked views use source pixels. Cropped or resized screenshots require matching scale and framing before judging detail.</p>
            </div>}</>}
        </section>
      </aside>
    </div>
    <footer className="status-bar"><span><span className="status-dot amber" />Comparison prototype · image-quality review pending</span><span>{active ? `${formatMs(active.info.decodeMs)} decode · ${formatMs(displayed?.renderMs ?? 0)} processing · ${images.length} image${images.length === 1 ? '' : 's'}` : 'Phase A · Offline · CPU processing'}</span></footer>
    {dragging && <div className="drop-overlay"><strong>Drop radiographs to open</strong><span>RVG · PANO · DICOM · PNG · JPEG</span></div>}
  </main>;
}
