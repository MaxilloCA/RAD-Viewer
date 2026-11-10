import { contrastValue, toneValue, withContrast, withTone } from './model';
import type { ImageInfo, Recipe } from './model';

// Window values are detector-specific. Transfer displayed tone/contrast instead
// of copying raw DICOM intensity values between selected images.
export function transferRecipe(value: Recipe, source: ImageInfo, target: ImageInfo): Recipe {
  const sourceBase = source.suggested ?? source.neutral;
  const targetBase = target.suggested ?? target.neutral;
  return withTone(withContrast(value, targetBase, contrastValue(value, sourceBase)), targetBase,
    toneValue(value, sourceBase, source.metadata.photometric), target.metadata.photometric);
}

export function transferChanges(before: Recipe, after: Recipe, source: ImageInfo, current: Recipe, target: ImageInfo): Recipe {
  const result = { ...current };
  for (const key of Object.keys(after) as (keyof Recipe)[]) {
    if (key !== 'windowCenter' && key !== 'windowWidth' && after[key] !== before[key]) Object.assign(result, { [key]: after[key] });
  }
  const sourceBase = source.suggested ?? source.neutral;
  const targetBase = target.suggested ?? target.neutral;
  if (after.windowCenter !== before.windowCenter) result.windowCenter = withTone(result, targetBase, toneValue(after, sourceBase, source.metadata.photometric), target.metadata.photometric).windowCenter;
  if (after.windowWidth !== before.windowWidth) result.windowWidth = withContrast(result, targetBase, contrastValue(after, sourceBase)).windowWidth;
  return result;
}
