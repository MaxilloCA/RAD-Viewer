export interface Recipe {
  version: number;
  windowCenter: number;
  windowWidth: number;
  gamma: number;
  denoise: number;
  localContrast: number;
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
  id: string; width: number; height: number; metadata: ImageMetadata; neutral: Recipe; suggested?: Recipe; decodeMs: number;
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
export function experimentalPreset(name: string, neutral: Recipe, suggested: Recipe = neutral): Recipe {
  const enhanced = { ...suggested, version: 2, detailMode: 'radiograph', denoise: 0, clahe: 0 };
  switch (name) {
    case 'bitewing': return { ...enhanced, gamma: suggested.gamma, localContrast: 0.4, sharpen: 5, radius: 2.2, threshold: 0.0015, halo: 0.35 };
    case 'endo': return { ...enhanced, gamma: Math.min(5, suggested.gamma * 1.7), localContrast: 0.3, sharpen: 3.5, radius: 2, threshold: 0.002, halo: 0.5 };
    case 'detail': return { ...enhanced, gamma: Math.min(5, suggested.gamma * 1.05), localContrast: 0.35, sharpen: 6, radius: 2.5, threshold: 0.001, halo: 0.35 };
    default: return { ...neutral };
  }
}
