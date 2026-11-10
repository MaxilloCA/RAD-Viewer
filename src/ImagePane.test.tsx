// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Exercise Windows behavior on either host; Mac behavior has its own suite.
vi.mock('./buildInfo', async importOriginal => ({
  buildInfo: { ...(await importOriginal<typeof import('./buildInfo')>()).buildInfo, os: 'windows', platform: 'Windows x64', engine: 'Tauri 2 · WebView2' },
}));
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
  it('measures horizontal, vertical and reverse diagonal lines in source coordinates through pan, zoom and rotation', () => {
    const p = props(), onMeasurement = vi.fn();
    const screen = render(<ImagePane {...p} tool="measure" onMeasurement={onMeasurement} entry={{ ...entry, rotationQuarterTurns: 1 }} view={{ scale: 2, x: 10, y: 20, fit: false }} />);
    const viewport = screen.getByTestId('image-viewport');
    for (const [x, y] of [[80, 140], [120, 100], [20, 20]]) {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 7, clientX: 80, clientY: 100 });
      fireEvent.pointerMove(viewport, { pointerId: 7, clientX: x, clientY: y });
      expect(screen.container.querySelector('text')?.textContent).toMatch(/\d+\.\d mm · uncalibrated/);
      fireEvent.pointerUp(viewport, { button: 0, pointerId: 7, clientX: x, clientY: y });
    }
    expect(onMeasurement.mock.calls.map(call => call[0])).toEqual([
      { start: { x: 630, y: 420 }, end: { x: 650, y: 420 } },
      { start: { x: 630, y: 420 }, end: { x: 630, y: 400 } },
      { start: { x: 630, y: 420 }, end: { x: 590, y: 450 } },
    ]);
    screen.rerender(<ImagePane {...p} tool="measure" measurements={[onMeasurement.mock.calls[2][0]]} view={{ scale: .5, x: 0, y: 0, fit: false }} />);
    expect(screen.getByText('50.0 mm · uncalibrated')).toBeTruthy();
    expect(p.onAdjustStart).not.toHaveBeenCalled();
  });
  it('cancels measurement drafts and ignores outside starts and tiny clicks', () => {
    const p = props(), onMeasurement = vi.fn();
    const screen = render(<ImagePane {...p} tool="measure" onMeasurement={onMeasurement} />);
    const viewport = screen.getByTestId('image-viewport');
    for (const cancel of ['pointerCancel', 'lostPointerCapture', 'escape']) {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 20, clientY: 20 });
      if (cancel === 'escape') fireEvent.keyDown(viewport, { key: 'Escape' });
      else if (cancel === 'pointerCancel') fireEvent.pointerCancel(viewport, { pointerId: 7 });
      else fireEvent.lostPointerCapture(viewport, { pointerId: 7 });
      fireEvent.pointerUp(viewport, { button: 0, pointerId: 7, clientX: 20, clientY: 20 });
      expect(screen.container.querySelector('line')).toBeNull();
    }
    for (const x of [0, 9999]) {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 8, clientX: x, clientY: 0 });
      fireEvent.pointerUp(viewport, { button: 0, pointerId: 8, clientX: x + 1, clientY: 0 });
    }
    expect(onMeasurement).not.toHaveBeenCalled();
  });
  it('picks source coordinates through rotation, pan and zoom without adjusting or selecting', () => {
    const p = props(), pick = vi.fn();
    const screen = render(<ImagePane {...p} entry={{ ...p.entry, rotationQuarterTurns: 1 }} view={{ scale: 2, x: 10, y: 20, fit: false }} pickingReference onPickReference={pick}/>);
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 7, clientX: 80, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 0, pointerId: 7, clientX: 80, clientY: 100 });
    expect(pick).toHaveBeenCalledExactlyOnceWith({ x: 630, y: 420 });
    expect(p.onAdjustStart).not.toHaveBeenCalled(); expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 8, clientX: 8000, clientY: 8000 });
    fireEvent.pointerUp(viewport, { button: 0, pointerId: 8, clientX: 8000, clientY: 8000 });
    expect(pick).toHaveBeenCalledOnce();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 9, clientX: 80, clientY: 100 });
    fireEvent.pointerCancel(viewport, { pointerId: 9 });
    fireEvent.pointerUp(viewport, { button: 0, pointerId: 9, clientX: 80, clientY: 100 });
    expect(pick).toHaveBeenCalledOnce();
  });
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
  it('swaps on header release over another pane and cancels outside it', () => {
    const p = props(), onSwap = vi.fn(), onMoveOver = vi.fn();
    const screen = render(<ImagePane {...p} onSwap={onSwap} onMoveOver={onMoveOver} />);
    const target = document.createElement('section'); target.dataset.paneKey = 'other';
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });
    const handle = screen.getByRole('button', { name: 'Select image Synthetic image' }).closest('header')!;
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

  it('pins an inactive image on double right click without selecting, rotating or fitting it', () => {
    const p = { ...props(), active: false }; const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    rightClick(viewport); advance(150); rightClick(viewport);
    fireEvent.doubleClick(viewport, { button: 2 });
    expect(p.onPin).toHaveBeenCalledOnce();
    expect(p.onSelect).not.toHaveBeenCalled();
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

  it('rotates an inactive pane without selecting it and uses its latest callback', () => {
    const p = props(); p.active = false;
    const screen = render(<ImagePane {...p} />);
    rightClick(screen.getByTestId('image-viewport'));
    expect(p.onSelect).not.toHaveBeenCalled();
    const latestRotate = vi.fn();
    screen.rerender(<ImagePane {...p} onRotate={latestRotate} active />);
    screen.rerender(<ImagePane {...p} onRotate={latestRotate} active={false} />);
    advance(400);
    expect(latestRotate).toHaveBeenCalledOnce(); expect(p.onRotate).not.toHaveBeenCalled();
  });

  it('uses the latest pin callback and opens the clicked image fullscreen on double left-click', () => {
    const p = { ...props(), onFullscreen: vi.fn() }; const screen = render(<ImagePane {...p} />);
    const viewport = screen.getByTestId('image-viewport');
    rightClick(viewport); advance(100);
    const latestPin = vi.fn(); screen.rerender(<ImagePane {...p} onPin={latestPin} />);
    rightClick(viewport);
    expect(latestPin).toHaveBeenCalledOnce(); expect(p.onPin).not.toHaveBeenCalled();
    fireEvent.doubleClick(viewport, { button: 0 });
    expect(p.setView).not.toHaveBeenCalled();
    expect(p.onFullscreen).toHaveBeenCalledOnce();
  });
});


it('selects an annotation without starting an image adjustment and hides all markup', () => {
  const p = props(), onAnnotationSelect = vi.fn();
  const marks = [{ x: 10, y: 20, width: 60, height: 40, color: 'red' as const }];
  const screen = render(<ImagePane {...p} tool="selectAnnotation" ellipses={marks} onAnnotationSelect={onAnnotationSelect} />);
  const mark = screen.getByRole('button', { name: 'Select ellipse 1' });
  fireEvent.pointerDown(mark, { button: 0, pointerId: 1 });
  fireEvent.click(mark);
  expect(onAnnotationSelect).toHaveBeenLastCalledWith({ kind: 'ellipse', index: 0 });
  expect(p.onAdjustStart).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByTestId('image-viewport'), { button: 0, pointerId: 1 });
  expect(onAnnotationSelect).toHaveBeenLastCalledWith(null);
  expect(p.onAdjustStart).not.toHaveBeenCalled();
  screen.rerender(<ImagePane {...p} annotationsVisible={false} ellipses={marks} measurements={[{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]} />);
  expect(screen.container.querySelector('.image-markup')).toBeNull();
});
