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
const snapshot = (args: Record<string, unknown>, suffix = ''): RenderInfo => ({ id: String(args.id), requestId: Number(args.requestId), url: `data:image/png;base64,${args.id}-${args.requestId}-${(args.recipe as Recipe).gamma}${suffix}`, histogram: [], clippedLow: 0, clippedHigh: 0, renderMs: 1 });
beforeEach(() => {
  live = new Set(); maxLive = 0; serial = 0; imported.length = 0; customInvoke = undefined;
  mocks.invoke.mockReset().mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    if (command === 'import_image') imported.push(String(args.path));
    const custom = customInvoke?.(command, args); if (custom) return custom;
    if (command === 'import_image') return Promise.resolve(allocate(String(args.path)));
    if (command === 'render_image') return Promise.resolve({ id: String(args.id), requestId: Number(args.requestId), url: `http://test.local/${args.id}.png`, histogram: [], clippedLow: 0, clippedHigh: 0, renderMs: 1 } satisfies RenderInfo);
    if (command === 'image_thumbnail') return Promise.resolve('data:image/png;base64,dGVzdA==');
    if (command === 'render_snapshot') return Promise.resolve(snapshot(args));
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
    act(() => result.current.rotate());
    act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .44 })));
    act(() => result.current.append(Array.from({ length: 12 }, (_, index) => `extra-${index}.rvg`)));
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
    expect(result.current.entries[0].image).toBeUndefined();
    expect(live.has(firstId)).toBe(false);
    act(() => result.current.select(editedKey));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries[0].image!.info.id).not.toBe(firstId);
    expect(result.current.entries[0].history!.present.gamma).toBe(.44);
    expect(result.current.entries[0].rotationQuarterTurns).toBe(1);
    const lastRender = mocks.invoke.mock.calls.filter(([command]) => command === 'render_image').at(-1);
    expect(lastRender?.[1].recipe.gamma).toBe(.44);
    act(() => result.current.changeHistory(undo));
    expect(result.current.entries[0].history!.present.gamma).toBe(.5);
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

  it('keeps twelve full-resolution pins after decoded eviction and restores the saved recipe', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    for (let index = 0; index < 12; index++) {
      act(() => result.current.append([`pin-${index}.rvg`], patient('00123')));
      await waitFor(() => expect(result.current.entries[index].image).toBeTruthy());
      act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .3 + index / 100 })));
      await act(async () => result.current.togglePin(result.current.entries[index].key));
    }
    expect(result.current.entries.every(entry => entry.pinned && entry.pinnedRender?.url.startsWith('data:image/png;base64,'))).toBe(true);
    expect(result.current.entries[0].image).toBeUndefined();
    expect(result.current.entries[0].pinnedRender?.url).not.toBe(result.current.entries[0].thumbnail);
    expect(maxLive).toBeLessThanOrEqual(DECODED_IMAGE_LIMIT);
    const first = result.current.entries[0];
    act(() => result.current.select(first.key));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries[0].image!.info.id).not.toBe(first.details!.id);
    expect(result.current.entries[0].history!.present.gamma).toBe(.3);
    expect(result.current.entries[0].pinnedRender).toEqual(first.pinnedRender);
    await act(async () => result.current.togglePin(result.current.entries[1].key));
    expect(result.current.entries[1].pinnedRender).toBeUndefined();
  });

  it('coalesces committed edits and refreshes an inactive pin without installing a stale frame', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['first.rvg', 'second.rvg']));
    await waitFor(() => expect(result.current.entries.every(entry => entry.image)).toBe(true));
    const key = result.current.entries[0].key;
    await act(async () => result.current.togglePin(key));
    const original = result.current.entries[0].pinnedRender;
    const calls: { args: Record<string, unknown>; finish: (value: RenderInfo) => void }[] = [];
    customInvoke = (command, args) => command === 'render_snapshot' ? new Promise(resolve => calls.push({ args, finish: resolve })) : undefined;
    act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .33 })));
    act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .44 })));
    act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .55 })));
    act(() => result.current.select(result.current.entries[1].key));
    expect(calls).toHaveLength(1);
    expect(result.current.entries[0].pinPending).toBe(true);
    expect(result.current.entries[0].pinnedRender).toEqual(original);
    await act(async () => calls[0].finish(snapshot(calls[0].args)));
    expect(calls).toHaveLength(2);
    expect((calls[1].args.recipe as Recipe).gamma).toBe(.55);
    expect(result.current.entries[0].pinnedRender).toEqual(original);
    await act(async () => calls[1].finish(snapshot(calls[1].args)));
    expect(result.current.entries[0].pinnedRender).toEqual(snapshot(calls[1].args));
    expect(result.current.entries[0].pinPending).toBe(false);
    await act(async () => result.current.refreshPinned(key));
    expect(calls).toHaveLength(2);
  });

  it('assigns pin order by pin actions and preserves it through refreshes', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['earlier.rvg', 'later.rvg']));
    await waitFor(() => expect(result.current.entries.every(entry => entry.image)).toBe(true));
    const [earlier, later] = result.current.entries;
    await act(async () => result.current.togglePin(later.key));
    await act(async () => result.current.togglePin(earlier.key));
    const order = result.current.entries.map(entry => entry.pinOrder!);
    expect(order[1]).toBeLessThan(order[0]);
    await act(async () => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .44 })));
    expect(result.current.entries.map(entry => entry.pinOrder)).toEqual(order);
    await act(async () => result.current.togglePin(later.key));
    expect(result.current.entries[1].pinOrder).toBeUndefined();
    await act(async () => result.current.togglePin(later.key));
    expect(result.current.entries[1].pinOrder).toBeGreaterThan(order[0]);
  });

  it('rotates a specified pane independently of selection and defaults to the selected pane', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['first.rvg', 'second.rvg']));
    await waitFor(() => expect(result.current.entries.every(entry => entry.image)).toBe(true));
    act(() => result.current.rotate(result.current.entries[1].key));
    expect(result.current.entries.map(entry => entry.rotationQuarterTurns)).toEqual([0, 1]);
    act(() => result.current.rotate());
    expect(result.current.entries.map(entry => entry.rotationQuarterTurns)).toEqual([1, 1]);
    expect(result.current.entries[0].defaultRecipe).toMatchObject({ gamma: .5, sharpen: 6 });
  });

  it('rejects cancelled pin generations when the same entry is pinned again', async () => {
    const calls: { args: Record<string, unknown>; finish: (value: RenderInfo) => void }[] = [];
    customInvoke = (command, args) => command === 'render_snapshot' ? new Promise(resolve => calls.push({ args, finish: resolve })) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['first.rvg']));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    const key = result.current.entries[0].key;
    act(() => { void result.current.togglePin(key); });
    await act(async () => result.current.togglePin(key));
    expect(result.current.entries[0].pinPending).toBe(false);
    act(() => { void result.current.togglePin(key); });
    expect(calls).toHaveLength(1);
    await act(async () => calls[0].finish(snapshot(calls[0].args, '-cancelled')));
    expect(calls).toHaveLength(2);
    expect(result.current.entries[0].pinnedRender).toBeUndefined();
    await act(async () => calls[1].finish(snapshot(calls[1].args)));
    expect(result.current.entries[0].pinnedRender).toEqual(snapshot(calls[1].args));
    expect(result.current.entries[0].pinned).toBe(true);
  });

  it('discards active and queued pins when the patient changes', async () => {
    const calls: { args: Record<string, unknown>; finish: (value: RenderInfo) => void }[] = [];
    customInvoke = (command, args) => command === 'render_snapshot' ? new Promise(resolve => calls.push({ args, finish: resolve })) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(['same.rvg', 'queued.rvg'], patient('00123')));
    await waitFor(() => expect(result.current.entries.every(entry => entry.image)).toBe(true));
    const oldKeys = result.current.entries.map(entry => entry.key);
    act(() => { for (const key of oldKeys) void result.current.togglePin(key); });
    expect(calls).toHaveLength(1);
    await act(async () => result.current.replace(['same.rvg'], patient('00456')));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    await act(async () => calls[0].finish(snapshot(calls[0].args)));
    expect(calls).toHaveLength(1);
    expect(result.current.entries[0].patient?.patientNumber).toBe('00456');
    expect(oldKeys).not.toContain(result.current.entries[0].key);
    expect(result.current.entries[0].pinnedRender).toBeUndefined();
  });

  it('protects queued latest recipes until captured while retaining the eight-source bound', async () => {
    const calls: { args: Record<string, unknown>; finish: (value: RenderInfo) => void }[] = [];
    customInvoke = (command, args) => command === 'render_snapshot' ? new Promise(resolve => calls.push({ args, finish: resolve })) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    act(() => result.current.append(Array.from({ length: 8 }, (_, index) => `pin-${index}.rvg`)));
    await waitFor(() => expect(result.current.entries.every(entry => entry.image)).toBe(true));
    const firstId = result.current.entries[0].image!.info.id;
    act(() => { for (const entry of result.current.entries) void result.current.togglePin(entry.key); });
    act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .44 })));
    act(() => result.current.append(['ninth.rvg']));
    expect(calls).toHaveLength(1);
    expect(imported).toHaveLength(8);
    await act(async () => calls[0].finish(snapshot(calls[0].args)));
    expect(calls[1].args.id).toBe(firstId);
    expect((calls[1].args.recipe as Recipe).gamma).toBe(.44);
    expect(live.has(firstId)).toBe(true);
    expect(imported).toHaveLength(8);
    await act(async () => calls[1].finish(snapshot(calls[1].args)));
    await waitFor(() => expect(result.current.entries[8].image).toBeTruthy());
    expect(live.has(firstId)).toBe(false);
    expect(result.current.entries[0].pinnedRender).toEqual(snapshot(calls[1].args));
    for (let index = 2; index < 9; index++) await act(async () => calls[index].finish(snapshot(calls[index].args)));
    expect(result.current.entries.slice(0, 8).every(entry => entry.pinned && !entry.pinPending)).toBe(true);
    expect(maxLive).toBeLessThanOrEqual(DECODED_IMAGE_LIMIT);
  });

  it('retains a visible failure marker and last good pin until a retry succeeds', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useImageLibrary(onError));
    act(() => result.current.append(['first.rvg']));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    const key = result.current.entries[0].key;
    await act(async () => result.current.togglePin(key));
    const original = result.current.entries[0].pinnedRender;
    customInvoke = command => command === 'render_snapshot' ? Promise.reject(new Error('Synthetic failure')) : undefined;
    await act(async () => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .44 })));
    expect(result.current.entries[0].pinError).toContain('Synthetic failure');
    expect(result.current.entries[0].pinnedRender).toEqual(original);
    expect(onError).toHaveBeenCalledOnce();
    customInvoke = undefined;
    await act(async () => result.current.refreshPinned(key));
    expect(result.current.entries[0].pinError).toBeUndefined();
    expect(result.current.entries[0].pinnedRender).not.toEqual(original);
  });

  it('discards snapshots after close/unmount and never overrides a selection made during close', async () => {
    let finishSnapshot!: (value: RenderInfo) => void;
    let snapshotArgs!: Record<string, unknown>;
    let finishRelease!: () => void;
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useImageLibrary(onError));
    act(() => result.current.append(['first.rvg', 'second.rvg', 'third.rvg']));
    await waitFor(() => expect(result.current.entries.every(entry => entry.image)).toBe(true));
    const [first, , third] = result.current.entries;
    customInvoke = (command, args) => {
      if (command === 'render_snapshot') { snapshotArgs = args; return new Promise(resolve => { finishSnapshot = resolve; }); }
      if (command === 'release_image' && args.id === first.image!.info.id) return new Promise(resolve => { finishRelease = () => { live.delete(String(args.id)); resolve(null); }; });
      return undefined;
    };
    act(() => { void result.current.togglePin(first.key); });
    let closing!: Promise<void>;
    act(() => { closing = result.current.close(); });
    act(() => result.current.select(third.key));
    await waitFor(() => expect(finishRelease).toBeTypeOf('function'));
    await act(async () => { finishRelease(); await closing; finishSnapshot(snapshot(snapshotArgs)); });
    expect(result.current.selectedKey).toBe(third.key);
    expect(result.current.entries.every(entry => !entry.pinnedRender)).toBe(true);
    act(() => { void result.current.togglePin(third.key); });
    unmount();
    await act(async () => finishSnapshot(snapshot(snapshotArgs)));
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('latest-day patient opening', () => {
  it('opens every latest-day image even beyond the decoded cache limit, leaving earlier dates in the library', async () => {
    const latest = Array.from({ length: 12 }, (_, i) => `latest-${i}.rvg`);
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace([...latest, 'older.rvg'], patient('00123'), latest));
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
    expect(result.current.entries.filter(entry => entry.pinned)).toHaveLength(11);
    expect(result.current.entries.slice(0, 11).every(entry => entry.pinnedRender)).toBe(true);
    expect(result.current.selectedKey).toBe(result.current.entries[11].key);
    expect(result.current.entries[12].pinned).not.toBe(true);
    expect(maxLive).toBeLessThanOrEqual(DECODED_IMAGE_LIMIT);
  });

  it('retains enhancement edits made while a pinned source is reloading', async () => {
    const latest = Array.from({ length: 10 }, (_, i) => `latest-${i}.rvg`);
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(latest, patient('00123'), latest));
    await waitFor(() => expect(result.current.entries.filter(entry => entry.pinned)).toHaveLength(9));
    const first = result.current.entries[0];
    expect(first.image).toBeUndefined();
    let finish!: (value: ImageInfo) => void;
    customInvoke = (command, args) => command === 'import_image' && args.path === first.path ? new Promise(resolve => { finish = resolve; }) : undefined;
    act(() => result.current.select(first.key));
    await waitFor(() => expect(finish).toBeTruthy());
    act(() => result.current.changeHistory(history => commit(history, { ...history.present, sharpen: 7 }), first.key));
    await act(async () => finish(allocate(first.path)));
    await waitFor(() => expect(result.current.entries[0].image?.history.present.sharpen).toBe(7));
    expect(result.current.entries[0].history?.present.sharpen).toBe(7);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'render_snapshot').at(-1)?.[1].recipe.sharpen).toBe(7);
  });

  it('shows the first immediately and selects the second only after its first-image pin is ready', async () => {
    let finishSecond!: (value: ImageInfo) => void;
    let finishPin!: (value: RenderInfo) => void;
    let pinArgs!: Record<string, unknown>;
    customInvoke = (command, args) => command === 'import_image' && args.path === 'second.rvg' ? new Promise(resolve => { finishSecond = resolve; }) : command === 'render_snapshot' ? new Promise(resolve => { pinArgs = args; finishPin = resolve; }) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(['first.rvg', 'second.rvg', 'third.rvg'], patient('00123'), ['first.rvg', 'second.rvg']));
    await waitFor(() => expect(finishSecond).toBeTruthy());
    expect(result.current.selectedKey).toBe(result.current.entries[0].key);
    expect(result.current.entries[0].image).toBeTruthy();
    expect(result.current.entries[0].pinned).not.toBe(true);
    await act(async () => finishSecond(allocate('second.rvg')));
    await waitFor(() => expect(finishPin).toBeTruthy());
    expect(result.current.selectedKey).toBe(result.current.entries[0].key);
    expect(result.current.entries[0].pinPending).toBe(true);
    await act(async () => finishPin(snapshot(pinArgs)));
    expect(result.current.entries[0].pinned).toBe(true);
    expect(result.current.selectedKey).toBe(result.current.entries[1].key);
    expect(result.current.entries.filter(entry => entry.pinned)).toHaveLength(1);
  });
  it('shows usable latest-day images without filling failed slots from earlier days', async () => {
    customInvoke = (command, args) => command === 'import_image' && ['bad-first.rvg', 'bad-middle.rvg'].includes(String(args.path)) ? Promise.reject('Unsupported synthetic image') : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(['bad-first.rvg', 'good-first.rvg', 'bad-middle.rvg', 'good-second.rvg', 'older.rvg'], patient('00123'), ['bad-first.rvg', 'good-first.rvg', 'bad-middle.rvg', 'good-second.rvg']));
    await waitFor(() => expect(result.current.entries[1].pinned).toBe(true));
    expect(result.current.selectedKey).toBe(result.current.entries[3].key);
    expect(result.current.entries.filter(entry => entry.pinned)).toHaveLength(1);
  });
  it('leaves a one-image patient and manual additions unpinned', async () => {
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(['only.rvg'], patient('00123')));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries[0].pinned).not.toBe(true);
    act(() => result.current.append(['manual-one.rvg', 'manual-two.rvg']));
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
    expect(result.current.selectedKey).toBe(result.current.entries[1].key);
    expect(result.current.entries.every(entry => !entry.pinned && !entry.pinPending)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'render_snapshot')).toHaveLength(0);
  });
  it('honors selection or adjustment made before the second import completes', async () => {
    for (const interaction of ['select', 'adjust']) {
      let finish!: (value: ImageInfo) => void;
      customInvoke = (command, args) => command === 'import_image' && args.path === `${interaction}-second.rvg` ? new Promise(resolve => { finish = resolve; }) : undefined;
      const { result, unmount } = renderHook(() => useImageLibrary(vi.fn()));
      await act(async () => result.current.replace([`${interaction}-first.rvg`, `${interaction}-second.rvg`, `${interaction}-third.rvg`], patient('00123')));
      await waitFor(() => expect(finish).toBeTruthy());
      if (interaction === 'select') act(() => result.current.select(result.current.entries[2].key));
      else act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .63 })));
      const selected = result.current.selectedKey;
      await act(async () => finish(allocate(`${interaction}-second.rvg`)));
      await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
      expect(result.current.selectedKey).toBe(selected);
      expect(result.current.entries.every(entry => !entry.pinned && !entry.pinPending)).toBe(true);
      if (interaction === 'adjust') expect(result.current.entries[0].history?.present.gamma).toBe(.63);
      unmount();
    }
  });
  it('cancels an unfinished automatic pin when the user interacts and rejects its late result', async () => {
    let finish!: (value: RenderInfo) => void;
    let args!: Record<string, unknown>;
    customInvoke = (command, input) => command === 'render_snapshot' ? new Promise(resolve => { args = input; finish = resolve; }) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(['first.rvg', 'second.rvg', 'third.rvg'], patient('00123'), ['first.rvg', 'second.rvg']));
    await waitFor(() => expect(finish).toBeTruthy());
    act(() => result.current.select(result.current.entries[2].key));
    await act(async () => finish(snapshot(args)));
    expect(result.current.selectedKey).toBe(result.current.entries[2].key);
    expect(result.current.entries.every(entry => !entry.pinned && !entry.pinPending)).toBe(true);
  });
  it('never moves selection when an old patient auto-pin finishes', async () => {
    let finish!: (value: RenderInfo) => void;
    let args!: Record<string, unknown>;
    customInvoke = (command, input) => command === 'render_snapshot' ? new Promise(resolve => { args = input; finish = resolve; }) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(['old-first.rvg', 'old-second.rvg'], patient('00123')));
    await waitFor(() => expect(finish).toBeTruthy());
    await act(async () => result.current.replace(['new.rvg'], patient('00456')));
    await act(async () => finish(snapshot(args)));
    await waitFor(() => expect(result.current.entries[0].image).toBeTruthy());
    expect(result.current.entries.map(entry => entry.path)).toEqual(['new.rvg']);
    expect(result.current.selectedKey).toBe(result.current.entries[0].key);
    expect(result.current.entries[0].pinned).not.toBe(true);
  });
  it('retains candidates while a slow automatic snapshot completes before further decoding', async () => {
    let finish!: (value: RenderInfo) => void;
    let args!: Record<string, unknown>;
    customInvoke = (command, input) => command === 'render_snapshot' ? new Promise(resolve => { args = input; finish = resolve; }) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(Array.from({ length: 15 }, (_, i) => `newest-${i}.rvg`), patient('00123'), ['newest-0.rvg', 'newest-1.rvg']));
    await waitFor(() => expect(finish).toBeTruthy());
    expect(result.current.entries[1].image).toBeTruthy();
    expect(maxLive).toBeLessThanOrEqual(DECODED_IMAGE_LIMIT);
    await act(async () => finish(snapshot(args)));
    await waitFor(() => expect(result.current.entries.every(entry => entry.thumbnail)).toBe(true));
    expect(result.current.selectedKey).toBe(result.current.entries[1].key);
    expect(result.current.entries[0].pinned).toBe(true);
  });
});

