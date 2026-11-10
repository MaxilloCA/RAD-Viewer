// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Exercise Windows behavior on either host; Mac behavior has its own suite.
vi.mock('./buildInfo', async importOriginal => ({
  buildInfo: { ...(await importOriginal<typeof import('./buildInfo')>()).buildInfo, os: 'windows', platform: 'Windows x64', engine: 'Tauri 2 · WebView2' },
}));
import { sliderPosition, withRadiographDetail } from './model';
import type { ImageInfo, PatientDiscovery, Recipe, RenderInfo } from './model';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: () => Promise.resolve(() => {}) }) }));
vi.mock('./viewerExport', async importOriginal => ({ ...await importOriginal<typeof import('./viewerExport')>(), loadBitmap: async () => ({}), drawExportBranding: vi.fn(async () => {}) }));
import App from './App';
import packageInfo from '../package.json';

const neutral: Recipe = { version: 1, windowCenter: 2048, windowWidth: 4096, gamma: 1, denoise: 0, localContrast: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false, colorize: false };
const info = (name: string): ImageInfo => ({ id: name, width: 1200, height: 900, neutral, decodeMs: 15, metadata: { name, format: 'DICOM', bitsStored: 12, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0, windowCenter: null, windowWidth: null, min: 0, max: 4095 } });
const result = (id: string, requestId: number): RenderInfo => ({ id, requestId, url: `http://test.local/${id}/${requestId}.png`, histogram: [0, 1, 2, 4], clippedLow: 3, clippedHigh: 5, renderMs: 25 });
let openPaths: string[];
let customInvoke: ((command: string, args: Record<string, unknown>) => Promise<unknown> | undefined) | undefined;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),drawImage:vi.fn(),fillText:vi.fn()})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,canvas';
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
    if (command === 'choose_jpeg_export_directory') return Promise.resolve('C:\\Exports');
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

describe('About and help', () => {
  it('keeps calibration isolated to its radiograph when switching images', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
    const first = within(screen.getByRole('region', { name: 'Image: first.rvg' })).getByTestId('image-viewport');
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(first, { button: 0, pointerId: 1, clientX: 20, clientY: 0 });
    fireEvent.change(screen.getByLabelText('Known length (mm)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply calibration' }));
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect(screen.getByText(/temporary 1 mm\/pixel/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Clear calibration' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    expect(screen.getByText('Drag to measure · Calibrated estimates')).toBeTruthy();
    expect(screen.getByText('Reference · 10.0 mm')).toBeTruthy();
  });
  it('calibrates existing and new measurements, rejects invalid input, and supports recalibration and clearing', async () => {
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    const viewport = screen.getByTestId('image-viewport');
    const draw = (length: number) => {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerUp(viewport, { button: 0, pointerId: 1, clientX: length, clientY: 0 });
    };
    draw(40);
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' })); draw(20);
    const dialog = screen.getByRole('dialog', { name: 'Calibrate radiograph' });
    fireEvent.change(within(dialog).getByLabelText('Known length (mm)'), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply calibration' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('greater than zero');
    fireEvent.change(within(dialog).getByLabelText('Known length (mm)'), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply calibration' }));
    expect(screen.getByText('20.0 mm · estimated')).toBeTruthy();
    expect(screen.getByText('Reference · 10.0 mm')).toBeTruthy();
    draw(10); expect(screen.getByText('5.0 mm · estimated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recalibrate' })); draw(20);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('20.0 mm · estimated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recalibrate' })); draw(20);
    fireEvent.change(screen.getByLabelText('Known length (mm)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply calibration' }));
    expect(screen.getByText('10.0 mm · estimated')).toBeTruthy();
    expect(screen.getByText('2.5 mm · estimated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear calibration' }));
    expect(screen.queryByText(/mm · estimated/)).toBeNull();
    expect(viewport.querySelectorAll('line')).toHaveLength(2);
  });
  it('adds and removes session measurements using the Windows toolbar', async () => {
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getByText(/temporary 1 mm\/pixel/)).toBeTruthy();
    const viewport = screen.getByTestId('image-viewport');
    const draw = () => {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerUp(viewport, { button: 0, pointerId: 1, clientX: 20, clientY: 0 });
    };
    draw(); draw();
    expect(viewport.querySelectorAll('line')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove last' }));
    expect(viewport.querySelectorAll('line')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear measurements' }));
    expect(viewport.querySelectorAll('line')).toHaveLength(0);
  });
  it('opens offline credits, build information and help, and restores focus on Escape', () => {
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'About & help' });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'About & help' });
    expect(within(dialog).getByText('Michal Goralski, DDS, MSc FRCD(C)')).toBeTruthy();
    expect(dialog.textContent).toContain('goralsi@kidsdentistry.ca');
    expect(dialog.textContent).toContain('Barrie, ON - Canada');
    expect(within(dialog).getByText(packageInfo.version)).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Quick help' })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'About & help' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('dismisses with Done without closing images', async () => {
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'About & help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'About & help' })).toBeNull();
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
  });
});

describe('deletion review', () => {
  const deleteReady = async () => {
    const button = screen.getByRole('button', { name: 'Delete' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    return screen.findByRole('dialog', { name: /Review .* selected radiograph/ });
  };
  const hashedImage = (path: string) => ({ ...info(path), sourceSha256: `hash-${path}` });
  it('shows the requested action order and three separators', () => {
    render(<App />);
    const header = document.querySelector('.header-actions')!;
    expect(within(header as HTMLElement).getAllByRole('button').map(button => button.textContent)).toEqual(['Reload Images', 'Print Current View', 'Export for Letter', 'Export to JPEG', 'Delete', 'Open Images', 'Open Patient']);
    expect(within(header as HTMLElement).getAllByRole('separator')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('danger');
  });
  it('previews the selected image fullscreen and cancels without moving any files', async () => {
    customInvoke = (command, args) => command === 'import_image' ? Promise.resolve(hashedImage(String(args.path))) : undefined;
    render(<App />); await open();
    const dialog = await deleteReady();
    expect(within(dialog).getByRole('img', { name: 'Delete preview: first.rvg' })).toBeTruthy();
    expect(dialog.textContent).toContain('DELETED');
    expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_fullscreen', { fullscreen: true });
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'delete_images')).toBe(false);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_fullscreen', { fullscreen: false });
  });
  it('moves only confirmed selections once, disables cancellation during the move, and removes their previews', async () => {
    let finish!: (value: unknown) => void;
    customInvoke = (command, args) => command === 'import_image' ? Promise.resolve(hashedImage(String(args.path)))
      : command === 'delete_images' ? new Promise(resolve => { finish = resolve; }) : undefined;
    render(<App />); await open();
    const dialog = await deleteReady();
    const confirm = within(dialog).getByRole('button', { name: 'Move to DELETED' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'delete_images')).toHaveLength(1));
    expect(mocks.invoke).toHaveBeenCalledWith('delete_images', { items: [{ path: 'first.rvg', directory: null, sourceSha256: 'hash-first.rvg' }] });
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => finish([{ path: 'first.rvg', destination: 'DELETED/first.rvg', error: null, warning: null }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByAltText('Enhanced: first.rvg')).toBeNull();
    expect(screen.queryByRole('button', { name: '01 first.rvg' })).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith('release_image', { id: 'first.rvg' });
  });
  it('reviews the full selection and keeps failed files available after a partial move', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    customInvoke = (command, args) => command === 'import_image' ? Promise.resolve(hashedImage(String(args.path)))
      : command === 'delete_images' ? Promise.resolve([
        { path: 'first.rvg', destination: 'DELETED/first.rvg', error: null, warning: null },
        { path: 'second.rvg', destination: null, error: 'Access denied', warning: null },
      ]) : undefined;
    render(<App />); await open(); await readyThumbnail('02 second.rvg');
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }), { ctrlKey: true });
    await screen.findByText('2 images selected');
    const dialog = await deleteReady();
    expect(within(dialog).getAllByRole('img')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to DELETED' }));
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('Access denied'));
    expect(within(dialog).getAllByRole('img')).toHaveLength(1);
    expect(within(dialog).getByRole('img', { name: 'Delete preview: second.rvg' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByAltText('Enhanced: first.rvg')).toBeNull();
    expect(screen.getByAltText('Enhanced: second.rvg')).toBeTruthy();
  });
});
const patient = (paths: string[], patientNumber = '00123', patientName: string | null = 'Example Person'): PatientDiscovery => ({ patientNumber, patientName, directory: 'C:\\Synthetic', paths, latestDatePaths: paths.slice(0, 2), warnings: [] });

