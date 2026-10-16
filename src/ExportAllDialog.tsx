import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ImageAppearance } from './model';

export type ExportItem = { path: string; sourceSha256: string; appearance: ImageAppearance; annotationStroke: number };
export default function ExportAllDialog({ items, patientName, onClose, onBusy }: { items: ExportItem[]; patientName: string; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const started = useRef(false);
  const [name, setName] = useState(patientName);
  const [stage, setStage] = useState<'name' | 'running' | 'done' | 'error'>(patientName ? 'running' : 'name');
  const [completed, setCompleted] = useState(0);
  const [directory, setDirectory] = useState('');
  const [failure, setFailure] = useState('');
  const run = async (value: string) => {
    if (started.current || !value.trim()) return;
    started.current = true; onBusy(true); setStage('running');
    try {
      const batchId = crypto.randomUUID();
      for (let index = 0; index < items.length; index++) {
        const result = await invoke<{ directory: string; path: string }>('export_jpg_image', { patientName: value.trim(), batchId, index: index + 1, item: items[index] });
        setDirectory(result.directory); setCompleted(index + 1);
      }
      setStage('done');
    } catch (error) { setFailure(String(error)); setStage('error'); }
    finally { onBusy(false); }
  };
  useEffect(() => { dialog.current?.showModal(); if (patientName) void run(patientName); }, []);
  return <dialog ref={dialog} className="export-dialog" aria-labelledby="export-title" onCancel={event => { event.preventDefault(); if (stage !== 'running') onClose(); }}>
    <h2 id="export-title">{stage === 'done' ? 'Export complete' : stage === 'error' ? 'Export incomplete' : 'Export visible radiographs'}</h2>
    {stage === 'name' ? <form onSubmit={event => { event.preventDefault(); void run(name); }}><p>Enter the patient name for the folder in \\C04577\incoming.</p><label>Patient name<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label><div className="export-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()}>Export {items.length} JPGs</button></div></form> : <>
      {stage === 'running' && <div className="export-progress" role="status" aria-live="polite"><span className="export-orbit" aria-hidden="true" /><p>Exporting image {Math.min(completed + 1, items.length)} of {items.length}…</p><progress value={completed} max={items.length} aria-label="Radiographs exported" /><small>{completed} saved · Full resolution · JPG quality 7/10</small></div>}
      {stage === 'done' && <p role="status">All {completed} radiograph{completed === 1 ? '' : 's'} exported as full-resolution JPGs at quality 7/10.</p>}
      {stage === 'error' && <div role="alert"><p>{completed} of {items.length} radiographs exported. Completed files have been kept.</p><p className="export-error">{failure}</p></div>}
      {directory && <div className="export-destination"><span>Saved to</span><code>{directory}</code></div>}
      {stage !== 'running' && <div className="export-actions"><button className="primary" autoFocus onClick={onClose}>Done</button></div>}
    </>}
  </dialog>;
}
