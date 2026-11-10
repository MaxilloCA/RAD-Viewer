// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./buildInfo', async importOriginal => ({
  buildInfo: { ...(await importOriginal<typeof import('./buildInfo')>()).buildInfo, os: 'macos', platform: 'macOS aarch64', engine: 'Tauri 2 · WKWebView' },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: () => Promise.resolve(() => {}) }) }));
import App from './App';
import ImagePane, { defaultPaneView } from './ImagePane';
import { selectionModifier } from './platform';
import type { ImageInfo, Recipe, RenderInfo } from './model';

const neutral: Recipe = { version: 1, windowCenter: 128, windowWidth: 256, gamma: 1, denoise: 0, localContrast: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false, colorize: false };
const info: ImageInfo = { id: 'mac-image', width: 1200, height: 900, neutral, decodeMs: 1, metadata: { name: 'Local image', format: 'PNG', bitsStored: 8, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0, windowCenter: null, windowWidth: null, min: 0, max: 255 } };
const frame: RenderInfo = { id: info.id, requestId: 1, url: 'rad://localhost/test-token', histogram: [1, 2], clippedLow: 0, clippedHigh: 0, renderMs: 1 };
const props = (): ComponentProps<typeof ImagePane> => ({ entry: { key: 'pane', path: '/Users/test/Local images/image.png', name: 'Local image', details: info, lastUsed: 1, rotationQuarterTurns: 0 }, render: frame, view: defaultPaneView, setView: vi.fn(), processing: false, onSize: vi.fn(), pixelRatio: 2, badge: 'Local', active: true, onSelect: vi.fn(), onToggleSelect: vi.fn(), onPin: vi.fn(), onRotate: vi.fn(), onAdjustStart: vi.fn(), onAdjustMove: vi.fn(), onAdjustEnd: vi.fn(), onEnhance: vi.fn() });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  mocks.invoke.mockReset().mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    if (command === 'load_presets') return Promise.resolve([]);
    if (command === 'choose_images') return Promise.resolve(['/Users/test/Local images/image.png']);
    if (command === 'import_image') return Promise.resolve(info);
    if (command === 'render_image') return Promise.resolve({ ...frame, requestId: args.requestId });
    if (command === 'image_thumbnail') return Promise.resolve('data:image/png;base64,dGVzdA==');
    return Promise.resolve(null);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Mac compatibility', () => {
  it('opens local images while explaining unavailable patient lookup and printing', async () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Measure' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Open Patient' }) as HTMLButtonElement).disabled).toBe(true);
    const print = screen.getByRole('button', { name: 'Print Current View' }) as HTMLButtonElement;
    expect(print.disabled).toBe(true);
    expect(print.title).toContain('Direct printing is unavailable');
    expect(screen.queryByRole('textbox', { name: 'Patient number' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open John Smith demo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open radiographs' }));
    expect(await screen.findByAltText('Enhanced: Local image')).toBeTruthy();
    expect(print.disabled).toBe(true);
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'launch_patient_number' || command === 'open_patient' || command === 'list_printers')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'About & help' }));
    expect(screen.getByRole('dialog').textContent).toContain('WKWebView');
    expect(screen.getByRole('dialog').textContent).toContain('Command + click');
  });

  it('uses Command for selection in both the pane and its header', () => {
    expect(selectionModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(selectionModifier({ metaKey: false, ctrlKey: true })).toBe(false);
    const p = props();
    const view = render(<ImagePane {...p} />);
    fireEvent.pointerDown(view.getByTestId('image-viewport'), { button: 0, pointerId: 1, metaKey: true });
    fireEvent.click(view.getByRole('button', { name: 'Select image Local image' }), { metaKey: true });
    expect(p.onToggleSelect).toHaveBeenCalledTimes(2);
    expect(p.onAdjustStart).not.toHaveBeenCalled();
    expect(p.onSelect).not.toHaveBeenCalled();
  });

  it('routes Command-scroll to enhancement and Control-scroll/pinch to image zoom', () => {
    const p = props();
    const view = render(<ImagePane {...p} />);
    const viewport = view.getByTestId('image-viewport');
    fireEvent.wheel(viewport, { metaKey: true, deltaY: -120 });
    expect(p.onEnhance).toHaveBeenCalledExactlyOnceWith(1);
    expect(p.setView).not.toHaveBeenCalled();
    const pinch = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true });
    fireEvent(viewport, pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(p.setView).toHaveBeenCalledOnce();
    expect(p.onEnhance).toHaveBeenCalledOnce();
  });
});
