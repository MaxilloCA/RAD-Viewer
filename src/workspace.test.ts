import { describe, expect, it } from 'vitest';
import { reconcilePaneOrder, regionBetween, sourcePoint, swapPanes, zoomAt } from './workspace';

describe('source-coordinate workspace navigation', () => {
  it.each([.025, .2, 1, 8])('anchors wheel zoom under the pointer at scale %s, including limits', scale => {
    const view = { scale, x: 70, y: -40, fit: false };
    const offset = { x: 180, y: -90 };
    for (const factor of [.1, .8, 1.5, 20]) {
      const next = zoomAt(view, factor, offset);
      expect(offset.x / next.scale - next.x).toBeCloseTo(offset.x / scale - view.x);
      expect(offset.y / next.scale - next.y).toBeCloseTo(offset.y / scale - view.y);
      expect(next.scale).toBeGreaterThanOrEqual(.025); expect(next.scale).toBeLessThanOrEqual(8);
      expect(next.fit).toBe(false);
    }
  });
  it.each([0, 1, 2, 3])('maps drawings back onto source pixels after %s rotations and pan/zoom', turns => {
    const view = { scale: .75, x: 33, y: -27, fit: false };
    const original = { x: 170, y: 235 }, width = 1200, height = 900;
    const x = original.x - width / 2, y = original.y - height / 2;
    const [rx, ry] = [[x, y], [-y, x], [-x, -y], [y, -x]][turns];
    const point = sourcePoint({ x: (rx + view.x) * view.scale, y: (ry + view.y) * view.scale }, view, width, height, turns);
    expect(point.x).toBeCloseTo(original.x); expect(point.y).toBeCloseTo(original.y);
  });
  it('supports reverse drawing and clamps to source bounds', () => {
    expect(regionBetween({ x: 80, y: 90 }, { x: 30, y: 40 })).toEqual({ x: 30, y: 40, width: 50, height: 50 });
    expect(sourcePoint({ x: 9999, y: -9999 }, { scale: 1, x: 0, y: 0, fit: false }, 1200, 900, 0)).toEqual({ x: 1200, y: 0 });
  });
  it('swaps without duplicates and keeps the working slot when a thumbnail changes', () => {
    const order = swapPanes(['pinned-a', 'pinned-b', 'working'], 'pinned-a', 'working');
    expect(order).toEqual(['working', 'pinned-b', 'pinned-a']);
    expect(reconcilePaneOrder(order, ['pinned-a', 'pinned-b', 'next-image'])).toEqual(['next-image', 'pinned-b', 'pinned-a']);
    expect(reconcilePaneOrder(order, ['pinned-a', 'working'])).toEqual(['working', 'pinned-a']);
    expect(swapPanes(order, 'missing', 'working')).toBe(order);
  });
});
