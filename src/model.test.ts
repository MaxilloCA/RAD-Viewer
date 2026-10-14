import { describe, expect, it } from 'vitest';
import { commit, experimentalPreset, redo, sourcePixelScale, undo } from './model';
import type { Recipe } from './model';

const neutral: Recipe = { version: 1, windowCenter: 2048, windowWidth: 4096, gamma: 1, denoise: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false };
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
    expect(experimentalPreset('detail', neutral).detailMode).toBe('multiscale');
  });
});
