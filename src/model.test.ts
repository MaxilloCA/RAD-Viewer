import { describe, expect, it } from 'vitest';
import { commit, contrastValue, dragAdjustment, experimentalPreset, formatImageDate, dateSourceLabel, orientedDimensions, redo, sameRecipe, sourcePixelScale, toneValue, undo, withContrast, withTone } from './model';
import type { Recipe } from './model';

const neutral: Recipe = { version: 1, windowCenter: 2048, windowWidth: 4096, gamma: 1, denoise: 0, localContrast: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false, colorize: false };
describe('non-destructive per-image adjustment history', () => {
  it('maps source pixels to physical display pixels on HiDPI displays', () => {
    expect(sourcePixelScale(2)).toBe(.5);
    expect(1200 * sourcePixelScale(2) * 2).toBe(1200);
    expect(sourcePixelScale(1.25) * 1.25).toBe(1);
    expect(sourcePixelScale(1)).toBe(1);
    expect(sourcePixelScale(0)).toBe(1);
  });
  it('restores recipes through undo/redo and clears redo when branching', () => {
    const initial = { past: [], present: neutral, future: [] };
    const edited = commit(initial, { ...neutral, gamma: .8 });
    expect(undo(edited).present).toEqual(neutral);
    expect(redo(undo(edited))).toEqual(edited);
    expect(commit(undo(edited), { ...neutral, gamma: 1.2 }).future).toEqual([]);
    expect(initial.present).toEqual(neutral);
  });
  it('does not record a no-op and bounds history', () => {
    let history = { past: [] as Recipe[], present: neutral, future: [] as Recipe[] };
    expect(commit(history, { ...neutral })).toBe(history);
    for (let i = 0; i < 120; i++) history = commit(history, { ...neutral, gamma: i + 2 });
    expect(history.past).toHaveLength(100);
  });
  it('keeps neutral spatial filters disabled and presets isolated', () => {
    const preset = experimentalPreset('bitewing', neutral);
    expect(preset.sharpen).toBeGreaterThan(0);
    expect(neutral.sharpen).toBe(0);
    expect(experimentalPreset('neutral', neutral)).toEqual(neutral);
    expect(experimentalPreset('detail', neutral).detailMode).toBe('radiograph');
    expect(experimentalPreset('detail', neutral).version).toBe(2);
  });
  it('uses the suggested window only for enhanced presets', () => {
    const suggested = { ...neutral, windowCenter: 2800, windowWidth: 1400, gamma: .38 };
    expect(experimentalPreset('neutral', neutral, suggested)).toEqual(neutral);
    expect(experimentalPreset('bitewing', neutral, suggested).windowCenter).toBe(2800);
    expect(experimentalPreset('detail', neutral, suggested).windowWidth).toBe(1400);
    expect(experimentalPreset('bitewing', neutral, suggested).gamma).toBe(.22);
    expect(experimentalPreset('bitewing', neutral).sharpen).toBe(6);
    expect(experimentalPreset('detail', neutral, suggested).gamma).toBe(.22);
    expect(experimentalPreset('detail', neutral).sharpen).toBe(8);
    expect(neutral.windowWidth).toBe(4096);
  });
  it('normalizes tone and contrast without changing source baseline', () => {
    const enhanced = experimentalPreset('bitewing', neutral);
    expect(withTone(enhanced, neutral, 100).windowCenter).toBe(1024);
    expect(toneValue(withTone(enhanced, neutral, 75), neutral)).toBe(75);
    expect(withContrast(enhanced, neutral, 100).windowWidth).toBe(2048);
    expect(withContrast(enhanced, neutral, -100).windowWidth).toBe(8192);
    expect(contrastValue(withContrast(enhanced, neutral, 40), neutral)).toBeCloseTo(40);
    expect(neutral.windowCenter).toBe(2048);
  });
  it('keeps rightward tone brighter for both polarities and inverted display', () => {
    const start = experimentalPreset('bitewing', neutral);
    expect(dragAdjustment(start, neutral, 100, 0, 'MONOCHROME2').windowCenter).toBeLessThan(start.windowCenter);
    expect(dragAdjustment(start, neutral, 100, 0, 'MONOCHROME1').windowCenter).toBeGreaterThan(start.windowCenter);
    expect(dragAdjustment({ ...start, invert: true }, neutral, 100, 0, 'MONOCHROME2').windowCenter).toBeGreaterThan(start.windowCenter);
    expect(dragAdjustment({ ...start, invert: true }, neutral, 100, 0, 'MONOCHROME1').windowCenter).toBeLessThan(start.windowCenter);
  });
  it('uses captured drag coordinates with bounded gamma and tone', () => {
    const start = experimentalPreset('bitewing', neutral);
    expect(dragAdjustment(start, neutral, 0, -80).gamma).toBeCloseTo(.42);
    expect(dragAdjustment(start, neutral, 0, -160).gamma).toBeCloseTo(.62);
    expect(dragAdjustment(start, neutral, 100000, -100000).gamma).toBe(.9);
    expect(dragAdjustment(start, neutral, -100000, 100000).gamma).toBe(.1);
    expect(toneValue(dragAdjustment(start, neutral, 100000, 0), neutral)).toBe(100);
    expect(toneValue(dragAdjustment(start, neutral, -100000, 0), neutral)).toBe(-100);
  });
  it('preserves legacy out-of-range values on an unmoved axis', () => {
    const legacy = { ...neutral, gamma: 1.2, windowCenter: neutral.windowCenter + neutral.windowWidth };
    expect(dragAdjustment(legacy, neutral, 0, 0)).toBe(legacy);
    expect(dragAdjustment(legacy, neutral, 50, 0).gamma).toBe(1.2);
    expect(dragAdjustment(legacy, neutral, 0, -50).windowCenter).toBe(legacy.windowCenter);
  });
  it('compares recipes independently of JSON property ordering', () => {
    const reordered = Object.fromEntries(Object.entries(neutral).reverse()) as unknown as Recipe;
    expect(sameRecipe(neutral, reordered)).toBe(true);
    expect(sameRecipe(neutral, { ...reordered, colorize: true })).toBe(false);
  });
});