it('opens John Smith demo without a patient number or office lookup, and refreshes it locally', async () => {
  const demo={...patient(['demo-1.dcm','demo-2.dcm'],'DEMO','John Smith'),firstName:'John',lastName:'Smith'};
  customInvoke=command=>command==='open_demo_patient'?Promise.resolve(demo):undefined;
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'Open John Smith demo'}));
  await screen.findByAltText('Enhanced: demo-1.dcm');
  expect(screen.getByLabelText('Current patient').textContent).toContain('John Smith');
  expect(mocks.invoke.mock.calls.some(([command])=>command==='open_patient')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Reload Images'}));
  await waitFor(()=>expect(mocks.invoke.mock.calls.filter(([command])=>command==='open_demo_patient')).toHaveLength(2));
  expect(screen.getByRole('button',{name:'Export for Letter'})).toBeTruthy();
});

it('prevents duplicate demo opening and reports demo errors in the patient form', async () => {
  let fail!:(reason:string)=>void;
  customInvoke=command=>command==='open_demo_patient'?new Promise((_,reject)=>{fail=reject;}):undefined;
  render(<App/>);
  const demo=screen.getByRole('button',{name:'Open John Smith demo'});
  fireEvent.click(demo);fireEvent.click(demo);
  expect(mocks.invoke.mock.calls.filter(([command])=>command==='open_demo_patient')).toHaveLength(1);
  expect((demo as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>fail('Demo folder unavailable'));
  expect(screen.getByRole('alert').textContent).toContain('Demo folder unavailable');
  expect((demo as HTMLButtonElement).disabled).toBe(false);
});
const submitPatient = (value = '00123') => {
  fireEvent.click(screen.getByRole('button', { name: 'Open Patient' }));
  fireEvent.change(screen.getByLabelText('Patient number'), { target: { value } });
  fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
};
const readyThumbnail = async (name: string) => waitFor(() => expect(screen.getByRole('button', { name }).querySelector('img')).toBeTruthy());
const slider = (label: string) => screen.getByRole('slider', { name: label }) as HTMLInputElement;
const centers: Record<string, number> = { Gamma: .35, Tone: 35, Contrast: -40, 'Sharpness strength': 7 };
const actualValue = (label: string) => String(Number(Number(slider(label).getAttribute('aria-valuenow')).toFixed(6)));
const setSlider = (label: string, value: number) => {
  const control = slider(label);
  const position = label in centers ? sliderPosition(value, Number(control.getAttribute('aria-valuemin')), centers[label], Number(control.getAttribute('aria-valuemax'))) : value;
  fireEvent.change(control, { target: { value: String(position) } }); fireEvent.blur(control);
};
const startDrag = (options: PointerEventInit = {}) => fireEvent.pointerDown(screen.getByTestId('image-viewport'), { button: 0, clientX: 100, clientY: 100, pointerId: 1, ...options });
const moveDrag = (x: number, y: number) => fireEvent.pointerMove(screen.getByTestId('image-viewport'), { clientX: x, clientY: y, pointerId: 1 });
const finishDrag = () => fireEvent.pointerUp(screen.getByTestId('image-viewport'), { pointerId: 1 });

describe('enhanced viewer with test-only Tauri IPC', () => {
  it('shows the fixed Radiograph multiscale detail method in Advanced processing',async()=>{
    render(<App/>);await open();
    const details=screen.getByText('Detailed adjustments').closest('details')!;
    details.open=true;
    fireEvent.click(screen.getByRole('button',{name:/Advanced processing/}));
    expect(screen.getByText('Detail method: Radiograph multiscale')).toBeTruthy();
    expect(screen.queryByRole('combobox',{name:'Detail method'})).toBeNull();
    expect(screen.queryByRole('option',{name:'Unsharp'})).toBeNull();
    expect(screen.queryByRole('option',{name:'Legacy two-scale'})).toBeNull();
  });
  it('starts with patient entry and keeps detailed controls collapsed after opening', async () => {
    render(<App />);
    expect(screen.getByLabelText('Patient number')).toBe(document.activeElement);
    expect(screen.getByRole('button', { name: 'Open Patient' }).className).toContain('primary');
    await open();
    for (const title of ['Detailed adjustments', 'Intensity histogram', 'Saved presets']) expect(screen.getByText(title).closest('details')?.open).toBe(false);
    expect(screen.getByLabelText('Adjusting selected image').textContent).toContain('first.rvg');
    expect(screen.getByRole('button', { name: 'Hold to compare with neutral' })).toBeTruthy();
  });
  it('sets and clears the native patient title as selection changes', async () => {
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient(['patient.rvg'], '00123', 'Synthetic Patient')) : undefined;
    render(<App />); submitPatient(); await screen.findByAltText('Enhanced: patient.rvg');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_title', { title: 'Synthetic Patient · Patient ID 00123 — RAD Viewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Images' })); await screen.findByAltText('Enhanced: first.rvg');
    expect(document.title).toBe('RAD Viewer');
    expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_title', { title: 'RAD Viewer' });
  });
  it('restores the enhanced frame immediately when comparison ends without changing history', async () => {
    render(<App />); await open();
    const before = screen.getByAltText('Enhanced: first.rvg').getAttribute('src');
    const compare = screen.getByRole('button', { name: 'Hold to compare with neutral' });
    fireEvent.pointerDown(compare, { button: 0, pointerId: 1 });
    await screen.findByText('Neutral · release to restore');
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).not.toBe(before);
    fireEvent.pointerUp(compare, { pointerId: 1 });
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).toBe(before);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps drawings with their images through swaps, exports and patient changes', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    await pin('first.rvg');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpin image first.rvg' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ellipse' }));
    const viewport = within(screen.getByRole('region', { name: 'Image: second.rvg' })).getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 60, clientY: 60 });
    expect(screen.getByRole('region', { name: 'Image: second.rvg' }).querySelectorAll('ellipse')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Select image second.rvg' }), { key: 'ArrowLeft' });
    expect(screen.getByLabelText('Image panes').firstElementChild?.getAttribute('aria-label')).toBe('Image: second.rvg');
    fireEvent.click(screen.getByRole('button', { name: 'Export to JPEG' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('export_image', expect.objectContaining({ id: 'second.rvg', ellipses: [expect.objectContaining({ color: 'red' })] })));
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient(['new-patient.rvg'])) : undefined;
    submitPatient(); await screen.findByAltText('Enhanced: new-patient.rvg');
    expect(document.querySelectorAll('.image-markup ellipse')).toHaveLength(0);
  });
  it('removes dark-area review and collapses both drawers without removing images', async () => {
    render(<App />); await open();
    expect(screen.queryByText(/Dark-area review/)).toBeNull();
    expect(screen.queryByText(/MONOCHROME2/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide adjustments' }));
    expect(screen.getByRole('button', { name: 'Show adjustments' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Previews/ }));
    expect(screen.getByRole('button', { name: /Previews/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
  });
  it('replaces the strip with all patient radiographs and preserves leading-zero identity', async () => {
    render(<App />); await open();
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient(['selected-patient.rvg', 'another.rvg'], '0067589')) : undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Open Patient' }));
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
  it('opens a launch patient once under StrictMode and automatically shows the latest pair', async () => {
    customInvoke = command => command === 'launch_patient_number' ? Promise.resolve('0067589') : command === 'open_patient' ? Promise.resolve(patient(['new.rvg', 'older.rvg'], '0067589')) : undefined;
    render(<StrictMode><App /></StrictMode>);
    await screen.findByAltText('Enhanced: older.rvg');
    expect(screen.getByAltText('Enhanced: new.rvg')).toBeTruthy();
    expect(screen.getByLabelText('Current patient').textContent).toContain('Patient ID 0067589');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'open_patient')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('reports bad launch arguments and missing patients without opening a picker', async () => {
    customInvoke = command => command === 'launch_patient_number' ? Promise.reject('Invalid patient number') : undefined;
    render(<App />);
    await screen.findByText('Could not open launch patient: Invalid patient number');
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'choose_images')).toBe(false);
  });
  it('keeps the launch patient identity visible when no radiographs are found', async () => {
    customInvoke = command => command === 'launch_patient_number' ? Promise.resolve('0067589') : command === 'open_patient' ? Promise.resolve(patient([], '0067589')) : undefined;
    render(<App />);
    await screen.findByText('Could not open launch patient: No radiographs were found for this patient.');
    expect(screen.getByLabelText('Current patient').textContent).toContain('Example Person');
    expect(screen.getByLabelText('Current patient').textContent).toContain('0067589');
  });
  it('does not let delayed launch discovery replace manually selected images', async () => {
    let finish!: (value: PatientDiscovery) => void;
    customInvoke = command => command === 'launch_patient_number' ? Promise.resolve('0067589') : command === 'open_patient' ? new Promise(resolve => { finish = resolve; }) : undefined;
    render(<App />); await waitFor(() => expect(finish).toBeTruthy());
    await open();
    await act(async () => finish(patient(['late.rvg'])));
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '01 late.rvg' })).toBeNull();
  });
  it('rejects invalid patient numbers without calling patient discovery', () => {
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open Patient' }));
    for (const value of ['', '1', '12a', '../123', '１２３', '9'.repeat(65)]) {
      fireEvent.change(screen.getByLabelText('Patient number'), { target: { value } });
      fireEvent.submit(screen.getByRole('form', { name: 'Open patient' }));
      expect(screen.getByRole('alert').textContent).toContain('2–64 digits only');
    }
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_patient')).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('closes the patient dialog with Cancel or Escape without opening files', () => {
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open Patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Patient' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_patient')).toBe(false);
  });
  it('keeps patient lookup errors local and permits retry without losing the number', async () => {
    customInvoke = command => command === 'open_patient' ? Promise.reject('Patient folder not found') : undefined;
    render(<App />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Open Patient' }));
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
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open Patient' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Open Images' }));
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
    expect(actualValue('Gamma')).toBe('0.35'); expect(slider('Gamma').getAttribute('aria-valuemin')).toBe('0.1'); expect(slider('Gamma').getAttribute('aria-valuemax')).toBe('0.9');
    expect(actualValue('Sharpness strength')).toBe('7'); expect(slider('Sharpness strength').getAttribute('aria-valuemin')).toBe('0'); expect(slider('Sharpness strength').getAttribute('aria-valuemax')).toBe('12');
    expect(actualValue('Tone')).toBe('35'); expect(actualValue('Contrast')).toBe('-40');
    expect(screen.queryByRole('slider', { name: 'Window center' })).toBeNull();
  });
  it('uses seven processing stops without changing tone, gamma or color and groups undo', async () => {
    render(<App />); await open();
    for (const [label, middle] of Object.entries(centers)) {
      expect(Number(slider(label).value)).toBeCloseTo(50);
      expect(Number(slider(label).getAttribute('aria-valuenow'))).toBeCloseTo(middle);
    }
    for (const name of ['Low', 'Med', 'High']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(slider('Processing level').min).toBe('0'); expect(slider('Processing level').max).toBe('7'); expect(slider('Processing level').step).toBe('1');
    expect(actualValue('Processing level')).toBe('4');
    setSlider('Gamma', .63); setSlider('Tone', -24);
    const level = slider('Processing level');
    for (const stop of [1, 2, 3, 5, 6, 7]) fireEvent.change(level, { target: { value: String(stop) } });
    fireEvent.pointerUp(level); fireEvent.blur(level);
    expect(actualValue('Gamma')).toBe('0.63'); expect(actualValue('Tone')).toBe('-24');
    expect(actualValue('Sharpness strength')).toBe('11.5'); expect(actualValue('Contrast')).toBe('40');
    expect(screen.getByLabelText('Current processing preset').textContent).toContain('Level 7');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actualValue('Processing level')).toBe('4'); expect(actualValue('Gamma')).toBe('0.63'); expect(actualValue('Tone')).toBe('-24');
    startDrag(); moveDrag(120, 80); finishDrag();
    expect(actualValue('Processing level')).toBe('4');
    setSlider('Sharpness strength', 9.1);
    expect(screen.getByLabelText('Current processing preset').textContent).toContain('Custom adjustments');
  });
  it('selects each processing stop with Ctrl+number and preserves gamma', async () => {
    render(<App />); await open();
    const level = slider('Processing level');
    level.focus();
    for (const stop of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(fireEvent.keyDown(level, { key: String(stop), ctrlKey: true })).toBe(false);
      expect(screen.getByRole('button', { name: `Processing level ${stop}` }).getAttribute('aria-pressed')).toBe('true');
    }
    fireEvent.keyDown(level, { key: '0', ctrlKey: true, repeat: true });
    expect(actualValue('Processing level')).toBe('7');
    expect(actualValue('Gamma')).toBe('0.35');
    fireEvent.keyDown(level, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(actualValue('Processing level')).toBe('7');
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(actualValue('Processing level')).toBe('6');
  });
  it('maps pointer slider positions back to real tone and contrast values', async () => {
    render(<App />); await open();
    setSlider('Tone', -30); setSlider('Contrast', 70);
    expect(actualValue('Tone')).toBe('-30'); expect(actualValue('Contrast')).toBe('70');
    fireEvent.change(slider('Tone'), { target: { value: '50' } }); fireEvent.blur(slider('Tone'));
    fireEvent.change(slider('Contrast'), { target: { value: '50' } }); fireEvent.blur(slider('Contrast'));
    expect(actualValue('Tone')).toBe('35'); expect(actualValue('Contrast')).toBe('-40');
    fireEvent.change(slider('Sharpness strength'), { target: { value: '100' } }); fireEvent.blur(slider('Sharpness strength'));
    expect(actualValue('Sharpness strength')).toBe('12');
    fireEvent.change(slider('Sharpness strength'), { target: { value: '0' } }); fireEvent.blur(slider('Sharpness strength'));
    expect(actualValue('Sharpness strength')).toBe('0');
  });
  it('steps centered sliders in actual units and commits a held keyboard adjustment once', async () => {
    render(<App />); await open();
    const gamma = slider('Gamma'); gamma.focus();
    fireEvent.keyDown(gamma, { key: 'ArrowRight' }); fireEvent.keyDown(gamma, { key: 'ArrowRight', repeat: true }); fireEvent.keyUp(gamma, { key: 'ArrowRight' }); fireEvent.blur(gamma);
    expect(actualValue('Gamma')).toBe('0.37'); expect(gamma.getAttribute('aria-valuetext')).toBe('0.37');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actualValue('Gamma')).toBe('0.35'); expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    for (const [label, min, max, increment] of [['Gamma', .1, .9, .01], ['Tone', -100, 100, 1], ['Contrast', -100, 100, 1], ['Sharpness strength', 0, 12, .1]] as const) {
      fireEvent.keyDown(slider(label), { key: 'Home' }); fireEvent.keyUp(slider(label), { key: 'Home' }); expect(Number(actualValue(label))).toBe(min);
      fireEvent.keyDown(slider(label), { key: 'ArrowRight' }); fireEvent.keyUp(slider(label), { key: 'ArrowRight' }); expect(Number(actualValue(label))).toBeCloseTo(min + increment);
      fireEvent.keyDown(slider(label), { key: 'End' }); fireEvent.keyUp(slider(label), { key: 'End' }); expect(Number(actualValue(label))).toBe(max);
    }
  });
  it('uses polarity-aware preset tone for MONOCHROME1 sources', async () => {
    customInvoke = (command, args) => command === 'import_image' ? Promise.resolve({ ...info(String(args.path)), metadata: { ...info(String(args.path)).metadata, photometric: 'MONOCHROME1' } }) : undefined;
    render(<App />); await open();
    expect(actualValue('Tone')).toBe('35');
    setSlider('Processing level', 7);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ gamma: .35, sharpen: 11.5, windowCenter: neutral.windowCenter + neutral.windowWidth * .25 * .35 }) })));
    expect(screen.getByLabelText('Current processing preset').textContent).toContain('Level 7');
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
    expect(Number(actualValue('Gamma'))).toBeCloseTo(.45);
    expect(Number(actualValue('Contrast'))).toBeCloseTo(0);
    expect(actualValue('Tone')).toBe('35');
    finishDrag();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actualValue('Gamma')).toBe('0.35'); expect(actualValue('Tone')).toBe('35');
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(actualValue('Gamma')).toBe('0.45');
  });
  it('bounds drag changes and commits cancellation exactly once', async () => {
    render(<App />); await open();
    startDrag(); moveDrag(10000, -10000);
    expect(actualValue('Gamma')).toBe('0.9'); expect(actualValue('Contrast')).toBe('100');
    fireEvent.pointerCancel(screen.getByTestId('image-viewport'), { pointerId: 1 });
    fireEvent.lostPointerCapture(screen.getByTestId('image-viewport'), { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actualValue('Gamma')).toBe('0.35');
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not create undo history for a click or zero-distance move', async () => {
    render(<App />); await open(); startDrag(); moveDrag(100, 100); finishDrag();
    expect(actualValue('Gamma')).toBe('0.35');
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('pans with Shift or middle drag without changing processing or history', async () => {
    render(<App />); await open();
    const initialTransform = screen.getByAltText('Enhanced: first.rvg').getAttribute('style');
    startDrag({ shiftKey: true }); moveDrag(140, 120); finishDrag();
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).not.toBe(initialTransform);
    expect(actualValue('Gamma')).toBe('0.35'); expect(actualValue('Tone')).toBe('35');
    startDrag({ button: 1 }); moveDrag(200, 150); finishDrag();
    expect(actualValue('Gamma')).toBe('0.35');
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('uses preview during continuous adjustment, coalesces work and refines on release', async () => {
    const pending: { recipe: Recipe; id: string; requestId: number; preview: boolean; resolve: (value: RenderInfo) => void }[] = [];
    render(<App />); await open();
    customInvoke = (command, args) => command === 'render_image' ? new Promise(resolve => pending.push({ recipe: args.recipe as Recipe, id: String(args.id), requestId: Number(args.requestId), preview: Boolean(args.preview), resolve })) : undefined;
    const complete = async (index: number) => act(async () => { const work = pending[index]; work.resolve({ ...result(work.id, work.requestId), preview: work.preview }); });
    startDrag(); moveDrag(100, 60); await waitFor(() => expect(pending).toHaveLength(1));
    moveDrag(100, 20); moveDrag(100, -20);
    expect(pending).toHaveLength(1); expect(pending[0].preview).toBe(true);
    await complete(0);
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).toBe(result(pending[0].id, pending[0].requestId).url);
    expect(screen.getByText(/Interactive preview/)).toBeTruthy();
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].recipe.gamma).toBeCloseTo(.65);
    finishDrag(); await complete(1);
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].preview).toBe(false); expect(pending[2].recipe.gamma).toBeCloseTo(.65);
    await complete(2);
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).toBe(result(pending[2].id, pending[2].requestId).url);
    expect(screen.queryByText(/Interactive preview/)).toBeNull();
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
    expect(actualValue('Gamma')).toBe('0.35');
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    expect(actualValue('Gamma')).toBe('0.72');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(actualValue('Gamma')).toBe('0.35'); expect(actualValue('Contrast')).toBe('-40'); expect(actualValue('Sharpness strength')).toBe('7');
  });
  it('toggles false color without changing tone/detail and keeps a linear monochrome histogram', async () => {
    render(<App />); await open(); setSlider('Gamma', .33); setSlider('Tone', 30);
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(screen.getByLabelText('Midtone Contrast legend')).toBeTruthy();
    expect(actualValue('Gamma')).toBe('0.33'); expect(Number(actualValue('Tone'))).toBeCloseTo(30); expect(actualValue('Sharpness strength')).toBe('7');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, gamma: .33, sharpen: 7 }) })));
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
    expect(actualValue('Sharpness strength')).toBe('0.7');
    expect(screen.queryByText(/Stored value 0.70/)).toBeNull();
    expect(slider('Gamma').getAttribute('aria-valuemax')).toBe('0.9'); expect(slider('Sharpness strength').getAttribute('aria-valuemin')).toBe('0');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: withRadiographDetail(legacy) })));
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
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Export to JPEG' }));
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
    await waitFor(() => expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain(`scale(${594 / 900})`));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain(`scale(${594 / 1200})`);
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('scale(1) rotate(90deg)');
  });
  it('shows acquisition dates on the active image and every thumbnail with readable source tooltips', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    customInvoke = (command, args) => command === 'import_image' && args.path === 'first.rvg' ? Promise.resolve({ ...info('first.rvg'), metadata: { ...info('first.rvg').metadata, imageDate: '2026-04-08', dateSource: 'ContentDate' } }) : undefined;
    render(<App />); await open(); await readyThumbnail('02 second.rvg');
    expect(screen.getAllByText('08-Apr-2026')).toHaveLength(4);
    expect(screen.getAllByTitle('Image content date')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '02 second.rvg' }).querySelector('time')?.textContent).toBe('Date unavailable');
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect(screen.getAllByText('Date unavailable')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(screen.queryByRole('option', { name: 'Local contrast color' })).toBeNull();
  });
  it('provides midtone color defaults, range limits, undo, preset preservation and reset', async () => {
    render(<App />); await open();
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(slider('Color amount').value).toBe('0.4');
    expect(slider('Color amount').getAttribute('aria-valuetext')).toBe('40%');
    expect(slider('Color amount').closest('label')?.querySelector('output')?.textContent).toBe('40%');
    expect(slider('Sensitivity').getAttribute('aria-valuetext')).toBe('±15 points');
    expect(slider('Sensitivity').closest('label')?.querySelector('output')?.textContent).toBe('±15 points');
    expect(slider('Color amount').min).toBe('0'); expect(slider('Color amount').max).toBe('1');
    expect(slider('Sensitivity').value).toBe('17');
    expect(slider('Sensitivity').min).toBe('2'); expect(slider('Sensitivity').max).toBe('30');
    expect(screen.queryByRole('slider', { name: 'Feature size' })).toBeNull();
    setSlider('Color amount', .42); setSlider('Sensitivity', 20);
    expect(screen.getByLabelText('Current processing preset').textContent).toContain('Custom adjustments');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(slider('Sensitivity').value).toBe('17'); expect(slider('Color amount').value).toBe('0.42');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    setSlider('Processing level', 7);
    expect(slider('Sensitivity').value).toBe('20'); expect(slider('Color amount').value).toBe('0.42');
    expect(screen.getByLabelText('Current processing preset').textContent).toContain('Level 7');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, colorStrength: .42, midtoneWidth: .12, sharpen: 11.5 }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Export to JPEG' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('export_image', expect.objectContaining({ recipe: expect.objectContaining({ colorStrength: .42, midtoneWidth: .12 }) })));
    fireEvent.change(screen.getByLabelText('New preset name'), { target: { value: 'Midtone overlay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_presets', { presets: [expect.objectContaining({ recipe: expect.objectContaining({ colorStrength: .42, midtoneWidth: .12 }) })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    expect(slider('Color amount').value).toBe('0.4'); expect(slider('Sensitivity').value).toBe('17');
  });
  it('commits keyboard color adjustment as one undo step with accessible units', async () => {
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    slider('Color amount').focus();
    fireEvent.change(slider('Color amount'), { target: { value: '.81' } });
    fireEvent.keyUp(slider('Color amount'), { key: 'ArrowRight' });
    fireEvent.blur(slider('Color amount'));
    expect(slider('Color amount').getAttribute('aria-valuetext')).toBe('81%');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(slider('Color amount').getAttribute('aria-valuetext')).toBe('40%');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
  });
  it('uses legacy overlay defaults without losing existing tone and retains color settings per image', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    customInvoke = command => command === 'load_presets' ? Promise.resolve([{ name: 'Legacy color', recipe: { ...neutral, gamma: .55, colorize: true } }]) : undefined;
    render(<App />); await open(); await readyThumbnail('02 second.rvg');
    fireEvent.change(screen.getByLabelText('Apply saved preset'), { target: { value: 'Legacy color' } });
    expect(slider('Color amount').value).toBe('0.8');
    expect(actualValue('Gamma')).toBe('0.55');
    setSlider('Color amount', .37);
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
    expect(screen.queryByRole('slider', { name: 'Color amount' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '01 first.rvg' }));
    expect(slider('Color amount').value).toBe('0.37');
    expect(actualValue('Gamma')).toBe('0.55');
  });
  it('saves the visible recipe including false color', async () => {
    render(<App />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_review', expect.objectContaining({ review: expect.objectContaining({ images: [expect.objectContaining({ recipe: expect.objectContaining({ colorize: true, gamma: .35, sharpen: 7 }) })] }) })));
  });
});

const pane = (name: string) => screen.getByRole('region', { name: `Image: ${name}` });
const paneNames = () => screen.getAllByRole('region', { name: /^Image:/ }).map(element => element.getAttribute('aria-label'));
const pin = async (name: string) => {
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`pin image ${name}`, 'i') }).getAttribute('aria-busy')).not.toBe('true'));
  const button = screen.queryByRole('button', { name: `Pin image ${name}` });
  if (button) fireEvent.click(button);
  await screen.findByRole('button', { name: `Unpin image ${name}` });
};
const selectThumbnail = (index: number, name: string) => fireEvent.click(screen.getByRole('button', { name: `${String(index).padStart(2, '0')} ${name}` }));

