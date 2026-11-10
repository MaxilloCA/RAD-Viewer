import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import Icon from './Icon';
import { selectionModifier } from './platform';
import { dateSourceLabel, formatImageDate } from './model';
import type { ImageEntry, RenderInfo } from './model';
import { calibrationScale, measurementLabel, regionBetween, sourcePoint, zoomAt } from './workspace';
import type { AnnotationSelection, Calibration, Ellipse, ImageTool, Measurement, Point, Region, ReviewOverlay } from './workspace';
export type PaneView = { scale: number; x: number; y: number; fit: boolean };
export const defaultPaneView: PaneView = { scale: .4, x: 0, y: 0, fit: true };

export function paneGrid(count: number, width: number, height: number) {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  // Fixed landscape layouts keep viewer and JPEG composition predictable.
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  if (count <= 9) return { columns: 3, rows: 3 };
  if (count <= 12) return { columns: 4, rows: 3 };
  let best = { columns: 2, rows: Math.ceil(count / 2) }, score = -Infinity;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns;
    const cellHeight = Math.max(1, height / rows - 34);
    const fitWidth = Math.min(cellWidth, cellHeight * 1.25);
    const next = fitWidth * fitWidth / 1.25 * count;
    if (next > score) { score = next; best = { columns, rows }; }
  }
  return best;
}

