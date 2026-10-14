# Phase A integration contract

## 0.3.8 ordered enhancement presets

Med remains the import/Reset default: gamma 0.5, Tone 35, Contrast -50, with the earlier sharpness 6, radius 2.2, threshold 0.0015, halo 0.35 and local contrast 0.4 restored. Sharpness retains range 1-10; its midpoint is now 6. Existing saved recipes retain their values.

| Preset | Gamma | Tone | Contrast | Sharpness | Local contrast | Radius | Threshold |
|---|---:|---:|---:|---:|---:|---:|---:|
| Low | 0.70 | 45 | -75 | 3 | 0.2 | 2.2 | 0.0015 |
| Med | 0.50 | 35 | -50 | 6 | 0.4 | 2.2 | 0.0015 |
| High | 0.22 | 0 | 0 | 8 | 0.5 | 2.5 | 0.001 |

This pipeline applies intensity^(1/gamma), so High uses the lowest gamma to darken midtones. Global and local contrast and sharpening increase from Low to High. All use radiograph detail, halo 0.35, denoise/CLAHE off, and preserve Colorize settings on preset selection. These settings supersede the 0.3.7 defaults below. No processing algorithm changes.


## 0.3.7 centered defaults and mouse shortcuts

Imports and Reset use version-2 Med with Gamma 0.5, Tone 35, Contrast −50 and Sharpness 3. Tone/Contrast retain their existing calculations against the original suggested-or-neutral base window; they are not re-zeroed. MONOCHROME1 polarity is accounted for when building the initial recipe. Gamma stays 0.1–0.9, Tone/Contrast −100…100, and Sharpness is now 1–10. A piecewise linear thumb-position mapping places each requested default at 50% without changing the actual recipe values or engine validation. Sliders display/expose actual units and support actual-step keyboard changes and Home/End.

Low/Med/High replace the previous built-in buttons. Their gamma/sharpness pairs are 0.3/1, 0.5/3 and 0.7/6, with common Tone35/Contrast−50 and unchanged radiograph-detail parameters (local contrast0.4, radius2.2, threshold0.0015, halo0.35). Selecting a built-in retains Colorize settings; Reset turns Colorize off and restores its defaults. Serialized old recipes are not migrated or remapped.

Image panes distinguish single from double right-click. A single right-click rotates the targeted pane 90° clockwise after the double-click interval; double-right-click toggles its pin without rotation. Targeting uses the entry key rather than whichever image is selected when a timer expires. Pointer cancellation, dragging and unmount prevent unintended delayed actions. Existing toolbar/pin buttons and left-double-click fit remain available. Source pixels and PNG export processing are unchanged.

## 0.3.6 pinned radiograph panes

The user's explicit request adds a pinned multi-image review view. Visible entries are the pinned entries plus the selected entry if it is not already pinned; there is at most one unpinned working pane. Two images are side by side and larger collections reflow within the main viewport. There is no two-image cap. Selecting a displayed pin does not duplicate it. Unpinning an inactive entry removes its pane; the selected unpinned entry remains visible. Closing removes the entry and its pin, and patient replacement clears all previous pins.

Image identity, recipe/history, rotation and view state are per entry. The selected pane owns the shared toolbar, controls, histogram and single-image PNG export. Activating an inactive pane does not apply the initiating pointer gesture to the previously selected image. Full-resolution immutable PNG snapshots keep inactive pins visible independently of the eight-entry decoded-source cache; bottom-strip thumbnails are never used for these panes. Committed adjustments refresh pin snapshots independently of the selected render queue, with generation/recipe checks and coalescing to reject stale results after rapid edits, unpinning, closing or patient replacement.

The pin setting is review state, not part of processing `Recipe`, and does not alter pixels or source files. Saved review JSON records pins; it remains a settings record rather than a reopenable workspace session. This feature does not implement mounting templates, annotations or printing.

`render_snapshot { id, recipe, requestId } -> RenderInfo` returns a durable full-resolution PNG data URL using the same processing engine as preview/export. It retains the source processor before awaiting work, uses the existing per-source lock and worker semaphore, and does not change the selected render's supersession counter or cache tokens. The frontend runs one snapshot request at a time, coalesces each pin's pending committed recipe, and temporarily protects queued/in-flight snapshot sources from decoded-cache eviction. Completed pin snapshots survive eviction. `pinPending` displays progress; a failed refresh keeps the previous snapshot with a persistent `pinError` indicator. Cancelled and old-patient completions cannot repopulate panes.

## 0.3.5 selective local Colorize

Version-2 Colorize now uses signed local contrast rather than a global intensity palette. `Recipe` adds `color_strength: f32` / `colorStrength` (0–1, default 0.8) and `color_scale: f32` / `colorScale` (2–24 source pixels, default 8). Serde supplies defaults for older JSON; frontend equality treats omitted values as those defaults. Invalid/nonfinite values are rejected. This intentionally changes the appearance of older Colorize recipes; grayscale recipes retain their rendering.

