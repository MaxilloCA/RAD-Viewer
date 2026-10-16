import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ImageAppearance } from './model';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { SettingsWriter } from './settingsWriter';
const appearance = (gamma: number): ImageAppearance => ({ recipe: { version: 1, windowCenter: 128, windowWidth: 256, gamma, denoise: 0, localContrast: 0, clahe: 0, sharpen: 0, radius: 2, threshold: .01, halo: .7, detailMode: 'unsharp', invert: false, colorize: false }, rotationQuarterTurns: 1, ellipses: [] });
beforeEach(() => mocks.invoke.mockReset());
describe('shared settings writer', () => {
  it('coalesces pending edits and passes the latest confirmed revision', async () => {
    let finish!: (revision: string) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue('r3');
    const status = vi.fn(); const writer = new SettingsWriter(status, vi.fn()); writer.register('image', 'r1');
    writer.queue('image', appearance(.5)); writer.queue('image', appearance(.6)); writer.queue('image', appearance(.7));
    expect(mocks.invoke).toHaveBeenCalledTimes(1); finish('r2'); expect(await writer.flush()).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(2); expect(mocks.invoke.mock.calls[1][1]).toEqual({ key: 'image', expectedRevision: 'r2', appearance: appearance(.7) }); expect(status).toHaveBeenLastCalledWith('saved');
  });
  it('retains failed edits, blocks flush, and retries without inventing a revision', async () => {
    mocks.invoke.mockRejectedValueOnce('share unavailable').mockResolvedValue('r2'); const errors = vi.fn(); const writer = new SettingsWriter(vi.fn(),errors); writer.register('image','r1'); writer.queue('image',appearance(.8));
    expect(await writer.flush()).toBe(false); expect(errors).toHaveBeenCalledWith(expect.stringContaining('share unavailable'));
    expect(await writer.retry()).toBe(true); expect(mocks.invoke.mock.calls[1][1].expectedRevision).toBe('r1');
  });
});
