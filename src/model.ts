export interface Recipe {
  version: number;
  windowCenter: number;
  windowWidth: number;
  gamma: number;
  denoise: number;
  clahe: number;
  sharpen: number;
  radius: number;
  threshold: number;
  halo: number;
  detailMode: string;
  invert: boolean;
}
export interface ImageMetadata {
  name: string; format: string; bitsStored: number; signed: boolean;
  photometric: string; slope: number; intercept: number;
  windowCenter: number | null; windowWidth: number | null; min: number; max: number;
}
export interface ImageInfo {
  id: string; width: number; height: number; metadata: ImageMetadata; neutral: Recipe; decodeMs: number;
}
export interface RenderInfo {
  id: string; requestId: number; url: string; histogram: number[];
  clippedLow: number; clippedHigh: number; renderMs: number;
}
export interface History { past: Recipe[]; present: Recipe; future: Recipe[] }
export interface OpenImage { info: ImageInfo; path: string; neutral: RenderInfo; history: History }
export interface CustomPreset { name: string; recipe: Recipe }
export interface ReferenceNotes {
  preset: string; sharpness: string; orientation: string; zoom: string; appearanceConfirmed: boolean;
}
export const sameRecipe = (a: Recipe, b: Recipe) => JSON.stringify(a) === JSON.stringify(b);
/** CSS scale at which one source pixel occupies one physical display pixel. */
export function sourcePixelScale(devicePixelRatio: number): number {
  return 1 / (Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1);
}
export function commit(history: History, recipe: Recipe): History {
  if (sameRecipe(history.present, recipe)) return history;
  return { past: [...history.past, history.present].slice(-100), present: recipe, future: [] };
}
export function undo(history: History): History {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] };
}
export function redo(history: History): History {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
export function experimentalPreset(name: string, neutral: Recipe): Recipe {
  switch (name) {
    case 'bitewing': return { ...neutral, gamma: 0.94, clahe: 0.2, sharpen: 0.65, radius: 1.5, threshold: 0.016, halo: 0.8 };
    case 'endo': return { ...neutral, gamma: 0.88, clahe: 0.28, sharpen: 0.5, radius: 2.2, threshold: 0.018, halo: 0.85 };
    case 'detail': return { ...neutral, sharpen: 0.65, radius: 1.4, threshold: 0.02, halo: 0.85, detailMode: 'multiscale' };
    default: return { ...neutral };
  }
}
