# Verification status

Phase A comparison prototype, 2026-10-13 (America/Toronto).

## 0.2.0 image-quality revision

- User supplied a Carestream/app comparison, accepted the interface, and rejected the original image detail. Both captures match R4. Investigation identified neutral linear mapping of a high-depth `FOR PROCESSING` image as the main tone mismatch, compounded by weak detail presets. See `IMAGE_QUALITY_REVIEW.md` for evidence and primary sources.
- Implemented source-aware window/gamma suggestions, version 2 multiscale detail and local contrast, noise-gated added gain and broad-edge protection. Original source values and version 1 preset behavior remain unchanged. Eligible sources open with Bitewing in the adjusted pane; original/reference and panoramic defaults remain neutral.
- **39 Rust tests and 13 frontend tests pass.** Strict Clippy and production frontend build pass. Tests include new source-aware windowing, modality/polarity, old recipe compatibility, cached/export equality, subtle texture enhancement, noise containment and moderate positive/negative horizontal/vertical edges.
- R4 matched-size screenshot comparison reduced approximate grayscale RMSE from 97.15 (neutral) to 12.00 (revised Bitewing), with reference/main-image mean 94.94/98.87 and standard deviation 61.82/61.90. The reference is only approximately aligned after border crop and resampling. These numbers describe appearance, not diagnostic accuracy or Carestream equivalence.
- All four samples were rendered with the new engine; R1/R2/R4 were visually inspected. Neutral P2 remains the default. CPU timings below are historical version 1 results; they must not be used to claim version 2 performance.
- A version 2 R1 workload with 12 distinct sharpness changes measured **208.59 ms median cached** versus **779.66 ms uncached**, with every output byte and histogram equal. These exclude PNG/IPC/display. Earlier concurrent-build timing runs were slower (up to about 1.37 seconds for intraoral and 3.03 seconds for an explicitly enhanced panorama); CPU contention matters, and the UI continues to mark the last completed image while rendering.
- Native 0.2.0 opened all four samples with Carestream still running. R4 automatically displayed Bitewing beside neutral, at fit and 100%; its displayed processing time was 603 ms including PNG. Selecting P2 showed neutral version 1, gamma 1 and sharpness 0, with 98 ms processing. These are functional observations, not controlled end-to-end benchmarks.
- Rebuilt the Windows executable and `RAD Viewer_0.2.0_x64-setup.exe`. All four source hashes still match the original pixel-fidelity report. Installation on a separate PC and the user's image-quality acceptance remain pending.

## Verified

- All four supplied RVG/PANO files decode. Every one of **7,749,492 source samples** matches independent pydicom + pylibjpeg-libjpeg exactly. Maximum difference: zero. Dimensions, 12-bit unsigned storage and MONOCHROME2 agree. Source hashes unchanged. See `pixel-fidelity.json` and `DECODING.md`.
- Rust numerical tests cover modality applied once, LINEAR windowing, polarity, signed data, PNG/JPEG reference fidelity, color preservation, immutable sources, spatial boundaries, noise reduction, halos, thresholding, flat fields and invalid recipes.
- Decoder integration tests include signed 8/12-bit, big endian, PNG8/PNG16/RGB16, JPEG, malformed input, transparent PNG rejection, multiframe rejection, unsupported transfer syntax and invalid bit layout.
- Desktop helper tests verify atomic replacement, source overwrite protection and pixel-exact final PNG encoding.
- Nine frontend tests pass, including progressive import, out-of-order render rejection, independent per-image adjustments with undo/redo/reset, reference metadata/mismatch warnings, physical-pixel 100% zoom at DPR 2, and visible image-load failures.
- Production frontend build and strict Rust Clippy checks pass.
- Release CPU timings meet the sub-second processing target for all supplied images. See `../PROCESSING.md` for the full table, method and bounds. These exclude PNG encoding, IPC and display.
- Native Windows release launched successfully with Carestream v7 running. Opened all four samples through the Windows file dialog, observed progressive thumbnails, binary image delivery and both comparison panes. R1 reported 86 ms decode, 40 ms neutral render and 181 ms Bitewing render; P2 reported 170 ms decode and 88 ms neutral render. Here rendering includes PNG encoding, but not the file dialog, IPC, or WebView presentation latency.
- Native 100% inspection and dragging kept both panes synchronized. Selecting P2 returned to fit with neutral gamma and zero spatial enhancement. This is functional observation, not a frame-rate measurement.
- Native PNG export of neutral P2 produced 2861 × 1316 RGBA pixels. All RGB samples exactly matched an independent NumPy mapping of pydicom's raw pixels (`round(clamp(raw / 4095) × 255)`); all alpha samples were 255. The generated image stays in ignored `local-verification/`.
- Windows NSIS installer built successfully. Installation on a separate clean Windows PC remains untested.
- Intermediate cache follow-up: 25 Rust tests pass (plus the nine unchanged frontend tests), including byte-identical cached/direct rendering across all adjustments and rejecting a request superseded while waiting for its source cache. Strict Clippy passes. A 12-change R1 sharpness workload measured 94.62 ms cached versus 139.13 ms uncached median; output bytes matched exactly. See `PROCESSING.md`.
- The updated native release and installer were rebuilt. Reopened all four samples in the native app; R2 Bitewing rendered in 110 ms, followed by a distinct sharpness change to 0.72 in 74 ms including PNG encoding. No rendering errors occurred. These are single functional-check observations, not a controlled latency benchmark.

## Required review gate

One Carestream/app screenshot pair has been supplied; the user rejected the earlier prototype's quality. Version 0.2.0 is a new comparison candidate, not an accepted result. Exact Carestream preset/Sharpness settings and a full-resolution corresponding export remain unrecorded. Matched crops, orientation and pixel scale must be checked; automatic registration is not implemented. Additional bitewings beyond the supplied tuning samples are still required for representative review.

The experimental presets are starting points. Pixel fidelity, automated tests and developer visual inspection do not establish diagnostic superiority or satisfy the user's image-quality acceptance requirement.

## Pending later phases

Per `IMPLEMENTATION.md`, mounting templates/free arrangement, rotation/flips, image-anchored annotations, full session save/reopen/relink, page composition, Windows printing and physical 4 × 6 print tests await the image-quality gate. Review JSON saves recipes/context only; it is not a session file.

20-image mounting performance, cold/warm process-launch timing, measured open-to-visible latency, slider-to-display latency, zoom/pan frame-time instrumentation and printer-driver/PDF/physical acceptance are not yet established. CPU benchmark results must not be substituted for those end-to-end measurements.

## Known implementation limits

- Display and PNG export are RGBA8 after floating-point processing; source precision is retained internally.
- Supported DICOM is single-frame integer MONOCHROME1/2, 8/16-bit containers, standard LINEAR VOI and rescale mapping. Other LUT/presentation/functional-group cases are rejected clearly. See `DECODING.md`.
- PNG/JPEG ICC color management and monitor grayscale calibration are not implemented. A reference must be checked against Carestream on the review display.
- Two bounded background workers, debounced full-resolution rendering, stale-result rejection, pinned neutral and recent rendered-image caches. There is no reduced-resolution preview; the last completed render remains visibly marked while processing.
- Final renders and the floating-point pre-detail stage are cached. Upstream tone/noise/CLAHE changes invalidate the intermediate cache. Retention is capped at 32 MiB per source; larger sources are processed without that cache.
- The prototype has a 24-open-image resource limit; this is not verification of the later 20-image mounting workflow.
- The development release is unsigned.