Color evidence is computed from prepared floating-point values before fine sharpening. Display inversion reverses hue sign: amber means darker than the local neighborhood, cyan lighter. A smooth final-brightness gate concentrates chroma in midtones, with local noise, scale agreement, strong-edge and boundary suppression. Color amount zero produces the processed grayscale image when Colorize is on, including RGB inputs. Rec.709-weighted display RGB brightness is preserved before quantization; this is not a linear-light or perceptual luminance guarantee.

New fields affect final render equality and serialized review/export/preset recipes, but not the upstream prepared-stage cache key. Full-resolution display/export share the same algorithm; histogram and clipping are unchanged. Built-in processing presets preserve the selected overlay settings; Reset restores 0.8/8 with Colorize off. Controls are visible only when Colorize is on. Rotation and image dates are unchanged.

## 0.3.4 rotation, image dates and reversed color

`ImageMetadata` adds nullable `imageDate` (validated calendar `YYYY-MM-DD`) and `dateSource` (DICOM keyword). Preference is AcquisitionDateTime, AcquisitionDate, ContentDate, StudyDate, SeriesDate. Missing or invalid values fall through; ordinary PNG/JPEG dates are unavailable. The interface formats calendar components as `DD-MMM-YYYY` without timezone conversion.

Frontend entries retain `rotationQuarterTurns` in 0–3 independently of processing recipes. The main image and thumbnail rotate clockwise, fit swaps dimensions for odd turns, and review JSON includes this field. `export_image` accepts optional `rotationQuarterTurns` (default 0); it rotates the full-resolution final RGBA output by exact pixel permutation before PNG encoding. Original source pixels and processing histograms are unchanged.

Colorize now reverses the existing sampled Viridis lookup: zero maps to RGB (253,231,37), one to (68,1,84). This intentionally updates the appearance of existing version-2 Colorize recipes. The upstream grayscale stages and histogram remain unchanged.

## 0.3.3 Carestream Secondary Capture and LAN lookup

The picker and patient discovery recognize `.sc`/`.cs` case-insensitively; decoding still identifies content rather than assuming every file with that suffix is DICOM. The supplied `.sc` files are single-frame DICOM Secondary Capture with JPEG Extended compressed unsigned 8-bit MONOCHROME2 data. No decoder conversion or invented bit depth is introduced. Edits remain processing recipes and separate PNG exports.

`open_patient` tries the local patient directory first and falls back to the same patient-number layout under `\\C04577\ABELDent\DATA\NOTES` if the local directory is absent/inaccessible. This permits execution from a LAN share without treating the client PC's D: drive as the sole patient location. Patient XML directory resolution then proceeds as before.

## 0.3.2 automatic patient loading

`open_patient { patientNumber: string } -> { patientNumber, patientName: string | null, directory, paths: string[], warnings: string[] }` validates a trimmed ASCII identifier of 2–64 digits, preserves leading zeros, and resolves `D:\ABELDent\DATA\NOTES\<last two digits>\<complete number>`. On a blocking worker it reads the local `PatientInfo.xml` trophy/patient parameters `first_name`, `last_name`, and `directory`. The entered ABELDent number remains the displayed ID; the XML internal identifier is not substituted. XML entities are decoded, DTDs rejected, and XML input limited to 1 MiB. An unavailable XML target falls back to the local folder with a warning. Discovery recursively lists supported image suffixes and standard DICOM magic without following junctions/symlinks or enumerating the entire archive. There is no file-selection dialog or 24-entry discovery limit. Patient changes replace the strip and identity, while failed/empty discovery preserves the existing review.

`image_thumbnail { id, requestId } -> string` returns a local PNG data URL with a maximum edge of 120 pixels from the specified initial full-resolution render. Compact previews survive release of decoded sources; full-resolution decoding remains bounded. Thumbnail pixels are never used for full-size viewing or export.

## 0.3.0 controls and display contract

This section supersedes older UI descriptions. One enhanced viewport replaces original/adjusted/reference panes. All imports and Reset use version 2 Bitewing with gamma 0.22, sharpness 6 and the suggested window (neutral window when no source-aware suggestion applies). Neutral remains an internal immutable-source baseline. There is no original/bypass control, Neutral preset button, Endo button or reference loading UI.

`Recipe.colorize: bool` / `colorize: boolean` defaults to false for older serialized recipes. Colorize requires version 2; the UI upgrades explicitly when toggled. It is part of full recipe equality for the final PNG cache but is absent from the upstream floating-stage cache key because only the display stage uses it. Histogram/clipping remain pre-colorization intensity values. Exports and display share the final lookup. Version 2 sharpness validates through 10; version 1 retains its previous maximum 3 and gamma validation remains 0.1–5 for legacy compatibility.

UI gamma bounds are 0.1–0.9, sharpness 5–10. Stored presets outside these ranges retain their exact recipe until edited and are labeled accordingly. Tone/Contrast expose relative -100…100 scales against each image's initial window. Horizontal left-drag changes tone and vertical left-drag gamma; Shift-left/middle drag pans. Pointer release/cancellation ends one history transaction. During changes, bounded/coalesced full-resolution rendering retains the last completed image with a processing indication. Switching/closing images cannot attach an old response to another source. The histogram uses linear counts and monochrome fill, with a black-to-white intensity strip. Colorize shows an intensity legend.

