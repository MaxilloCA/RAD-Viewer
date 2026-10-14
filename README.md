# RAD Viewer

Offline Windows radiograph viewer built with Rust, Tauri 2, React and TypeScript.

This delivery is the **Phase A image-quality comparison prototype**. The project handoff requires the user's Carestream comparison approval before implementing the mounting workspace, annotations, session relinking and printing. The experimental presets are independently implemented and are not replicas of Carestream filters. No image-quality acceptance is inferred from automated tests.

## Build and run (Windows x64)

Install the prerequisites in [DEV_ENVIRONMENT.md](DEV_ENVIRONMENT.md). From this folder in PowerShell:

```powershell
$env:Path = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:Path
npm.cmd ci
npm.cmd run tauri -- dev
```

Create a release build and installer:

```powershell
npm.cmd run tauri -- build -- --locked
```

Executable: `target\release\rad-viewer.exe`. Installer: `target\release\bundle\nsis\`.
Dependency versions are pinned in manifests and resolved dependencies in `Cargo.lock` / `package-lock.json`.

```powershell
npm.cmd test
npm.cmd run build
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

## View and adjust images

Open local RVG, PANO, DICOM, JPEG or PNG files. DICOM is detected from content, independently of its extension. Select an image in the strip. Version 0.3.0 shows one enhanced image, with gamma **0.22** and sharpness **6** on every import and Reset. Gamma controls span **0.1–0.9** and sharpness **5–10**. Eligible high-depth intraoral DICOM also receives a source-aware starting window; other images use their supplied or neutral starting window.

Hold the left mouse button on the image and drag **right/left to lighten/darken tone**, or **up/down to increase/decrease gamma**. Shift-drag or middle-drag pans; the wheel zooms; double-click fits. Choose 100% to inspect source pixels. A completed drag is one undo step. Tone and Contrast use short, labeled relative scales instead of raw detector values. The monochrome histogram uses linear pixel counts and a black-to-white intensity strip.

**Colorize** toggles an ordered sampled Viridis false-color mapping of processed intensity, retaining current tone/detail settings. The legend runs from low to high intensity. Histogram and clipping describe intensity before the color mapping. Colorize is included in PNG exports and saved presets. Neutral and Endo preset buttons, the original/reference panes and bypass are removed. Source pixels remain immutable internally.

Expand advanced controls for local contrast, noise reduction and detail enhancement. Undo, redo and Reset affect the selected image. Old saved recipes retain their rendering, even when stored values fall outside the new slider ranges; the UI identifies those values. PNG export always processes the full source resolution. Save review JSON to record recipes; it is not a reopenable workspace session. See [processing details](PROCESSING.md) and [the earlier research and comparison report](verification/IMAGE_QUALITY_REVIEW.md). Matched-scale Carestream comparison remains part of the user's image-quality review.

## Privacy and source preservation

Processing and storage stay local. There are no cloud services, telemetry, patient indexing or background directory scans. Source pixels are immutable; exports are separate files. Identifying DICOM tags are not displayed. Patient samples and local generated verification material are excluded from Git. Do not add clinical images or references to the repository.

## Implementation

- `crates/rad-core`: independently testable decoder and floating-point processing.
- `src-tauri`: bounded background workers, image cache, binary image protocol, native dialogs, local preset persistence, PNG/review export.
- `src`: comparison UI and source-coordinate navigation.
- `CONTRACTS.md`: shared image, recipe and IPC types.
- `IMPLEMENTATION.md`: full roadmap and acceptance gates.

See `verification/` and `PROCESSING.md` for verification evidence and algorithm limits as they are completed. Physical 4 × 6 printer acceptance and Carestream coexistence remain required in later phases.
