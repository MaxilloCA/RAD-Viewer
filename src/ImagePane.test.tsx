// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImagePane, { defaultPaneView } from './ImagePane';
import type { ImageEntry, ImageInfo, Recipe, RenderInfo } from './model';

const neutral: Recipe = { version: 1, windowCenter: 128, windowWidth: 256, gamma: 1, denoise: 0, localContrast: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false, colorize: false };
const info: ImageInfo = { id: 'source-1', width: 1200, height: 900, neutral, decodeMs: 1, metadata: { name: 'Synthetic image', format: 'DICOM', bitsStored: 8, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0, windowCenter: null, windowWidth: null, min: 0, max: 255 } };
const frame: RenderInfo = { id: info.id, requestId: 1, url: 'data:image/png;base64,c3ludGhldGlj', histogram: [], clippedLow: 0, clippedHigh: 0, renderMs: 1 };
const entry: ImageEntry = { key: 'pane-1', path: 'synthetic.rvg', name: 'Synthetic image', details: info, lastUsed: 1, rotationQuarterTurns: 0 };
const props = (): ComponentProps<typeof ImagePane> => ({ entry, render: frame, view: defaultPaneView, setView: vi.fn(), processing: false, onSize: vi.fn(), pixelRatio: 1, badge: 'Synthetic', active: true, onSelect: vi.fn(), onPin: vi.fn(), onRotate: vi.fn(), onAdjustStart: vi.fn(), onAdjustMove: vi.fn(), onAdjustEnd: vi.fn() });
const rightClick = (element: HTMLElement, x = 30, y = 40) => {
  fireEvent.pointerDown(element, { button: 2, buttons: 2, pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(element, { button: 2, buttons: 0, pointerId: 1, clientX: x, clientY: y });
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('explicit image tools and pane movement', () => {
  it('routes Ctrl+wheel to enhancement and prevents page zoom without changing image zoom', () => {
    const values = { ...props(), onEnhance: vi.fn() };
    const { getByTestId } = render(<ImagePane {...values} />);
    const viewport = getByTestId('image-viewport');
    const wheel = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
    fireEvent(viewport, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(values.onEnhance).toHaveBeenLastCalledWith(1);
    fireEvent.wheel(viewport, { deltaY: 120, ctrlKey: true });
    expect(values.onEnhance).toHaveBeenLastCalledWith(-1);
    expect(values.setView).not.toHaveBeenCalled();
    fireEvent.wheel(viewport, { deltaY: -120 });
    expect(values.setView).toHaveBeenCalledOnce();
  });
  it('draws source-anchored red and yellow ellipses with a constant three-pixel stroke', () => {
    const onEllipse = vi.fn(); const p = props();
    const screen = render(<ImagePane {...p} tool="ellipse" onEllipse={onEllipse} view={{ scale: 1, x: 0, y: 0, fit: false }} />);
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 60, clientY: 70 });
    fireEvent.pointerUp(viewport, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });
    expect(onEllipse).toHaveBeenCalledWith({ x: 610, y: 470, width: 50, height: 50, color: 'red' });
    expect(p.onAdjustMove).not.toHaveBeenCalled();
    screen.rerender(<ImagePane {...p} tool="ellipse" ellipseColor="yellow" onEllipse={onEllipse} ellipses={[onEllipse.mock.calls[0][0]]} view={{ scale: 1, x: 0, y: 0, fit: false }} />);
    const drawn = screen.container.querySelector('ellipse')!;
    expect(drawn.getAttribute('stroke-width')).toBe('3'); expect(drawn.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 0, pointerId: 2, clientX: 20, clientY: 30 });
    expect(onEllipse).toHaveBeenLastCalledWith({ x: 620, y: 480, width: 80, height: 70, color: 'yellow' });
  });
  it('cancels incomplete marks and does not fit on an ellipse double click', () => {
    const p = props(), onEllipse = vi.fn(); const screen = render(<ImagePane {...p} tool="ellipse" onEllipse={onEllipse} />);
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.doubleClick(viewport, { button: 0 });
    expect(onEllipse).not.toHaveBeenCalled(); expect(p.setView).not.toHaveBeenCalled();
  });
  it('uses explicit pan without touching adjustments and can disable right-click shortcuts', () => {
    const p = props(); const screen = render(<ImagePane {...p} tool="pan" mouseShortcuts={false} />);
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(viewport, { pointerId: 1 }); rightClick(viewport); advance(500);
    expect(p.setView).toHaveBeenCalledOnce(); expect(p.onAdjustStart).not.toHaveBeenCalled(); expect(p.onRotate).not.toHaveBeenCalled();
  });
  it('swaps on handle release over another pane and cancels outside it', () => {
    const p = props(), onSwap = vi.fn(), onMoveOver = vi.fn();
    const screen = render(<ImagePane {...p} onSwap={onSwap} onMoveOver={onMoveOver} />);
    const target = document.createElement('section'); target.dataset.paneKey = 'other';
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });
    const handle = screen.getByRole('button', { name: 'Move image Synthetic image' });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 9 }); fireEvent.pointerMove(handle, { pointerId: 9, clientX: 500, clientY: 200 }); fireEvent.pointerUp(handle, { pointerId: 9, clientX: 500, clientY: 200 });
    expect(onSwap).toHaveBeenCalledWith('pane-1', 'other'); expect(onMoveOver).toHaveBeenLastCalledWith(null, null);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 10 }); fireEvent.pointerCancel(handle, { pointerId: 10 }); fireEvent.pointerUp(handle, { pointerId: 10 });
    expect(onSwap).toHaveBeenCalledOnce(); expect(p.onSelect).not.toHaveBeenCalled();
  });
});

