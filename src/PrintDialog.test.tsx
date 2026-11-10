// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PrintDialog from './PrintDialog';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => mocks);
vi.mock('./printLayout', () => ({ composePrint: async () => 'data:image/png;base64,preview' }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  mocks.invoke.mockReset().mockImplementation((command: string) => Promise.resolve(command === 'list_printers' ? ['DNP DS-RX1HS', 'Office'] : null));
});
afterEach(cleanup);
it('preselects the DNP, prints the preview once, and reports submission', async () => {
  const onBusy = vi.fn(); render(<PrintDialog images={[]} onClose={vi.fn()} onBusy={onBusy} />);
  await screen.findByAltText('4 by 6 landscape radiograph print preview');
  expect((screen.getByLabelText('Printer') as HTMLSelectElement).value).toBe('DNP DS-RX1HS');
  fireEvent.click(screen.getByRole('button', { name: 'Print 1 copy' }));
  await screen.findByText('Sent to DNP DS-RX1HS. Check the printer for your print.');
  expect(mocks.invoke).toHaveBeenCalledWith('print_radiographs', { png: 'data:image/png;base64,preview', printer: 'DNP DS-RX1HS' });
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect((screen.getByRole('button', { name: 'Print 1 copy' }) as HTMLButtonElement).disabled).toBe(true);
});
it('shows a print failure and allows retry without claiming success', async () => {
  mocks.invoke.mockImplementation((command: string) => command === 'list_printers' ? Promise.resolve(['DNP DS-RX1HS']) : Promise.reject('Printer offline'));
  render(<PrintDialog images={[]} onClose={vi.fn()} onBusy={vi.fn()} />);
  await screen.findByAltText('4 by 6 landscape radiograph print preview');
  fireEvent.click(screen.getByRole('button', { name: 'Print 1 copy' }));
  await screen.findByText('Printer offline');
  expect(screen.queryByText(/Sent to/)).toBeNull();
  await waitFor(() => expect((screen.getByRole('button', { name: 'Print 1 copy' }) as HTMLButtonElement).disabled).toBe(false));
});
