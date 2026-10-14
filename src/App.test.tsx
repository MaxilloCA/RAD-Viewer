// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageInfo, Recipe, RenderInfo } from './model';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));
import App from './App';

const neutral: Recipe = { version: 1, windowCenter: 2048, windowWidth: 4096, gamma: 1, denoise: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false };
const info = (name: string): ImageInfo => ({ id: name, width: name === 'reference.png' ? 800 : 1200, height: 900, neutral, decodeMs: 15, metadata: { name, format: 'DICOM', bitsStored: 12, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0, windowCenter: null, windowWidth: null, min: 0, max: 4095 } });
const result = (id: string, requestId: number): RenderInfo => ({ id, requestId, url: `http://test.local/${id}/${requestId}.png`, histogram: Array(256).fill(1), clippedLow: 3, clippedHigh: 5, renderMs: 25 });
let openPaths: string[];
let customInvoke: ((command: string, args: Record<string, unknown>) => Promise<unknown> | undefined) | undefined;
beforeEach(() => {
  openPaths = ['first.rvg']; customInvoke = undefined;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.invoke.mockReset().mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const custom = customInvoke?.(command, args);
    if (custom) return custom;
    if (command === 'load_presets') return Promise.resolve([]);
    if (command === 'choose_images') return Promise.resolve(openPaths);
    if (command === 'choose_reference') return Promise.resolve('reference.png');
    if (command === 'import_image') return Promise.resolve(info(String(args.path)));
    if (command === 'render_image') return Promise.resolve(result(String(args.id), Number(args.requestId)));
    return Promise.resolve(null);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Open radiographs' }));
  await screen.findByAltText('Original: first.rvg');
};
const gamma = (value: number) => {
  const input = screen.getByRole('slider', { name: 'Gamma' });
  fireEvent.change(input, { target: { value: String(value) } });
  fireEvent.blur(input);
};
describe('comparison workflow with test-only Tauri IPC', () => {
  it('uses physical pixel scale at 100% and shows binary image display failures', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    const original = screen.getByAltText('Original: first.rvg');
    expect(original.getAttribute('style')).toContain('scale(0.5)');
    expect(screen.getByTitle('Source pixels relative to physical display pixels').textContent).toBe('100%');
    fireEvent.error(original);
    expect(screen.getByRole('alert').textContent).toContain('Image display failed');
    expect(original.getAttribute('style')).toContain('visibility: hidden');
  });
  it('shows the selected first image while later imports are pending', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    let finishSecond!: (value: ImageInfo) => void;
    customInvoke = (command, args) => command === 'import_image' && args.path === 'second.rvg' ? new Promise(resolve => { finishSecond = resolve; }) : undefined;
    render(<App />); await open();
    await screen.findByText('Opening 2 of 2');
    expect(screen.getByAltText('Adjusted: first.rvg')).toBeTruthy();
    await act(async () => finishSecond(info('second.rvg')));
    await screen.findByRole('button', { name: '02 second.rvg' });
    expect(screen.getByAltText('Original: first.rvg')).toBeTruthy();
  });

  it('discards a completed obsolete render after a more recent change', async () => {
    const pending: { id: string; requestId: number; resolve: (value: RenderInfo) => void }[] = [];
    render(<App />); await open();
    customInvoke = (command, args) => command === 'render_image' ? new Promise(resolve => pending.push({ id: String(args.id), requestId: Number(args.requestId), resolve })) : undefined;
    gamma(.8); await waitFor(() => expect(pending).toHaveLength(1));
    gamma(.6); await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].requestId).toBeGreaterThan(pending[0].requestId);
    await act(async () => pending[1].resolve(result(pending[1].id, pending[1].requestId)));
    const latestUrl = result(pending[1].id, pending[1].requestId).url;
    expect(screen.getByAltText('Adjusted: first.rvg').getAttribute('src')).toBe(latestUrl);
    await act(async () => pending[0].resolve(result(pending[0].id, pending[0].requestId)));
    expect(screen.getByAltText('Adjusted: first.rvg').getAttribute('src')).toBe(latestUrl);
  });

  it('keeps recipes independent and supports undo, redo, and reset', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    render(<App />); await open();
    await screen.findByRole('button', { name: '02 second.rvg' });
    gamma(.72);
    expect((screen.getByRole('slider', { name: 'Gamma' }) as HTMLInputElement).value).toBe('0.72');
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect((screen.getByRole('slider', { name: 'Gamma' }) as HTMLInputElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    expect((screen.getByRole('slider', { name: 'Gamma' }) as HTMLInputElement).value).toBe('0.72');
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    expect((screen.getByRole('slider', { name: 'Gamma' }) as HTMLInputElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '↷ Redo' }));
    expect((screen.getByRole('slider', { name: 'Gamma' }) as HTMLInputElement).value).toBe('0.72');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect((screen.getByRole('slider', { name: 'Gamma' }) as HTMLInputElement).value).toBe('1');
  });

  it('identifies an unmatched reference and records its review metadata', async () => {
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: '＋ Add reference image' }));
    await screen.findByAltText('Carestream reference: reference.png');
    expect(screen.getByText(/Different reference dimensions/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Sharpness setting'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_review', expect.objectContaining({ review: expect.objectContaining({ qualityAcceptance: 'Pending user comparison', reference: expect.objectContaining({ sharpness: '3', appearanceConfirmed: false }) }) })));
  });
});
