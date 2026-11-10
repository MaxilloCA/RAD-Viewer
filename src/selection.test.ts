import { expect, it } from 'vitest';
import { contrastValue, toneValue, withContrast, withTone } from './model';
import type { ImageInfo, Recipe } from './model';
import { transferChanges, transferRecipe } from './selection';

const base: Recipe = { version: 2, windowCenter: 128, windowWidth: 256, gamma: .5, denoise: 0, localContrast: 0, clahe: 0, sharpen: 6, radius: 2, threshold: .01, halo: .7, detailMode: 'radiograph', invert: false, colorize: false };
const info = (neutral: Recipe, photometric = 'MONOCHROME2') => ({ neutral, metadata: { photometric } }) as ImageInfo;
it('transfers displayed tone and contrast across different detector ranges and polarities', () => {
  const source = info(base), target = info({ ...base, windowCenter: 2048, windowWidth: 4096 }, 'MONOCHROME1');
  const value = withTone(withContrast(base, base, 20), base, 65);
  const converted = transferRecipe(value, source, target);
  expect(toneValue(converted, target.neutral, 'MONOCHROME1')).toBeCloseTo(65);
  expect(contrastValue(converted, target.neutral)).toBeCloseTo(20);
  expect(converted.windowCenter).not.toBe(value.windowCenter);
});
it('changes only the edited controls and respects each target inversion', () => {
  const source = info(base), target = info({ ...base, windowCenter: 2048, windowWidth: 4096 });
  const original = { ...target.neutral, gamma: .3, denoise: .8, invert: true };
  const result = transferChanges(base, withTone(base, base, 50), source, original, target);
  expect(toneValue(result, target.neutral)).toBeCloseTo(50);
  expect(result.gamma).toBe(.3); expect(result.denoise).toBe(.8); expect(result.invert).toBe(true);
});
