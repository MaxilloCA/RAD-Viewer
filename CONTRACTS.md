# Phase A integration contract

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