export default function ImagePane({ entry, render, view, setView, processing, onSize, pixelRatio, onAdjustStart, onAdjustMove, onAdjustEnd, badge, active, highlighted = active, hidden = false, onToggleSelect, onFullscreen, onReset, onSelect, onPin, onRotate, onClose,
  annotationsVisible = true, selectedAnnotation, onAnnotationSelect, tool = 'adjust', ellipseColor = 'red', ellipses = [], measurements = [], calibration, calibrationReference, onMeasurement, overlay, comparing = false, mouseShortcuts = true, onEnhance, onEllipse, onRegion, onSwap, onMoveOver, onMoveStep, moveSource, moveTarget, pickingReference = false, onPickReference }: {
  entry: ImageEntry; render?: RenderInfo | null; view: PaneView; setView: Dispatch<SetStateAction<PaneView>>; processing: boolean;
  onSize: (key: string, width: number, height: number) => void; pixelRatio: number; badge: string; active: boolean;
  highlighted?: boolean; hidden?: boolean; onToggleSelect?: () => void; onFullscreen?: () => void; onReset?: () => void;
  onSelect: () => void; onPin: () => void; onRotate: () => void;
  onEnhance?: (direction: number) => void; onClose?: () => void;
  onAdjustStart: () => void; onAdjustMove: (dx: number, dy: number) => void; onAdjustEnd: () => void;
  annotationsVisible?: boolean; selectedAnnotation?: AnnotationSelection | null; onAnnotationSelect?: (selection: AnnotationSelection | null) => void;
  tool?: ImageTool; ellipseColor?: 'red' | 'yellow'; ellipses?: Ellipse[]; overlay?: ReviewOverlay; comparing?: boolean; mouseShortcuts?: boolean;
  onEllipse?: (ellipse: Ellipse) => void; onRegion?: (region: Region) => void;
  calibration?: Calibration; calibrationReference?: Measurement; measurements?: Measurement[]; onMeasurement?: (line: Measurement) => void;
  pickingReference?: boolean; onPickReference?: (point: Point) => void;
  onSwap?: (source: string, target: string) => void; onMoveOver?: (source: string | null, target: string | null) => void;
  onMoveStep?: (key: string, direction: number) => void; moveSource?: string | null; moveTarget?: string | null;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drawing = useRef<{ pointerId: number; start: Point; end: Point; tool: 'ellipse' | 'region'; color: 'red' | 'yellow' } | null>(null);
  const [draftShape, setDraftShape] = useState<Region | null>(null);
  const measuring = useRef<{ pointerId: number; start: Point } | null>(null);
  const [draftLine, setDraftLine] = useState<Measurement | null>(null);
  const moving = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressHeaderClick = useRef(false);
  const clickSelect = useRef(false);
  const referencePress = useRef<{ id: number; x: number; y: number } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const info = entry.details;
  const rotationQuarterTurns = entry.rotationQuarterTurns;
  const drag = useRef<{ pointerId: number; x: number; y: number; originalX: number; originalY: number; scale: number; mode: 'pan' | 'adjust' } | null>(null);
  const rightPress = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const rightClick = useRef<{ timer: ReturnType<typeof setTimeout>; at: number; x: number; y: number; key: string } | null>(null);
  const callbacks = useRef({ onSelect, onPin, onRotate });
  callbacks.current = { onSelect, onPin, onRotate };
  const cancelRightClick = () => {
    if (rightClick.current) clearTimeout(rightClick.current.timer);
    rightClick.current = null;
  };
  useEffect(() => () => {
    cancelRightClick(); rightPress.current = null; drag.current = null;
  }, [entry.key]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setSize({ width, height }); onSize(entry.key, width, height); });
    observer.observe(element); return () => observer.disconnect();
  }, [entry.key, onSize]);
  useEffect(() => { if (!highlighted) drag.current = null; }, [highlighted]);
  const finish = () => { const current = drag.current; drag.current = null; if (current?.mode === 'adjust') onAdjustEnd(); };
  const offset = (x: number, y: number) => { const box = viewport.current!.getBoundingClientRect(); return { x: x - box.left - box.width / 2, y: y - box.top - box.height / 2 }; };
  const point = (x: number, y: number) => sourcePoint(offset(x, y), view, info!.width, info!.height, rotationQuarterTurns);
  const dropTarget = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane-key]')?.dataset.paneKey ?? null;
  const cancelDrawing = () => { drawing.current = null; setDraftShape(null); measuring.current = null; setDraftLine(null); };
  useEffect(() => { cancelDrawing(); }, [entry.key, tool, comparing, pickingReference, rotationQuarterTurns, annotationsVisible]);
  const unavailable = !info || !render;
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = event => {
    event.preventDefault();
    if (unavailable || drawing.current || measuring.current || drag.current || event.deltaY === 0) return;
    if (selectionModifier(event)) { if (!comparing) onEnhance?.(event.deltaY < 0 ? 1 : -1); return; }
    if (!highlighted) onSelect();
    const anchor = offset(event.clientX, event.clientY);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
    setView(previous => zoomAt(previous, Math.exp(-delta * .0015), anchor));
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => wheelHandler.current(event);
    // React's delegated wheel listener is passive; this also blocks WebView Ctrl+wheel page zoom.
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [entry.key]);
  const mmPerPixel = calibrationScale(calibration);
  const reference = calibrationReference ?? calibration?.reference;
  const measurementMarks = measurements.map(line => ({ line, label: measurementLabel(line, mmPerPixel), color: '#66f5ff' }));
  if (draftLine) measurementMarks.push({ line: draftLine, label: tool === 'calibrate' ? 'Reference' : measurementLabel(draftLine, mmPerPixel), color: tool === 'calibrate' ? '#ffe600' : '#66f5ff' });
  if (reference) measurementMarks.push({ line: reference, label: calibrationReference ? 'Reference' : `Reference \u00b7 ${calibration!.knownLengthMm.toFixed(1)} mm`, color: '#ffe600' });
  const annotationProps = (kind: AnnotationSelection['kind'], index: number, label: string) => {
    const selectable = tool === 'selectAnnotation' && Boolean(onAnnotationSelect);
    const chosen = selectedAnnotation?.kind === kind && selectedAnnotation.index === index;
    return {
      role: selectable ? 'button' : undefined, tabIndex: selectable ? 0 : undefined,
      'aria-label': selectable ? `Select ${label}` : undefined,
      'aria-pressed': selectable ? chosen : undefined,
      className: chosen ? 'annotation-selected' : undefined,
      style: { pointerEvents: selectable ? 'all' as const : 'none' as const, cursor: selectable ? 'pointer' : undefined },
      onPointerDown: (event: React.PointerEvent<SVGElement>) => { if (selectable) event.stopPropagation(); },
      onClick: (event: React.MouseEvent<SVGElement>) => { if (selectable) { event.stopPropagation(); onAnnotationSelect?.({ kind, index }); } },
      onDoubleClick: (event: React.MouseEvent<SVGElement>) => { if (selectable) event.stopPropagation(); },
      onKeyDown: (event: React.KeyboardEvent<SVGElement>) => { if (selectable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); onAnnotationSelect?.({ kind, index }); } },
    };
  };
  const overlayTransform = info ? `translate(${size.width / 2 + view.x * view.scale} ${size.height / 2 + view.y * view.scale}) scale(${view.scale}) rotate(${rotationQuarterTurns * 90}) translate(${-info.width / 2} ${-info.height / 2})` : '';
  return <section className={`image-pane ${highlighted ? 'selected-pane' : ''} ${moveSource === entry.key ? 'moving-pane' : ''} ${moveTarget === entry.key && moveSource !== entry.key ? 'swap-target' : ''}`} aria-label={`Image: ${entry.name}`} hidden={hidden} data-selected={highlighted} data-active={active} data-pane-key={entry.key}>
    <header className="pane-header" title="Drag header to swap positions; arrow keys on the title also reorder"
      onClick={event => { if ((event.target as HTMLElement).closest('.pin-button, .pane-close-button, .pane-reset-button')) return; if (suppressHeaderClick.current) { suppressHeaderClick.current = false; return; } if (selectionModifier(event)) onToggleSelect?.(); else onSelect(); }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onMoveStep?.(entry.key, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1); } if (event.key === 'Escape') { moving.current = null; onMoveOver?.(null, null); } }}
      onPointerDown={event => { if (event.button !== 0 || (event.target as HTMLElement).closest('.pin-button, .pane-close-button, .pane-reset-button')) return; suppressHeaderClick.current = false; moving.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); onMoveOver?.(entry.key, entry.key); }}
      onPointerMove={event => { const move = moving.current; if (move?.id === event.pointerId && (move.moved || Math.hypot(event.clientX - move.x, event.clientY - move.y) > 4)) { move.moved = true; onMoveOver?.(entry.key, dropTarget(event.clientX, event.clientY)); } }}
      onPointerUp={event => { if (moving.current?.id !== event.pointerId) return; const moved = moving.current.moved; suppressHeaderClick.current = moved; moving.current = null; const target = dropTarget(event.clientX, event.clientY); if (moved && target && target !== entry.key) onSwap?.(entry.key, target); onMoveOver?.(null, null); }}
      onPointerCancel={() => { moving.current = null; onMoveOver?.(null, null); }} onLostPointerCapture={() => { moving.current = null; onMoveOver?.(null, null); }}><button className="pane-select" aria-label={`Select image ${entry.name}`} aria-pressed={highlighted}><strong>{entry.name}</strong><time title={dateSourceLabel(info?.metadata.dateSource)}>{formatImageDate(info?.metadata.imageDate)}</time></button><button className={`pin-button ${entry.pinned ? 'active' : ''}`} aria-label={`${entry.pinned ? 'Unpin' : 'Pin'} image ${entry.name}`} aria-pressed={Boolean(entry.pinned)} aria-busy={Boolean(entry.pinPending)} title={entry.pinned ? 'Unpin image' : entry.pinPending ? 'Cancel pin' : 'Keep this image visible'} disabled={!entry.pinned && !entry.pinPending && !entry.image} onClick={onPin}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7 2h6l-1 5 3 3v2H5v-2l3-3-1-5Zm3 10v6" /></svg>{entry.pinPending && <span className="spinner" />}</button>{onReset && <button className="pane-reset-button" aria-label={`Reset image ${entry.name}`} title="Reset processing, gamma and tone" onClick={onReset}><Icon name="reset" /></button>}{onClose && <button className="pane-close-button" aria-label={`Close image ${entry.name} from viewer`} title="Close from viewer; keep in thumbnails" onClick={onClose}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>}</header>
    <div ref={viewport} className={`image-viewport enhanced-viewport tool-${tool}`} data-testid="image-viewport" tabIndex={0} aria-label={active ? `Selected image ${entry.name}` : `Activate ${entry.name}`} onKeyDown={event => { if (event.key === 'Escape') { cancelDrawing(); finish(); } if (!active && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } }}
      onClick={event => { if (!selectionModifier(event) && clickSelect.current) { clickSelect.current = false; onSelect(); } }}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (tool === 'selectAnnotation' && event.button === 0 && !event.shiftKey) { event.preventDefault(); clickSelect.current = false; onAnnotationSelect?.(null); return; }
        if (pickingReference && event.button === 0) {
          event.preventDefault(); clickSelect.current = false;
          if (!unavailable && !comparing) { referencePress.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }
          return;
        }
        clickSelect.current = event.button === 0 && !selectionModifier(event) && !event.shiftKey;
        if (event.button === 2) {
          event.preventDefault();
          if (unavailable || !mouseShortcuts || comparing) return;
          rightPress.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
        if (event.button === 0 && selectionModifier(event)) { event.preventDefault(); onToggleSelect?.(); return; }
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        if (unavailable || comparing) return;
        if (!highlighted) { onSelect(); if (tool === 'adjust' && !event.shiftKey && event.button !== 1) return; }
        if (tool === 'region' && !entry.image) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const panning = event.button === 1 || event.shiftKey || tool === 'pan';
        if (!panning && (tool === 'measure' || tool === 'calibrate')) {
          clickSelect.current = false;
          const start = sourcePoint(offset(event.clientX, event.clientY), view, info!.width, info!.height, rotationQuarterTurns, false);
          if (start.x < 0 || start.y < 0 || start.x > info!.width || start.y > info!.height) return;
          measuring.current = { pointerId: event.pointerId, start }; setDraftLine({ start, end: start }); return;
        }
        if (!panning && (tool === 'ellipse' || tool === 'region')) { const start = point(event.clientX, event.clientY); drawing.current = { pointerId: event.pointerId, start, end: start, tool, color: ellipseColor }; setDraftShape(regionBetween(start, start)); return; }
        if (!panning && tool === 'magnify') { const anchor = offset(event.clientX, event.clientY); setView(previous => zoomAt(previous, event.altKey ? 1 / 1.5 : 1.5, anchor)); return; }
        const mode = panning ? 'pan' : 'adjust';
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originalX: view.x, originalY: view.y, scale: view.scale, mode };
        if (mode === 'adjust') onAdjustStart();
      }} onPointerMove={event => {
        if (measuring.current?.pointerId === event.pointerId) { setDraftLine({ start: measuring.current.start, end: point(event.clientX, event.clientY) }); return; }
        const shape = drawing.current;
        if (shape?.pointerId === event.pointerId) { shape.end = point(event.clientX, event.clientY); setDraftShape(regionBetween(shape.start, shape.end)); return; }
        const right = rightPress.current;
        if (right && event.pointerId === right.pointerId) {
          if (Math.hypot(event.clientX - right.x, event.clientY - right.y) > 5) {
            right.moved = true; cancelRightClick();
          }
          return;
        }
        const origin = drag.current;
        if (!highlighted || !origin || event.pointerId !== origin.pointerId) return;
        const dx = event.clientX - origin.x; const dy = event.clientY - origin.y;
        if (Math.hypot(dx, dy) > 4) clickSelect.current = false;
        if (origin.mode === 'adjust') onAdjustMove(dx, dy);
        else setView(previous => ({ ...previous, fit: false, x: origin.originalX + dx / origin.scale, y: origin.originalY + dy / origin.scale }));
      }} onPointerUp={event => {
        if (measuring.current?.pointerId === event.pointerId) {
          const line = { start: measuring.current.start, end: point(event.clientX, event.clientY) };
          if (Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) * view.scale >= 4) onMeasurement?.(line);
          cancelDrawing(); return;
        }
        const reference = referencePress.current;
        if (reference?.id === event.pointerId) {
          referencePress.current = null;
          if (tool === 'selectAnnotation' && event.button === 0 && !event.shiftKey) { event.preventDefault(); clickSelect.current = false; onAnnotationSelect?.(null); return; }
        if (pickingReference && info && Math.hypot(event.clientX - reference.x, event.clientY - reference.y) <= 4) {
            const p = sourcePoint(offset(event.clientX, event.clientY), view, info.width, info.height, rotationQuarterTurns, false);
            if (p.x >= 0 && p.y >= 0 && p.x < info.width && p.y < info.height) onPickReference?.(p);
          }
          return;
        }
        const shape = drawing.current;
        if (shape?.pointerId === event.pointerId) { const region = regionBetween(shape.start, point(event.clientX, event.clientY)); if (region.width * view.scale >= 4 && region.height * view.scale >= 4) { if (shape.tool === 'ellipse') onEllipse?.({ ...region, color: shape.color }); else onRegion?.(region); } cancelDrawing(); return; }
        const right = rightPress.current;
        if (right && event.pointerId === right.pointerId && event.button === 2) {
          event.preventDefault(); rightPress.current = null;
          if (right.moved || Math.hypot(event.clientX - right.x, event.clientY - right.y) > 5) { cancelRightClick(); return; }
          const previous = rightClick.current;
          if (previous && previous.key === entry.key && Date.now() - previous.at <= 400 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8) {
            cancelRightClick(); callbacks.current.onPin();
          } else {
            // A distinct click does not silently replace an earlier single click.
            if (previous) { cancelRightClick(); callbacks.current.onRotate(); }
            const click = { at: Date.now(), x: event.clientX, y: event.clientY, key: entry.key, timer: setTimeout(() => {
              if (rightClick.current !== click) return;
              rightClick.current = null; callbacks.current.onRotate();
            }, 400) };
            rightClick.current = click;
          }
          return;
        }
        if (drag.current?.pointerId === event.pointerId) finish();
      }} onPointerCancel={event => {
        referencePress.current = null;
        if (drawing.current?.pointerId === event.pointerId || measuring.current?.pointerId === event.pointerId) cancelDrawing();
        if (rightPress.current?.pointerId === event.pointerId) { rightPress.current = null; cancelRightClick(); }
        if (drag.current?.pointerId === event.pointerId) finish();
      }} onLostPointerCapture={event => {
        referencePress.current = null;
        if (drawing.current?.pointerId === event.pointerId || measuring.current?.pointerId === event.pointerId) cancelDrawing();
        // Normal capture release follows pointerup; keep its deferred click.
        if (rightPress.current?.pointerId === event.pointerId) { rightPress.current = null; cancelRightClick(); }
        if (drag.current?.pointerId === event.pointerId) finish();
      }} onDoubleClick={event => { if (event.button !== 0 || tool === 'selectAnnotation' || tool === 'ellipse' || tool === 'region' || tool === 'magnify' || (tool === 'measure' || tool === 'calibrate')) return; onFullscreen?.(); }}>
      {info && render ? <img src={render.url} alt={`Enhanced: ${info.metadata.name}`} draggable={false} onError={() => setFailedUrl(render.url)} style={{ width: info.width, height: info.height, visibility: failedUrl === render.url ? 'hidden' : 'visible', imageRendering: !render.preview && view.scale * pixelRatio >= 1 ? 'pixelated' : 'auto', transform: `translate(-50%, -50%) translate(${view.x * view.scale}px, ${view.y * view.scale}px) scale(${view.scale}) rotate(${rotationQuarterTurns * 90}deg)` }} /> : <div className="pane-placeholder"><strong>{entry.error ? 'Image unavailable' : 'Preparing your image…'}</strong>{entry.error && <><span>{entry.error}</span><button onClick={onSelect}>Retry image</button></>}</div>}
      {info && !comparing && annotationsVisible && <svg className="image-markup" aria-label={`${ellipses.length} ellipse annotations`} width="100%" height="100%"><g transform={overlayTransform}>
        {measurementMarks.map(({ line, label, color }, index) => <g key={index} {...(index < measurements.length ? annotationProps('measurement', index, `measurement ${index + 1}`) : reference && index === measurementMarks.length - 1 && !calibrationReference ? annotationProps('calibration', 0, 'calibration reference') : {})}>
          {tool === 'selectAnnotation' && <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke" />}
          <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {[line.start, line.end].map((p, endpoint) => <circle key={endpoint} cx={p.x} cy={p.y} r={3 / view.scale} fill={color} />)}
          <g transform={`translate(${(line.start.x + line.end.x) / 2} ${(line.start.y + line.end.y) / 2}) rotate(${-rotationQuarterTurns * 90}) scale(${1 / view.scale})`}>
            <text y="-10" textAnchor="middle" fontSize="13" fontWeight="600" fill={color} stroke="#101719" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">{label}</text>
          </g>
        </g>)}
        {overlay?.visible && overlay.url && <image href={overlay.url} x={overlay.region.x} y={overlay.region.y} width={overlay.region.width} height={overlay.region.height} />}
        {overlay?.visible && <rect {...overlay.region} fill="none" stroke="#c6dce4" strokeWidth="1" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
        {ellipses.map((ellipse, index) => <ellipse key={index} {...annotationProps('ellipse', index, `ellipse ${index + 1}`)} cx={ellipse.x + ellipse.width / 2} cy={ellipse.y + ellipse.height / 2} rx={ellipse.width / 2} ry={ellipse.height / 2} fill="none" stroke={ellipse.color === 'red' ? '#ff3030' : '#ffe600'} strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
        {draftShape && (tool === 'ellipse' ? <ellipse cx={draftShape.x + draftShape.width / 2} cy={draftShape.y + draftShape.height / 2} rx={draftShape.width / 2} ry={draftShape.height / 2} fill="none" stroke={ellipseColor === 'red' ? '#ff3030' : '#ffe600'} strokeWidth="3" vectorEffect="non-scaling-stroke" /> : <rect {...draftShape} fill="#c6dce410" stroke="#c6dce4" strokeWidth="1" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />)}
      </g></svg>}
      {render && failedUrl === render.url && <div className="image-load-error" role="alert"><strong>Image display failed</strong><span>The rendered image could not be loaded. Try reopening this image.</span></div>}
      {entry.pinError && <div className="pin-error" role="status" title={entry.pinError}>{active ? 'Pinned copy update failed' : 'Pinned image update failed · showing previous settings'}</div>}
      {(processing || render?.preview) && <div className="processing-pill">{processing && <span className="spinner" />}{render?.preview ? 'Interactive preview · full detail on release' : 'Updating · last completed image'}</div>}
    </div><footer><span>{info ? `${info.width} × ${info.height}` : 'Loading'} · {badge}</span><span>{highlighted ? 'Selected' : entry.pinned ? 'Pinned' : 'Pinning'}</span></footer></section>;
}
