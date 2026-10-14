# Phase A integration contract

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
