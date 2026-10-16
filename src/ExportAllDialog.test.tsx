// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import ExportAllDialog, { type ExportItem } from './ExportAllDialog';
const neutral = { version:1,windowCenter:128,windowWidth:256,gamma:1,denoise:0,localContrast:0,clahe:0,sharpen:0,radius:2,threshold:.01,halo:.7,detailMode:"unsharp",invert:false,colorize:false };
const items: ExportItem[] = [{ path:'first.rvg', sourceSha256:'hash', appearance:{ recipe:{...neutral,gamma:.7}, rotationQuarterTurns:1,ellipses:[] }, annotationStroke:3 }, {path:'second.rvg',sourceSha256:'hash2',appearance:{recipe:neutral,rotationQuarterTurns:0,ellipses:[]},annotationStroke:6}];
beforeEach(() => { mocks.invoke.mockReset(); Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}}); });
afterEach(cleanup);
it('exports sequentially once under StrictMode and confirms the actual destination', async () => {
  let finish!: (value: unknown) => void; mocks.invoke.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;})).mockResolvedValue({directory:'\\\\C04577\\incoming\\Example Person',path:'second.jpg'});
  const busy=vi.fn(); render(<StrictMode><ExportAllDialog items={items} patientName="Example Person" onClose={vi.fn()} onBusy={busy}/></StrictMode>);
  expect(mocks.invoke).toHaveBeenCalledTimes(1); expect(screen.getByText('Exporting image 1 of 2…')).toBeTruthy();
  await act(async () => finish({directory:'\\\\C04577\\incoming\\Example Person',path:'first.jpg'}));
  await screen.findByText('Export complete'); expect(mocks.invoke).toHaveBeenCalledTimes(2); expect(mocks.invoke.mock.calls[1][1].item).toEqual(items[1]); expect(mocks.invoke.mock.calls[0][1].batchId).toBe(mocks.invoke.mock.calls[1][1].batchId); expect(screen.getByText('\\\\C04577\\incoming\\Example Person')).toBeTruthy(); expect(busy).toHaveBeenLastCalledWith(false);
});
it('reports partial export failure without claiming completion', async () => {
  mocks.invoke.mockResolvedValueOnce({directory:'test destination',path:'first.jpg'}).mockRejectedValueOnce('Network unavailable');
  render(<ExportAllDialog items={items} patientName="Example Person" onClose={vi.fn()} onBusy={vi.fn()}/>);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('1 of 2 radiographs exported')); expect(screen.getByText('Network unavailable')).toBeTruthy(); expect(screen.queryByText('Export complete')).toBeNull();
});
