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
  colorize: boolean;
  colorStrength?: number;
  colorScale?: number;
}
export interface ImageMetadata {
  name: string; format: string; bitsStored: number; signed: boolean;
  photometric: string; slope: number; intercept: number;
  windowCenter: number | null; windowWidth: number | null; min: number; max: number;
  imageDate?: string | null; dateSource?: string | null;
}
export interface ImageInfo {
  id: string; width: number; height: number; metadata: ImageMetadata; neutral: Recipe; suggested?: Recipe; decodeMs: number;
}
export interface RenderInfo {
  id: string; requestId: number; url: string; histogram: number[];
  clippedLow: number; clippedHigh: number; renderMs: number;
}
export interface History { past: Recipe[]; present: Recipe; future: Recipe[] }
export interface OpenImage { info: ImageInfo; path: string; initial: RenderInfo; defaultRecipe: Recipe; history: History }
export interface CustomPreset { name: string; recipe: Recipe }
export interface PatientDiscovery { patientNumber: string; patientName: string | null; directory: string; paths: string[]; warnings: string[] }
export type PatientIdentity = Pick<PatientDiscovery, 'patientNumber' | 'patientName' | 'directory'>;
export interface ImageEntry {
  key: string; path: string; name: string; patient?: PatientIdentity;
  image?: OpenImage; details?: ImageInfo; history?: History; defaultRecipe?: Recipe;
  thumbnail?: string; error?: string; lastUsed: number; rotationQuarterTurns: number;
  pinned?: boolean; pinPending?: boolean; pinError?: string; pinOrder?: number; pinnedRender?: RenderInfo;
}
/** Calendar-only parsing: no local timezone conversion or inferred acquisition date. */
export function formatImageDate(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return 'Date unavailable';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!year || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return 'Date unavailable';
  return `${match[3]}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]}-${match[1]}`;
}
export const orientedDimensions = (width: number, height: number, turns: number) => turns % 2 ? { width: height, height: width } : { width, height };
export const dateSourceLabel = (source?: string | null): string => ({ AcquisitionDateTime: 'Acquisition date/time', AcquisitionDate: 'Acquisition date', ContentDate: 'Image content date', StudyDate: 'Study date', SeriesDate: 'Series date' }[source ?? ''] ?? source ?? 'No acquisition date metadata');
const recipeKeys: (keyof Recipe)[] = ['version', 'windowCenter', 'windowWidth', 'gamma', 'denoise', 'localContrast', 'clahe', 'sharpen', 'radius', 'threshold', 'halo', 'detailMode', 'invert'];
export const sameRecipe = (a: Recipe, b: Recipe) => recipeKeys.every(key => a[key] === b[key]) && Boolean(a.colorize) === Boolean(b.colorize) && (a.colorStrength ?? .8) === (b.colorStrength ?? .8) && (a.colorScale ?? 8) === (b.colorScale ?? 8);
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toneDirection = (recipe: Recipe, photometric: string) => (photometric === 'MONOCHROME1' ? -1 : 1) * (recipe.invert ? -1 : 1);
export const toneValue = (recipe: Recipe, base: Recipe, photometric = 'MONOCHROME2') => (base.windowCenter - recipe.windowCenter) / (base.windowWidth * .25) * 100 * toneDirection(recipe, photometric);
export const contrastValue = (recipe: Recipe, base: Recipe) => 100 * Math.log2(base.windowWidth / recipe.windowWidth);
export const withTone = (recipe: Recipe, base: Recipe, tone: number, photometric = 'MONOCHROME2'): Recipe => ({ ...recipe, windowCenter: base.windowCenter - clamp(tone, -100, 100) / 100 * base.windowWidth * .25 * toneDirection(recipe, photometric) });
export const withContrast = (recipe: Recipe, base: Recipe, contrast: number): Recipe => ({ ...recipe, windowWidth: Math.max(1, base.windowWidth * 2 ** (-clamp(contrast, -100, 100) / 100)) });
/** Drag starts from a captured recipe; CSS-pixel distances do not depend on image zoom. */
export function dragAdjustment(start: Recipe, base: Recipe, dx: number, dy: number, photometric = 'MONOCHROME2'): Recipe {
  const toned = dx === 0 ? start : withTone(start, base, toneValue(start, base, photometric) + dx * .5, photometric);
  return dy === 0 ? toned : { ...toned, gamma: clamp(start.gamma - dy * .0025, .1, .9) };
}
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
  const enhanced = { ...suggested, version: 2, detailMode: 'radiograph', denoise: 0, clahe: 0, colorize: false, colorStrength: .8, colorScale: 8 };
  switch (name) {
    case 'bitewing': return { ...enhanced, gamma: .22, localContrast: 0.4, sharpen: 6, radius: 2.2, threshold: 0.0015, halo: 0.35 };
    case 'detail': return { ...enhanced, gamma: .22, localContrast: 0.35, sharpen: 8, radius: 2.5, threshold: 0.001, halo: 0.35 };
    default: return { ...neutral };
  }
}
