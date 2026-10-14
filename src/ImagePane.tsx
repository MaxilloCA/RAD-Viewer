import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { clamp, dateSourceLabel, formatImageDate } from './model';
import type { ImageEntry, RenderInfo } from './model';
export type PaneView = { scale: number; x: number; y: number; fit: boolean };
export const defaultPaneView: PaneView = { scale: .4, x: 0, y: 0, fit: true };

export function paneGrid(count: number, width: number, height: number) {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  let best = { columns: 2, rows: Math.ceil(count / 2) }, score = -Infinity;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns;
    const cellHeight = Math.max(1, height / rows - 75);
    const fitWidth = Math.min(cellWidth, cellHeight * 1.25);
    const next = fitWidth * fitWidth / 1.25 * count;
    if (next > score) { score = next; best = { columns, rows }; }
  }
  return best;
}

export default function ImagePane({ entry, render, view, setView, processing, onSize, pixelRatio, onAdjustStart, onAdjustMove, onAdjustEnd, badge, active, onSelect, onPin, onRotate }: {
  entry: ImageEntry; render?: RenderInfo | null; view: PaneView; setView: Dispatch<SetStateAction<PaneView>>; processing: boolean;
  onSize: (key: string, width: number, height: number) => void; pixelRatio: number; badge: string; active: boolean;
  onSelect: () => void; onPin: () => void; onRotate: () => void;
  onAdjustStart: () => void; onAdjustMove: (dx: number, dy: number) => void; onAdjustEnd: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
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
    const observer = new ResizeObserver(entries => onSize(entry.key, entries[0].contentRect.width, entries[0].contentRect.height));
    observer.observe(element); return () => observer.disconnect();
  }, [entry.key, onSize]);
  useEffect(() => { if (!active) drag.current = null; }, [active]);
  const finish = () => { const current = drag.current; drag.current = null; if (current?.mode === 'adjust') onAdjustEnd(); };
  const unavailable = !info || !render;
  return <section className={`image-pane ${active ? 'selected-pane' : ''}`} aria-label={`Image: ${entry.name}`} data-selected={active}>
    <header className="pane-header"><button className="pane-select" onClick={onSelect} aria-label={`Select image ${entry.name}`} aria-pressed={active}><strong>{entry.name}</strong><time title={dateSourceLabel(info?.metadata.dateSource)}>{formatImageDate(info?.metadata.imageDate)}</time></button><button className={`pin-button ${entry.pinned ? 'active' : ''}`} aria-label={`${entry.pinned ? 'Unpin' : 'Pin'} image ${entry.name}`} aria-pressed={Boolean(entry.pinned)} aria-busy={Boolean(entry.pinPending)} title={entry.pinned ? 'Unpin image' : entry.pinPending ? 'Cancel pin' : 'Keep this image visible'} disabled={!entry.pinned && !entry.pinPending && !entry.image} onClick={onPin}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7 2h6l-1 5 3 3v2H5v-2l3-3-1-5Zm3 10v6" /></svg>{entry.pinPending && <span className="spinner" />}</button></header>
    <div ref={viewport} className="image-viewport enhanced-viewport" data-testid="image-viewport" tabIndex={active ? -1 : 0} aria-label={active ? undefined : `Activate ${entry.name}`} onKeyDown={event => { if (!active && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } }}
      onContextMenu={event => event.preventDefault()} onWheel={event => { if (!active) { onSelect(); return; } setView(previous => ({ ...previous, fit: false, scale: clamp(previous.scale * Math.exp(-event.deltaY * .0015), .025, 8) })); }}
      onPointerDown={event => {
        if (event.button === 2) {
          event.preventDefault();
          if (unavailable) return;
          rightPress.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
          if (!active) callbacks.current.onSelect();
          return;
        }
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        if (!active) { onSelect(); return; }
        if (unavailable) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const mode = event.button === 1 || event.shiftKey ? 'pan' : 'adjust';
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originalX: view.x, originalY: view.y, scale: view.scale, mode };
        if (mode === 'adjust') onAdjustStart();
      }} onPointerMove={event => {
        const right = rightPress.current;
        if (right && event.pointerId === right.pointerId) {
          if (Math.hypot(event.clientX - right.x, event.clientY - right.y) > 5) {
            right.moved = true; cancelRightClick();
          }
          return;
        }
        const origin = drag.current;
        if (!active || !origin || event.pointerId !== origin.pointerId) return;
        const dx = event.clientX - origin.x; const dy = event.clientY - origin.y;
        if (origin.mode === 'adjust') onAdjustMove(dx, dy);
        else setView(previous => ({ ...previous, fit: false, x: origin.originalX + dx / origin.scale, y: origin.originalY + dy / origin.scale }));
      }} onPointerUp={event => {
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
        if (rightPress.current?.pointerId === event.pointerId) { rightPress.current = null; cancelRightClick(); }
        if (drag.current?.pointerId === event.pointerId) finish();
      }} onLostPointerCapture={event => {
        // Normal capture release follows pointerup; keep its deferred click.
        if (rightPress.current?.pointerId === event.pointerId) { rightPress.current = null; cancelRightClick(); }
        if (drag.current?.pointerId === event.pointerId) finish();
      }} onDoubleClick={event => { if (event.button !== 0) return; if (!active) { onSelect(); return; } setView(previous => ({ ...previous, fit: true, x: 0, y: 0 })); }}>
      {info && render ? <img src={render.url} alt={`Enhanced: ${info.metadata.name}`} draggable={false} onError={() => setFailedUrl(render.url)} style={{ width: info.width, height: info.height, visibility: failedUrl === render.url ? 'hidden' : 'visible', imageRendering: !render.preview && view.scale * pixelRatio >= 1 ? 'pixelated' : 'auto', transform: `translate(-50%, -50%) translate(${view.x * view.scale}px, ${view.y * view.scale}px) scale(${view.scale}) rotate(${rotationQuarterTurns * 90}deg)` }} /> : <div className="pane-placeholder"><strong>{entry.error ? 'Image unavailable' : 'Preparing your image…'}</strong>{entry.error && <><span>{entry.error}</span><button onClick={onSelect}>Retry image</button></>}</div>}
      {render && failedUrl === render.url && <div className="image-load-error" role="alert"><strong>Image display failed</strong><span>The rendered image could not be loaded. Try reopening this image.</span></div>}
      {entry.pinError && <div className="pin-error" role="status" title={entry.pinError}>{active ? 'Pinned copy update failed' : 'Pinned image update failed · showing previous settings'}</div>}
      {(processing || render?.preview) && <div className="processing-pill">{processing && <span className="spinner" />}{render?.preview ? 'Interactive preview · full detail on release' : 'Updating · last completed image'}</div>}
    </div><footer><span>{info ? `${info.width} × ${info.height}` : 'Loading'} · {badge}</span><span>{active ? 'Selected' : entry.pinned ? 'Pinned' : 'Pinning'}</span></footer></section>;
}