describe('pinned panes', () => {
  it('replaces the working pane from the filmstrip but preserves it when selecting a visible pin', async () => {
    openPaths = ['first.rvg', 'second.rvg', 'third.rvg']; render(<App />); await open(); await readyThumbnail('03 third.rvg');
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg');
    expect(paneNames()).toEqual(['Image: first.rvg', 'Image: second.rvg']);
    selectThumbnail(3, 'third.rvg');
    expect(paneNames()).toEqual(['Image: first.rvg', 'Image: second.rvg', 'Image: third.rvg']);
    fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }));
    expect(paneNames()).toEqual(['Image: first.rvg', 'Image: second.rvg', 'Image: third.rvg']);
    await screen.findByRole('button', { name: 'Unpin image third.rvg' });
    expect(pane('first.rvg').getAttribute('data-selected')).toBe('true');
  });
  it('keeps existing panes in pin order when earlier strip images are pinned later', async () => {
    openPaths = ['first.rvg', 'second.rvg', 'third.rvg']; render(<App />); await open(); await readyThumbnail('03 third.rvg');
    await pin('first.rvg');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin image first.rvg' }));
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
    expect(screen.getByAltText('Enhanced: fifth.rvg').getAttribute('style')).toContain('scale(1)');
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
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg'); await pin('second.rvg'); setSlider('Gamma', .65);
    const firstViewport = within(pane('first.rvg')).getByTestId('image-viewport');
    fireEvent.pointerDown(firstViewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(firstViewport, { clientX: 200, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(firstViewport, { pointerId: 1 });
    expect(actualValue('Gamma')).toBe('0.35');
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(90deg)');
    expect(screen.getByAltText('Enhanced: second.rvg').getAttribute('style')).toContain('rotate(0deg)');
    fireEvent.click(screen.getByRole('button', { name: 'Select image second.rvg' }));
    expect(actualValue('Gamma')).toBe('0.65');
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
    await screen.findByRole('button', { name: /Unpin image/ });
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
    fireEvent.click(screen.getByRole('button', { name: 'Unpin image first.rvg' }));
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

describe('pane context gesture integration', () => {
  it('rotates the clicked pane after the delay even if selection changes', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg'); await pin('first.rvg');
    selectThumbnail(2, 'second.rvg'); await pin('second.rvg');
    const viewport = within(pane('first.rvg')).getByTestId('image-viewport');
    fireEvent.pointerDown(viewport, { button: 2, pointerId: 2, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(viewport, { button: 2, pointerId: 2, clientX: 60, clientY: 60 });
    expect(pane('first.rvg').getAttribute('data-selected')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Select image second.rvg' }));
    await waitFor(() => expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(90deg)'));
    expect(screen.getByAltText('Enhanced: second.rvg').getAttribute('style')).toContain('rotate(0deg)');
    expect(pane('second.rvg').getAttribute('data-selected')).toBe('true');
  });
  it('double right-click toggles the pin with no intermediate or delayed rotation', async () => {
    render(<App />); await open();
    const viewport = screen.getByTestId('image-viewport');
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(viewport, { button: 2, pointerId: 2, clientX: 60, clientY: 60 });
      fireEvent.pointerUp(viewport, { button: 2, pointerId: 2, clientX: 60, clientY: 60 });
    }
    await screen.findByRole('button', { name: 'Pin image first.rvg' });
    await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(0deg)');
    expect(actualValue('Gamma')).toBe('0.35');
  });
});

describe('automatic newest patient pair', () => {
  it('closes individual panes without deleting thumbnails or adjustments and allows reopening the last pane', async () => {
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient(['one.rvg', 'two.rvg', 'older.rvg'])) : undefined;
    render(<App />); submitPatient();
    await screen.findByAltText('Enhanced: two.rvg');
    setSlider('Processing level', 6);
    fireEvent.click(screen.getByRole('button', { name: 'Close image one.rvg from viewer' }));
    expect(paneNames()).toEqual(['Image: two.rvg']);
    expect(actualValue('Processing level')).toBe('6');
    fireEvent.click(screen.getByRole('button', { name: 'Close image two.rvg from viewer' }));
    expect(screen.queryAllByRole('region', { name: /^Image:/ })).toHaveLength(0);
    expect(screen.getByText('Select a thumbnail below to show a radiograph.')).toBeTruthy();
    expect(document.title).toContain('Patient ID 00123');
    selectThumbnail(2, 'two.rvg');
    await screen.findByAltText('Enhanced: two.rvg');
    expect(actualValue('Processing level')).toBe('6');
    await pin('two.rvg');
    selectThumbnail(1, 'one.rvg');
    await screen.findByAltText('Enhanced: one.rvg');
    fireEvent.click(screen.getByRole('button', { name: 'Close image one.rvg from viewer' }));
    expect(paneNames()).toEqual(['Image: two.rvg']);
    expect(pane('two.rvg').getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '03 older.rvg' })).toBeTruthy();
  });

  it('opens every radiograph in the latest acquisition day for a launch patient', async () => {
    const latest = ['one.rvg', 'two.rvg', 'three.rvg', 'four.rvg'];
    customInvoke = command => command === 'launch_patient_number' ? Promise.resolve('00123') : command === 'open_patient' ? Promise.resolve({ ...patient([...latest, 'older.rvg']), latestDatePaths: latest }) : undefined;
    render(<App />);
    await screen.findByAltText('Enhanced: four.rvg');
    expect(paneNames()).toEqual(latest.map(name => `Image: ${name}`));
    expect(screen.queryByRole('region', { name: 'Image: older.rvg' })).toBeNull();
    await readyThumbnail('05 older.rvg');
  });

  it('changes the hovered image enhancement with Ctrl+wheel and supports undo and level bounds', async () => {
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient(['one.rvg', 'two.rvg'])) : undefined;
    render(<App />); submitPatient();
    await screen.findByAltText('Enhanced: two.rvg');
    const viewport = within(pane('one.rvg')).getByTestId('image-viewport');
    const transform = screen.getByAltText('Enhanced: one.rvg').style.transform;
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -120 });
    expect(actualValue('Processing level')).toBe('5');
    expect(pane('one.rvg').getAttribute('data-selected')).toBe('true');
    expect(screen.getByAltText('Enhanced: one.rvg').style.transform).toBe(transform);
    fireEvent.keyDown(viewport, { ctrlKey: true, code: 'KeyZ' });
    expect(actualValue('Processing level')).toBe('4');
    for (let i = 0; i < 10; i++) fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -120 });
    expect(actualValue('Processing level')).toBe('7');
    for (let i = 0; i < 10; i++) fireEvent.wheel(viewport, { ctrlKey: true, deltaY: 120 });
    expect(actualValue('Processing level')).toBe('0');
    fireEvent.click(within(pane('two.rvg')).getByRole('button', { name: 'Select image two.rvg' }));
    expect(actualValue('Processing level')).toBe('4');
  });

  it('toggles native image-only fullscreen with F11 and exits with Escape while retaining mouse controls', async () => {
    render(<App />); await open();
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.keyDown(slider('Processing level'), { key: 'F11' });
    await waitFor(() => expect(document.querySelector('.radiographs-fullscreen')).toBeTruthy());
    expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_fullscreen', { fullscreen: true });
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -120 });
    expect(actualValue('Processing level')).toBe('5');
    const before = screen.getByAltText('Enhanced: first.rvg').style.transform;
    fireEvent.wheel(viewport, { deltaY: -120 });
    expect(screen.getByAltText('Enhanced: first.rvg').style.transform).not.toBe(before);
    fireEvent.keyDown(viewport, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.radiographs-fullscreen')).toBeNull());
    expect(mocks.invoke).toHaveBeenLastCalledWith('set_viewer_fullscreen', { fullscreen: false });
    expect(actualValue('Processing level')).toBe('5');
  });

  it('serializes a rapid F11/Escape and ignores repeated F11 keydown events', async () => {
    let finish!: () => void;
    customInvoke = (command, args) => command === 'set_viewer_fullscreen' && args.fullscreen ? new Promise<void>(resolve => { finish = resolve; }) : undefined;
    render(<App />); await open();
    const viewport = screen.getByTestId('image-viewport');
    fireEvent.keyDown(viewport, { key: 'F11' });
    fireEvent.keyDown(viewport, { key: 'F11', repeat: true });
    fireEvent.keyDown(viewport, { key: 'Escape' });
    await act(async () => finish());
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'set_viewer_fullscreen').map(([, args]) => args.fullscreen)).toEqual([true, false]);
    expect(document.querySelector('.radiographs-fullscreen')).toBeNull();
  });

  it('keeps controls visible and reports a failed native fullscreen request', async () => {
    customInvoke = command => command === 'set_viewer_fullscreen' ? Promise.reject('Synthetic failure') : undefined;
    render(<App />); await open();
    fireEvent.keyDown(screen.getByTestId('image-viewport'), { key: 'F11' });
    await screen.findByText(/Could not change fullscreen mode: Synthetic failure/);
    expect(document.querySelector('.radiographs-fullscreen')).toBeNull();
  });

  it('opens the newest two patient radiographs as a pinned first pane and selected second pane', async () => {
    customInvoke = command => command === 'open_patient' ? Promise.resolve(patient(['newest.rvg', 'previous.rvg', 'older.rvg'])) : undefined;
    render(<App />); submitPatient();
    await screen.findByRole('button', { name: 'Unpin image newest.rvg' });
    await screen.findByAltText('Enhanced: previous.rvg');
    expect(paneNames()).toEqual(['Image: newest.rvg', 'Image: previous.rvg']);
    expect(pane('previous.rvg').getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '03 older.rvg' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Image: older.rvg' })).toBeNull();
    selectThumbnail(3, 'older.rvg');
    await screen.findByAltText('Enhanced: older.rvg');
    expect(paneNames()).toEqual(['Image: newest.rvg', 'Image: previous.rvg', 'Image: older.rvg']);
  });
  it('does not replace the image after a viewing gesture during progressive patient loading', async () => {
    let finish!: (value: ImageInfo) => void;
    customInvoke = (command, args) => command === 'open_patient' ? Promise.resolve(patient(['newest.rvg', 'previous.rvg'])) : command === 'import_image' && args.path === 'previous.rvg' ? new Promise(resolve => { finish = resolve; }) : undefined;
    render(<App />); submitPatient();
    await screen.findByAltText('Enhanced: newest.rvg');
    await waitFor(() => expect(finish).toBeTruthy());
    fireEvent.wheel(screen.getByTestId('image-viewport'), { deltaY: -80 });
    const afterZoom = screen.getByAltText('Enhanced: newest.rvg').getAttribute('style');
    await act(async () => finish(info('previous.rvg')));
    await readyThumbnail('02 previous.rvg');
    expect(paneNames()).toEqual(['Image: newest.rvg']);
    expect(screen.getByAltText('Enhanced: newest.rvg').getAttribute('style')).toBe(afterZoom);
    await screen.findByRole('button', { name: /Unpin image/ });
  });
});

