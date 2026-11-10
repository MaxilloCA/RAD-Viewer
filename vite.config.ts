import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import packageInfo from './package.json';
import { arch, platform } from 'node:os';

const targetPlatform = process.env.TAURI_ENV_PLATFORM ?? platform();
const os = targetPlatform === 'darwin' ? 'macos' : targetPlatform === 'win32' ? 'windows' : targetPlatform;
const architecture = process.env.TAURI_ENV_ARCH ?? arch();
const platformName = os === 'macos' ? 'macOS' : os === 'windows' ? 'Windows' : os;
const engine = os === 'macos' ? 'WKWebView' : os === 'windows' ? 'WebView2' : 'WebKitGTK';

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_INFO__: JSON.stringify({ version: packageInfo.version, builtAt: new Date().toISOString(), os, platform: `${platformName} ${architecture}`, engine: `Tauri 2 · ${engine}` }) },
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  clearScreen: false,
});