describe('image right-click gestures', () => {
  it('defers a single right click, rotates once, and suppresses the context menu', () => {
    const p = props(); const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    rightClick(viewport);
    // Browsers release pointer capture after pointerup; this must not cancel the click.
    fireEvent.lostPointerCapture(viewport, { pointerId: 1 });
    expect(fireEvent.contextMenu(viewport)).toBe(false);
    advance(399); expect(p.onRotate).not.toHaveBeenCalled();
    advance(1); expect(p.onRotate).toHaveBeenCalledOnce();
    expect(p.onPin).not.toHaveBeenCalled();
    expect(p.onAdjustStart).not.toHaveBeenCalled();
  });

  it('pins on a double right click without an intermediate rotation or fit', () => {
    const p = props(); const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    rightClick(viewport); advance(150); rightClick(viewport);
    fireEvent.doubleClick(viewport, { button: 2 });
    expect(p.onPin).toHaveBeenCalledOnce();
    advance(1000);
    expect(p.onRotate).not.toHaveBeenCalled();
    expect(p.setView).not.toHaveBeenCalled();
  });

  it('treats two slow clicks as two rotations', () => {
    const p = props(); const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    rightClick(viewport); advance(401); rightClick(viewport); advance(401);
    expect(p.onRotate).toHaveBeenCalledTimes(2);
    expect(p.onPin).not.toHaveBeenCalled();
  });

  it('rejects right-button dragging even if the pointer returns before release', () => {
    const p = props(); const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 2, pointerId: 1, clientX: 30, clientY: 40 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 45, clientY: 40 });
    fireEvent.pointerUp(viewport, { button: 2, pointerId: 1, clientX: 30, clientY: 40 });
    advance(1000);
    expect(p.onRotate).not.toHaveBeenCalled();
    expect(p.onPin).not.toHaveBeenCalled();
    expect(p.onAdjustMove).not.toHaveBeenCalled();
  });

  it.each(['pointerCancel', 'lostPointerCapture'] as const)('cancels a right gesture on %s', event => {
    const p = props(); const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 2, pointerId: 1, clientX: 30, clientY: 40 });
    fireEvent[event](viewport, { pointerId: 1 });
    fireEvent.pointerUp(viewport, { button: 2, pointerId: 1, clientX: 30, clientY: 40 });
    advance(1000);
    expect(p.onRotate).not.toHaveBeenCalled(); expect(p.onPin).not.toHaveBeenCalled();
  });

  it('discards a pending single click when unmounted or the pane identity changes', () => {
    const p = props(); const screen = render(<ImagePane {...p} />);
    rightClick(screen.getByTestId('image-viewport'));
    screen.rerender(<ImagePane {...p} entry={{ ...entry, key: 'pane-2' }} />);
    advance(500); expect(p.onRotate).not.toHaveBeenCalled();
    rightClick(screen.getByTestId('image-viewport'));
    screen.unmount(); advance(500); expect(p.onRotate).not.toHaveBeenCalled();
  });

  it('selects an inactive pane and uses its latest callback even after selection changes', () => {
    const p = props(); p.active = false;
    const screen = render(<ImagePane {...p} />);
    rightClick(screen.getByTestId('image-viewport'));
    expect(p.onSelect).toHaveBeenCalledOnce();
    const latestRotate = vi.fn();
    screen.rerender(<ImagePane {...p} onRotate={latestRotate} active />);
    screen.rerender(<ImagePane {...p} onRotate={latestRotate} active={false} />);
    advance(400);
    expect(latestRotate).toHaveBeenCalledOnce(); expect(p.onRotate).not.toHaveBeenCalled();
  });

  it('uses the latest pin callback for a double right click and keeps left-double fit', () => {
    const p = props(); const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    rightClick(viewport); advance(100);
    const latestPin = vi.fn(); screen.rerender(<ImagePane {...p} onPin={latestPin} />);
    rightClick(viewport);
    expect(latestPin).toHaveBeenCalledOnce(); expect(p.onPin).not.toHaveBeenCalled();
    fireEvent.doubleClick(viewport, { button: 0 });
    expect(p.setView).toHaveBeenCalledOnce();
  });
});