it('exports only visible panes with restored processing and annotations', async () => {
  customInvoke = (command,args) => {
    if(command==='open_patient') return Promise.resolve(patient(['one.rvg','two.rvg']));
    if(command==='import_image') return Promise.resolve({...info(String(args.path)),settingsKey:String(args.path),sourceSha256:'hash',settingsRevision:'r1',savedAppearance:{recipe:{...neutral,gamma:.73},rotationQuarterTurns:1,ellipses:[{x:10,y:20,width:30,height:40,color:'red'}]}});
    if(command==='save_image_settings') return Promise.resolve('r2');
    if(command==='prepare_export_image') return Promise.resolve({url:'frame',width:900,height:1200});
    if(command==='preview_viewer_jpg') return Promise.resolve('data:image/jpeg;base64,preview');
    if(command==='export_viewer_jpg') return Promise.resolve({directory:'\\\\C04577\\incoming\\Example Person',path:'export.jpg'});
  };
  render(<App/>); submitPatient(); await screen.findByAltText('Enhanced: two.rvg');
  fireEvent.click(screen.getByRole('button',{name:'Close image one.rvg from viewer'}));
  fireEvent.click(screen.getByRole('button',{name:'Export for Letter'})); fireEvent.click(await screen.findByRole('button',{name:'Confirm and save'})); await screen.findByText('Export complete');
  const calls=mocks.invoke.mock.calls.filter(([command])=>command==='prepare_export_image'); expect(calls).toHaveLength(1);
  expect(mocks.invoke).toHaveBeenCalledWith('export_viewer_jpg',expect.objectContaining({patientName:'Example Person',patientId:'00123'})); expect(calls[0][1].item.path).toBe('two.rvg'); expect(calls[0][1].item.appearance.recipe.gamma).toBe(.73); expect(calls[0][1].item.appearance.rotationQuarterTurns).toBe(1); expect(calls[0][1].item.appearance.ellipses[0].color).toBe('red');
});