describe('calendar dates and quarter-turn orientation', () => {
  it('formats strict calendar dates without timezones or inferred dates', () => {
    expect(formatImageDate('2026-04-08')).toBe('08-Apr-2026');
    expect(formatImageDate('2024-02-29')).toBe('29-Feb-2024');
    for (const invalid of [undefined, null, '', '2026-02-29', '2026-04-31', '0000-01-01', '2026-1-02', '2026-01-02T00:00:00Z', '2026-13-01']) expect(formatImageDate(invalid)).toBe('Date unavailable');
    expect(dateSourceLabel('ContentDate')).toBe('Image content date');
    expect(dateSourceLabel('AcquisitionDate')).toBe('Acquisition date');
    expect(dateSourceLabel(null)).toBe('No acquisition date metadata');
  });
  it('swaps fit dimensions only for odd quarter turns', () => {
    expect(orientedDimensions(1200, 900, 0)).toEqual({ width: 1200, height: 900 });
    expect(orientedDimensions(1200, 900, 1)).toEqual({ width: 900, height: 1200 });
    expect(orientedDimensions(1200, 900, 2)).toEqual({ width: 1200, height: 900 });
    expect(orientedDimensions(1200, 900, 3)).toEqual({ width: 900, height: 1200 });
  });
});

describe('local color recipe compatibility', () => {
  it('equates omitted color parameters with defaults while detecting overlay changes', () => {
    expect(sameRecipe(neutral, { ...neutral, colorStrength: .8, colorScale: 8 })).toBe(true);
    expect(sameRecipe(neutral, { ...neutral, colorStrength: .5 })).toBe(false);
    expect(sameRecipe(neutral, { ...neutral, colorScale: 12 })).toBe(false);
    expect(experimentalPreset('bitewing', neutral)).toMatchObject({ colorStrength: .8, colorScale: 8 });
    const legacy = { past: [], present: neutral, future: [] };
    expect(commit(legacy, { ...neutral, colorStrength: .8, colorScale: 8 })).toBe(legacy);
  });
});
