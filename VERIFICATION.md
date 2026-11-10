# Verification

## 0.9.11 on Windows x64, 2026-11-09

- `npm ci` installed the locked dependencies.
- `npm test -- --maxWorkers=2` passed all 222 tests across 16 files, including the default gamma and contrast changes and Ctrl+0 through Ctrl+7 processing controls.
- `cargo test --workspace --locked` passed 108 tests. Three manual performance tests remained ignored. The synthetic demo tests decoded all five generated DICOM patterns and exercised local edits and file handling.
- `npm run tauri build -- --debug --no-bundle` built the production frontend and a standalone Windows debug executable with the frontend bundled.

The first GitHub run exposed an invalid lockfile reference to `rrweb-cssom@0.8.3`. The lock now matches the public npm metadata: both `jsdom@26.1.0` and `cssstyle@4.6.0` require `^0.8.0`, and the resolved package is published `0.8.0`. Its integrity hash is unchanged. A subsequent `npm ci --registry=https://registry.npmjs.org/` with a new empty cache succeeded, followed by all 222 frontend tests and the production build. This clean-install check used Node 24.15.0 and npm 11.14.1; GitHub CI uses Node 22.

Native Windows smoke verification on November 9 launched the standalone 0.9.11 executable, loaded all five generated DICOM patterns, and confirmed that Ctrl+2 changed the selected image to processing level 2/7. The refreshed screenshot records that actual application state. The new defaults and shortcut range are also covered by automated tests. No patient images were opened. Export, physical printing and native macOS and Linux builds remain outside the scope of these checks.