describe('Focus Dark controls', () => {
  it('applies a processing stop to the selection, preserves tone and gamma, and supports undo', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    render(<App />); await open(); await readyThumbnail('02 second.rvg');
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }), { ctrlKey: true });
    await screen.findByText('2 images selected');
    setSlider('Tone', 51); setSlider('Gamma', .61);
    fireEvent.click(screen.getByRole('button', { name: 'Processing level 7' }));
    expect(actualValue('Processing level')).toBe('7');
    expect(actualValue('Tone')).toBe('51');
    expect(actualValue('Gamma')).toBe('0.61');
    expect(screen.getByRole('button', { name: 'Processing level 7' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actualValue('Processing level')).toBe('4');
    expect(actualValue('Tone')).toBe('51');
    fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }));
    expect(actualValue('Processing level')).toBe('4');
    expect(actualValue('Tone')).toBe('51');
    expect(actualValue('Gamma')).toBe('0.61');
  });
  it('opens the complete layout with the Fullscreen button and restores it on Escape', async () => {
    render(<App />);
    expect((screen.getByRole('button', { name: 'Fullscreen' }) as HTMLButtonElement).disabled).toBe(true);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_fullscreen', { fullscreen: true }));
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.radiographs-fullscreen')).toBeNull());
    expect(screen.getByAltText('Enhanced: first.rvg')).toBeTruthy();
  });
  it('reflows five open radiographs down to one as panes close and keeps every preview', async () => {
    const paths = Array.from({ length: 5 }, (_, index) => `image-${index + 1}.rvg`);
    customInvoke = command => command === 'open_demo_patient' ? Promise.resolve({ ...patient(paths, 'DEMO', 'John Smith'), latestDatePaths: paths }) : undefined;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open John Smith demo' }));
    await waitFor(() => expect(screen.getAllByAltText(/^Enhanced:/)).toHaveLength(5));
    const grid = screen.getByLabelText('Image panes');
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    for (let remaining = 4; remaining >= 1; remaining--) {
      fireEvent.click(screen.getByRole('button', { name: `Close image image-${remaining + 1}.rvg from viewer` }));
      await waitFor(() => expect(screen.getAllByAltText(/^Enhanced:/)).toHaveLength(remaining));
      expect(grid.style.gridTemplateColumns).toBe(`repeat(${remaining === 1 ? 1 : 2}, minmax(0, 1fr))`);
      expect(grid.style.gridTemplateRows).toBe(`repeat(${remaining > 2 ? 2 : 1}, minmax(0, 1fr))`);
    }
    expect(document.querySelectorAll('.thumbnail')).toHaveLength(5);
  });
});

