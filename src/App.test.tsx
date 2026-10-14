// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageInfo, Recipe, RenderInfo } from './model';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));
import App from './App';

const neutral: Recipe = { version: 1, windowCenter: 2048, windowWidth: 4096, gamma: 1, denoise: 0, localContrast: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false, colorize: false };
const info = (name: string): ImageInfo => ({ id: name, width: 1200, height: 900, neutral, decodeMs: 15, metadata: { name, format: 'DICOM', bitsStored: 12, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0, windowCenter: null, windowWidth: null, min: 0, max: 4095 } });
const result = (id: string, requestId: number): RenderInfo => ({ id, requestId, url: `http://test.local/${id}/${requestId}.png`, histogram: [0, 1, 2, 4], clippedLow: 3, clippedHigh: 5, renderMs: 25 });
let openPaths: string[];
let customInvoke: ((command: string, args: Record<string, unknown>) => Promise<unknown> | undefined) | undefined;
beforeEach(() => {
  openPaths = ['first.rvg']; customInvoke = undefined;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  mocks.invoke.mockReset().mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const custom = customInvoke?.(command, args); if (custom) return custom;
    if (command === 'load_presets') return Promise.resolve([]);
    if (command === 'choose_images') return Promise.resolve(openPaths);
    if (command === 'import_image') return Promise.resolve(info(String(args.path)));
    if (command === 'render_image') return Promise.resolve(result(String(args.id), Number(args.requestId)));
    return Promise.resolve(null);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = async () => { fireEvent.click(screen.getByRole('button', { name: 'Open radiographs' })); await screen.findByAltText('Enhanced: first.rvg'); };
const slider = (label: string) => screen.getByRole('slider', { name: label }) as HTMLInputElement;
const setSlider = (label: string, value: number) => { fireEvent.change(slider(label), { target: { value: String(value) } }); fireEvent.blur(slider(label)); };
const startDrag = (options: PointerEventInit = {}) => fireEvent.pointerDown(screen.getByTestId('image-viewport'), { button: 0, clientX: 100, clientY: 100, pointerId: 1, ...options });
const moveDrag = (x: number, y: number) => fireEvent.pointerMove(screen.getByTestId('image-viewport'), { clientX: x, clientY: y, pointerId: 1 });
const finishDrag = () => fireEvent.pointerUp(screen.getByTestId('image-viewport'), { pointerId: 1 });

describe('enhanced viewer with test-only Tauri IPC', () => {
  it('opens selected patient radiographs with a trimmed, leading-zero-preserving number', async () => {
    render(<App />); await open();
    customInvoke = command => command === 'choose_patient_images' ? Promise.resolve(['selected-patient.rvg']) : undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    expect(screen.getByRole('dialog', { name: 'Open patient' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Patient number'));
    fireEvent.change(screen.getByLabelText('Patient number'), { target: { value: ' 0067589 ' } });
    expect(screen.getByText('D:\\ABELDent\\DATA\\NOTES\\89\\0067589')).toBeTruthy();
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    await screen.findByAltText('Enhanced: selected-patient.rvg');
    expect(mocks.invoke).toHaveBeenCalledWith('choose_patient_images', { patientNumber: '0067589' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '01 first.rvg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '02 selected-patient.rvg' })).toBeTruthy();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'import_image').map(([, args]) => args.path)).toEqual(['first.rvg', 'selected-patient.rvg']);
  });
  it('rejects invalid patient numbers without calling the file picker', () => {
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    for (const value of ['', '1', '12a', '../123', '１２３', '9'.repeat(65)]) {
      fireEvent.change(screen.getByLabelText('Patient number'), { target: { value } });
      fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
      expect(screen.getByRole('alert').textContent).toContain('2–64 digits only');
    }
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'choose_patient_images')).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('closes the patient dialog with Cancel or Escape without opening files', () => {
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'choose_patient_images')).toBe(false);
  });
  it('keeps patient lookup errors local and permits retry without losing the number', async () => {
    customInvoke = command => command === 'choose_patient_images' ? Promise.reject('Patient folder not found') : undefined;
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.change(screen.getByLabelText('Patient number'), { target: { value: '67589' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    await screen.findByText('Patient folder not found');
    expect(screen.getByRole('dialog').contains(screen.getByRole('alert'))).toBe(true);
    expect((screen.getByLabelText('Patient number') as HTMLInputElement).value).toBe('67589');
    expect((screen.getByRole('button', { name: 'Choose radiographs' }) as HTMLButtonElement).disabled).toBe(false);
    customInvoke = command => command === 'choose_patient_images' ? Promise.resolve([]) : undefined;
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    await screen.findByText('No radiographs selected.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('coalesces patient submissions while the native picker is busy and handles cancellation', async () => {
    let finishPicker!: (paths: string[]) => void;
    customInvoke = command => command === 'choose_patient_images' ? new Promise(resolve => { finishPicker = resolve; }) : undefined;
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.change(screen.getByLabelText('Patient number'), { target: { value: '0012' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'choose_patient_images')).toHaveLength(1);
    expect((screen.getByLabelText('Patient number') as HTMLInputElement).disabled).toBe(true);
    await act(async () => finishPicker([]));
    expect(screen.getByText('No radiographs selected.')).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'import_image')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps failed selected-image imports in the patient dialog', async () => {
    customInvoke = (command, args) => command === 'choose_patient_images' ? Promise.resolve(['broken.rvg']) : command === 'import_image' && args.path === 'broken.rvg' ? Promise.reject('Unsupported encoding') : undefined;
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.change(screen.getByLabelText('Patient number'), { target: { value: '67589' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    await screen.findByText('broken.rvg: Unsupported encoding');
    expect(screen.getByRole('dialog').contains(screen.getByRole('alert'))).toBe(true);
    expect((screen.getByRole('button', { name: 'Choose radiographs' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('opens one enhanced viewport with exact defaults and requested ranges', async () => {
    render(<App />); await open();
    expect(screen.getAllByAltText('Enhanced: first.rvg')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Neutral' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Endo' })).toBeNull();
    expect(screen.queryByText(/Add reference/)).toBeNull();
    expect(screen.queryByAltText(/Original:/)).toBeNull();
    expect(slider('Gamma').value).toBe('0.22'); expect(slider('Gamma').min).toBe('0.1'); expect(slider('Gamma').max).toBe('0.9');
    expect(slider('Sharpness strength').value).toBe('6'); expect(slider('Sharpness strength').min).toBe('5'); expect(slider('Sharpness strength').max).toBe('10');
    expect(slider('Tone').value).toBe('0'); expect(slider('Contrast').value).toBe('0');
    expect(screen.queryByRole('slider', { name: 'Window center' })).toBeNull();
  });
  it('shows the first enhanced image while subsequent imports are pending', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    let finishSecond!: (value: ImageInfo) => void;
    customInvoke = (command, args) => command === 'import_image' && args.path === 'second.rvg' ? new Promise(resolve => { finishSecond = resolve; }) : undefined;
    render(<App />); await open(); await screen.findByText('Opening 2 of 2');
    await act(async () => finishSecond(info('second.rvg')));
    await screen.findByRole('button', { name: '02 second.rvg' });
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
  });
  it('adjusts both drag axes from the snapshot and records one undo entry', async () => {
    render(<App />); await open();
    startDrag(); moveDrag(140, 80); moveDrag(180, 60);
    expect(Number(slider('Gamma').value)).toBeCloseTo(.32);
    expect(Number(slider('Tone').value)).toBeCloseTo(40);
    finishDrag();
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    expect(slider('Gamma').value).toBe('0.22'); expect(slider('Tone').value).toBe('0');
    expect((screen.getByRole('button', { name: '↶ Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '↷ Redo' }));
    expect(slider('Gamma').value).toBe('0.32');
  });
  it('bounds drag changes and commits cancellation exactly once', async () => {
    render(<App />); await open();
    startDrag(); moveDrag(10000, -10000);
    expect(slider('Gamma').value).toBe('0.9'); expect(slider('Tone').value).toBe('100');
    fireEvent.pointerCancel(screen.getByTestId('image-viewport'), { pointerId: 1 });
    fireEvent.lostPointerCapture(screen.getByTestId('image-viewport'), { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    expect(slider('Gamma').value).toBe('0.22');
    expect((screen.getByRole('button', { name: '↶ Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not create undo history for a click or zero-distance move', async () => {
    render(<App />); await open(); startDrag(); moveDrag(100, 100); finishDrag();
    expect(slider('Gamma').value).toBe('0.22');
    expect((screen.getByRole('button', { name: '↶ Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('pans with Shift or middle drag without changing processing or history', async () => {
    render(<App />); await open();
    const initialTransform = screen.getByAltText('Enhanced: first.rvg').getAttribute('style');
    startDrag({ shiftKey: true }); moveDrag(140, 120); finishDrag();
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).not.toBe(initialTransform);
    expect(slider('Gamma').value).toBe('0.22'); expect(slider('Tone').value).toBe('0');
    startDrag({ button: 1 }); moveDrag(200, 150); finishDrag();
    expect(slider('Gamma').value).toBe('0.22');
    expect((screen.getByRole('button', { name: '↶ Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('updates during continuous adjustment and coalesces pending work behind a slow render', async () => {
    const pending: { recipe: Recipe; id: string; requestId: number; resolve: (value: RenderInfo) => void }[] = [];
    render(<App />); await open();
    customInvoke = (command, args) => command === 'render_image' ? new Promise(resolve => pending.push({ recipe: args.recipe as Recipe, id: String(args.id), requestId: Number(args.requestId), resolve })) : undefined;
    startDrag(); moveDrag(100, 60); await waitFor(() => expect(pending).toHaveLength(1));
    moveDrag(100, 20); moveDrag(100, -20);
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].resolve(result(pending[0].id, pending[0].requestId)));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).toBe(result(pending[0].id, pending[0].requestId).url);
    expect(screen.getByText(/Updating · last completed image/)).toBeTruthy();
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].recipe.gamma).toBeCloseTo(.52);
    expect(pending[1].requestId).toBeGreaterThan(pending[0].requestId);
    finishDrag();
    await act(async () => pending[1].resolve(result(pending[1].id, pending[1].requestId)));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).toBe(result(pending[1].id, pending[1].requestId).url);
    expect(screen.queryByText(/Updating · last completed image/)).toBeNull();
  });
  it('never displays an old source completion after switching or closing', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open();
    await screen.findByRole('button', { name: '02 second.rvg' });
    let pending!: { id: string; requestId: number; resolve: (value: RenderInfo) => void };
    customInvoke = (command, args) => command === 'render_image' ? new Promise(resolve => { pending = { id: String(args.id), requestId: Number(args.requestId), resolve }; }) : undefined;
    setSlider('Gamma', .4); await waitFor(() => expect(pending).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    const secondUrl = screen.getByAltText('Enhanced: second.rvg').getAttribute('src');
    await act(async () => pending.resolve(result(pending.id, pending.requestId)));
    expect(screen.getByAltText('Enhanced: second.rvg').getAttribute('src')).toBe(secondUrl);
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    setSlider('Gamma', .6); await waitFor(() => expect(pending.requestId).toBeGreaterThan(Number(secondUrl?.match(/\/(\d+)\.png$/)?.[1])));
    fireEvent.click(screen.getByRole('button', { name: 'Close selected' }));
    await act(async () => pending.resolve(result(pending.id, pending.requestId)));
    expect(screen.getByAltText('Enhanced: second.rvg')).toBeTruthy();
    expect(screen.queryByAltText('Enhanced: first.rvg')).toBeNull();
  });
  it('retains independent image recipes and resets to enhanced defaults', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open();
    await screen.findByRole('button', { name: '02 second.rvg' });
    setSlider('Gamma', .72); setSlider('Sharpness strength', 9);
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect(slider('Gamma').value).toBe('0.22');
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    expect(slider('Gamma').value).toBe('0.72');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(slider('Gamma').value).toBe('0.22'); expect(slider('Sharpness strength').value).toBe('6');
  });
  it('toggles false color without changing tone/detail and keeps a linear monochrome histogram', async () => {
    render(<App />); await open(); setSlider('Gamma', .33); setSlider('Tone', 30);
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(screen.getByLabelText('False-color intensity legend')).toBeTruthy();
    expect(slider('Gamma').value).toBe('0.33'); expect(Number(slider('Tone').value)).toBeCloseTo(30); expect(slider('Sharpness strength').value).toBe('6');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, gamma: .33, sharpen: 6 }) })));
    const histogram = screen.getByRole('img', { name: /Monochrome intensity histogram.*linear count/ });
    expect(histogram.querySelector('path')?.getAttribute('d')).toContain('L85.33333333333333,59');
    expect(screen.getByText('Midtones')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize On' }));
    expect(screen.queryByLabelText('False-color intensity legend')).toBeNull();
  });
  it('preserves out-of-range legacy values with a visible note until the control is changed', async () => {
    const legacy = { ...neutral, gamma: 1.2, sharpen: .7 };
    customInvoke = command => command === 'load_presets' ? Promise.resolve([{ name: 'Legacy', recipe: legacy }]) : undefined;
    render(<App />); await open();
    fireEvent.change(screen.getByLabelText('Apply saved preset'), { target: { value: 'Legacy' } });
    expect(screen.getByText(/Stored value 1.20 is outside 0.1–0.9/)).toBeTruthy();
    expect(screen.getByText(/Stored value 0.70 is outside 5–10/)).toBeTruthy();
    expect(slider('Gamma').max).toBe('0.9'); expect(slider('Sharpness strength').min).toBe('5');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: legacy })));
    setSlider('Sharpness strength', 7);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ version: 2, gamma: 1.2, sharpen: 7 }) })));
  });
  it('uses physical pixel scale at 100% and shows binary image display failures', async () => {
    vi.stubGlobal('devicePixelRatio', 2); render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    const enhanced = screen.getByAltText('Enhanced: first.rvg');
    expect(enhanced.getAttribute('style')).toContain('scale(0.5)');
    expect(screen.getByTitle('Source pixels relative to physical display pixels').textContent).toBe('100%');
    fireEvent.error(enhanced);
    expect(screen.getByRole('alert').textContent).toContain('Image display failed');
  });
  it('saves the visible recipe including false color', async () => {
    render(<App />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_review', expect.objectContaining({ review: expect.objectContaining({ images: [expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, gamma: .22, sharpen: 6 }) })] }) })));
  });
});
