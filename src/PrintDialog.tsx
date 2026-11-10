import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { composePrint } from './printLayout';
import type { PrintImage } from './printLayout';

export default function PrintDialog({ images, onClose, onBusy }: { images: PrintImage[]; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [preview, setPreview] = useState('');
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal(); let alive = true;
    void Promise.all([composePrint(images), invoke<string[]>('list_printers')]).then(([url, names]) => {
      if (!alive) return;
      setPreview(url); setPrinters(names); setPrinter(names.find(name => /RX.?1/i.test(name)) ?? '');
    }).catch(problem => { if (alive) setError(String(problem)); });
    return () => { alive = false; focus?.focus(); };
  }, [images]);
  const print = async () => {
    if (pending.current || !printer || !preview || sent) return;
    pending.current = true; setBusy(true); onBusy(true); setError('');
    try { await invoke('print_radiographs', { png: preview, printer }); setSent(true); }
    catch (problem) { setError(String(problem)); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  };
  return <dialog ref={dialog} className="print-dialog" aria-labelledby="print-title" onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}>
    <h2 id="print-title">Print radiographs</h2>
    <p>6 × 4 inches · Landscape · 5 px minimum spacing</p>
    {preview ? <img className="print-preview" src={preview} alt="4 by 6 landscape radiograph print preview" /> : !error && <p role="status">Preparing preview…</p>}
    <p className="control-note">Same grid and image order as the viewer. Full images and relative zoom are preserved without cropping.</p>
    <label className="select-control">Printer<select value={printer} disabled={busy || sent} onChange={event => setPrinter(event.target.value)}><option value="">Select a printer</option>{printers.map(name => <option key={name}>{name}</option>)}</select></label>
    {preview && !printers.some(name => /RX.?1/i.test(name)) && <p className="control-note">DNP RX1HS is not installed on this computer. Connect it and install its Windows driver, then reopen Print.</p>}
    {error && <p role="alert" className="export-error">{error}</p>}
    {sent && <p role="status">Sent to {printer}. Check the printer for your print.</p>}
    <div className="export-actions"><button disabled={busy} onClick={onClose}>{sent ? 'Done' : 'Cancel'}</button><button className="primary" disabled={!preview || !printer || busy || sent} onClick={() => void print()}>{busy ? 'Sending…' : 'Print 1 copy'}</button></div>
  </dialog>;
}
