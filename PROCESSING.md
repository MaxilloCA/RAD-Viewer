# Versioned radiograph processing

## Version 2 image-quality revision

The 0.2.0 prototype adds source-aware tone suggestions and a `radiograph` detail mode. Version 1 algorithms remain unchanged for saved recipes. `localContrast` defaults to zero when older JSON is read. Neutral remains version 1 with all spatial filters off.

For high-depth grayscale DICOM without supplied windowing, `suggested_recipe` estimates q1/q99 after modality mapping, omitting exact global extrema and a 2% border only while collecting statistics. It adds 7.5% headroom toward display-white and uses gamma 0.38. This addresses the supplied R4's compressed upper-range anatomy without changing decoding. Stored windowing, ordinary images, flat/tiny sources and recognized panoramic images retain neutral suggestions. Panoramic recognition is currently `.pano` or width/height greater than two. Suggestions are experimental display settings, not calibrated attenuation or tissue segmentation.

Eligible intraoral sources open with Bitewing applied only in the adjusted pane. References always use neutral. Reset/undo restore neutral mapping. The current preset and processing version are visible.

Version 2 preserves the input and adds noise-gated, bounded band contrast. Fine detail uses Gaussian scales at radius × 1, 2 and 4; local contrast uses differences between scales 4, 8, 16, 32 and 64 source pixels. Original coefficients remain even when extra gain is suppressed. Threshold is a display-relative activity control, not a calibrated detector noise estimate. Broad bands have a separate sharp-transition guard: a smoothed gradient detects localized edges, and a maximum filter expands protection through each band's support. The fine halo control suppresses gain near strong edges; near-edge sharpening overshoot remains possible. CLAHE and denoising are disabled in new built-ins.

| Preset | Gamma for eligible source | Local contrast | Fine strength | Radius px | Threshold | Halo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bitewing | 0.38 | 0.40 | 5.0 | 2.2 | 0.0015 | 0.35 |
| Endo | 0.646 | 0.30 | 3.5 | 2.0 | 0.0020 | 0.50 |
| Detail | 0.399 | 0.35 | 6.0 | 2.5 | 0.0010 | 0.35 |

For images without a source-aware suggestion, explicitly choosing these presets uses the neutral tone base with gamma multipliers 1, 1.7 and 1.05 respectively. Neutral ordinary/reference imports are unchanged.

Tone statistics and processing run on background workers. The prepared-stage cache keys version and local contrast as well as earlier controls; when broad contrast is active, threshold and halo also participate. Preview and export share deterministic processing.

See [image-quality research and comparison](verification/IMAGE_QUALITY_REVIEW.md) for primary sources, rationale and limits. Reproduce current preset outputs with `cargo run --release --locked -p rad-core --example compare_presets -- INPUT local-verification/OUTPUT`. The optional third argument is a recipe JSON, producing only a candidate render. Outputs are private clinical material and must stay out of Git.

Version 2 R1, 12 sharpness changes after warm-up: **208.59 ms cached median**, **779.66 ms uncached median**, byte-identical outputs. Reproduce with `cargo run --release --locked -p rad-core --example cache_benchmark -- "Sample RAD Files/R1.rvg" --v2`. Without `--v2` it retains the historical v1 workload. These are CPU-only measurements. Native R4 automatic Bitewing reported 603 ms including PNG while other samples imported. Busy concurrent-build runs exceeded one second on intraoral images, so sub-second end-to-end interaction is not guaranteed.

## Version 1 behavior and historical measurements

The Phase A engine is a deterministic CPU implementation in `crates/rad-core/src/processing.rs`. Source samples are immutable. DICOM integer samples through 16 bits remain exactly representable in the stored `f32` buffer. Spatial operations use source-image coordinates and never depend on viewer zoom. Final display and PNG export are 8-bit RGBA; no intermediate stage quantizes to 8 bits.

## Neutral mapping and reference fidelity

DICOM uses the first supported supplied window center/width pair, otherwise the observed modality-transformed minimum/maximum. The engine applies slope and intercept exactly once and implements DICOM LINEAR VOI, including its half-unit offsets and width-one threshold. A flat DICOM without a supplied window maps to middle gray. Unsupported modality/VOI/presentation lookup tables and non-LINEAR VOI functions are rejected by the decoder instead of silently ignored.

Ordinary grayscale and color PNG/JPEG use their full nominal 8-bit or 16-bit range. In particular, neutral opening of a grayscale Carestream export does not stretch its minimum and maximum. An 8-bit reference with gray values 100–150 retains values 100–150. A 16-bit PNG preserves its tones through the final 8-bit display quantization.

MONOCHROME1 polarity is applied after LINEAR windowing and before gamma, so the gamma control consistently affects display-positive brightness. User inversion is applied at the end. Gamma follows `output = input^(1/gamma)`, so a value above one brightens. Neutral has gamma one and all spatial filters disabled.

## Optional stages

