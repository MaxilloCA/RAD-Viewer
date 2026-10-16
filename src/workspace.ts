import { clamp } from './model';
import type { PaneView } from './ImagePane';

export type ImageTool = 'adjust' | 'pan' | 'magnify' | 'ellipse' | 'region';
export type Point = { x: number; y: number };
export type Region = { x: number; y: number; width: number; height: number };
export type Ellipse = Region & { color: 'red' | 'yellow' };
export type ReviewOverlay = { region: Region; url?: string; sensitivity: number; busy?: boolean; error?: string; visible: boolean };

/** Offset is relative to viewport centre, in CSS pixels. */
export function zoomAt(view: PaneView, factor: number, offset: Point): PaneView {
  const scale = clamp(view.scale * factor, .025, 8);
  return { ...view, fit: false, scale, x: view.x + offset.x * (1 / scale - 1 / view.scale), y: view.y + offset.y * (1 / scale - 1 / view.scale) };
}

/** Inverse of the display transform, independent of DPI and quarter-turn rotation. */
export function sourcePoint(offset: Point, view: PaneView, width: number, height: number, turns: number): Point {
  const x = offset.x / view.scale - view.x, y = offset.y / view.scale - view.y;
  const rotated = [{ x, y }, { x: y, y: -x }, { x: -x, y: -y }, { x: -y, y: x }][((turns % 4) + 4) % 4];
  return { x: clamp(rotated.x + width / 2, 0, width), y: clamp(rotated.y + height / 2, 0, height) };
}
export function regionBetween(a: Point, b: Point): Region {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Keep a working slot in place when another thumbnail replaces its image. */
export function reconcilePaneOrder(previous: string[], visible: string[]): string[] {
  const newcomers = visible.filter(key => !previous.includes(key));
  const result = previous.flatMap(key => visible.includes(key) ? [key] : newcomers.length ? [newcomers.shift()!] : []);
  return [...result, ...newcomers];
}
export function swapPanes(order: string[], a: string, b: string): string[] {
  const first = order.indexOf(a), second = order.indexOf(b);
  if (first < 0 || second < 0 || first === second) return order;
  const next = [...order]; [next[first], next[second]] = [next[second], next[first]]; return next;
}
