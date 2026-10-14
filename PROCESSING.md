# Processing version 1

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

`cargo test -p rad-core --release benchmark_supplied_samples -- --ignored --nocapture` runs locally against all four private supplied samples. It reports first decode timing and five full-resolution renders per neutral/experimental UI preset after one warm-up. It also measures all optional stages on R1. Preset parameters in this test mirror `src/model.ts`. These are CPU pipeline timings and exclude PNG encoding, IPC, WebView rendering, and interaction latency; they are not end-to-end promises.

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

The numerical processing suite passed **11 tests**, with the two manual benchmark tests excluded from routine runs. No source images or rendered sample pixels are included in this document or version control.
