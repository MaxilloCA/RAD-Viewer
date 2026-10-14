# Verification status

Phase A comparison prototype, 2026-10-13 (America/Toronto).

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

## Required review gate

Carestream v7 DEJ/Endo/Sharpness reference captures have not been supplied or accepted. The available prototype can import them, record capture settings and preserve neutral PNG/JPEG tones. Matched crops, orientation and pixel scale must be checked by the reviewer; automatic image registration is not implemented. Additional bitewings beyond the supplied tuning samples are still required for representative review.

The experimental presets are starting points. Pixel fidelity, automated tests and developer visual inspection do not establish diagnostic superiority or satisfy the user's image-quality acceptance requirement.

## Pending later phases

Per `IMPLEMENTATION.md`, mounting templates/free arrangement, rotation/flips, image-anchored annotations, full session save/reopen/relink, page composition, Windows printing and physical 4 × 6 print tests await the image-quality gate. Review JSON saves recipes/context only; it is not a session file.

20-image mounting performance, cold/warm process-launch timing, measured open-to-visible latency, slider-to-display latency, zoom/pan frame-time instrumentation and printer-driver/PDF/physical acceptance are not yet established. CPU benchmark results must not be substituted for those end-to-end measurements.

## Known implementation limits

- Display and PNG export are RGBA8 after floating-point processing; source precision is retained internally.
- Supported DICOM is single-frame integer MONOCHROME1/2, 8/16-bit containers, standard LINEAR VOI and rescale mapping. Other LUT/presentation/functional-group cases are rejected clearly. See `DECODING.md`.
- PNG/JPEG ICC color management and monitor grayscale calibration are not implemented. A reference must be checked against Carestream on the review display.
- Two bounded background workers, debounced full-resolution rendering, stale-result rejection, pinned neutral and recent rendered-image caches. There is no reduced-resolution preview; the last completed render remains visibly marked while processing.
- Final renders are cached; individual intermediate filter stages are not yet cached. Measured full-resolution pipeline times are below one second on this PC.
- The prototype has a 24-open-image resource limit; this is not verification of the later 20-image mounting workflow.
- The development release is unsigned.