describe('multi-image selection and focused fullscreen', () => {
  const savedRecipes = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const calls = mocks.invoke.mock.calls.filter(([command]) => command === 'save_review');
    return calls.at(-1)![1].review.images as { source: string; recipe: Recipe }[];
  };
  it('applies only the changed adjustment to the selection, with per-image undo and redo', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    setSlider('Gamma', .3);
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg');
    setSlider('Gamma', .7);
    fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }), { ctrlKey: true });
    await screen.findByText('2 images selected');
    setSlider('Tone', 70);
    let recipes = await savedRecipes();
    expect(recipes.map(item => item.recipe.gamma)).toEqual([.3, .7]);
    expect(recipes[0].recipe.windowCenter).toBe(recipes[1].recipe.windowCenter);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    recipes = await savedRecipes();
    expect(recipes[0].recipe.windowCenter).toBeCloseTo(neutral.windowCenter - .35 * neutral.windowWidth * .25);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    recipes = await savedRecipes();
    expect(recipes[0].recipe.windowCenter).toBeCloseTo(neutral.windowCenter - .7 * neutral.windowWidth * .25);
    expect(recipes[1].recipe.windowCenter).toBe(recipes[0].recipe.windowCenter);
    setSlider('Gamma', .6);
    expect((await savedRecipes()).map(item => item.recipe.gamma)).toEqual([.6, .6]);
    fireEvent.click(screen.getByRole('button', { name: 'Select image second.rvg' }));
    setSlider('Gamma', .4);
    expect((await savedRecipes()).map(item => item.recipe.gamma)).toEqual([.6, .4]);
  });
  it('supports Ctrl-click on viewports and thumbnails, toggles membership, and rotates the whole selection', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }), { ctrlKey: true });
    await screen.findByText('2 images selected');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }));
    for (const name of openPaths) expect(screen.getByAltText(`Enhanced: ${name}`).getAttribute('style')).toContain('rotate(90deg)');
    const first = within(pane('first.rvg')).getByTestId('image-viewport');
    fireEvent.pointerDown(first, { button: 0, ctrlKey: true, pointerId: 8 });
    expect(screen.queryByText('2 images selected')).toBeNull();
    expect(pane('first.rvg').getAttribute('data-selected')).toBe('false');
    fireEvent.pointerDown(first, { button: 0, ctrlKey: true, pointerId: 9 });
    await screen.findByText('2 images selected');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    for (const name of openPaths) expect(screen.getByAltText(`Enhanced: ${name}`).getAttribute('style')).toContain('scale(1)');
  });
  it('opens only the double-clicked image fullscreen and restores all panes on Escape', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
    await pin('first.rvg'); selectThumbnail(2, 'second.rvg');
    const order = paneNames();
    fireEvent.doubleClick(within(pane('first.rvg')).getByTestId('image-viewport'), { button: 0 });
    await waitFor(() => expect(paneNames()).toEqual(['Image: first.rvg']));
    expect(document.querySelector('.radiographs-fullscreen')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(paneNames()).toEqual(order));
    expect(document.querySelector('.radiographs-fullscreen')).toBeNull();
  });
});