1. **Edge-preserving noise reduction:** self-guided local linear filter, two-source-pixel box radius, regularization `(0.005 + 0.045 × strength)^2` in window-relative modality units. Strength also blends with the original. No denoising is enabled by default. Box sums accumulate in `f64`.
2. **Window and gamma:** clipping to the chosen window is explicit. Window width is at least one; gamma is 0.1–5.
3. **CLAHE:** approximately 128-source-pixel tiles, 256 histogram bins, clip multiplier three. Clipped mass is redistributed, neighboring tile maps interpolate bilinearly, and values interpolate between histogram bins. Flat tiles use identity maps. The control blends the result with the input. CLAHE may change broad tonal relationships; it is experimental and off in neutral.
4. **Detail:** thresholded unsharp masking or two-scale detail with the coarser scale at 2.5 times the selected radius and 0.6 weight. The threshold is a soft threshold in normalized display luminance. Gaussian blur uses three separable box passes, with a narrow discrete Gaussian below a 0.8-pixel radius. Strength is 0–3, radius 0.35–12 source pixels, threshold 0–0.25.
5. **Halo suppression:** blend the enhanced value toward the original 3 × 3 neighborhood bounds. At strength one, output cannot exceed those local bounds. This may reduce enhancement near a strong edge; it does not establish that subtler artifacts cannot occur.
6. **Display:** clamp luminance, collect a 256-bin histogram, count exact lower/upper saturation, and round to RGBA8. Saturation counts use floating luminance before rounding, so near-black pixels rounded to zero need not count as clipped. RGB input uses Rec.709 luminance weights on the stored RGB channel values; enhancement retains hue and contracts chroma only as needed to keep the requested luminance inside gamut. It is display-domain processing, not a color-managed linear-light workflow.

Algorithms are independently implemented; preset names do not indicate replicas of proprietary Carestream filters. The included experimental presets require the user's comparison against matched Carestream exports before any image-quality acceptance claim.

## Verification and timing

`cargo test -p rad-core processing` runs synthetic checks for 12-bit neutral ramps, original-buffer immutability, modality-once behavior, signed and negative-slope inputs, polarity, width-one VOI, grayscale and RGB reference fidelity, flat fields, tiny images, boundary filtering, noise/edge behavior, thresholding, halo bounds, CLAHE continuity, and invalid inputs.

`cargo test -p rad-core --release benchmark_supplied_samples -- --ignored --nocapture` runs locally against all four private supplied samples. It reports first decode timing and five full-resolution renders per original version 1 preset after one warm-up. It also measures all optional stages on R1. These legacy parameters no longer represent the current version 2 UI presets. These timings exclude PNG encoding, IPC, WebView rendering, and interaction latency; they are not end-to-end promises.

Independent raw-pixel decoder comparison is reported separately. Synthetic numerical checks and performance measurements do not replace Carestream comparison or user image-quality acceptance.

### Measured on the development PC

Release build, five independent full-resolution renders after one warm-up, measured during development on 2026-10-13 (America/Toronto). Values are median milliseconds; parentheses give minimum–maximum. Other development processes were running. File decoding is one measurement per file with unspecified OS file-cache state, so it is not a cold-disk benchmark.

| Sample | Decode ms | Neutral ms | Bitewing ms | Endo ms | Detail ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| R1, 1562 × 1168 | 67.16 | 24.72 (23.97–33.09) | 179.81 (163.25–211.31) | 196.18 (160.55–230.30) | 169.28 (147.27–181.71) |
| R2, 1200 × 900 | 42.80 | 14.03 (12.07–15.32) | 96.14 (87.61–97.27) | 107.04 (93.61–131.49) | 85.12 (81.18–90.07) |
| R4, 1200 × 900 | 34.99 | 10.72 (10.09–12.45) | 103.34 (98.31–105.52) | 96.32 (83.57–107.08) | 80.87 (73.05–104.90) |
| P2, 2861 × 1316 | 117.74 | 42.41 (38.58–45.40) | 320.44 (310.17–330.85) | 308.32 (306.52–338.95) | 353.84 (301.17–381.04) |

R1 with every optional stage active (denoise 0.35, gamma 0.94, CLAHE 0.3, multiscale detail 0.7, radius 2, threshold 0.01, halo 0.7) measured **248.43 ms**, range **243.52–275.53 ms**. All measured CPU processing runs were below one second. Neutral remains the default for the panoramic image; non-neutral panoramic results above are timing exercises, not endorsed panoramic settings.

The numerical processing suite passed **13 tests**, with the two manual benchmark tests excluded from routine runs. No source images or rendered sample pixels are included in this document or version control.

### Intermediate reuse during adjustments

Each desktop image owns a `ProcessingSession` bound to its immutable source. It retains one floating-point result through modality mapping, denoise, window/gamma and CLAHE, keyed by all five upstream controls. Sharpness strength, radius, threshold, halo, detail method and inversion reuse this result. Tone changes invalidate it. Retained intermediate data is capped at 32 MiB per image; larger images use uncached processing. Closing an image releases its cache after in-flight work finishes.

The per-image cache lock is asynchronous and acquired before the global worker permit. The renderer checks request freshness after both waits, avoiding work superseded while waiting for an earlier render. Regression tests verify this scheduling behavior and byte-identical cached/direct outputs across every control, undo-like reverse sequences, reset and separate sources. Export continues to use the uncached full-resolution pipeline.

`cargo run --release --locked -p rad-core --example cache_benchmark -- "Sample RAD Files/R1.rvg"` exercises 12 distinct sharpness changes after warming both paths. On this PC, cached processing had a **94.62 ms median**, versus **139.13 ms** uncached in the same run; every output byte matched. These timings exclude PNG/IPC/display and do not replace end-to-end latency measurements.