describe('automatic pair cancellation boundaries', () => {
  it('honors an explicit cancel of the automatic initial pin', async () => {
    let finish!: (value: RenderInfo) => void;
    let args!: Record<string, unknown>;
    customInvoke = (command, input) => command === 'render_snapshot' ? new Promise(resolve => { args = input; finish = resolve; }) : undefined;
    const { result } = renderHook(() => useImageLibrary(vi.fn()));
    await act(async () => result.current.replace(['first.rvg', 'second.rvg'], patient('00123')));
    await waitFor(() => expect(finish).toBeTruthy());
    await act(async () => result.current.togglePin(result.current.entries[0].key));
    await act(async () => finish(snapshot(args)));
    expect(result.current.entries.every(entry => !entry.pinned && !entry.pinPending)).toBe(true);
    expect(result.current.selectedKey).toBe(result.current.entries[0].key);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'render_snapshot')).toHaveLength(1);
  });
  it('keeps the first usable image visible if its automatic pin fails', async () => {
    customInvoke = command => command === 'render_snapshot' ? Promise.reject('Synthetic capture failure') : undefined;
    const onError = vi.fn();
    const { result } = renderHook(() => useImageLibrary(onError));
    await act(async () => result.current.replace(['first.rvg', 'second.rvg'], patient('00123')));
    await waitFor(() => expect(result.current.entries[0].pinError).toContain('Synthetic capture failure'));
    expect(result.current.entries[0].image).toBeTruthy();
    expect(result.current.selectedKey).toBe(result.current.entries[0].key);
    expect(result.current.entries.every(entry => !entry.pinned && !entry.pinPending)).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
  });
});

