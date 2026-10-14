// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commit, undo } from './model';
import type { ImageInfo, PatientIdentity, Recipe, RenderInfo } from './model';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { DECODED_IMAGE_LIMIT, useImageLibrary } from './useImageLibrary';

const neutral: Recipe = { version: 1, windowCenter: 2048, windowWidth: 4096, gamma: 1, denoise: 0, localContrast: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false, colorize: false };
const patient = (patientNumber: string): PatientIdentity => ({ patientNumber, patientName: 'Synthetic Person', directory: 'C:\\Synthetic' });
const image = (path: string, id: string): ImageInfo => ({ id, width: 1200, height: 900, neutral, decodeMs: 1, metadata: { name: path, format: 'DICOM', bitsStored: 12, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0, windowCenter: null, windowWidth: null, min: 0, max: 4095 } });
let customInvoke: ((command: string, args: Record<string, unknown>) => Promise<unknown> | undefined) | undefined;
let live: Set<string>;
let maxLive: number;
let serial: number;
const imported: string[] = [];
const allocate = (path: string) => { const id = `source-${++serial}`; live.add(id); maxLive = Math.max(maxLive, live.size); return image(path, id); };
beforeEach(() => {
  live = new Set(); maxLive = 0; serial = 0; imported.length = 0; customInvoke = undefined;
  mocks.invoke.mockReset().mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    if (command === 'import_image') imported.push(String(args.path));
    const custom = customInvoke?.(command, args); if (custom) return custom;
    if (command === 'import_image') return Promise.resolve(allocate(String(args.path)));
    if (command === 'render_image') return Promise.resolve({ id: String(args.id), requestId: Number(args.requestId), url: `http://test.local/${args.id}.png`, histogram: [], clippedLow: 0, clippedHigh: 0, renderMs: 1 } satisfies RenderInfo);
    if (command === 'image_thumbnail') return Promise.resolve('data:image/png;base64,dGVzdA==');
    if (command === 'release_image') live.delete(String(args.id));
    return Promise.resolve(null);
  });
});
afterEach(cleanup);

describe('bounded patient image library', () => {
  it('keeps all 30 paths and real thumbnails while bounding decoded sources and preserving selection', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    const paths = Array.from({ length: 30 }, (_, index) => `synthetic-${index}.rvg`);
    act(() => result.current.append(paths, patient('00123')));
    expect(result.current.entries).toHaveLength(30);
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail?.startsWith('data:image/'))).toBe(true));
    expect(maxLive).toBeLessThanOrEqual(DECODED_IMAGE_LIMIT);
    expect(live.size).toBe(DECODED_IMAGE_LIMIT);
    expect(result.current.entries[0].image).toBeTruthy();
    expect(result.current.selectedKey).toBe(result.current.entries[0].key);
    expect(imported).toEqual(paths);
  });
  it('restores adjusted recipes and undo history after eviction and reimport', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['edited.rvg']));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    const editedKey = result.current.entries[0].key;
    const firstId = result.current.entries[0].image!.info.id;
    act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .44 })));
    act(() => result.current.append(Array.from({ length: 12 }, (_, index) => `extra-${index}.rvg`)));
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
    expect(result.current.entries[0].image).toBeUndefined();
    expect(live.has(firstId)).toBe(false);
    act(() => result.current.select(editedKey));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries[0].image!.info.id).not.toBe(firstId);
    expect(result.current.entries[0].history!.present.gamma).toBe(.44);
    const lastRender = mocks.invoke.mock.calls.filter(([command]) => command === 'render_image').at(-1);
    expect(lastRender?.[1].recipe.gamma).toBe(.44);
    act(() => result.current.changeHistory(undo));
    expect(result.current.entries[0].history!.present.gamma).toBe(.22);
  });
  it('prioritizes a newly selected path after the in-flight background preview completes', async () => {
    let finish!: (value: ImageInfo) => void;
    customInvoke = (command, args) => command === 'import_image' && args.path === 'second.rvg' ? new Promise(resolve => { finish = resolve; }) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['first.rvg', 'second.rvg', 'third.rvg', 'last.rvg']));
    await waitFor(() => expect(finish).toBeTruthy());
    act(() => result.current.select(result.current.entries[3].key));
    await act(async () => finish(allocate('second.rvg')));
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
    expect(imported).toEqual(['first.rvg', 'second.rvg', 'last.rvg', 'third.rvg']);
    expect(result.current.entries.find(entry => entry.key === result.current.selectedKey)?.path).toBe('last.rvg');
  });
  it('rejects and releases an old patient import completing after replacement', async () => {
    let finish!: (value: ImageInfo) => void;
    customInvoke = (command, args) => command === 'import_image' && args.path === 'old-pending.rvg' ? new Promise(resolve => { finish = resolve; }) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['old-first.rvg', 'old-pending.rvg'], patient('00123')));
    await waitFor(() => expect(finish).toBeTruthy());
    await act(async () => result.current.replace(['new.rvg'], patient('00456')));
    expect(result.current.entries.map(entry => entry.path)).toEqual(['new.rvg']);
    const old = allocate('old-pending.rvg');
    await act(async () => finish(old));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries[0].patient?.patientNumber).toBe('00456');
    expect(live.has(old.id)).toBe(false);
    expect(mocks.invoke.mock.calls.some(([command, args]) => command === 'render_image' && args.id === old.id)).toBe(false);
  });
  it('does not append an older patient replacement after delayed release', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['initial.rvg']));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    let finish!: () => void;
    customInvoke = (command, args) => command === 'release_image' ? new Promise(resolve => { finish = () => { live.delete(String(args.id)); resolve(null); }; }) : undefined;
    let older!: Promise<void>;
    act(() => { older = result.current.replace(['older.rvg'], patient('00123')); });
    await act(async () => result.current.replace(['newer.rvg'], patient('00456')));
    await act(async () => { finish(); await older; });
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries.map(entry => entry.path)).toEqual(['newer.rvg']);
    expect(result.current.entries[0].patient?.patientNumber).toBe('00456');
    customInvoke = undefined;
  });
  it('hides an evicted source before release settles and reloads it if selected', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(Array.from({ length: 8 }, (_, i) => `initial-${i}.rvg`)));
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
    const victim = result.current.entries[0];
    let finish!: () => void;
    customInvoke = (command, args) => command === 'release_image' && args.id === victim.image?.info.id ? new Promise(resolve => { finish = () => { live.delete(String(args.id)); resolve(null); }; }) : undefined;
    act(() => result.current.append(['new.rvg']));
    await waitFor(() => expect(finish).toBeTruthy());
    expect(result.current.entries[0].image).toBeUndefined();
    act(() => result.current.select(victim.key));
    await act(async () => finish());
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries[0].image!.info.id).not.toBe(victim.image!.info.id);
    expect(result.current.selectedKey).toBe(victim.key);
    expect(maxLive).toBeLessThanOrEqual(DECODED_IMAGE_LIMIT);
    customInvoke = undefined;
  });
});
