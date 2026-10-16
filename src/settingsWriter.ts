import { invoke } from '@tauri-apps/api/core';
import type { ImageAppearance } from './model';

/** One write at a time, newest committed state wins. Pending writes survive chart changes. */
export class SettingsWriter {
  private pending = new Map<string, ImageAppearance>();
  private failed = new Map<string, ImageAppearance>();
  private revisions = new Map<string, string | null>();
  private active: Promise<void> | null = null;
  constructor(private status: (value: 'saved' | 'saving' | 'error') => void, private error: (message: string) => void) {}
  register(key: string, revision: string | null) { if (!this.revisions.has(key)) this.revisions.set(key, revision); }
  queue(key: string, appearance: ImageAppearance) {
    this.failed.delete(key); this.pending.set(key, appearance); this.status('saving');
    this.start();
  }
  private start() {
    if (this.active) return;
    this.active = this.run().finally(() => { this.active = null; if (this.pending.size) this.start(); else this.status(this.failed.size ? 'error' : 'saved'); });
  }
  private async run() {
    while (this.pending.size) {
      const [key, appearance] = this.pending.entries().next().value!;
      this.pending.delete(key);
      try {
        const revision = await invoke<string>('save_image_settings', { key, expectedRevision: this.revisions.get(key) ?? null, appearance });
        this.revisions.set(key, revision);
        this.failed.delete(key);
      } catch (error) {
        this.failed.set(key, this.pending.get(key) ?? appearance); this.pending.delete(key);
        this.error(`Image adjustments were not saved: ${String(error)}`);
      }
    }
  }
  async flush() { while (this.active) await this.active; return this.failed.size === 0; }
  async retry() { for (const [key, appearance] of this.failed) this.pending.set(key, appearance); this.failed.clear(); this.status('saving'); this.start(); return this.flush(); }
}
