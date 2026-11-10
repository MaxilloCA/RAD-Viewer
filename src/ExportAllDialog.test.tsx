// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import ExportAllDialog, { type ExportItem } from './ExportAllDialog';
const neutral = { version:1,windowCenter:128,windowWidth:256,gamma:1,denoise:0,localContrast:0,clahe:0,sharpen:0,radius:2,threshold:.01,halo:.7,detailMode:"unsharp",invert:false,colorize:false };
const items: ExportItem[] = [{ path:'first.rvg', sourceSha256:'hash', appearance:{ recipe:{...neutral,gamma:.7}, rotationQuarterTurns:1,ellipses:[] }, annotationStroke:3 }, {path:'second.rvg',sourceSha256:'hash2',appearance:{recipe:neutral,rotationQuarterTurns:0,ellipses:[]},annotationStroke:6}];
vi.mock('./viewerExport', async importOriginal => ({ ...await importOriginal<typeof import('./viewerExport')>(), loadBitmap: async () => ({}), drawExportBranding: vi.fn(async () => {}) }));
beforeEach(() => {
  mocks.invoke.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.open=true; };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),drawImage:vi.fn(),fillText:vi.fn()})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,canvas';
});
afterEach(cleanup);
it('uses the letter-export title and a local Pictures destination for the demo',async()=>{
  mocks.invoke.mockImplementation(command=>Promise.resolve(command==='prepare_export_image'?{url:'frame',width:80,height:60}:'data:image/jpeg;base64,preview'));
  render(<ExportAllDialog items={items} patientName="Smith, John" patientId="DEMO" onClose={vi.fn()} onBusy={vi.fn()}/>);
  await screen.findByAltText('JPEG export preview');
  expect(screen.getByRole('heading',{name:'Export for Letter'})).toBeTruthy();
  expect(screen.getByText(/your Pictures folder under RAD Viewer \/ John Smith/)).toBeTruthy();
  expect(screen.queryByText(/server\\incoming/)).toBeNull();
  expect(mocks.invoke.mock.calls.some(([command])=>command==='export_viewer_jpg')).toBe(false);
});
it('prepares sequentially once in StrictMode, then saves exactly one combined JPEG', async () => {
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;})).mockImplementation((command:string) => Promise.resolve(command==='prepare_export_image'?{url:'second',width:80,height:60,imageDate:'2026-10-15'}:command==='preview_viewer_jpg'?'data:image/jpeg;base64,preview':{directory:'destination',path:'destination/Person, Example - 123 - uuid.jpg'}));
  const busy=vi.fn(); render(<StrictMode><ExportAllDialog items={items} patientName="Person, Example" patientId="123" onClose={vi.fn()} onBusy={busy}/></StrictMode>);
  expect(mocks.invoke).toHaveBeenCalledTimes(1); expect(screen.getByText('Preparing radiograph 1 of 2…')).toBeTruthy();
  await act(async () => finish({url:'first',width:80,height:60,imageDate:'2026-10-15'}));
  expect((await screen.findByAltText('JPEG export preview')).getAttribute('src')).toBe('data:image/jpeg;base64,preview');
  expect(mocks.invoke.mock.calls.some(([command])=>command==='export_viewer_jpg')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Confirm and save'}));
  await screen.findByText('Export complete'); expect(mocks.invoke).toHaveBeenCalledTimes(4);
  expect(mocks.invoke.mock.calls[1][1].item).toEqual(items[1]);
  expect(mocks.invoke.mock.calls[3]).toEqual(['export_viewer_jpg',expect.objectContaining({patientName:'Person, Example',patientId:'123',png:'data:image/png;base64,canvas'})]);
  expect(screen.getByText('destination/Person, Example - 123 - uuid.jpg')).toBeTruthy(); expect(busy).toHaveBeenLastCalledWith(false);
});
it('does not save a partial montage if an image fails', async () => {
  mocks.invoke.mockResolvedValueOnce({url:'first',width:80,height:60}).mockRejectedValueOnce('Network unavailable');
  render(<ExportAllDialog items={items} patientName="Example Person" onClose={vi.fn()} onBusy={vi.fn()}/>);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network unavailable'));
  expect(mocks.invoke.mock.calls.some(([command])=>command==='export_viewer_jpg')).toBe(false); expect(screen.queryByText('Export complete')).toBeNull();
});

it('Escape cancels the preview without writing a file',async()=>{
  mocks.invoke.mockImplementation(command=>Promise.resolve(command==='prepare_export_image'?{url:'frame',width:80,height:60}:'data:image/jpeg;base64,preview'));
  const close=vi.fn();render(<ExportAllDialog items={items} patientName="Example" onClose={close} onBusy={vi.fn()}/>);
  await screen.findByAltText('JPEG export preview');fireEvent.keyDown(screen.getByRole('button',{name:'Confirm and save'}),{key:'Escape'});
  expect(close).toHaveBeenCalledOnce();expect(mocks.invoke.mock.calls.some(([command])=>command==='export_viewer_jpg')).toBe(false);
});
it('cancels pending preparation and ignores the late response',async()=>{
  let finish!:(value:unknown)=>void;mocks.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const close=vi.fn(),busy=vi.fn();render(<ExportAllDialog items={items} patientName="Example" onClose={close} onBusy={busy}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await act(async()=>finish({url:'frame',width:80,height:60}));
  expect(close).toHaveBeenCalledOnce();expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(busy).toHaveBeenLastCalledWith(false);
});
it('prevents duplicate saves and reports a save failure',async()=>{
  let fail!:(reason:unknown)=>void;
  mocks.invoke.mockImplementation(command=>command==='export_viewer_jpg'?new Promise((_,reject)=>{fail=reject;}):Promise.resolve(command==='prepare_export_image'?{url:'frame',width:80,height:60}:'data:image/jpeg;base64,preview'));
  render(<ExportAllDialog items={items} patientName="Example" onClose={vi.fn()} onBusy={vi.fn()}/>);
  const confirm=await screen.findByRole('button',{name:'Confirm and save'});fireEvent.doubleClick(confirm);fireEvent.click(confirm);fireEvent.click(confirm);
  expect(mocks.invoke.mock.calls.filter(([command])=>command==='export_viewer_jpg')).toHaveLength(1);
  await act(async()=>fail('Share unavailable'));expect(screen.getByRole('alert').textContent).toContain('Share unavailable');
});
