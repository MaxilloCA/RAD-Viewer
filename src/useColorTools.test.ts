// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGrayscalePreview, useReferencePicker } from './useColorTools';
import type { Recipe, RenderInfo } from './model';
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ipc);
const recipe: Recipe = { version: 2, windowCenter: 128, windowWidth: 256, gamma: .5, denoise: 0, clahe: 0, localContrast: .4, sharpen: 6, radius: 2, threshold: .01, halo: .7, detailMode: 'radiograph', invert: false, colorize: true, colorMode: 'midtoneContrast', midtoneLevel: .5, midtoneWidth: .15, colorStrength: .4 };
beforeEach(() => { ipc.invoke.mockReset(); });
afterEach(cleanup);

it('samples a source patch once and drops results when the recipe or image changes', async () => {
  let resolve!: (n: number) => void;
  ipc.invoke.mockImplementation(() => new Promise<number>(done => { resolve = done; }));
  const apply = vi.fn(), error = vi.fn();
  const { result, rerender } = renderHook(({ context }) => useReferencePicker(context, error), { initialProps: { context: 'first recipe' } });
  act(() => result.current.toggle());
  let pending!: Promise<void>;
  act(() => { pending = result.current.sample('first', recipe, { x: 10.8, y: 30.2 }, apply); });
  expect(ipc.invoke).toHaveBeenCalledWith('sample_reference', { id: 'first', recipe, x: 10, y: 30 });
  rerender({ context: 'second recipe' });
  await act(async () => { resolve(.7); await pending; });
  expect(apply).not.toHaveBeenCalled();
  act(() => result.current.toggle());
  act(() => { pending = result.current.sample('second', recipe, { x: 0, y: 0 }, apply); });
  await act(async () => { resolve(.65); await pending; });
  expect(apply).toHaveBeenCalledExactlyOnceWith(.65);
});

it('cancels armed picking with Escape and releases temporary sources after a stale load', async () => {
  const apply = vi.fn(), dispose = vi.fn(async () => {});
  const { result, rerender } = renderHook(({ context }) => useReferencePicker(context, vi.fn()), { initialProps: { context: 'first' } });
  act(() => result.current.toggle());
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
  expect(result.current.picking).toBe(false);
  let loaded!: (source: { id: string; dispose: () => Promise<void> }) => void;
  const load = () => new Promise<{ id: string; dispose: () => Promise<void> }>(done => { loaded = done; });
  act(() => result.current.toggle());
  let pending!: Promise<void>;
  act(() => { pending = result.current.sample(load, recipe, { x: 2, y: 3 }, apply); });
  rerender({ context: 'changed' });
  await act(async () => { loaded({ id: 'temporary', dispose }); await pending; });
  expect(dispose).toHaveBeenCalledOnce(); expect(ipc.invoke).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
});

it('holds processed grayscale without mutating the recipe and restores immediately on release or blur', async () => {
  const frame = { id: 'one', url: 'gray' } as RenderInfo;
  ipc.invoke.mockResolvedValue(frame);
  const { result, rerender } = renderHook(({ id }) => useGrayscalePreview(id, recipe, vi.fn()), { initialProps: { id: 'one' } });
  act(() => result.current.setHeld(true));
  await waitFor(() => expect(result.current.render).toEqual(frame));
  expect(ipc.invoke).toHaveBeenCalledWith('render_snapshot', expect.objectContaining({ id: 'one', recipe: { ...recipe, colorStrength: 0 } }));
  expect(recipe.colorStrength).toBe(.4);
  act(() => window.dispatchEvent(new Event('blur')));
  expect(result.current.render).toBeNull();
  act(() => result.current.setHeld(true));
  rerender({ id: 'two' });
  expect(result.current.held).toBe(false); expect(result.current.render).toBeNull();
});

it('does not display a delayed grayscale response after release', async () => {
  let resolve!: (value: RenderInfo) => void;
  ipc.invoke.mockImplementation(() => new Promise<RenderInfo>(done => { resolve = done; }));
  const { result } = renderHook(() => useGrayscalePreview('one', recipe, vi.fn()));
  act(() => result.current.setHeld(true));
  act(() => result.current.setHeld(false));
  await act(async () => resolve({ id: 'one', url: 'late' } as RenderInfo));
  expect(result.current.render).toBeNull();
});