it('restores shared settings on import and saves edits and annotation removal without touching image bytes', async () => {
  const ellipse = { x: 10, y: 20, width: 40, height: 30, color: 'yellow' as const };
  customInvoke = (command, args) => {
    if (command === 'import_image') return Promise.resolve({ ...allocate(String(args.path)), settingsKey: 'shared-key', sourceSha256: 'hash', settingsRevision: 'revision-1', savedAppearance: { recipe: { ...neutral, gamma: .73 }, rotationQuarterTurns: 2, ellipses: [ellipse] } });
    if (command === 'save_image_settings') return Promise.resolve('revision-2');
  };
  const { result } = renderHook(() => useImageLibrary(vi.fn())); act(() => result.current.append(['shared.rvg']));
  await waitFor(() => expect(result.current.entries[0].image).toBeTruthy()); const entry = result.current.entries[0];
  expect(entry.history!.present.gamma).toBe(.73); expect(entry.rotationQuarterTurns).toBe(2); expect(entry.ellipses).toEqual([ellipse]);
  expect(mocks.invoke.mock.calls.find(([command]) => command === 'render_image')?.[1].recipe.gamma).toBe(.73);
  act(() => result.current.changeHistory(history => commit(history, { ...history.present, gamma: .85 })));
  await act(async () => { expect(await result.current.flushSettings()).toBe(true); });
  let saved = mocks.invoke.mock.calls.filter(([command]) => command === 'save_image_settings').at(-1)![1]; expect(saved.expectedRevision).toBe('revision-1'); expect(saved.appearance.ellipses).toEqual([ellipse]); expect(saved.appearance.rotationQuarterTurns).toBe(2);
  act(() => result.current.setEllipses({ [entry.key]: [] })); await act(async () => { await result.current.flushSettings(); });
  saved = mocks.invoke.mock.calls.filter(([command]) => command === 'save_image_settings').at(-1)![1]; expect(saved.appearance.ellipses).toEqual([]); expect(saved.appearance.recipe.gamma).toBe(.85);
});
