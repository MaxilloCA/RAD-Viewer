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

## Compare images

Open local RVG, PANO, DICOM, JPEG or PNG files. DICOM is detected from content, independently of its extension. Select an image in the strip. Neutral starts with spatial filters disabled. Pan and zoom stay linked between the neutral, adjusted and reference panes. Choose 100% to inspect source pixels; fit returns to the complete image. Bypass shows the neutral rendering immediately.

Try the experimental Bitewing preset first. Expand advanced controls for noise reduction, local contrast and detail enhancement. Check the histogram and clipping counts, and inspect noise, edge halos and small structures at 100%. Undo, redo and reset affect the selected image. Custom presets persist locally. PNG export always processes the full source resolution.

Use a rendered Carestream v7 PNG/JPEG as the reference. Record its DEJ or Endo setting, Sharpness, orientation and capture zoom in the reference notes. Verify that the exported reference preserves Carestream's displayed appearance. A screenshot with toolbars, borders, a different orientation or different crop must be cropped/aligned externally before a valid matched-scale comparison; synchronized navigation does not register unmatched images automatically.

Save a comparison review JSON to record the recipe and reference context. It is a review record, not a reopenable workspace session. Reference images are visual targets, not decoding ground truth.

## Privacy and source preservation

Processing and storage stay local. There are no cloud services, telemetry, patient indexing or background directory scans. Source pixels are immutable; exports are separate files. Identifying DICOM tags are not displayed. Patient samples and local generated verification material are excluded from Git. Do not add clinical images or references to the repository.

## Implementation

- `crates/rad-core`: independently testable decoder and floating-point processing.
- `src-tauri`: bounded background workers, image cache, binary image protocol, native dialogs, local preset persistence, PNG/review export.
- `src`: comparison UI and source-coordinate navigation.
- `CONTRACTS.md`: shared image, recipe and IPC types.
- `IMPLEMENTATION.md`: full roadmap and acceptance gates.

See `verification/` and `PROCESSING.md` for verification evidence and algorithm limits as they are completed. Physical 4 × 6 printer acceptance and Carestream coexistence remain required in later phases.
