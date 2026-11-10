# Windows 0.9.11

- Press **Ctrl+0** through **Ctrl+7** in the viewer to apply the corresponding
  processing level to the selected images. Undo reverses the change.
- New images and **Reset** use gamma **0.35** and contrast **−40** on the
  existing −100 to +100 scale. This combination uses level 4 detail and
  displays as **Custom · near 4**. Saved image adjustments retain their values.

## Verification

All 222 frontend tests and 108 Rust tests passed. Three manual benchmarks
were ignored. Rust formatting, the production frontend build and the locked
optimized Windows and NSIS build passed. The portable and demo ZIPs passed CRC
and embedded executable hash checks. The shared copies matched the project ZIPs.

## Deployment

Windows 0.9.11 was deployed to `D:\APPS\RAD-Viewer\rad-viewer.exe`. Build,
staged and deployed executable hashes matched. All four running sessions were
preserved and will load the new version when reopened.

SHA-256: `EDD91D02534803A486EF7EE1498440391BB90ECFA072D8CC1379A4FA8B95501B`.

Automatic approval review rejected removal of superseded Windows installers,
packages, release notes and rollback executables as blocked by policy.
