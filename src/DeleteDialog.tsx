import { useEffect, useRef } from 'react';
import { formatImageDate, orientedDimensions } from './model';
import type { ImageEntry } from './model';

export type DeletePreview = { entry: ImageEntry; url: string };

export default function DeleteDialog({ items, busy, error, onClose, onConfirm }: {
  items: DeletePreview[]; busy: boolean; error: string | null; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previousFocus?.focus(); };
  }, []);
  return <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-warning" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); } }}>
    <header><div><h2 id="delete-title">Review {items.length} selected radiograph{items.length === 1 ? '' : 's'}</h2>
      <p id="delete-warning">These files will be moved to the <strong>DELETED</strong> folder in each patient folder and removed from the viewer.</p>
      <p>You can restore them later by moving them out of DELETED.</p></div>
      <div className="delete-actions"><button autoFocus disabled={busy} onClick={onClose}>Cancel</button>
        <button className="danger" disabled={busy || !items.length} onClick={onConfirm}>{busy ? 'Moving files…' : 'Move to DELETED'}</button></div></header>
    {error && <p className="delete-error" role="alert">{error}</p>}
    <div className="delete-preview-grid" style={{ gridTemplateColumns: `repeat(${items.length === 1 ? 1 : items.length <= 4 ? 2 : 3}, minmax(0, 1fr))` }}>
      {items.map(({ entry, url }) => {
        const info = entry.details!;
        const dimensions = orientedDimensions(info.width, info.height, entry.rotationQuarterTurns);
        return <figure key={entry.key}><svg viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} role="img" aria-label={`Delete preview: ${entry.name}`}>
          <g transform={`translate(${dimensions.width / 2} ${dimensions.height / 2}) rotate(${entry.rotationQuarterTurns * 90})`}>
            <image href={url} x={-info.width / 2} y={-info.height / 2} width={info.width} height={info.height} />
          </g></svg><figcaption><strong>{entry.name}</strong><time>{formatImageDate(info.metadata.imageDate)}</time><small title={entry.path}>{entry.path}</small></figcaption></figure>;
      })}
    </div>
  </dialog>;
}
