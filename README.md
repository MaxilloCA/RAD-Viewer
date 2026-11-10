# RAD Viewer

Current Windows release: **0.9.11**. Retained macOS source port: **0.9.3**
(frozen at that version). See [current releases and verification](verification/STATUS.md)
for the executable, installer, ZIPs and Mac handoff. Feature sections below describe
the application's development; these are the two supported release versions.
Any incomplete package cleanup is recorded in the verification status.

## Processing shortcuts and defaults (0.9.11)

Press **Ctrl+0** through **Ctrl+7** to apply the corresponding processing level
to the selected images. New images and **Reset** use gamma **0.35**, contrast
**−40** on the existing −100 to +100 scale, and level 4 detail. The viewer
displays this combination as **Custom · near 4**. Saved image adjustments retain
their values.

## macOS local viewer preparation (0.9.3)

Apple Silicon source support is prepared for local image opening, adjustments,
comparison, annotations, sidecars and exports. Native Mac build and device checks
remain pending on the Mac. Read [MAC_HANDOFF.md](MAC_HANDOFF.md) for the transfer
package, setup, build commands, acceptance checklist and continuation prompt.
Mac uses Command selection/shortcuts and local Pictures exports. Patient-number
lookup and direct printing are disabled on Mac. Windows retains its existing
patient lookup, office export destination and printer adapter.

Create the private source snapshot with `python scripts/package_mac_source.py`;
it includes the embedded demo files and untracked source, excluding dependency and
build folders. Keep the patient-derived demo archive out of public repositories.

## About and help (0.9.1)

Choose **About & help** in the bottom bar for creator credits, the application
version, UTC build date, platform and runtime, plus an offline quick guide to
opening images, arranging panes, adjustments, mouse controls, comparison,
annotations, fullscreen, printing, exports and deletion. Close with Done, the
close button or Esc; keyboard focus returns to the About button.

For a trial without installing RAD Viewer, run `scripts/package_portable.ps1`
after building the release. Extract its versioned portable ZIP and run
`rad-viewer.exe`. The five demo radiographs are embedded. Windows x64 and an
existing Microsoft Edge WebView2 Runtime are required. Preferences and demo
data still use the Windows user profile; this is not an isolated USB workspace.

## Focus Dark interface (0.9.0)

The viewer now uses neutral charcoal surfaces with orange highlights for selections,
active tools and processing controls. All existing commands remain available: Reload
Images, Print Current View, Export for Letter, Export to JPEG, Delete, Open Images
and Open Patient stay visible in the header. At narrower window widths the actions
move onto a second row, and the viewing toolbar wraps without hiding controls.

The image grid continues to adapt to the number of visible radiographs. Each image
retains its processing, orientation, annotations and view as panes are selected,
pinned, reordered or closed. Previews and Adjustments can still be retracted for
more image space. Orange borders identify the selection; the inspector shows its
count. Processing levels 1–7 can now be selected directly with the numbered buttons
as well as the existing slider and Ctrl + wheel gesture. Each click supports Undo.
The new Fullscreen button uses the existing F11 behavior; Escape restores the viewer.

Print, export, patient opening and A/B comparison use the matching visual theme.
Image processing and exported image pixels are unchanged by the theme.

## Processing and file management (0.8.8)

Processing levels 1–6 match the former levels 2–7. Level 7 adds stronger processing; new images and Reset default to level 4. Existing saved adjustments retain their values.