it('drags adjustments on any member of a selection and preserves the group until a normal click', async () => {
  openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open(); await readyThumbnail('02 second.rvg');
  fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }), { ctrlKey: true });
  await screen.findByText('2 images selected');
  const viewport = within(pane('first.rvg')).getByTestId('image-viewport');
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 20, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(viewport, { pointerId: 20, clientX: 140, clientY: 80 });
  fireEvent.pointerUp(viewport, { pointerId: 20, clientX: 140, clientY: 80 });
  fireEvent.click(viewport);
  expect(screen.getByText('2 images selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  const saved = mocks.invoke.mock.calls.filter(([command]) => command === 'save_review').at(-1)![1].review.images as { recipe: Recipe }[];
  for (const item of saved) expect(item.recipe.gamma).toBeCloseTo(.4);
  expect(saved[0].recipe.windowCenter).toBe(saved[1].recipe.windowCenter);
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(actualValue('Gamma')).toBe('0.35');
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 21, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(viewport, { pointerId: 21, clientX: 100, clientY: 100 });
  fireEvent.click(viewport);
  expect(screen.queryByText('2 images selected')).toBeNull();
});

it('refreshes a patient without replacing adjustments and resets only the clicked pane', async () => {
  let paths=['one.rvg','two.rvg'];
  customInvoke=command=>command==='open_patient'?Promise.resolve(patient(paths)):undefined;
  render(<App/>);submitPatient();await screen.findByAltText('Enhanced: two.rvg');
  setSlider('Gamma',.72);
  paths=['one.rvg','two.rvg','new.rvg'];
  fireEvent.click(screen.getByRole('button',{name:'Reload Images'}));await screen.findByText('1 new radiograph found.');
  await readyThumbnail('03 new.rvg');expect(actualValue('Gamma')).toBe('0.72');
  fireEvent.click(screen.getByRole('button',{name:'Reset image one.rvg'}));expect(actualValue('Gamma')).toBe('0.72');
  fireEvent.click(screen.getByRole('button',{name:'Reset image two.rvg'}));expect(actualValue('Gamma')).toBe('0.35');
  fireEvent.click(screen.getByRole('button',{name:'Reload Images'}));await screen.findByText('0 new radiographs found.');
});
it('highlights an adjustable midtone level and keeps other processing controls working', async () => {
  render(<App/>);await open();expect(screen.queryByRole('button',{name:'Highlight midtones'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Colorize Off'}));fireEvent.change(screen.getByRole('combobox',{name:'Color mode'}),{target:{value:'midtone'}});
  setSlider('Midtone level',.65);setSlider('Gamma',.61);setSlider('Processing level',6);
  fireEvent.click(screen.getByRole('button',{name:'Save settings'}));await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('save_review',expect.anything()));
  const saved=mocks.invoke.mock.calls.filter(([command])=>command==='save_review').at(-1)![1].review.images[0].recipe;
  expect(saved.midtoneLevel).toBe(.65);expect(saved.gamma).toBe(.61);expect(saved.colorize).toBe(true);
});
it('compares two independent copies in fullscreen and applies only the chosen recipe', async () => {
  let serial=0;
  customInvoke=(command,args)=>command==='import_image'?Promise.resolve({...info(String(args.path)),id:`copy-${++serial}`}):undefined;
  render(<App/>);await open();fireEvent.click(screen.getByRole('button',{name:'A/B compare'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Use B'}) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByLabelText('A Detail method')).toBeNull();expect(screen.queryByLabelText('B Detail method')).toBeNull();
  expect(screen.getAllByText('Detail method: Radiograph multiscale')).toHaveLength(2);
  fireEvent.change(screen.getByRole('slider',{name:'A Gamma'}),{target:{value:'.7'}});fireEvent.blur(screen.getByRole('slider',{name:'A Gamma'}));
  expect((screen.getByRole('slider',{name:'B Gamma'}) as HTMLInputElement).value).toBe('0.35');
  fireEvent.change(screen.getByRole('slider',{name:'B Gamma'}),{target:{value:'.6'}});fireEvent.blur(screen.getByRole('slider',{name:'B Gamma'}));
  expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_fullscreen',{fullscreen:true});
  fireEvent.click(screen.getByRole('button',{name:'Use B'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'A/B processing comparison'})).toBeNull());
  expect(actualValue('Gamma')).toBe('0.6');expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_fullscreen',{fullscreen:false});
});


it('uses Midtone Contrast defaults, samples once with undo, and holds grayscale without changing exports', async () => {
  customInvoke = command => command === 'sample_reference' ? Promise.resolve(.63) : undefined;
  render(<App/>); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
  expect((screen.getByRole('combobox', { name: 'Color mode' }) as HTMLSelectElement).value).toBe('midtoneContrast');
  expect(slider('Midtone center').value).toBe('0.5'); expect(slider('Color amount').value).toBe('0.4');
  expect(slider('Sensitivity').getAttribute('aria-valuetext')).toBe('±15 points');
  setSlider('Sensitivity', 27);
  expect(slider('Sensitivity').getAttribute('aria-valuetext')).toBe('±5 points');
  fireEvent.click(screen.getByRole('button', { name: 'Pick reference' }));
  const viewport = screen.getByTestId('image-viewport');
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 4, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(viewport, { button: 0, pointerId: 4, clientX: 0, clientY: 0 });
  await waitFor(() => expect(slider('Midtone center').value).toBe('0.63'));
  expect(mocks.invoke).toHaveBeenCalledWith('sample_reference', expect.objectContaining({ x: 600, y: 450 }));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(slider('Midtone center').value).toBe('0.5');
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ midtoneLevel: .63, midtoneWidth: .05 }) })));
  const before = screen.getByAltText('Enhanced: first.rvg').getAttribute('src');
  const hold = screen.getByRole('button', { name: 'Hold for grayscale' });
  fireEvent.pointerDown(hold, { button: 0, pointerId: 5 });
  await screen.findByText('Grayscale · release to restore');
  expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).not.toBe(before);
  fireEvent.pointerCancel(hold, { pointerId: 5 });
  expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('src')).toBe(before);
  fireEvent.click(screen.getByRole('button', { name: 'Export to JPEG' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('export_image', expect.objectContaining({ recipe: expect.objectContaining({ colorMode: 'midtoneContrast', midtoneLevel: .63, midtoneWidth: .05, colorStrength: .4 }) })));
});

it('keeps Midtone Contrast controls independent in A/B and Escape cancels picking before closing', async () => {
  render(<App/>); await open(); fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
  fireEvent.click(screen.getByRole('button', { name: 'A/B compare' }));
  await screen.findByRole('dialog', { name: 'A/B processing comparison' });
  fireEvent.change(screen.getByRole('slider', { name: 'A Midtone center' }), { target: { value: '.72' } });
  fireEvent.blur(screen.getByRole('slider', { name: 'A Midtone center' }));
  expect((screen.getByRole('slider', { name: 'B Midtone center' }) as HTMLInputElement).value).toBe('0.5');
  fireEvent.click(screen.getByRole('button', { name: 'A Pick reference' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'A/B processing comparison' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'A Pick reference' }).getAttribute('aria-pressed')).toBe('false');
  await waitFor(() => expect((screen.getByRole('button', { name: 'Use A' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Use A' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'A/B processing comparison' })).toBeNull());
  expect(slider('Midtone center').value).toBe('0.72');
});


it('reference picking updates only the clicked image within a multi-selection', async () => {
  customInvoke = command => command === 'sample_reference' ? Promise.resolve(.68) : undefined;
  openPaths = ['first.rvg', 'second.rvg']; render(<App/>); await open(); await readyThumbnail('02 second.rvg');
  await pin('first.rvg');
  fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }));
  await screen.findByAltText('Enhanced: second.rvg');
  fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }), { ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Colorize Off' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick reference' }));
  const viewport = within(screen.getByRole('region', { name: 'Image: second.rvg' })).getByTestId('image-viewport');
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 4, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(viewport, { button: 0, pointerId: 4, clientX: 0, clientY: 0 });
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('sample_reference', expect.objectContaining({ id: 'second.rvg' })));
  fireEvent.click(screen.getByRole('button', { name: 'Select image second.rvg' }));
  await waitFor(() => expect(slider('Midtone center').value).toBe('0.68'));
  fireEvent.click(screen.getByRole('button', { name: 'Select image first.rvg' }));
  await waitFor(() => expect(slider('Midtone center').value).toBe('0.5'));
});


