import type { ImageEntry } from './model';
import { formatImageDate } from './model';
export function groupByDate(images: ImageEntry[]) {
  const groups = new Map<string, { image: ImageEntry; index: number }[]>();
  images.forEach((image, index) => {
    const date = image.details?.metadata.imageDate;
    const key = date && formatImageDate(date) !== 'Date unavailable' ? date : '';
    const group = groups.get(key);
    if (group) group.push({ image, index });
    else groups.set(key, [{ image, index }]);
  });
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => ({ date, label: date ? formatImageDate(date) : 'Date unavailable', items }));
}