Select radiographs with Ctrl + click, then choose the red **Delete** button. Review those images fullscreen and choose **Move to DELETED** to confirm, or **Cancel** / Escape to keep them. Confirmed images and their adjustment sidecars move into a `DELETED` subfolder of each patient folder (or the image's own folder for manually opened files). The folder is created only when deletion is confirmed. Existing deleted files are preserved; conflicting filenames receive a unique suffix. Failed moves remain visible with an error. Patient reloads and direct opening exclude `DELETED`, including its nested folders. Restore files manually by moving them out of that folder.

The upper actions are **Reload Images | Print Current View, Export for Letter, Export to JPEG | Delete | + Open Images, + Open Patient**. Export to JPEG saves a full-resolution JPEG at 70% quality for each selected image. Save settings remains available in the adjustments drawer; appearance changes also continue to save automatically.

## Midtone Contrast (0.8.0)

Open **Detailed adjustments → Colorize → Midtone Contrast**. Amber marks tones darker than the chosen reference; cyan marks lighter tones. Adjust **Midtone center**, increase **Sensitivity** to concentrate color on smaller tonal differences, and set **Color amount**. New settings start at 50% center, ±15 percentage points and 40% color; Colorize remains off until enabled.

**Pick reference** samples a 5×5 source-pixel patch on the next image click; Escape cancels. Only that image changes, with Undo available. **Hold for grayscale** temporarily removes color while retaining all other processing. The same controls are available independently in A/B comparison. Midtone highlight remains available inside Colorize. The local-color option and standalone highlight button were removed in 0.8.1; saved legacy recipes still render compatibly. Colors describe image intensity, not calibrated mineral density or changes between dates.

Offline Windows radiograph viewer built with Rust, Tauri 2, React and TypeScript.

## DNP print compatibility (0.6.2)

The print adapter now recognizes DNP `(6x4)` and `PR (4x6)` paper forms with their borderless allowance (105.0 x 156.1 mm), preserving the driver's native paper identifier. Two-up modes are excluded. Windows print failures now appear as plain text instead of serialized PowerShell XML.

## Mouse controls (0.6.1)

Pan and Magnify buttons have been removed. Scroll to zoom around the pointer; Shift + left-drag or middle-drag pans. Ctrl + scroll changes the processing level. These and the other image gestures are described under **Adjustments → Mouse shortcuts**.

**Ctrl + left-click** a pane, its header, or a thumbnail to add/remove it from the selection. Selected panes and previews are outlined, and Adjustments shows the selection count. A normal click returns to one selected image. Sliders display the active image’s values; changing a control applies that value to the entire selection while preserving unrelated settings. Tone and contrast use each image’s own intensity range and polarity. Processing, presets, Reset, Undo/Redo, toolbar Rotate/Fit/100%, and mouse adjustment/zoom/pan act on the selection. Slider and adjustment drags commit one undo step per image on release; other selected panes refresh then. Right-click rotation and double-right-click pinning still target only the clicked image. Ellipses are drawn on their individual images.

**Double-left-click** an image to display only that image fullscreen. **Esc** restores the previous pane order and layout. **F11** still toggles the complete visible layout fullscreen.

## Compact viewer and 4 x 6 printing (0.6.0)

The image toolbar puts Adjust, Pan, Magnify and Ellipse beside Rotate, Fit and 100%. The Adjustments handle retracts the right drawer; the Previews handle retracts the bottom drawer. Compact headers and reduced labels leave more room for radiographs. Drag an image header onto another pane to swap positions; focus the title and use arrow keys for keyboard reordering. Right-click rotates the clicked image and double-right-click toggles its pin without requiring or changing selection.

**Print** opens a preview of the currently visible radiographs on one landscape 6 x 4 inch sheet. The 1800 x 1200 composition uses a common enlargement factor to preserve relative zoom, current order, rotations, processing and ellipses. Row breaks maximize the image area with five output pixels between neighbours. Full images are printed without pan cropping; unavoidable aspect-ratio space is black. No viewer controls, filenames or patient labels are printed.

Select the installed DNP RX1HS printer (preselected when found), then **Print 1 copy**. Printing uses the local Windows driver and requires a supported 4 x 6 paper size; no job is submitted if the driver does not offer it. Driver hard margins may reduce the composition slightly. A successful submission confirms Windows accepted the job, not that paper physically emerged. Temporary print pixels are removed after submission. Install the DNP driver and load 4 x 6 media on each workstation that prints. Physical printer acceptance remains necessary.

Dark-area review has been removed. Older sidecars still load their processing, rotation and ellipses, but their retired dark-area overlay is ignored and excluded from new exports. The historical notes below describe earlier versions.

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

This delivery is the **Phase A image-quality comparison prototype**. The current UI and printing changes were requested by the user; image-quality acceptance remains a separate clinical review. The experimental presets are independently implemented and are not replicas of Carestream filters. No image-quality acceptance is inferred from automated tests.

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

The user's shared deployment copy is **`D:\APPS\RAD-Viewer\rad-viewer.exe`**. Always update that exact path to the latest verified release after app changes. Verify the deployed version and SHA-256 against the build output, then remove superseded executables, installers and packages. Keep only the latest verified app version; temporary rollback copies are retained only until deployment verification succeeds.

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

Choose **Adjust**, **Pan**, **Magnify**, or **Ellipse** in the image toolbar. Adjust drags change contrast/gamma; Pan drags move within an image; Magnify clicks zoom in (Alt-click zooms out). Mouse wheel zoom stays centred on the pointer. Shift/middle drag pans in every tool. Right-click rotation and double-right-click pinning can be disabled under **Mouse shortcuts**.

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

Hold the left mouse button on the image and drag **right/left to increase/decrease contrast**, or **up/down to increase/decrease gamma**. Shift-drag or middle-drag pans; the wheel zooms; double-click fits. Choose 100% to inspect source pixels. A completed drag is one undo step. Tone and Contrast use short, labeled relative scales instead of raw detector values. The monochrome histogram uses linear pixel counts and a black-to-white intensity strip.

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

**Export for Letter** saves the current viewer as one branded image directly to `\\server\incoming`. See JPEG export (0.8.1) below for filename and footer details.

The existing single-image PNG export remains available. Its experimental dark-area overlay remains screen-only; use batch JPG export to include that overlay.

## Viewer workflow improvements (0.7.0)

- The filmstrip groups images by recorded date, newest first, with a separate Date unavailable group. All thumbnails retain their original library numbers and selection behavior.
- A/B compare opens two independent copies of the selected radiograph fullscreen. Each has its own processing, tone, gamma, contrast, detail, color, rotation, pan and zoom. Use A or Use B applies that copy to the original image and its shared XML settings; closing with Esc discards comparison-only edits. This is separate from F11's image-only viewing mode.
- Refresh images rescans the current patient's radiograph locations, adds newly discovered files without duplicates, and preserves the current selection, panes, annotations and committed edits. Existing open files remain available even if absent in the rescan. Newly added images appear in the filmstrip.
- Highlight midtones enables amber highlighting around an adjustable Midtone level (5–95%) after normal image enhancement. Color amount controls intensity. Tone, gamma, contrast, sharpening and noise controls remain active. The existing local-contrast color mode is still selectable. Neither color mode identifies decay or makes a diagnostic classification.
- Each image header has a reset icon for that image's default processing, gamma and tone. Reset participates in adjustment undo and shared XML saving; rotation and annotations remain separate.
- Export viewer JPEG replaces the multiple-file export with one combined image. It preserves visible pane order and pan/zoom, arranges the grid for the screen aspect ratio, and includes each recorded date, patient identity and the office logo at bottom left. The output is up to twice screen dimensions, capped at 4096 pixels per axis, encoded once at JPEG quality 70. It uses full-resolution processed source images before composition. There is no export of interface controls.
- Destination: `\\C04577\incoming\<LastName, FirstName>\<LastName, FirstName> - <PatientID> - <UUID>.jpg`. Windows prohibits `|`, so hyphens separate those fields. Names come from separate first/last name fields in patient XML; if these are unavailable, the displayed name is retained, or the user is prompted when no name is known. Dates unavailable in the source are explicitly labeled. Existing files are never overwritten.
- The bundled office logo comes from https://kidsdentistry.ca/wp-content/uploads/KD_logo.png; no web connection is required during exports.


## JPEG export (0.8.1)

**Export for Letter** saves the visible viewer composition directly to `\\server\incoming\` as `PatientName - PatientID - 123456.jpg`. The six decimal digits are a hash of the export timestamp; atomic filename reservation advances to a free ID on collision, preserving existing exports. Network errors are reported without silently falling back to another directory.

The black footer includes the supplied transparent KidsDentistry.ca logo, white doctor and office contact text, and patient identification. The image dates, visible order, pan/zoom, current processing, and JPEG quality 70 remain unchanged. Colorize offers Midtone Contrast and Midtone highlight; the separate Highlight midtones button and Local contrast color controls are removed. Previously saved local-color recipes remain readable and render unchanged; their disabled legacy selection can be replaced by either supported mode.


## JPEG preview (0.8.2)

**Export for Letter** prepares an on-screen preview using the same JPEG encoder and quality as the saved file. Choose **Confirm and save** to write it to the incoming folder. **Cancel** or **Escape** dismisses the preview without saving; preparation can also be cancelled. Once a confirmed write has started, the dialog reports Saving JPEG until success or failure.


## Main viewer grid (0.8.3)

The viewer, Print command and JPEG preview/export use 2 rows × 2 columns for 3–4 images, 2 × 3 for 5–6, 3 × 3 for 7–9, and 3 × 4 for 10–12. These grids stay fixed as the window changes size. One and two images retain their previous layouts; larger collections retain adaptive placement.

## Branded JPEG sidebar (0.8.4)

Main Viewer JPEG exports use a white sidebar with the original bundled KidsDentistry.ca logo, patient name, office address, phone and email. The patient ID and doctors' names are omitted from the image. Long patient names wrap within the sidebar. Radiographs appear to the right in the existing viewer order and grids, with a date caption below each image. Original source files, processing, rotation, current pan/zoom, JPEG quality, confirmation and export filenames are unchanged.

## Letter export and friend demo (0.8.5)

The combined JPEG action is named **Export for Letter** in the viewer and export dialog. **Open John Smith demo**, available on the start screen and Open patient dialog, opens five bundled sample radiographs without an office drive or network lookup. The app creates a writable **John Smith** folder under `%LOCALAPPDATA%\com.local.radviewer\Samples`. Its sample identity is John Smith / DEMO; refreshing the demo stays local. Demo letter exports save to `Pictures\RAD Viewer\John Smith`; ordinary patient exports retain their office incoming destination.

The Windows x64 installer embeds the five demo images and includes the WebView2 bootstrapper (internet is required only when that runtime is missing). `scripts/package_demo.ps1` creates a shareable setup file and a ZIP with the setup, an extra John Smith sample folder, brief instructions and checksums.

Demo files are prepared locally by `python scripts/prepare_demo.py SOURCE_FOLDER`. The script constructs new DICOM datasets with John Smith metadata, new UIDs and an explicit allowlist of image attributes; it excludes private tags, original direct identifiers and the original patient XML. Compressed pixel data and decoded pixel arrays are verified equal, dates retained and source hashes verified unchanged. Source pixels must also be reviewed for identifying text before packaging. Generated patient-derived assets under `demo/John Smith` and the share packages are excluded from Git. Prepare those local files before compiling the embedded-demo build.

## Fixed detail method (0.8.6)

Advanced processing and A/B comparison always use **Radiograph multiscale**. The detail-method dropdown is replaced by a read-only label. Older saved image settings and custom presets use the fixed method when opened or applied, retaining their numerical adjustments, rotation and annotations. Subsequent edits are saved with the fixed method; undo/redo and comparison resets keep it selected. Original radiograph files remain unchanged.

## Windows line measurements and calibration (0.9.5)

Choose **Measure**, then **Calibrate**. Drag across a known structure on the
radiograph and enter its actual length in millimetres. Apply calibration to
update all existing and future measurements on that image. The yellow line marks
the reference; cyan measurement lines show estimated lengths to one decimal.
Each radiograph has its own scale, independent of pan, zoom and rotation.
**Recalibrate** replaces the reference; cancelling preserves the existing scale.
**Clear calibration** removes the scale without deleting measurement lines.

Measurements and calibration last for the current viewing session only; they
are not saved, exported or printed. Before calibration, the temporary conversion
is 1 mm/source pixel and labels explicitly say uncalibrated.

## Windows viewer controls (0.9.6)

Images opened in the main viewer are pinned by default. Manual unpinning remains available.
Ctrl+A opens A/B comparison; Ctrl+F opens fullscreen; Ctrl+C toggles Colorize;
Ctrl+Q rotates clockwise; Ctrl+E opens Export for Letter; Ctrl+P opens Print;
Ctrl+O opens images; Ctrl+R reloads the current patient images. Shortcuts respect
disabled controls and do not intercept typing in fields or modal dialogs.

## Annotation controls (Windows 0.9.7)

Hide/Show annotations controls mark visibility in the viewer and A/B comparison; saved marks and exports are unchanged. Select annotation enables clicking ellipses, measurement lines or calibration references. Selected marks are highlighted. Delete selected annotation removes only that mark. Ellipse deletion is saved automatically. Deleting a calibration reference preserves measurement lines but returns them to uncalibrated values. Measurement data remains session-only.

## Toolbar and processing level 0 (Windows 0.9.8)

Adjust is first in its own group. Ellipse, Measure and annotation visibility/selection/deletion share a single group on the same row. A/B comparison is the last button. Narrow windows can scroll the toolbar horizontally. Processing level 0 disables sharpen, denoise, local contrast and CLAHE and restores baseline window contrast; tone, gamma, inversion and color settings remain unchanged. Levels 1-7 and default level 4 are retained. Level 0 is available in the main viewer, A/B comparison and Ctrl+wheel stepping.


Selected JPEG exports ask for a destination once for all selected images. For a
known patient the default is `\\server\Incoming\Lastname, Firstname - RAD Export`.
Exports include current image processing, colorization, rotation and ellipse
annotations at full resolution and JPEG quality 70. Choose another folder in the
native picker if preferred. Each image gets its own dated, numbered `.jpg` file;
existing files and originals are preserved.
