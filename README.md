# RAD Viewer

Offline Windows radiograph viewer built with Rust, Tauri 2, React and TypeScript.

## Processing levels and Open Dental launch

Processing level has seven discrete stops, from least to most sharpening, contrast, local contrast and adaptive contrast. Previously unedited images and Reset start at level 4 (gamma 0.5, tone 35, contrast -50, sharpness 6). Changing levels preserves tone, gamma, inversion, noise reduction and Colorize settings. Drag up/down on an image for gamma and left/right for tone. Manual processing adjustments show Custom with the nearest slider stop.

During adjustment, the viewer uses a small, explicitly labeled interactive preview for faster feedback. Releasing the mouse restores full-resolution detail with the final settings. Pins and PNG exports always use the full-resolution source.

In Open Dental, use **Setup → Program Links → Add** for a custom bridge:

- Description / button text: `RAD Viewer`
- Path of file to open: `\\server\APPS\RAD-Viewer\rad-viewer.exe`
- Optional command line arguments: `--patnum [PatNum]`
- Enable the bridge and select its toolbar.

The executable path must match the actual Windows share. The supplied patient number must match the ABELDent patient folder ID. A complete Windows command is:

```text
"\\server\APPS\RAD-Viewer\rad-viewer.exe" --patnum 67751
```

Local equivalent: `"D:\APPS\RAD-Viewer\rad-viewer.exe" --patnum 67751`. Do not append `?patnum=` directly to the executable filename. `--patnum=67751` also works. No arguments opens an empty viewer; invalid arguments show an error. Every launch creates a separate process/window. Launching with an ID uses the same XML lookup and automatic latest-day display as Open patient. Patient name and ID appear beside RAD Viewer in the top bar.

