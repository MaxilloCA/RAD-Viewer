# 0.9.3 — Apple Silicon macOS source preparation

Prepared on Windows on 2026-10-17 (America/Toronto).

## Changes

- Native `.app` configuration for Apple Silicon/macOS 12+, with an ICNS icon and
  ad-hoc signing for a local build. Windows NSIS configuration remains in place.
- Platform-specific render URLs: Windows `http://rad.localhost/<token>`, Mac
  `rad://localhost/<token>`. Existing CSP already permits both; cached pixels and
  image-processing algorithms/formats are unchanged by this port.
- Build metadata follows the Tauri target platform/architecture and runtime;
  `darwin` hook values normalize to macOS.
- Command-click selection and Command-scroll enhancement on Mac. Control-scroll
  goes through image zoom on Mac; Windows retains Ctrl selection/enhancement.
- Patient-number lookup and direct printing are disabled on Mac with explanations.
  Local opening/drag-drop, demo loading, comparison, annotations, sidecars and
  exports remain available. Backend patient lookup rejects unsupported platforms.
- Mac combined JPEG exports go to Pictures/RAD Viewer/Exports; demo JPEGs go to
  Pictures/RAD Viewer/John Smith. Windows keeps its office-share export paths.
- Private source ZIP packager includes current tracked/untracked source, lockfiles,
  public assets, icons, handoff and embedded demo files. Dependencies, build
  outputs, Git metadata and private sample folders are excluded. The ZIP has an
  outer SHA-256 and a per-file source manifest; every archive entry is verified.
- Added Windows pixel-reference comparison for the five embedded demo DICOMs,
  including decoded float32 samples, neutral/suggested RGBA and lossless PNGs.

## Windows verification

- Frontend: **194 tests pass** in 15 files. The Windows behavior tests explicitly
  mock Windows metadata; a separate Mac suite covers disabled features, local
  opening, Command selection and Control-scroll zoom routing.
- The same 194 tests pass with Tauri's `darwin/aarch64` frontend environment on
  this Windows host. This checks conditional code, not a native Mac runtime.
- TypeScript/Vite builds pass for Windows and a simulated Mac target. Mac-target
  assets contain macOS aarch64/WKWebView metadata.
- Rust: **105 tests pass**, three pre-existing manual benchmarks ignored. This
  includes sidecar roundtrips/conflicts, source integrity, collision-safe deletion,
  exports, PNG channel fidelity and platform render URL parsing.
- Strict Clippy passes for the workspace and all targets with warnings denied.
- ICNS generation/readback succeeds; configured icon files exist and Mac config
  keys match the installed Tauri schema.
- Pixel baseline recorded on Windows. Cross-platform equality is pending Mac.

## Windows release and deployment

- Release build and NSIS installer completed with locked Rust dependencies:
  target/release/rad-viewer.exe and
  target/release/bundle/nsis/RAD Viewer_0.9.3_x64-setup.exe.
- Canonical executable D:\APPS\RAD-Viewer\rad-viewer.exe reports version 0.9.3.
  Build, staged copy and canonical SHA-256 all match:
  42F1BD964A0BC7159B368C44A522C542B6D2B6BBE33E539326F07CD95E751054.
- Previous 0.9.2 preserved as D:\APPS\RAD-Viewer\rad-viewer-0.9.2.exe:
  2A6BBE42B90196E347109D88BDF88A212AB8FC8BF61CB89C2EC51A263783118D.
- Atomic replacement used the verified staged file. No running viewer was
  force-closed; no viewer processes were running at deployment time.
- Windows pixel-reference comparison passes for all five inputs, decoded samples,
  neutral/suggested RGBA and PNG exports. Input hashes were unchanged.
- Private transfer: output/RAD-Viewer-0.9.3-Mac-source.zip, with a sibling
  .zip.sha256 and embedded SOURCE-MANIFEST.json. The packager verifies every ZIP
  entry against captured source bytes. Extracted manifest verification is part of
  the final packaging check; the outer ZIP digest is in its sibling checksum file.
- No new native Windows visual or physical printer check is claimed for this port.
  Runtime UI coverage here is automated; native Mac acceptance remains below.

## Mac verification — pending

No native Mac compilation or device testing has been performed on this Windows
machine. Follow MAC_HANDOFF.md on the Mac. Required checks include the native
release/Finder launch, WKWebView custom image protocol, Retina display, trackpad
and secondary click, dialogs/cancellation, read-only folders, sidecars, collision
handling, export destinations and pixel-reference comparison. No Mac runtime or
image-quality acceptance is inferred from the Windows or mocked frontend tests.

LAN patient lookup, the Open Dental bridge, direct DNP printing, Intel builds,
distribution signing/notarization and public distribution are deferred on Mac.
