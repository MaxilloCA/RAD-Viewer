import { colorMode } from './model';
import type { ColorMode, Recipe } from './model';

export default function ColorControls({ recipe, prefix = '', onChange, onCommit, onMode, onPick, picking, onHold, held, busy }: {
  recipe: Recipe; prefix?: string; onChange: (patch: Partial<Recipe>) => void; onCommit: () => void;
  onMode: (mode: ColorMode) => void; onPick: () => void; picking: boolean;
  onHold: (held: boolean) => void; held: boolean; busy: boolean;
}) {
  const mode = colorMode(recipe);
  const slider = (label: string, value: number, min: number, max: number, step: number, text: string, change: (n: number) => void) =>
    <label className="slider-control"><span>{label}<output>{text}</output></span>
      <input aria-label={`${prefix}${label}`} aria-valuenow={value} aria-valuetext={text} type="range" min={min} max={max} step={step} value={value}
        onChange={event => change(Number(event.target.value))} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit}/>
    </label>;
  return <div className="local-color-controls">
    <label className="select-control">Color mode<select aria-label={`${prefix}Color mode`} value={mode} onChange={event => onMode(event.target.value as ColorMode)}>
      <option value="midtoneContrast">Midtone Contrast</option><option value="midtone">Midtone highlight</option>{mode === 'local' && <option value="local" disabled>Saved legacy color</option>}
    </select></label>
    {slider('Color amount', recipe.colorStrength ?? .8, 0, 1, .01, `${Math.round((recipe.colorStrength ?? .8) * 100)}%`, colorStrength => onChange({ colorStrength }))}
    {mode !== 'local' && slider(mode === 'midtoneContrast' ? 'Midtone center' : 'Midtone level', recipe.midtoneLevel ?? .5, .05, .95, .01,
      `${Math.round((recipe.midtoneLevel ?? .5) * 100)}%`, midtoneLevel => onChange({ midtoneLevel }))}
    {mode === 'midtoneContrast' && <>
      {slider('Sensitivity', 32 - Math.round((recipe.midtoneWidth ?? .15) * 100), 2, 30, 1,
        `±${Math.round((recipe.midtoneWidth ?? .15) * 100)} points`, value => onChange({ midtoneWidth: (32 - value) / 100 }))}
      <button type="button" aria-label={`${prefix}Pick reference`} aria-pressed={picking} onClick={onPick}>{picking ? 'Click image · Esc cancels' : 'Pick reference'}</button>
      <div className="color-legend midtone-contrast-legend" aria-label="Midtone Contrast legend"><div className="midtone-contrast-strip"/><div className="histogram-scale"><span>Darker</span><span>Reference</span><span>Lighter</span></div><p>Color represents image intensity around the reference, not measured mineral density.</p></div>
    </>}
    {mode === 'midtone' && <p className="control-note">Amber highlights the selected tonal range after enhancement.</p>}
    <button type="button" className="compare-button" aria-label={`${prefix}Hold for grayscale`} aria-pressed={held}
      onPointerDown={event => { if (event.button !== 0) return; onCommit(); event.currentTarget.setPointerCapture(event.pointerId); onHold(true); }}
      onPointerUp={() => onHold(false)} onPointerCancel={() => onHold(false)} onLostPointerCapture={() => onHold(false)}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) { onCommit(); onHold(true); } } }}
      onKeyUp={() => onHold(false)} onBlur={() => onHold(false)}>{held ? busy ? 'Preparing grayscale…' : 'Grayscale · release to restore' : 'Hold for grayscale'}</button>
  </div>;
}