describe('viewer keyboard shortcuts', () => {
  it.each(['a', 'f', 'c', 'q', 'e', 'p', 'o', 'r'])('routes Ctrl+%s to its toolbar action once and respects disabled controls', async key => {
    render(<App />); await open();
    const button = document.querySelector<HTMLButtonElement>(`button[data-shortcut="${key}"]`)!;
    expect(button).toBeTruthy();
    const click = vi.spyOn(button, 'click').mockImplementation(() => {});
    const disabled = button.matches(':disabled');
    fireEvent.keyDown(window, { key, ctrlKey: true });
    expect(click).toHaveBeenCalledTimes(disabled ? 0 : 1);
    fireEvent.keyDown(window, { key, ctrlKey: true, repeat: true });
    expect(click).toHaveBeenCalledTimes(disabled ? 0 : 1);
    button.disabled = true;
    fireEvent.keyDown(window, { key, ctrlKey: true });
    expect(click).toHaveBeenCalledTimes(disabled ? 0 : 1);
    click.mockRestore();
  });
  it('colorizes, rotates, enters fullscreen, and leaves text editing alone', async () => {
    render(<App />); await open();
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Colorize On' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'q', ctrlKey: true });
    expect(screen.getByAltText('Enhanced: first.rvg').getAttribute('style')).toContain('rotate(90deg)');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('set_viewer_fullscreen', { fullscreen: true }));
    fireEvent.keyDown(screen.getByLabelText('New preset name'), { key: 'c', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Colorize On' })).toBeTruthy();
  });
  it('pins a newly opened pane and keeps manual unpinning until reopened', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open();
    await screen.findByRole('button', { name: 'Unpin image first.rvg' });
    fireEvent.click(screen.getByRole('button', { name: 'Unpin image first.rvg' }));
    setSlider('Gamma', .6);
    expect(screen.getByRole('button', { name: 'Pin image first.rvg' })).toBeTruthy();
    await readyThumbnail('02 second.rvg'); selectThumbnail(2, 'second.rvg');
    await screen.findByRole('button', { name: 'Unpin image second.rvg' });
    selectThumbnail(1, 'first.rvg');
    await screen.findByRole('button', { name: 'Unpin image first.rvg' });
  });
});


describe('annotation visibility and individual deletion', () => {
  it('hides and restores marks, deletes only the selected ellipse, and retains other images', async () => {
    openPaths = ['first.rvg', 'second.rvg']; render(<App />); await open();
    const draw = (x: number) => {
      const viewport = within(pane('first.rvg')).getByTestId('image-viewport');
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: x, clientY: 10 });
      fireEvent.pointerUp(viewport, { button: 0, pointerId: 1, clientX: x + 30, clientY: 40 });
    };
    fireEvent.click(screen.getByRole('button', { name: 'Ellipse' })); draw(10); draw(70);
    expect(pane('first.rvg').querySelectorAll('ellipse')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Hide annotations' }));
    expect(pane('first.rvg').querySelector('svg.image-markup')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_review').at(-1)![1].review.images[0].ellipses).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show annotations' }));
    expect(pane('first.rvg').querySelectorAll('ellipse')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Select annotation' }));
    expect((screen.getByRole('button', { name: 'Delete selected annotation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select ellipse 1' }));
    expect(screen.getByRole('button', { name: 'Select ellipse 1' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected annotation' }));
    expect(pane('first.rvg').querySelectorAll('ellipse')).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Delete selected annotation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_review').at(-1)![1].review.images[0].ellipses).toHaveLength(1);
    await readyThumbnail('02 second.rvg'); selectThumbnail(2, 'second.rvg');
    expect(pane('first.rvg').querySelectorAll('ellipse')).toHaveLength(1);
    expect(pane('second.rvg').querySelectorAll('ellipse')).toHaveLength(0);
  });
  it('deletes one measurement and a calibration reference independently', async () => {
    render(<App />); await open();
    const viewport = screen.getByTestId('image-viewport');
    const draw = (length: number) => { fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 0, clientY: 0 }); fireEvent.pointerUp(viewport, { button: 0, pointerId: 1, clientX: length, clientY: 0 }); };
    fireEvent.click(screen.getByRole('button', { name: 'Measure' })); draw(40); draw(60);
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' })); draw(20);
    fireEvent.change(screen.getByLabelText('Known length (mm)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply calibration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select annotation' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Select measurement 1' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected annotation' }));
    expect(screen.queryByText('20.0 mm · estimated')).toBeNull();
    expect(screen.getByText('30.0 mm · estimated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select calibration reference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected annotation' }));
    expect(screen.queryByText('Reference · 10.0 mm')).toBeNull();
    expect(screen.getByText(/mm · uncalibrated/)).toBeTruthy();
  });
});


it('places Adjust first, annotation actions together, and A/B comparison last', async () => {
  render(<App />); await open();
  const toolbar = screen.getByLabelText('Image tools');
  const buttons = within(toolbar).getAllByRole('button');
  expect(buttons[0].textContent).toBe('Adjust');
  expect(buttons.at(-1)?.textContent).toBe('A/B compare');
  const group = screen.getByRole('group', { name: 'Annotation controls' });
  for (const name of ['Ellipse', 'Measure', 'Hide annotations', 'Select annotation', 'Delete selected annotation']) expect(within(group).getByRole('button', { name })).toBeTruthy();
  expect(within(group).queryByRole('button', { name: 'Adjust' })).toBeNull();
});
it('applies level zero with undo and makes it available in A/B comparison', async () => {
  render(<App />); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Processing level 0' }));
  expect(actualValue('Processing level')).toBe('0');
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('render_image', expect.objectContaining({ recipe: expect.objectContaining({ sharpen: 0, denoise: 0, localContrast: 0, clahe: 0, windowWidth: 4096 }) })));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(actualValue('Processing level')).toBe('4');
  fireEvent.click(screen.getByRole('button', { name: 'A/B compare' }));
  const control = await screen.findByRole('slider', { name: 'A Processing level' });
  expect(control.getAttribute('min')).toBe('0');
  fireEvent.change(control, { target: { value: '0' } });
  fireEvent.pointerUp(control);
  expect((control as HTMLInputElement).value).toBe('0');
});


describe('Selected JPEG export', () => {
  it('asks for one folder and exports every selected image with its current processing', async () => {
    openPaths = ['first.rvg', 'second.rvg'];
    customInvoke = command => command === 'export_image' ? Promise.resolve('C:\\Exports\\image.jpg') : undefined;
    render(<App />); await open(); await readyThumbnail('02 second.rvg');
    fireEvent.click(screen.getByRole('button', { name: '02 second.rvg' }), { ctrlKey: true });
    await screen.findByText('2 images selected');
    setSlider('Gamma', .61);
    fireEvent.click(screen.getByRole('button', { name: 'Export to JPEG' }));
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'export_image')).toHaveLength(2));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'choose_jpeg_export_directory')).toHaveLength(1);
    const exports = mocks.invoke.mock.calls.filter(([command]) => command === 'export_image').map(([, args]) => args);
    expect(exports.map(args => args.id).sort()).toEqual(['first.rvg', 'second.rvg']);
    expect(exports.every(args => args.directory === 'C:\\Exports' && args.recipe.gamma === .61)).toBe(true);
    expect(screen.getByText('2 selected radiographs exported as full-resolution JPEGs at 70% quality.')).toBeTruthy();
  });
  it('uses Last name, First name for the native destination prompt', async () => {
    const demo = { ...patient(['demo-1.dcm'], 'DEMO', 'John Smith'), firstName: 'John', lastName: 'Smith' };
    customInvoke = command => command === 'open_demo_patient' ? Promise.resolve(demo) : undefined;
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Open John Smith demo' }));
    await screen.findByAltText('Enhanced: demo-1.dcm');
    fireEvent.click(screen.getByRole('button', { name: 'Export to JPEG' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('choose_jpeg_export_directory', { patientName: 'Smith, John' }));
  });
  it('cancelling the folder dialog exports nothing', async () => {
    customInvoke = command => command === 'choose_jpeg_export_directory' ? Promise.resolve(null) : undefined;
    render(<App />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Export to JPEG' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('choose_jpeg_export_directory', { patientName: '' }));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'export_image')).toHaveLength(0);
  });
});
