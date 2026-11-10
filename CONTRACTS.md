# Windows 0.9.10 selected JPEG export

The former Export Selected action is now Export to JPEG. It prompts once for a
folder for the selection, defaulting on Windows to
`\\server\Incoming\Lastname, Firstname - RAD Export` when patient identity is
available. A local or other folder can be chosen; cancellation writes no image.
A suggested empty folder may be created to initialize the native folder picker.
Selections spanning multiple patients must be separated before exporting.

Each selected image is independently reprocessed at full resolution from its
source with its current recipe (including contrast, sharpening and colorization),
rotation and ellipse annotations, and encoded as JPEG at exactly quality 70.
Filenames use image date plus an atomic sequence number. Existing exports and
source images are never overwritten. Zoom/pan do not crop exported images;
measurement marks remain session only. Frozen macOS source 0.9.3 is unchanged.

# Phase A integration contract

## Version 0.8.0 Midtone Contrast

`Recipe.colorMode` is optional (`local`, `midtone`, `midtoneContrast`); absent/null retains legacy mode selection from `midtoneLevel`. `midtoneWidth` defaults to 0.15 and validates 0.02–0.30; the existing reference level validates 0.05–0.95. New import/reset recipes select Midtone Contrast at center 0.5, width 0.15 and strength 0.4, with Colorize off. Existing saved recipes retain their mode and strength.

Midtone Contrast computes signed evidence from display-positive floating-point values before fine sharpening. For d=(tone−center)/width, evidence=d×exp((1−d²)/2). The existing final-brightness gate, amber/cyan palette and gamut-limited display-brightness blend apply this evidence to the final sharpened image. Exact reference values remain grayscale; large deviations fade smoothly. Histogram/clipping and source pixels are unchanged. New parameters affect final render equality only, not the prepared-stage cache.

`sample_reference { id, recipe, x, y } -> number` averages a clipped 5×5 full-resolution source-coordinate patch in the same pre-sharpen, display-positive domain. Outside-image coordinates fail. The UI clamps the resulting center to 0.05–0.95, ignores stale results, and commits only the clicked image. Temporarily imported sources for evicted panes are released after sampling. Main and A/B viewers share mode/center/sensitivity/amount controls. Sensitivity maps increasing slider values to decreasing width (30–2 percentage points).

Hold for grayscale renders an ephemeral snapshot with Colorize enabled and strength zero, preserving processing even for RGB inputs. It never changes history, saved recipes, pins or exports. Release, cancellation, lost capture/focus, window blur and source changes restore the enhanced frame. Neutral comparison remains separate.

## Version 0.3.10 additions

- Processing levels 1–7 change sharpness, window width (contrast), local contrast and CLAHE, with fixed radiograph detail scale 2.2, threshold 0.0015 and halo suppression 0.35. They preserve window center (tone), gamma, inversion, denoise and Colorize parameters. New imports/Reset use level 4; manual processing changes show Custom with the nearest stop. Adjustment history remains per-image.
- Launch arguments are separate from the executable path: `--patnum 67751` or `--patnum=67751`. IDs remain strings, preserve leading zeros and must contain 2–64 ASCII digits. Duplicate, missing and unrecognized arguments fail visibly. Each process has independent image/recipe state; no singleton forwarding. Launch lookup follows the same XML discovery and latest-pair behavior as manual Open patient. Delayed startup lookup cannot override a manual selection.
- Draft adjustments request explicitly approximate previews bounded to 384 pixels on the longest edge. Samples are averaged in floating point; reduced previews never replace original pixels or full-resolution pin/export renders. Releasing the adjustment requests the exact final recipe at original resolution. A single in-flight frontend render coalesces pending changes; no fixed 100 ms delay. Preview labels identify the temporary image and histogram percentages use its sample count.


## 0.3.9 color DICOM import as grayscale

Supported single-frame unsigned 8-bit color DICOM is decoded to display RGB and converted to Rec.709-weighted floating-point grayscale during import. The resulting SourceImage has color=None, photometric MONOCHROME2, identity modality and explicit full-range neutral VOI center128/width256. File name, image date and DICOM format identity remain available. IPC shapes and processing recipes are unchanged; patient scanning, thumbnails, pins, controls and export use the existing grayscale pipeline. Original files are never rewritten. See verification/DECODING.md for supported transfer syntaxes and restrictions.

Patient discovery sorts paths newest first using a cached early DICOM date-header read (the same validated date priority as displayed labels), with file modification day as fallback and modification time/name for ties. No full pixel decoding is needed to sort. Patient replacement automatically pairs the first two successful imports: first stays selected until its full-resolution pin is ready, then second becomes the working pane. Failed imports are skipped; manual Add is unchanged. Generation checks and user-interaction cancellation prevent later imports/snapshots from overriding another patient or a user's selection/adjustment. The pending second image is protected from decoded-cache eviction.

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

