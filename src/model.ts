import type { Ellipse, ReviewOverlay } from './workspace';
export interface ImageAppearance { recipe: Recipe; rotationQuarterTurns: number; ellipses: Ellipse[]; overlay?: ReviewOverlay | null }
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
  midtoneLevel?: number | null;
  colorMode?: ColorMode | null;
  midtoneWidth?: number;
}
export type ColorMode = 'local' | 'midtone' | 'midtoneContrast';

/** The viewer uses one detail algorithm, including recipes restored from older versions. */
export const withRadiographDetail = (recipe: Recipe): Recipe => recipe.version === 2 && recipe.detailMode === 'radiograph'
  ? recipe : { ...recipe, version: 2, detailMode: 'radiograph' };
export const colorMode = (recipe: Recipe): ColorMode => recipe.colorMode ?? (recipe.midtoneLevel == null ? 'local' : 'midtone');
export const colorModeName = (recipe: Recipe) => ({ local: 'Local contrast color', midtone: 'Midtone highlight', midtoneContrast: 'Midtone Contrast' })[colorMode(recipe)];
export function withColorMode(recipe: Recipe, mode: ColorMode): Recipe {
  const entering = mode === 'midtoneContrast' && colorMode(recipe) !== mode;
  return { ...recipe, version: 2, colorMode: mode, midtoneLevel: mode === 'local' ? null : entering ? .5 : recipe.midtoneLevel ?? .5,
    midtoneWidth: entering ? .15 : recipe.midtoneWidth ?? .15, colorStrength: entering ? .4 : recipe.colorStrength ?? .8 };
}
export interface ImageMetadata {
  name: string; format: string; bitsStored: number; signed: boolean;
  photometric: string; slope: number; intercept: number;
  windowCenter: number | null; windowWidth: number | null; min: number; max: number;
  imageDate?: string | null; dateSource?: string | null;
}
export interface ImageInfo {
  id: string; width: number; height: number; metadata: ImageMetadata; neutral: Recipe; suggested?: Recipe; decodeMs: number;
  settingsKey?: string; sourceSha256?: string; savedAppearance?: ImageAppearance | null; settingsRevision?: string | null; settingsError?: string | null;
}
export interface RenderInfo {
  id: string; requestId: number; url: string; histogram: number[];
  clippedLow: number; clippedHigh: number; renderMs: number; preview?: boolean;
}
export interface History { past: Recipe[]; present: Recipe; future: Recipe[] }
export interface OpenImage { info: ImageInfo; path: string; initial: RenderInfo; initialRecipe: Recipe; defaultRecipe: Recipe; history: History }
export interface CustomPreset { name: string; recipe: Recipe }
export interface PatientDiscovery { patientNumber: string; patientName: string | null; firstName?: string | null; lastName?: string | null; directory: string; paths: string[]; latestDatePaths: string[]; warnings: string[] }
export type PatientIdentity = Pick<PatientDiscovery, 'patientNumber' | 'patientName' | 'firstName' | 'lastName' | 'directory'>;
export interface ImageEntry {
  key: string; path: string; name: string; patient?: PatientIdentity;
  image?: OpenImage; details?: ImageInfo; history?: History; defaultRecipe?: Recipe;
  thumbnail?: string; error?: string; lastUsed: number; rotationQuarterTurns: number;
  pinned?: boolean; pinPending?: boolean; pinError?: string; pinOrder?: number; pinnedRender?: RenderInfo;
  ellipses?: Ellipse[]; overlay?: ReviewOverlay; settingsKey?: string; settingsBlocked?: boolean;
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
export const sameRecipe = (a: Recipe, b: Recipe) => recipeKeys.every(key => a[key] === b[key]) && Boolean(a.colorize) === Boolean(b.colorize) && (a.colorStrength ?? .8) === (b.colorStrength ?? .8) && (a.colorScale ?? 8) === (b.colorScale ?? 8) && (a.midtoneLevel ?? null) === (b.midtoneLevel ?? null) && colorMode(a) === colorMode(b) && (a.midtoneWidth ?? .15) === (b.midtoneWidth ?? .15);
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Map actual values to slider positions, with the chosen default at the center. */
export function sliderPosition(value: number, min: number, middle: number, max: number): number {
  const bounded = clamp(value, min, max);
  return bounded <= middle ? 50 * (bounded - min) / (middle - min) : 50 + 50 * (bounded - middle) / (max - middle);
}
/** Preserve actual-value precision; any input step rounding belongs to the control. */
export function sliderValue(position: number, min: number, middle: number, max: number): number {
  const bounded = clamp(position, 0, 100);
  return bounded <= 50 ? min + bounded / 50 * (middle - min) : middle + (bounded - 50) / 50 * (max - middle);
}
const toneDirection = (recipe: Recipe, photometric: string) => (photometric === 'MONOCHROME1' ? -1 : 1) * (recipe.invert ? -1 : 1);
export const toneValue = (recipe: Recipe, base: Recipe, photometric = 'MONOCHROME2') => (base.windowCenter - recipe.windowCenter) / (base.windowWidth * .25) * 100 * toneDirection(recipe, photometric);
export const contrastValue = (recipe: Recipe, base: Recipe) => 100 * Math.log2(base.windowWidth / recipe.windowWidth);
export const withTone = (recipe: Recipe, base: Recipe, tone: number, photometric = 'MONOCHROME2'): Recipe => ({ ...recipe, windowCenter: base.windowCenter - clamp(tone, -100, 100) / 100 * base.windowWidth * .25 * toneDirection(recipe, photometric) });
export const defaultGamma = .35;
export const defaultContrast = -40;
export const withContrast = (recipe: Recipe, base: Recipe, contrast: number): Recipe => ({ ...recipe, windowWidth: Math.max(1, base.windowWidth * 2 ** (-clamp(contrast, -100, 100) / 100)) });
/** Discrete processing only: never change the per-image tone, gamma or color settings. */
export const processingLevels = [
  { sharpen: 0, contrast: 0, localContrast: 0, clahe: 0 },
  { sharpen: 2.5, contrast: -75, localContrast: .12, clahe: .04 },
  { sharpen: 4, contrast: -62.5, localContrast: .26, clahe: .08 },
  { sharpen: 6, contrast: -50, localContrast: .4, clahe: .12 },
  { sharpen: 7, contrast: -30, localContrast: .5, clahe: .18 },
  { sharpen: 8.5, contrast: -10, localContrast: .6, clahe: .24 },
  { sharpen: 10, contrast: 15, localContrast: .7, clahe: .3 },
  { sharpen: 11.5, contrast: 40, localContrast: .8, clahe: .36 },
] as const;

export const isDeletedPath = (path: string) => path.split(/[\\/]/).some(part => part.toUpperCase() === 'DELETED');
export interface DeleteResult { path: string; destination: string | null; error: string | null; warning: string | null }
export function withProcessingLevel(recipe: Recipe, base: Recipe, level: number): Recipe {
  const stop = clamp(Math.round(level), 0, 7);
  const { contrast, ...detail } = processingLevels[stop];
  return withContrast({ ...recipe, ...detail, ...(stop === 0 ? { denoise: 0 } : {}), version: 2, detailMode: 'radiograph', radius: 2.2, threshold: .0015, halo: .35 }, base, contrast);
}
export function processingLevel(recipe: Recipe, base: Recipe): { level: number; exact: boolean } {
  const distances = processingLevels.map((_, index) => {
    const candidate = withProcessingLevel(recipe, base, index);
    return Math.abs(contrastValue(recipe, base) - contrastValue(candidate, base)) / 100
      + Math.abs(recipe.sharpen - candidate.sharpen) / 10
      + Math.abs(recipe.localContrast - candidate.localContrast) + Math.abs(recipe.clahe - candidate.clahe);
  });
  const closest = distances.indexOf(Math.min(...distances));
  const candidate = withProcessingLevel(recipe, base, closest);
  return { level: closest, exact: (closest !== 0 || recipe.denoise === 0) && distances[closest] < 1e-8 && recipe.version === 2 && recipe.detailMode === candidate.detailMode && recipe.radius === candidate.radius && recipe.threshold === candidate.threshold && recipe.halo === candidate.halo };
}
/** Drag starts from a captured recipe; CSS-pixel distances do not depend on image zoom. */
export function dragAdjustment(start: Recipe, base: Recipe, dx: number, dy: number): Recipe {
  const contrasted = dx === 0 ? start : withContrast(start, base, contrastValue(start, base) + dx * .5);
  return dy === 0 ? contrasted : { ...contrasted, gamma: clamp(start.gamma - dy * .0025, .1, .9) };
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
export function experimentalPreset(name: string, neutral: Recipe, suggested: Recipe = neutral, photometric = 'MONOCHROME2'): Recipe {
  const enhanced: Recipe = { ...suggested, version: 2, detailMode: 'radiograph', denoise: 0, clahe: 0, colorize: false, colorStrength: .4, colorScale: 8, colorMode: 'midtoneContrast', midtoneLevel: .5, midtoneWidth: .15 };
  switch (name) {
    case 'low':
    case 'med':
    case 'high': {
      // Lower gamma darkens this pipeline: enhancement increases from Low to High.
      const settings = name === 'low'
        ? { gamma: .7, sharpen: 3, localContrast: .2, radius: 2.2, threshold: .0015, tone: 45, contrast: -75 }
        : name === 'high'
          ? { gamma: .22, sharpen: 8, localContrast: .5, radius: 2.5, threshold: .001, tone: 0, contrast: 0 }
          : { gamma: .5, sharpen: 6, localContrast: .4, radius: 2.2, threshold: .0015, tone: 35, contrast: -50 };
      const { tone, contrast, ...detail } = settings;
      return withTone(withContrast({ ...enhanced, ...detail, halo: .35 }, suggested, contrast), suggested, tone, photometric);
    }
    // Retain the previous helper names for callers restoring earlier presets.
    case 'bitewing': return { ...enhanced, gamma: .22, localContrast: 0.4, sharpen: 6, radius: 2.2, threshold: 0.0015, halo: 0.35 };
    case 'detail': return { ...enhanced, gamma: .22, localContrast: 0.35, sharpen: 8, radius: 2.5, threshold: 0.001, halo: 0.35 };
    default: return { ...neutral };
  }
}