## 0.2.0 contract extension (historical UI)

`Recipe` now includes `local_contrast: f32` / `localContrast: number`, defaulting to zero when reading old JSON. Version 1 rendering is preserved. Version 2 adds `detail_mode: "radiograph"`, strength up to six and independent local contrast. A deliberate choice of a new control upgrades the selected recipe to version 2; loading a saved version 1 preset does not.

`import_image` additionally returns `suggested: Recipe`. It is computed in the worker from immutable samples. A version 2 suggestion identifies an eligible source for initial Bitewing processing in the adjusted pane; a neutral version 1 suggestion leaves initial processing neutral. Reference loading always uses `neutral`, regardless of suggestion. The left original pane always uses the pinned neutral render. Automatic Bitewing has neutral in its undo history.

Processing order for version 2 is modality, optional denoise, window/polarity/gamma, optional CLAHE, broad local contrast, selected fine detail, final inversion/display. Fine and broad stages use source coordinates. The cached prepared stage includes broad local contrast, with every upstream control in its key. Exports use the identical uncached pipeline. The older contract below remains applicable except for these extensions.

Patient samples, decoded dumps, screenshots and references stay local and out of Git.
Phase B/C are gated on user acceptance of the Carestream comparison.

## Rust core (`crates/rad-core`)

Decoder owns lib.rs, decode.rs, Cargo.toml and decoder tests. Processing owns processing.rs and its tests. Shell integrator owns root Cargo.toml and src-tauri.

Public structs use serde camelCase. `SourceImage { width: u32, height: u32, samples: Vec<f32>, color: Option<Vec<[f32;3]>>, metadata: ImageMetadata }`. samples are original decoded scalar values (or RGB luminance) before modality mapping, never modified. RGB values use native 0..255 or 0..65535. `ImageMetadata { name: String, format: String, bits_stored: u16, signed: bool, photometric: String, slope: f32, intercept: f32, window_center: Option<f32>, window_width: Option<f32>, min: f32, max: f32 }`. No patient identifying DICOM tags are exposed. `decode(path: &Path) -> Result<SourceImage, String>`.

`Recipe { version: u32, window_center: f32, window_width: f32, gamma: f32, denoise: f32, clahe: f32, sharpen: f32, radius: f32, threshold: f32, halo: f32, detail_mode: String, invert: bool }`. Default spatial filters off, gamma 1, halo .7, radius 2, threshold .01, detail_mode `unsharp`. `Recipe::neutral(&SourceImage) -> Recipe`; `process(&SourceImage, &Recipe) -> Result<RenderedImage, String>` returns `RenderedImage { width:u32,height:u32,rgba:Vec<u8>,histogram:Vec<u32>,clipped_low:u32,clipped_high:u32 }`. Working pipeline applies modality once, then denoise, window/gamma, CLAHE, detail, polarity/display. Report histogram and clipping for final output. Preserve color by luminance adjustment. Processing writes tests within processing.rs. Decoder exports processing module.

## Tauri IPC / TypeScript

Root frontend src/ owned by UI agent, package.json, tsconfig*, index.html, vite.config.ts also UI. UI installs npm dependencies. src-tauri owned by root.

`import_image { path:string } -> ImageInfo { id:string, width:number,height:number,metadata:ImageMetadata,neutral:Recipe,decodeMs:number }`. Import sequentially/progressively in UI, first selected immediately. `render_image { id:string, recipe:Recipe, requestId:number } -> RenderInfo { id:string,requestId:number,url:string,histogram:number[],clippedLow:number,clippedHigh:number,renderMs:number }`. `url` is a custom protocol URL usable directly in img, generated via backend and returned ready for Windows. No base64/image arrays through JSON. Binary PNG served from Rust in-memory cache. `release_image {id}`. Use monotonically increasing request IDs per image and UI discard obsolete completions; debounce slider renders. Backend uses bounded workers and discards superseded queued work.

`choose_images {}` -> string[] opens native multi-select dialog (cancel = []). `choose_reference {}` -> string|null; imports via same import_image and neutral rendering. `save_presets {presets: CustomPreset[]}` / `load_presets {}` where CustomPreset { name:string, recipe:Recipe }. `export_image {id,recipe}` -> string|null saves full resolution processed PNG with native dialog. `save_review {review:object}` -> string|null saves comparison settings/metadata to user selected JSON. No print/workspace features in Phase A.

UI comparison: neutral + adjusted + optional independently imported Carestream reference. Shared source-coordinate zoom/pan with fit and 100%, bypass, histogram/clipping, presets labeled experimental, expandable advanced, reset and undo/redo, per-image recipes, reference capture notes (preset, Sharpness, orientation, zoom, appearance confirmed). Dark restrained clinical tool, no remote resources, no fabricated reference images. Browser mode clearly states desktop required; can use a synthetic ramp only for browser testing, never pretend samples opened. Desktop drag/drop through Tauri event API.
