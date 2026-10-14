// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageInfo, PatientDiscovery, Recipe, RenderInfo } from './model';

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
    if (command === 'render_snapshot') return Promise.resolve({ ...result(String(args.id), Number(args.requestId)), url: `data:image/png;base64,${args.id}-${args.requestId}` });
    if (command === 'image_thumbnail') return Promise.resolve('data:image/png;base64,dGVzdA==');
    return Promise.resolve(null);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = async () => { fireEvent.click(screen.getByRole('button', { name: 'Open radiographs' })); await screen.findByAltText('Enhanced: first.rvg'); };
const patient = (paths: string[], patientNumber = '00123', patientName: string | null = 'Example Person'): PatientDiscovery => ({ patientNumber, patientName, directory: 'C:\\Synthetic', paths, warnings: [] });
const submitPatient = (value = '00123') => {
  fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
  fireEvent.change(screen.getByLabelText('Patient number'), { target: { value } });
  fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
};
const readyThumbnail = async (name: string) => waitFor(() => expect(screen.getByRole('button', { name }).querySelector('img')).toBeTruthy());
const slider = (label: string) => screen.getByRole('slider', { name: label }) as HTMLInputElement;
const setSlider = (label: string, value: number) => { fireEvent.change(slider(label), { target: { value: String(value) } }); fireEvent.blur(slider(label)); };
const startDrag = (options: PointerEventInit = {}) => fireEvent.pointerDown(screen.getByTestId('image-viewport'), { button: 0, clientX: 100, clientY: 100, pointerId: 1, ...options });
const moveDrag = (x: number, y: number) => fireEvent.pointerMove(screen.getByTestId('image-viewport'), { clientX: x, clientY: y, pointerId: 1 });
const finishDrag = () => fireEvent.pointerUp(screen.getByTestId('image-viewport'), { pointerId: 1 });