UI gamma bounds are 0.1–0.9, sharpness 0–12. Stored presets outside these ranges retain their exact recipe until edited and are labeled accordingly. Tone/Contrast expose relative -100…100 scales against each image's initial window. Horizontal left-drag changes contrast and vertical left-drag gamma; Shift-left/middle drag pans. Pointer release/cancellation ends one history transaction. During changes, bounded/coalesced full-resolution rendering retains the last completed image with a processing indication. Switching/closing images cannot attach an old response to another source. The histogram uses linear counts and monochrome fill, with a black-to-white intensity strip. Colorize shows an intensity legend.

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


## 0.8.1 combined JPEG export

`export_viewer_jpg` accepts patientName, patientId and the composed PNG. The backend generates a six-digit decimal hash of its timestamp and atomically reserves an unused filename directly in `\\server\incoming`. Collisions advance the suffix; existing files are never overwritten. Patient-name sanitization and image-size limits remain enforced. The canvas composites the supplied transparent office logo over black, with white letterhead text and patient identity. Local color is no longer selectable, but legacy serialized recipes remain compatible.


## 0.8.2 export confirmation

JPEG export preparation and preview perform no destination writes. The JPEG preview and confirmed save share the quality-70 encoder and retained PNG composition. Confirmation is required before invoking export_viewer_jpg. Escape cancels the modal and pending preparation, with stale responses discarded. A confirmed write is allowed to finish and reports its result; repeated confirmation cannot create duplicate writes.


## 0.8.3 shared image grids

Viewer, JPEG composition and Print use 2 rows × 2 columns for 3–4 images, 2 × 3 for 5–6, 3 × 3 for 7–9 and 3 × 4 for 10–12. Images retain row-major viewer order and unused final cells stay empty. Print uses a common fit scale within these cells to preserve relative magnification without cropping.

## 0.8.4 JPEG sidebar

The Main Viewer JPEG canvas has a white practice sidebar occupying 22% of the width, a cyan divider, and a radiograph grid with consistent outer margins and gutters. It composites the existing office-logo.png without replacement or generated imagery. The sidebar contains patient name and office contacts; neither patient ID nor doctors' names are drawn. Names wrap using measured glyph widths and shrink when needed to avoid the contacts. Each original prepared bitmap is drawn at its aspect ratio, with retained pan/zoom and a separate date band. Backend full-resolution processing, source fingerprint validation, preview/save encoder, filename patient ID and atomic destination writes are unchanged.

## 0.8.5 friend demo

The combined export's visible action and dialog title are Export for Letter. `open_demo_patient {}` extracts five embedded metadata-minimized DICOMs and generic PatientInfo.xml into the user's local app data Samples/John Smith directory. It returns PatientStudy with John Smith, firstName John, lastName Smith, patientNumber DEMO and all five paths selected for initial display, and registers these paths for source-protected rendering/export. Reopening preserves sidecars and rejects changed bundled image/XML files instead of overwriting them. Demo refresh invokes this command without patient-number lookup. For patientId DEMO only, confirmed composite export uses Pictures/RAD Viewer/John Smith; ordinary exports remain on the office share. Preview wording reflects the destination. Demo packaging includes only the six explicitly named sample files, the installer, instructions and checksums.

## 0.8.6 fixed viewer detail method

The main viewer and A/B comparison expose Radiograph multiscale as a read-only detail-method label. withRadiographDetail normalizes restored sidecar recipes, committed edits, applied presets and comparison initial/reset recipes to version 2 / detailMode radiograph while preserving all other fields. Already-normalized recipes retain their object identity. The library normalizes incoming commit recipes before equality/undo checks so a legacy method alone cannot create an empty adjustment step or reappear in displayed/persisted history. Full-resolution display, pins, print and exports consume these same viewer recipes. The core retains its existing versioned recipe compatibility and unenhanced neutral-reference pipeline; original source samples are unchanged.
## Version 0.8.8 processing and deletion

The seven processing stops now span former level 2 through one stop above former level 7. New levels 1–6 retain those old recipes; level 7 uses sharpness 11.5, contrast 40, local contrast 0.8 and CLAHE 0.36. New imports/Reset use level 4 (sharpness 7, contrast −30); centered detail controls match these defaults. Version-2 sharpness validation and detail sliders extend to 12; version 1 stays bounded to 3. Existing saved recipe values are preserved.

`delete_images { items: [{ path, directory: string | null, sourceSha256 }] } -> [{ path, destination: string | null, error: string | null, warning: string | null }]` moves confirmed files into each canonical patient directory's DELETED folder, or the source parent for manual files. Fingerprints are checked before creating the folder; moves cannot overwrite existing destinations. A sidecar move failure is reported separately after a successful image move. Only successfully moved paths are removed from the library, including duplicate references, decoded sources and pin jobs. Failures stay in the review and viewer. Flushing adjustments precedes the move. The fullscreen modal traps focus, defaults to Cancel, blocks closing while moving, and never moves files merely by opening the review. Patient scans, manual imports and demo reloads exclude DELETED.
