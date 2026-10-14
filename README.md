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

The user's shared deployment copy is **`D:\APPS\RAD-Viewer\rad-viewer.exe`**. Always update that exact path to the latest verified release after app changes, retaining the previous version as a numbered backup. Verify the deployed version and SHA-256 against the build output; the build output above remains in the project workspace.

For LAN access, share `D:\APPS\RAD-Viewer` on **SERVER**. If the share is named `RADViewer`, the executable is `\\SERVER\RADViewer\rad-viewer.exe`. It runs on the Windows PC opening it. Patient lookup tries the local `D:\ABELDent\DATA\NOTES` folder first, then `\\C04577\ABELDent\DATA\NOTES` when the local patient folder is unavailable. The remote PC needs access to that patient share. The installer in `target\release\bundle\nsis` can install the viewer and its WebView2 prerequisite on another PC.

```powershell
npm.cmd test
npm.cmd run build
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

## View and adjust images

New imports and **Reset** use **Med**: Gamma **0.50**, Tone **35**, Contrast **−50**, Sharpness **6**. Each default sits at the midpoint of its slider. Gamma spans 0.1–0.9, Tone and Contrast retain their existing −100…100 scales, and Sharpness spans 1–10. The two halves of each slider are scaled separately where needed; displayed values and saved recipes retain their actual meaning. Arrow keys adjust by the displayed control's step.

The **Low / Med / High** buttons increase enhancement: Low uses gamma 0.70, Tone 45, Contrast -75 and sharpness 3; Med uses gamma 0.50, Tone 35, Contrast -50 and sharpness 6; High uses gamma 0.22, Tone 0, Contrast 0 and sharpness 8. Lower gamma darkens the image in this pipeline. High has the strongest global/local contrast and sharpening; Low is the mildest. Med restores the earlier sharpening parameters. Colorize settings are retained when choosing a preset. Existing saved recipes keep their exact values until edited.

**Right-click an image** to rotate it 90° clockwise. **Double-right-click** to toggle its thumbtack hold without rotating it. Single-right-click rotation waits briefly to distinguish the double-click gesture. The Rotate and thumbtack buttons remain available. Left-double-click still fits the image.

Click the **thumbtack** in a radiograph's pane to keep it in the main viewer. Select another bottom-strip preview to view it alongside the pinned images. Only pinned images stay when you select a different preview: there is at most one unpinned working image. You can pin a third, fourth, fifth or more radiographs; the grid resizes to fit them. Two images appear side by side.

Click a pane to select it for adjustments, rotation, Fit, 100%, undo and export. Its border identifies the selected image. Each pane shows its filename and date and retains its own processing settings and orientation. Clicking an already visible image selects it without creating a duplicate. Unpinning an inactive pane removes it from the main view; unpinning the selected pane leaves it as the working image. Opening another patient clears the previous patient's pins. Pinned images use full-resolution rendered snapshots, so they remain visible when their decoded source is unloaded from the bounded cache.

**Rotate 90° clockwise** turns the selected image and its preview by one quarter turn; four clicks return it to its original orientation. Fit accounts for the rotated dimensions. Rotation is kept separately for each image, survives decoded-image cache eviction, and is included in exported PNGs and saved review JSON. Source files remain unchanged.

Each image and preview displays its embedded date as **DD-MMM-YYYY** (for example, `14-Oct-2026`). Date priority is Acquisition Date/Time, Acquisition Date, Content Date, Study Date, then Series Date. The tooltip identifies the source. Dates are validated without timezone conversion. Images without usable embedded date metadata show **Date unavailable**.

Choose **Open patient** and enter the patient number. For example, `67589` resolves to `D:\ABELDent\DATA\NOTES\89\67589`. The viewer reads `PatientInfo.xml` for the patient's name and radiograph directory, follows that directory when available, and falls back to the local patient folder with a notice when unavailable. All supported radiographs in that directory and its subfolders appear in the bottom strip automatically, with previews generated progressively. Select a preview to view the full image. The top bar shows the patient name and entered ID; unavailable names are identified explicitly. Leading zeros are preserved. Opening another patient replaces the strip; failed lookup or an empty collection leaves the existing review intact. Only the requested patient's directory is scanned, and source files remain unchanged. Full-resolution images use a bounded cache so collections larger than 24 images remain available.

Open local RVG, PANO, DICOM, JPEG or PNG files. DICOM is detected from content, independently of its extension. Select an image in the strip. Eligible high-depth intraoral DICOM receives a source-aware base window; other images use their supplied or neutral base window. The default Tone and Contrast offsets described above are applied relative to that base.

Hold the left mouse button on the image and drag **right/left to lighten/darken tone**, or **up/down to increase/decrease gamma**. Shift-drag or middle-drag pans; the wheel zooms; double-click fits. Choose 100% to inspect source pixels. A completed drag is one undo step. Tone and Contrast use short, labeled relative scales instead of raw detector values. The monochrome histogram uses linear pixel counts and a black-to-white intensity strip.

**Colorize** adds selective color to local midtone differences over the grayscale image. Amber means darker than nearby; cyan means lighter than nearby. Smooth areas, deep blacks, bright whites, strong boundaries and fine noise receive reduced or no color. **Color amount** adjusts the overlay (default 80%); **Feature size** selects the neighborhood scale (2–24 source pixels, default 8). These colors describe relative image brightness, not tissue types or diagnoses. Histogram and clipping remain grayscale intensity measurements. PNG exports and saved presets include the settings; older Colorize recipes use the new appearance with default values. See [the design and research note](verification/SELECTIVE_COLORIZE.md). Source pixels remain immutable.

Expand advanced controls for local contrast, noise reduction and detail enhancement. Undo, redo and Reset affect the selected image. Old saved recipes retain their grayscale processing, even when stored values fall outside the new slider ranges; the UI identifies those values. Colorize appearance changes as described above. PNG export always processes the full source resolution. Save review JSON to record recipes; it is not a reopenable workspace session. See [processing details](PROCESSING.md) and [the earlier research and comparison report](verification/IMAGE_QUALITY_REVIEW.md). Matched-scale Carestream comparison remains part of the user's image-quality review.

## Privacy and source preservation

Carestream `.sc` (and `.cs`) files are available in the radiograph picker and automatic patient discovery. The inspected examples are DICOM Secondary Capture images, 852 × 668, unsigned 8-bit MONOCHROME2, with JPEG Extended compression (transfer syntax `1.2.840.10008.1.2.4.51`) and the lossy flag set. The existing DICOM decoder reads their pixels by content; they use the same non-destructive tone, sharpening, colorization and PNG export workflow. The source DICOM files are never rewritten.

Processing and storage stay local. There are no cloud services, telemetry, patient indexing or background directory scans. Source pixels are immutable; exports are separate files. Identifying DICOM tags are not displayed. Patient samples and local generated verification material are excluded from Git. Do not add clinical images or references to the repository.

## Implementation

- `crates/rad-core`: independently testable decoder and floating-point processing.
- `src-tauri`: bounded background workers, image cache, binary image protocol, native dialogs, local preset persistence, PNG/review export.
- `src`: comparison UI and source-coordinate navigation.
- `CONTRACTS.md`: shared image, recipe and IPC types.
- `IMPLEMENTATION.md`: full roadmap and acceptance gates.

See `verification/` and `PROCESSING.md` for verification evidence and algorithm limits as they are completed. Physical 4 × 6 printer acceptance and Carestream coexistence remain required in later phases.