describe('enhanced viewer with test-only Tauri IPC', () => {
  it('replaces the strip with all patient radiographs and preserves leading-zero identity', async () => {
    render(<App />); await open();
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient(['selected-patient.rvg', 'another.rvg'], '0067589')) : undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    expect(screen.getByRole('dialog', { name: 'Open patient' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Patient number'));
    fireEvent.change(screen.getByLabelText('Patient number'), { target: { value: ' 0067589 ' } });
    expect(screen.getByText('D:\\ABELDent\\DATA\\NOTES\\89\\0067589')).toBeTruthy();
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    await screen.findByAltText('Enhanced: selected-patient.rvg');
    expect(mocks.invoke).toHaveBeenCalledWith('open_patient', { patientNumber: '0067589' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: '01 first.rvg' })).toBeNull();
    expect(screen.getByRole('button', { name: '01 selected-patient.rvg' })).toBeTruthy();
    await readyThumbnail('02 another.rvg');
    expect(screen.getByLabelText('Current patient').textContent).toContain('Example Person');
    expect(screen.getByLabelText('Current patient').textContent).toContain('0067589');
    expect(mocks.invoke).toHaveBeenCalledWith('release_image', { id: 'first.rvg' });
  });
  it('rejects invalid patient numbers without calling patient discovery', () => {
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    for (const value of ['', '1', '12a', '../123', '１２３', '9'.repeat(65)]) {
      fireEvent.change(screen.getByLabelText('Patient number'), { target: { value } });
      fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
      expect(screen.getByRole('alert').textContent).toContain('2–64 digits only');
    }
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_patient')).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('closes the patient dialog with Cancel or Escape without opening files', () => {
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_patient')).toBe(false);
  });
  it('keeps patient lookup errors local and permits retry without losing the number', async () => {
    customInvoke = command => command === 'open_patient' ? Promise.reject('Patient folder not found') : undefined;
    render(<App />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.change(screen.getByLabelText('Patient number'), { target: { value: '67589' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    await screen.findByText('Patient folder not found');
    expect(screen.getByRole('dialog').contains(screen.getByRole('alert'))).toBe(true);
    expect((screen.getByLabelText('Patient number') as HTMLInputElement).value).toBe('67589');
    expect((screen.getByRole('button', { name: 'Open all radiographs' }) as HTMLButtonElement).disabled).toBe(false);
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient([])) : undefined;
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    await screen.findByText(/No radiographs were found/);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
  });
  it('coalesces patient submissions while discovery is busy and handles no images', async () => {
    let finishPicker!: (value: PatientDiscovery) => void;
    customInvoke = command => command === 'open_patient' ? new Promise(resolve => { finishPicker = resolve; }) : undefined;
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open patient' }));
    fireEvent.change(screen.getByLabelText('Patient number'), { target: { value: '0012' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'open_patient')).toHaveLength(1);
    expect((screen.getByLabelText('Patient number') as HTMLInputElement).disabled).toBe(true);
    await act(async () => finishPicker(patient([])));
    expect(screen.getByText(/No radiographs were found/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'import_image')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows unknown names and discovery warnings, and keeps manual imports unlabelled', async () => {
    customInvoke = command => command === 'open_patient' ? Promise.resolve({ ...patient(['patient.rvg'], '00123', null), warnings: ['Synthetic lookup warning'] }) : undefined;
    render(<App />); submitPatient();
    await screen.findByAltText('Enhanced: patient.rvg');
    expect(screen.getByLabelText('Current patient').textContent).toContain('Name unavailable');
    expect(screen.getByText('Synthetic lookup warning')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '＋ Open images' }));
    await screen.findByAltText('Enhanced: first.rvg');
    expect(screen.queryByLabelText('Current patient')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '01 patient.rvg' }));
    expect(screen.getByLabelText('Current patient').textContent).toContain('00123');
  });
  it('shows failed patient images in the strip and permits retry', async () => {
    customInvoke = (command, args) => command === 'open_patient' ? Promise.resolve(patient(['broken.rvg'])) : command === 'import_image' && args.path === 'broken.rvg' ? Promise.reject('Unsupported encoding') : undefined;
    render(<App />); submitPatient();
    await screen.findByText('broken.rvg: Unsupported encoding');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '01 broken.rvg' })).toBeTruthy();
    customInvoke = undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Retry image' }));
    await screen.findByAltText('Enhanced: broken.rvg');
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
    render(<App />); await open(); await waitFor(() => expect(finishSecond).toBeTruthy());
    expect(screen.getByRole('button', { name: '02 second.rvg' })).toBeTruthy();
    await act(async () => finishSecond(info('second.rvg')));
    await readyThumbnail('02 second.rvg');
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
    await readyThumbnail('02 second.rvg');
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
    await readyThumbnail('02 second.rvg');
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
    expect(screen.getByLabelText('Local contrast color legend')).toBeTruthy();
    expect(slider('Gamma').value).toBe('0.33'); expect(Number(slider('Tone').value)).toBeCloseTo(30); expect(slider('Sharpness strength').value).toBe('6');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, gamma: .33, sharpen: 6 }) })));
    const histogram = screen.getByRole('img', { name: /Monochrome intensity histogram.*linear count/ });
    expect(histogram.querySelector('path')?.getAttribute('d')).toContain('L85.33333333333333,59');
    expect(screen.getByText('Midtones')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize On' }));
    expect(screen.queryByLabelText('Local contrast color legend')).toBeNull();
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
  it('rotates independently per image, exports orientation, and returns to zero after four turns', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    const rotate = () => fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    rotate();
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(90deg)');
    expect(screen.getByRole('button', { name: '01 first.rvg' }).querySelector('img')?.getAttribute('style')).toContain('rotate(90deg)');
    expect((screen.getByRole('button', { name: '↶ Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('export_image', expect.objectContaining({ id: 'first.rvg', rotationQuarterTurns: 1 })));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_review', expect.objectContaining({ review: expect.objectContaining({ images: [expect.objectContaining({ rotationQuarterTurns: 1 }), expect.objectContaining({ rotationQuarterTurns: 0 })] }) })));
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect(screen.getByAltText('Enhanced: second.rvg').getAttribute('style')).toContain('rotate(0deg)');
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(90deg)');
    rotate(); rotate(); rotate();
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(0deg)');
  });
  it('fits rotated dimensions and keeps physical pixel scaling unchanged', async () => {
    vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe() { this.callback([{ contentRect: { width: 1000, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
    render(<App />); await open();
    await waitFor(() => expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain(`scale(${572 / 900})`));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain(`scale(${572 / 1200})`);
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('scale(1) rotate(90deg)');
  });
  it('shows acquisition dates on the active image and every thumbnail with readable source tooltips', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    customInvoke = (command, args) => command === 'import_image' && args.path === 'first.rvg' ? Promise.resolve({ ...info('first.rvg'), metadata: { ...info('first.rvg').metadata, imageDate: '2026-04-08', dateSource: 'ContentDate' } }) : undefined;
    render(<App />); await open(); await readyThumbnail('02 second.rvg');
    expect(screen.getAllByText('08-Apr-2026')).toHaveLength(3);
    expect(screen.getAllByTitle('Image content date')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '02 second.rvg' }).querySelector('time')?.textContent).toBe('Date unavailable');
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect(screen.getAllByText('Date unavailable')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(screen.getByLabelText('Local contrast color legend').textContent).toContain('Darker than nearbyLighter than nearby');
  });
  it('provides local color defaults, range limits, undo, preset preservation and reset', async () => {
    render(<App />); await open();
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(slider('Color amount').value).toBe('0.8');
    expect(slider('Color amount').getAttribute('aria-valuetext')).toBe('80%');
    expect(slider('Color amount').closest('label')?.querySelector('output')?.textContent).toBe('80%');
    expect(slider('Feature size').getAttribute('aria-valuetext')).toBe('8 px');
    expect(slider('Feature size').closest('label')?.querySelector('output')?.textContent).toBe('8 px');
    expect(slider('Color amount').min).toBe('0'); expect(slider('Color amount').max).toBe('1');
    expect(slider('Feature size').value).toBe('8');
    expect(slider('Feature size').min).toBe('2'); expect(slider('Feature size').max).toBe('24');
    expect(screen.getByText('Color emphasizes local midtone differences. Flat areas and extremes stay grayscale.')).toBeTruthy();
    setSlider('Color amount', .42); setSlider('Feature size', 17);
    expect(screen.getByLabelText('Current processing preset').textContent).toContain('Bitewing');
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    expect(slider('Feature size').value).toBe('8'); expect(slider('Color amount').value).toBe('0.42');
    fireEvent.click(screen.getByRole('button', { name: '↷ Redo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
    expect(slider('Feature size').value).toBe('17'); expect(slider('Color amount').value).toBe('0.42');
    expect(screen.getByLabelText('Current processing preset').textContent).toContain('Detail');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, colorStrength: .42, colorScale: 17, sharpen: 8 }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('export_image', expect.objectContaining({ recipe: expect.objectContaining({ colorStrength: .42, colorScale: 17 }) })));
    fireEvent.change(screen.getByLabelText('New preset name'), { target: { value: 'Local overlay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_presets', { presets: [expect.objectContaining({ recipe: expect.objectContaining({ colorStrength: .42, colorScale: 17 }) })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(slider('Color amount').value).toBe('0.8'); expect(slider('Feature size').value).toBe('8');
  });
  it('commits keyboard color adjustment as one undo step with accessible units', async () => {
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    slider('Color amount').focus();
    fireEvent.change(slider('Color amount'), { target: { value: '.81' } });
    fireEvent.keyUp(slider('Color amount'), { key: 'ArrowRight' });
    fireEvent.blur(slider('Color amount'));
    expect(slider('Color amount').getAttribute('aria-valuetext')).toBe('81%');
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    expect(slider('Color amount').getAttribute('aria-valuetext')).toBe('80%');
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
  });
  it('uses legacy overlay defaults without losing existing tone and retains color settings per image', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    customInvoke = command => command === 'load_presets' ? Promise.resolve([{ name: 'Legacy color', recipe: { ...neutral, gamma: .55, colorize: true } }]) : undefined;
    render(<App />); await open(); await readyThumbnail('02 second.rvg');
    fireEvent.change(screen.getByLabelText('Apply saved preset'), { target: { value: 'Legacy color' } });
    expect(slider('Color amount').value).toBe('0.8'); expect(slider('Feature size').value).toBe('8');
    expect(slider('Gamma').value).toBe('0.55');
    setSlider('Color amount', .37); setSlider('Feature size', 20);
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    expect(slider('Color amount').value).toBe('0.37'); expect(slider('Feature size').value).toBe('20');
    expect(slider('Gamma').value).toBe('0.55');
  });
  it('saves the visible recipe including false color', async () => {
    render(<App />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_review', expect.objectContaining({ review: expect.objectContaining({ images: [expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, gamma: .22, sharpen: 6 }) })] }) })));
  });
});

const pane = (name: string) => screen.getByRole('region', { name: `Image: ${name}` });
const paneNames = () => screen.getAllByRole('region', { name: /^Image:/ }).map(element => element.getAttribute('aria-label'));
const pin = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Pin image ${name}` }));
  await screen.findByRole('button', { name: `Unpin image ${name}` });
};
const selectThumbnail = (index: number, name: string) => fireEvent.click(screen.getByRole('button', { name: `${String(index).padStart(2, '0')} ${name}` }));

describe('pinned panes', () => {
  it('keeps pins while replacing one working pane and never duplicates a selected pin', async () => {
    openPaths = ['first.rvg', 'second.rvg', 'third.rvg']; render(<App />); await open(); await readyThumbnail('03 third.rvg');
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg');
    expect(paneNames()).toEqual(['Image: first.rvg', 'Image: second.rvg']);
    selectThumbnail(3, 'third.rvg');
    expect(paneNames()).toEqual(['Image: first.rvg', 'Image: third.rvg']);
    fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }));
    expect(paneNames()).toEqual(['Image: first.rvg']);
    expect(pane('first.rvg').getAttribute('data-selected')).toBe('true');
  });
  it('keeps existing panes in pin order when earlier strip images are pinned later', async () => {
    openPaths = ['first.rvg', 'second.rvg', 'third.rvg']; render(<App />); await open(); await readyThumbnail('03 third.rvg');
    selectThumbnail(3, 'third.rvg'); await pin('third.rvg');
    selectThumbnail(1, 'first.rvg');
    expect(paneNames()).toEqual(['Image: third.rvg', 'Image: first.rvg']);
    await pin('first.rvg');
    expect(paneNames()).toEqual(['Image: third.rvg', 'Image: first.rvg']);
    selectThumbnail(2, 'second.rvg'); await pin('second.rvg');
    expect(paneNames()).toEqual(['Image: third.rvg', 'Image: first.rvg', 'Image: second.rvg']);
    fireEvent.click(screen.getByRole('button', { name: 'Select image third.rvg' }));
    expect(paneNames()).toEqual(['Image: third.rvg', 'Image: first.rvg', 'Image: second.rvg']);
  });
  it('fits three, four, and five panes, preserving zoom when only activation changes', async () => {
    openPaths = ['first.rvg', 'second.rvg', 'third.rvg', 'fourth.rvg', 'fifth.rvg'];
    render(<App />); await open(); await readyThumbnail('05 fifth.rvg');
    await pin('first.rvg');
    for (let index = 1; index < openPaths.length; index++) {
      selectThumbnail(index + 1, openPaths[index]); await pin(openPaths[index]);
      expect(paneNames()).toHaveLength(index + 1);
    }
    expect(screen.getByLabelText('Image panes').getAttribute('style')).toContain('repeat(3, minmax(0, 1fr))');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByAltText('Enhanced: fifth.rvg').getAttribute('style')).toContain('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }));
    expect(screen.getByAltText('Enhanced: fifth.rvg').getAttribute('style')).toContain('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin image fourth.rvg' }));
    expect(paneNames()).toHaveLength(4);
    expect(screen.getByLabelText('Image panes').getAttribute('style')).toContain('repeat(2, minmax(0, 1fr))');
    expect(screen.getByAltText('Enhanced: fifth.rvg').getAttribute('style')).not.toContain('scale(1)');
  });
  it('unpins inactive panes immediately, keeps the active working pane, and closes pins', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg'); await pin('second.rvg');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin image first.rvg' }));
    expect(paneNames()).toEqual(['Image: second.rvg']);
    fireEvent.click(screen.getByRole('button', { name: 'Unpin image second.rvg' }));
    expect(paneNames()).toEqual(['Image: second.rvg']);
    await pin('second.rvg');
    fireEvent.click(screen.getByRole('button', { name: 'Close selected' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Image: second.rvg' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Unpin image second.rvg' })).toBeNull();
  });
  it('activates passive panes without changing either recipe and isolates rotation/adjustments', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg'); await pin('second.rvg'); setSlider('Gamma', .5);
    const firstViewport = within(pane('first.rvg')).getByTestId('image-viewport');
    fireEvent.pointerDown(firstViewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(firstViewport, { clientX: 200, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(firstViewport, { pointerId: 1 });
    expect(slider('Gamma').value).toBe('0.22');
    expect((screen.getByRole('button', { name: '↶ Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(90deg)');
    expect(screen.getByAltText('Enhanced: second.rvg').getAttribute('style')).toContain('rotate(0deg)');
    fireEvent.click(screen.getByRole('button', { name: 'Select image second.rvg' }));
    expect(slider('Gamma').value).toBe('0.5');
  });
  it('keeps pinned views beside a failed selected image and clears pins on patient replacement', async () => {
    openPaths = ['first.rvg', 'broken.rvg'];
    customInvoke = (command, args) => command === 'import_image' && args.path === 'broken.rvg' ? Promise.reject('Synthetic failure') : command === 'open_patient' ? Promise.resolve(patient(['new.rvg'], '00456')) : undefined;
    render(<App />); await open(); await pin('first.rvg'); selectThumbnail(2, 'broken.rvg');
    await screen.findByText('Image unavailable');
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
    expect(paneNames()).toHaveLength(2);
    submitPatient('00456'); await screen.findByAltText('Enhanced: new.rvg');
    expect(paneNames()).toEqual(['Image: new.rvg']);
    expect(screen.queryByRole('button', { name: /Unpin image/ })).toBeNull();
  });
  it('refreshes a pin after editing then switching without publishing a stale intermediate snapshot', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg'); await pin('first.rvg');
    let finish!: (value: RenderInfo) => void;
    let requested!: { id: string; recipe: Recipe; requestId: number };
    customInvoke = (command, args) => command === 'render_snapshot' ? new Promise(resolve => { finish = resolve; requested = args as typeof requested; }) : undefined;
    setSlider('Gamma', .45);
    await waitFor(() => expect(finish).toBeTruthy());
    selectThumbnail(2, 'second.rvg');
    const prior = screen.getByAltText('Enhanced: first.rvg').getAttribute('src');
    expect(within(pane('first.rvg')).getByText(/Updating/)).toBeTruthy();
    expect(requested.recipe.gamma).toBe(.45);
    await act(async () => finish({ ...result(requested.id, requested.requestId), url: 'data:image/png;base64,updated-pin' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).toBe('data:image/png;base64,updated-pin');
    expect(prior).not.toBe('data:image/png;base64,updated-pin');
    expect(pane('second.rvg').getAttribute('data-selected')).toBe('true');
  });
});

describe('pending pin UI', () => {
  it('keeps an initial pending pin visible after selection changes and cancels it without resurrection', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    let finish!: (value: RenderInfo) => void;
    let requested!: { id: string; requestId: number };
    customInvoke = (command, args) => command === 'render_snapshot' ? new Promise(resolve => { finish = resolve; requested = args as typeof requested; }) : undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Pin image first.rvg' }));
    await waitFor(() => expect(finish).toBeTruthy());
    selectThumbnail(2, 'second.rvg');
    expect(paneNames()).toEqual(['Image: first.rvg', 'Image: second.rvg']);
    expect(within(pane('first.rvg')).getByText('Preparing your image…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pin image first.rvg' }).getAttribute('aria-busy')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Pin image first.rvg' }));
    expect(paneNames()).toEqual(['Image: second.rvg']);
    await act(async () => finish({ ...result(requested.id, requested.requestId), url: 'data:image/png;base64,cancelled' }));
    expect(paneNames()).toEqual(['Image: second.rvg']);
  });
  it('keeps a persistent stale-pin warning after dismissing a failed-refresh notification', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg'); await pin('first.rvg');
    customInvoke = command => command === 'render_snapshot' ? Promise.reject('Synthetic pin failure') : undefined;
    setSlider('Gamma', .47);
    await screen.findByText('Pinned copy update failed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    selectThumbnail(2, 'second.rvg');
    expect(within(pane('first.rvg')).getByText('Pinned image update failed · showing previous settings')).toBeTruthy();
    customInvoke = undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }));
    setSlider('Gamma', .48);
    await waitFor(() => expect(screen.queryByText('Pinned copy update failed')).toBeNull());
  });
  it('saves pin state and individual pane views without embedding full image snapshots', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg'); await pin('second.rvg');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_review', expect.objectContaining({ review: expect.objectContaining({ images: [expect.objectContaining({ source: 'first.rvg', pinned: true, view: expect.objectContaining({ fit: true }) }), expect.objectContaining({ source: 'second.rvg', pinned: true, view: expect.objectContaining({ fit: false, scale: 1 }) })] }) })));
    const saved = mocks.invoke.mock.calls.find(([command]) => command === 'save_review')?.[1];
    expect(JSON.stringify(saved)).not.toContain('data:image');
  });
});