Sources: [Open Dental Program Links](https://www.opendental.com/manual/programlinks.html), [Custom Bridges](https://www.opendental.com/manual/bridgecustom.html). Configuration within Open Dental and execution from another LAN workstation require verification on that workstation.

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

For LAN access, share `D:\APPS\RAD-Viewer` on **SERVER**. If the share is named `RADViewer`, the executable is `\\SERVER\RADViewer\rad-viewer.exe`. It runs on the Windows PC opening it. Patient lookup tries the current `<last two digits>\<patient number>` layout under `D:\ABELDent\DATA\NOTES`, `\\C04577\ABELDent\DATA\NOTES`, and `\\SERVER\ABELDent\DATA\NOTES`, in that order. If no radiographs are found, it tries the older `PN<prefix>\<middle two digits>\<last two digits>IMGS` layout under those same roots. For example, patient `48486` resolves to `PN4\84\86IMGS`. A missing or empty current folder does not prevent the older-layout fallback. Only after every candidate fails does the viewer report the checked locations. The remote PC needs access to that patient share. The installer in `target\release\bundle\nsis` can install the viewer and its WebView2 prerequisite on another PC.

```powershell
npm.cmd test
npm.cmd run build
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

## View and adjust images

### Version 0.4.2 pane close controls

Each radiograph pane has an × icon beside the pin button. It closes that pane from the main viewing area while retaining its thumbnail, adjustments and annotations. Click its thumbnail to reopen it. Closing the selected pane selects another visible pane; closing the last pane leaves the thumbnail strip available. Pane controls remain hidden in image-only fullscreen; press Esc to access them.

### Version 0.4.1 viewing shortcuts

- **F11** toggles native fullscreen with only the radiographs visible. **Esc** restores the normal window and controls. Existing mouse gestures and annotations remain available; views and processing settings are retained.
- **Ctrl + mouse wheel** over an image increases enhancement when scrolling up and decreases it when scrolling down, through the same seven processing levels as the slider. It preserves tone/gamma, supports Undo, and does not zoom the page or image. Plain wheel still zooms toward the pointer.
- Opening a patient shows all images from their latest imaging date. Switching between visible panes keeps the other images visible.

### Version 0.4.0 interaction update

The start screen opens patients directly by number. **Open patient** is the primary header action. The native Windows title bar shows the selected image's patient name and ID; manually imported images use the neutral **RAD Viewer** title. The adjustment panel identifies its selected image with a thumbnail, filename and date.

Daily controls are **Processing level**, **Tone**, and **Hold to compare with neutral**. Hold that comparison button with the mouse, Space or Enter to temporarily show the neutral rendering without changing settings or history; releasing restores the enhanced view. Detailed adjustments (including the original Colorize), histogram, and saved presets are collapsible. The seven processing levels change sharpness and contrast while preserving tone and gamma.

Choose **Adjust**, **Pan**, **Magnify**, or **Ellipse** in the image toolbar. Adjust drags change tone/gamma; Pan drags move within an image; Magnify clicks zoom in (Alt-click zooms out). Mouse wheel zoom stays centred on the pointer. Shift/middle drag pans in every tool. Right-click rotation and double-right-click pinning can be disabled under **Mouse shortcuts**.

Drag the **⠿ grab handle** at the upper right of an image onto another image to swap their positions. The target shows **Release to swap**. A focused handle also supports arrow keys. Image settings, pins, annotations and manual zoom/pan remain attached to their image. Adding/removing panes no longer resets manually positioned views; **Fit all** explicitly refits the visible panes.

**Ellipse** draws red or yellow outlines with a **3 CSS-pixel screen width**, unchanged by zoom. Annotations follow the image through pan, zoom, rotation and pane swaps. **Remove last** and **Clear ellipses** affect the selected image. PNG export includes ellipses at the full-resolution equivalent of their visible stroke width; Save settings includes their source coordinates. Annotations are session-local and are discarded when the image is closed or another patient is opened. The existing review JSON remains an export, not a reopenable session.

**Dark-area review (experimental)** is a separate, user-guided visualization to try for the caries-highlighting investigation. Select a tooth area by drawing a rectangle, then adjust sensitivity. Yellow through red indicates increasing darkness relative to nearby pixels, **not disease probability**. It uses immutable source intensities, polarity-aware modality mapping, bounded area averaging, two neighbourhood scales and connected-component filtering. It rejects small isolated components, components crossing the selection boundary and very large components. It runs locally on the CPU. The original Colorize feature is unchanged.

This prototype **does not identify or rule out decay**: pulp, normal anatomy, burnout, overlap and other artifacts can be highlighted; lesions may be missed. It is not a trained or clinically validated detector. The overlay is screen-only and is excluded from PNG exports. A true automatic caries detector requires suitable annotated training data, a vetted model and validation on representative images from this practice. See the primary studies on [early caries detection](https://www.nature.com/articles/s41598-021-96368-7) and [caries versus cervical burnout](https://pmc.ncbi.nlm.nih.gov/articles/PMC13040230/). Synthetic tests establish software behavior only, not clinical performance.

New imports and **Reset** use **level 4**: Gamma **0.50**, Tone **35**, Contrast **−50**, Sharpness **6**. Each default sits at the midpoint of its slider. Gamma spans 0.1–0.9, Tone and Contrast retain their existing −100…100 scales, and Sharpness spans 1–10. The two halves of each slider are scaled separately where needed; displayed values and saved recipes retain their actual meaning. Arrow keys adjust by the displayed control's step.

The **Processing level** slider replaces Low / Med / High. Its seven stops change detail and contrast without changing tone or gamma. Colorize settings are retained when changing levels. Existing saved recipes keep their exact values until edited.

**Right-click an image** to rotate it 90° clockwise. **Double-right-click** to toggle its thumbtack hold without rotating it. Single-right-click rotation waits briefly to distinguish the double-click gesture. The Rotate and thumbtack buttons remain available. Left-double-click still fits the image.

Click the **thumbtack** in a radiograph's pane to keep it in the main viewer. Select another bottom-strip preview to view it alongside the pinned images. Only pinned images stay when you select a different preview: there is at most one unpinned working image. You can pin a third, fourth, fifth or more radiographs; the grid resizes to fit them. Two images appear side by side.

**Open patient** and patient launch arguments automatically display every usable radiograph from the most recent acquisition day. Images are ordered and grouped by embedded radiograph date; missing dates use file modification day, and modification time breaks same-date ties. Earlier dates remain available in the preview strip. Failed latest-day files are reported rather than replaced with older dates. Images appear progressively; interacting with the images stops unfinished automatic selection so background loading cannot change your choice. A patient with one usable image opens just that image.

Click a pane to select it for adjustments, rotation, Fit, 100%, undo and export. Its border identifies the selected image. Each pane shows its filename and date and retains its own processing settings and orientation. Clicking an already visible image selects it without creating a duplicate. Unpinning an inactive pane removes it from the main view; unpinning the selected pane leaves it as the working image. Opening another patient clears the previous patient's pins. Pinned images use full-resolution rendered snapshots, so they remain visible when their decoded source is unloaded from the bounded cache.

**Rotate 90° clockwise** turns the selected image and its preview by one quarter turn; four clicks return it to its original orientation. Fit accounts for the rotated dimensions. Rotation is kept separately for each image, survives decoded-image cache eviction, and is included in exported PNGs and saved review JSON. Source files remain unchanged.

Each image and preview displays its embedded date as **DD-MMM-YYYY** (for example, `14-Oct-2026`). Date priority is Acquisition Date/Time, Acquisition Date, Content Date, Study Date, then Series Date. The tooltip identifies the source. Dates are validated without timezone conversion. Images without usable embedded date metadata show **Date unavailable**.

Choose **Open patient** and enter the patient number. For example, `67589` resolves to `D:\ABELDent\DATA\NOTES\89\67589`. The viewer reads `PatientInfo.xml` for the patient's name and radiograph directory, follows that directory when available, and falls back to the local patient folder with a notice when unavailable. All supported radiographs in that directory and its subfolders appear in the bottom strip automatically, with previews generated progressively. Select a preview to view the full image. The top bar shows the patient name and entered ID; unavailable names are identified explicitly. Leading zeros are preserved. Opening another patient replaces the strip; failed lookup or an empty collection leaves the existing review intact. Only the requested patient's directory is scanned, and source files remain unchanged. Full-resolution images use a bounded cache so collections larger than 24 images remain available.

Open local RVG, PANO, DICOM, JPEG or PNG files. DICOM is detected from content, independently of its extension. Select an image in the strip. Eligible high-depth intraoral DICOM receives a source-aware base window; other images use their supplied or neutral base window. The default Tone and Contrast offsets described above are applied relative to that base.

Hold the left mouse button on the image and drag **right/left to lighten/darken tone**, or **up/down to increase/decrease gamma**. Shift-drag or middle-drag pans; the wheel zooms; double-click fits. Choose 100% to inspect source pixels. A completed drag is one undo step. Tone and Contrast use short, labeled relative scales instead of raw detector values. The monochrome histogram uses linear pixel counts and a black-to-white intensity strip.

**Colorize** adds selective color to local midtone differences over the grayscale image. Amber means darker than nearby; cyan means lighter than nearby. Smooth areas, deep blacks, bright whites, strong boundaries and fine noise receive reduced or no color. **Color amount** adjusts the overlay (default 80%); **Feature size** selects the neighborhood scale (2–24 source pixels, default 8). These colors describe relative image brightness, not tissue types or diagnoses. Histogram and clipping remain grayscale intensity measurements. PNG exports and saved presets include the settings; older Colorize recipes use the new appearance with default values. See [the design and research note](verification/SELECTIVE_COLORIZE.md). Source pixels remain immutable.

Expand advanced controls for local contrast, noise reduction and detail enhancement. Undo, redo and Reset affect the selected image. Old saved recipes retain their grayscale processing, even when stored values fall outside the new slider ranges; the UI identifies those values. Colorize appearance changes as described above. PNG export always processes the full source resolution. Save review JSON to record recipes; it is not a reopenable workspace session. See [processing details](PROCESSING.md) and [the earlier research and comparison report](verification/IMAGE_QUALITY_REVIEW.md). Matched-scale Carestream comparison remains part of the user's image-quality review.

## Privacy and source preservation

Supported color DICOM captures (`.sc`/`.cs` included) are decoded and converted to grayscale automatically inside the viewer. They use the same enhancement, rotation and PNG export controls. Original files remain intact; no Carestream installation or separate codec installation is required. See [supported color formats and conversion](verification/DECODING.md).

Carestream `.sc` (and `.cs`) files are available in the radiograph picker and automatic patient discovery. The inspected examples are DICOM Secondary Capture images, 852 × 668, unsigned 8-bit MONOCHROME2, with JPEG Extended compression (transfer syntax `1.2.840.10008.1.2.4.51`) and the lossy flag set. The existing DICOM decoder reads their pixels by content; they use the same non-destructive tone, sharpening, colorization and PNG export workflow. The source DICOM files are never rewritten.

Processing and storage stay local. There are no cloud services, telemetry, patient indexing or background directory scans. Source pixels are immutable; exports are separate files. Identifying DICOM tags are not displayed. Patient samples and local generated verification material are excluded from Git. Do not add clinical images or references to the repository.

## Implementation

- `crates/rad-core`: independently testable decoder and floating-point processing.
- `src-tauri`: bounded background workers, image cache, binary image protocol, native dialogs, local preset persistence, PNG/review export.
- `src`: comparison UI and source-coordinate navigation.
- `CONTRACTS.md`: shared image, recipe and IPC types.
- `IMPLEMENTATION.md`: full roadmap and acceptance gates.

See `verification/` and `PROCESSING.md` for verification evidence and algorithm limits as they are completed. Physical 4 × 6 printer acceptance and Carestream coexistence remain required in later phases.

## Shared image adjustments and JPG export (0.5.0)

Committed processing, tone, gamma, rotation, red/yellow ellipse annotations and dark-area review settings save automatically beside each source image as `<original-filename>.rad-viewer.xml`. Opening that image again restores its appearance, including on another clinic computer using the same shared radiograph directory. All computers must run 0.5.0 or later and have write access to that directory. Original radiograph bytes remain unchanged. Zoom, pan and pane layout are not image adjustments and are not restored by these sidecars.

Writes are atomic, use an OS file lock (the small `.xml.lock` companion is retained), and check a revision to prevent stale sessions silently replacing another computer's edits. Save failures appear in the status bar with Retry. Pending saves finish before changing charts or exiting. If another viewer has changed the same image, close and reopen to load its changes; closing without saving discards the conflicting local edits. Invalid sidecars are preserved and automatic saving for that image is disabled, with an error. SHA-256 and native dimensions bind each sidecar to its original image.

**Export all JPGs** exports only radiographs currently displayed in the main viewer to `\\C04577\incoming\<PatientName>`. Each file uses the full original resolution (dimensions swap for quarter-turn rotations), JPEG quality 70/100, current processing, rotation, ellipses and any visible dark-area overlay. Pan and zoom do not crop or resize the export. Annotation widths are scaled from their on-screen three-pixel stroke. An animated progress dialog reports each completed image and confirms the destination. If a network write fails, it reports how many files completed. Filenames use the recorded image date and a sequence, such as `2026-10-15_01.jpg`, `2026-10-15_02.jpg`. Each date has its own sequence, starting at 01 and skipping existing filenames to preserve earlier exports. Images without an embedded date use `date-unknown_01.jpg`. Images opened without patient identity prompt for a patient folder name; invalid Windows filename characters are replaced with underscores.

The existing single-image PNG export remains available. Its experimental dark-area overlay remains screen-only; use batch JPG export to include that overlay.
