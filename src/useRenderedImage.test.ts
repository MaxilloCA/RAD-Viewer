// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OpenImage, Recipe, RenderInfo } from './model';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { useRenderedImage } from './useRenderedImage';

const recipe: Recipe = { version: 2, windowCenter: 2048, windowWidth: 4096, gamma: .5, denoise: 0, clahe: .12, localContrast: .4, sharpen: 6, radius: 2.2, threshold: .0015, halo: .35, detailMode: 'radiograph', invert: false, colorize: false };
const render = (id: string, requestId = 0, preview = false): RenderInfo => ({ id, requestId, preview, url: `${id}/${requestId}`, histogram: [1], clippedLow: 0, clippedHigh: 0, renderMs: 1 });
const image = (id: string): OpenImage => ({ info: { id, width: 1500, height: 1000, neutral: recipe, decodeMs: 1, metadata: { name: id, format: 'DICOM', bitsStored: 12, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0, windowCenter: null, windowWidth: null, min: 0, max: 4095 } }, path: id, initial: render(id), initialRecipe: recipe, defaultRecipe: recipe, history: { past: [], present: recipe, future: [] } });
type Pending = { args: { id: string; requestId: number; preview: boolean; recipe: Recipe }; resolve: (value: RenderInfo) => void; reject: (error: Error) => void };
let pending: Pending[];
beforeEach(() => {
  pending = [];
  mocks.invoke.mockReset().mockImplementation((_command, args) => new Promise<RenderInfo>((resolve, reject) => pending.push({ args, resolve, reject })));
});
afterEach(cleanup);
const complete = async (i: number) => act(async () => { const { args, resolve } = pending[i]; resolve(render(args.id, args.requestId, args.preview)); await Promise.resolve(); });

it('does not mistake the initial frame for a recipe edited before mounting', async () => {
  const active = image('one');
  active.history = { ...active.history, present: { ...recipe, gamma: .8 } };
  const { result } = renderHook(() => useRenderedImage(active, active.history.present, vi.fn()));
  expect(pending).toHaveLength(1);
  expect(pending[0].args.recipe.gamma).toBe(.8);
  await complete(0);
  expect(result.current.processing).toBe(false);
});

it('reuses the exact edited frame when returning to a still-loaded image', async () => {
  const first = image('one'); const second = image('two');
  const edited = { ...recipe, gamma: .6 };
  const { result, rerender } = renderHook(({ active, value }) => useRenderedImage(active, value, vi.fn()), { initialProps: { active: first, value: edited } });
  await complete(0);
  const exact = result.current.rendered;
  rerender({ active: second, value: recipe });
  rerender({ active: first, value: edited });
  expect(pending).toHaveLength(1);
  expect(result.current.rendered).toBe(exact);
});

it('coalesces drag positions, removes the 100ms throttle, and refines the final recipe after release', async () => {
  const active = image('one'); const error = vi.fn();
  const { result, rerender } = renderHook(({ value, interactive }) => useRenderedImage(active, value, error, interactive), { initialProps: { value: recipe, interactive: false } });
  expect(pending).toHaveLength(0);
  rerender({ value: { ...recipe, gamma: .6 }, interactive: true });
  expect(pending).toHaveLength(1); expect(pending[0].args.preview).toBe(true);
  rerender({ value: { ...recipe, gamma: .7 }, interactive: true });
  rerender({ value: { ...recipe, gamma: .8 }, interactive: true });
  expect(pending).toHaveLength(1);
  await complete(0);
  expect(pending).toHaveLength(2); expect(pending[1].args.recipe.gamma).toBe(.8);
  expect(result.current.rendered?.preview).toBe(true);
  rerender({ value: { ...recipe, gamma: .8 }, interactive: false });
  await complete(1);
  expect(pending).toHaveLength(3); expect(pending[2].args.preview).toBe(false);
  expect(pending[2].args.recipe.gamma).toBe(.8);
  await complete(2);
  expect(result.current.processing).toBe(false); expect(result.current.rendered?.preview).toBe(false);
  expect(error).not.toHaveBeenCalled();
});

it('never caches a draft as the full-resolution result, even with the same recipe', async () => {
  const active = image('one'); const changed = { ...recipe, windowCenter: 2020 };
  const { result, rerender } = renderHook(({ interactive }) => useRenderedImage(active, changed, vi.fn(), interactive), { initialProps: { interactive: true } });
  await complete(0);
  expect(result.current.rendered?.preview).toBe(true);
  rerender({ interactive: false });
  expect(pending).toHaveLength(2); expect(pending[1].args.preview).toBe(false);
  await complete(1);
  rerender({ interactive: true });
  expect(pending).toHaveLength(2); expect(result.current.rendered?.preview).toBe(false);
});

it('does not flash back to the initial image between preview results', async () => {
  const active = image('one');
  const { result, rerender } = renderHook(({ value }) => useRenderedImage(active, value, vi.fn(), true), { initialProps: { value: { ...recipe, gamma: .6 } } });
  await complete(0);
  const previewUrl = result.current.rendered?.url;
  rerender({ value: { ...recipe, gamma: .65 } });
  expect(result.current.rendered?.url).toBe(previewUrl);
  await complete(1);
});

it('rejects stale previews on image change and drains only the current image', async () => {
  const first = image('one'); const second = image('two');
  const { result, rerender } = renderHook(({ active }) => useRenderedImage(active, { ...recipe, gamma: .6 }, vi.fn(), true), { initialProps: { active: first } });
  rerender({ active: second });
  expect(result.current.rendered?.id).toBe('two');
  await complete(0);
  expect(result.current.rendered?.id).toBe('two'); expect(pending[1].args.id).toBe('two');
  await complete(1);
  expect(result.current.rendered?.id).toBe('two');
});

it('ignores a failed stale preview and still renders the final committed recipe', async () => {
  const active = image('one'); const error = vi.fn(); const value = { ...recipe, gamma: .6 };
  const { result, rerender } = renderHook(({ interactive }) => useRenderedImage(active, value, error, interactive), { initialProps: { interactive: true } });
  rerender({ interactive: false });
  await act(async () => { pending[0].reject(new Error('superseded')); await Promise.resolve(); });
  expect(error).not.toHaveBeenCalled(); expect(pending[1].args.preview).toBe(false);
  await complete(1);
  expect(result.current.processing).toBe(false);
});

it('does not schedule more work after unmount', async () => {
  const active = image('one'); const error = vi.fn();
  const { rerender, unmount } = renderHook(({ value }) => useRenderedImage(active, value, error, true), { initialProps: { value: { ...recipe, gamma: .6 } } });
  rerender({ value: { ...recipe, gamma: .7 } });
  unmount(); await complete(0);
  expect(pending).toHaveLength(1); expect(error).not.toHaveBeenCalled();
});
