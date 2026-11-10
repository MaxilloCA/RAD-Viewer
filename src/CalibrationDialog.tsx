import { useEffect, useRef, useState } from 'react';
import { calibrationScale } from './workspace';
import type { Calibration, Measurement } from './workspace';

export default function CalibrationDialog({ imageName, reference, onApply, onCancel }: {
  imageName: string; reference: Measurement; onApply: (value: Calibration) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [length, setLength] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal(); input.current?.focus();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="patient-dialog" aria-labelledby="calibration-title" onCancel={event => { event.preventDefault(); onCancel(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}>
    <form noValidate onSubmit={event => {
      event.preventDefault();
      const value = { reference, knownLengthMm: Number(length) };
      if (calibrationScale(value) === undefined) { setError('Enter a finite length greater than zero in millimetres.'); return; }
      onApply(value);
    }}>
      <h2 id="calibration-title">Calibrate radiograph</h2>
      <p>{imageName}</p>
      <p>Enter the actual length of the structure marked by the reference line. All measurements on this radiograph will use this scale.</p>
      <label htmlFor="known-length">Known length (mm)</label>
      <input ref={input} id="known-length" type="number" step="any" min="0" value={length} onChange={event => { setLength(event.target.value); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'calibration-error' : undefined} />
      {error && <p id="calibration-error" role="alert">{error}</p>}
      <p>Lengths are estimates based on this reference. Calibration lasts for this viewing session.</p>
      <div className="patient-dialog-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="submit" className="primary">Apply calibration</button></div>
    </form>
  </dialog>;
}
