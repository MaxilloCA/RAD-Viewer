# RAD Viewer — Implementation Handoff

Prepared: 2026-10-13 (America/Toronto).

## 1. Objective and agreed requirements

Build an offline Windows desktop application for viewing, enhancing, arranging, annotating, and printing dental radiographs.

**Primary workflow:** Quickly open and review existing radiographs before starting treatment on a patient. The user's reason for choosing Rust is responsiveness. Fast opening and interaction are core requirements, not optional polish. Carestream remains the acquisition application because the sensors are proprietary; this viewer consumes existing files and must coexist with that workflow.

**The first milestone is image quality.** The user previously built a similar application, but images remained too flat or soft for satisfactory interpretation. Build and evaluate a focused comparison prototype before expanding into the complete workflow.

Decisions confirmed with the user:

- **Architecture:** Rust processing engine with a Tauri desktop interface.
- **Use:** The user's clinical practice.
- **Import:** Open existing files rather than maintain a patient database.
- **Formats:** Carestream RVG, JPG, PNG, and the supplied Carestream panoramic `.pano` format. Recognize supported DICOM content independently of filename extension.
- **Quality benchmark:** Carestream Imaging v7, using **Dentin-to-enamel junction**, **Endo**, and the **Sharpness** filter.
- **Initial clinical priority:** Bitewings and caries assessment.
- **Controls:** Presets plus expandable advanced adjustments and saved custom presets.
- **Workspace:** Dental mounting templates plus free placement and resizing.
- **Tools:** Zoom, pan, rotate, flip, invert, comparison, arrows, circles, and text annotations. Measurements are deferred.
- **Persistence:** Session files reference original images and save adjustments, annotations, and arrangements. Provide relinking when originals move.
- **Printing:** A Windows-driver-supported dye-sublimation printer attached to an office PC, producing **4 × 6 inch prints**. The exact printer model has not been specified; use its installed Windows driver.
- **Development:** Use multiple agents. The next orchestrator determines their number, assignments, and scheduling.

Defaults: Windows x64, local processing and storage, no cloud services. Sensor acquisition, practice-management integration, PACS, CBCT, automated diagnosis, and patient-library management are outside this version.

## 2. Model guidance and mandatory quality gate

**Recommended default: Astra with High reasoning for the orchestrator.** High is also appropriate for routine interface, session, printing, and integration work. The orchestrator may choose agent settings suited to their assignments.

Use **Extra High selectively** for difficult DICOM decoding or numerical-correctness problems, unresolved image-quality differences, or a deeper independent review of the processing pipeline. Evaluate whether the extra reasoning produces a useful improvement rather than assuming it always improves results. This is project guidance, not a claimed benchmark result.

Official reasoning guidance: https://developers.openai.com/api/docs/guides/reasoning

**Mandatory instruction to the implementing orchestrator:**

> Verify pixel fidelity and get the user's approval of the Carestream comparison before expanding the application.

The user explicitly chose this milestone order. Do not treat passing compilation, automated tests, or the agents' own visual assessment as satisfying the user's image-quality acceptance gate. Deliver the comparison prototype, report the evidence and remaining limitations, and obtain the user's review before proceeding with the full workspace and printing phases.

## 3. Existing evidence and development setup

Workspace: `C:\CODEX\RAD-Viewer`.

At initial inspection, the workspace contained sample images and no application scaffold or repository-specific instructions. No application implementation has been commissioned in this preparation chat; the next orchestrator will build it.

Samples: `C:\CODEX\RAD-Viewer\Sample RAD Files`.

| File | Device identified in header | Width × height |
|---|---|---:|
| `R1.rvg` | RVG 6200 | 1562 × 1168 |
| `R2.rvg` | Kodak RVG 6100 | 1200 × 900 |
| `R4.rvg` | Kodak RVG 6100 | 1200 × 900 |
| `P2.pano` | CS 8100 | 2861 × 1316 |

All four headers identify:

- DICOM files with a `DICM` marker.
- Transfer syntax `1.2.840.10008.1.2.4.70`: JPEG Lossless Process 14, first-order prediction.
- Unsigned, single-channel `MONOCHROME2` pixels.
- **12 stored bits in 16-bit containers.**

Only headers have been inspected. **Successful pixel decoding and appearance have not been verified.** Do not assume that the embedded pixels are unprocessed sensor measurements or already match Carestream's displayed result.

See `DEV_ENVIRONMENT.md` for installed tool versions and setup verification. Required foundations are Microsoft C++ Build Tools, the Windows SDK, stable Rust for `x86_64-pc-windows-msvc`, Node.js/npm, and WebView2. Pin project dependencies and commit lockfiles during implementation.

The development environment exposes a **Red Hat QXL virtual graphics adapter** and approximately 24 GB RAM. Make processing CPU-capable and verify operation without a dedicated GPU.

Tauri prerequisites: https://v2.tauri.app/start/prerequisites/

## 4. Architecture and implementation phases

### Phase A — Processing engine and comparison prototype

Use Tauri 2, React, TypeScript, and Vite for the interface. Keep decoding, enhancement, session persistence, export composition, and printer integration in Rust.

Separate the Rust image-processing library from the desktop shell so it can be tested without launching the UI.

#### Import and precision

- Use `dicom-object` and `dicom-pixeldata` for DICOM parsing and decoding. Their registry documents support for the samples' lossless JPEG transfer syntax: https://docs.rs/dicom-transfer-syntax-registry/latest/dicom_transfer_syntax_registry/
- Use the Rust `image` ecosystem for ordinary JPEG and PNG.
- Preserve immutable decoded source samples at their original precision; use floating-point working buffers.
- Configure conversions explicitly. Avoid implicit 8-bit conversion, normalization, or applying a DICOM transform twice.
- Handle bit depth, signedness, modality transforms, grayscale polarity, and available VOI information.
- Support single-frame 2D images initially; report unsupported encodings and image types clearly.
- Preserve colour when opening colour JPG/PNG images; apply enhancement to luminance.
- Never overwrite source files.

#### Initial processing pipeline

Implement a fixed, inspectable sequence:

1. Decode and interpret source metadata.
2. Apply modality mapping where applicable.
3. Optional edge-preserving noise reduction.
4. Window/level and tonal mapping, including gamma.
5. Optional contrast-limited adaptive histogram equalization.
6. Selectable thresholded unsharp masking or multiscale detail enhancement.
7. Final display mapping and output conversion.

Expose strength, radius/detail scale, noise threshold, and halo suppression where relevant. Noise reduction and advanced spatial processing start disabled in the neutral preset.

Use full-resolution processing coordinates so sharpening strength does not change with zoom. Cache intermediate results, process on worker threads, and discard stale results when sliders move again. Preserve meaningful precision until the final display/output conversion.

Prioritize the selected image during multi-file import; load other images and thumbnails progressively. Keep decoding and expensive processing out of the UI thread, use a bounded worker pool, and cancel or coalesce superseded work. Reuse rendered images for zoom/pan rather than rerunning filters. Avoid JSON/base64 copies of full-resolution pixel arrays across IPC. Do not index patient directories or scan libraries during startup.

During slider dragging, allow a clearly identified preview when necessary, then replace it with the full-resolution result when adjustment settles. Any reduced-resolution processing preview must account for filter scale and must never be used for export or printing. If faithful preview processing is not ready, retain the last completed image with a processing indicator rather than displaying stale work as final.

#### Comparison interface and reference collection

- Synchronized original/processed/reference views.
- Fit-to-window and 100% source-pixel inspection.
- Linked zoom and pan; instant enhancement bypass.
- Histogram and clipping feedback.
- Preset selection, advanced controls, reset, and undo/redo.

The neutral baseline must be a properly mapped grayscale image with spatial enhancement disabled.

Obtain rendered reference images or screenshots from **Carestream Imaging v7**, recording preset, Sharpness setting, orientation, and zoom. Confirm that exported reference images retain the appearance being compared. References establish visual targets; they are not raw-pixel decoding ground truth. These references have not yet been provided.

Tune a **Bitewing** preset first. Compare against both DEJ and Endo appearances. Use independently implemented processing; do not promise an exact recreation of Carestream's proprietary filters.

**Required gate:** Present the working prototype for the user's comparative review. Continue tuning until the user accepts image quality before expanding into Phase B.

### Phase B — Complete viewing workspace

Use a restrained dark interface with a central image workspace, thumbnail strip, compact toolbar, and collapsible adjustment panel.

Implement:

- Multi-file opening and drag-and-drop.
- Two-image, four-bitewing, and full-mouth templates.
- Free placement, resizing, and aspect-ratio preservation.
- Up to 20 simultaneously arranged images as the initial performance target.
- Independent image adjustments, with explicit application of a preset to selected images.
- Optional linked comparison views.
- Non-destructive rotation, flips, and inversion, with visible transformation state.
- Arrows, circles, and text anchored to image coordinates.
- Separate annotation visibility controls for viewing and printing.

Include the panoramic sample in import and workspace verification. Keep its initial processing neutral rather than automatically applying bitewing presets.

#### Application interfaces and saved data

- Use typed Tauri commands for import, processing, session operations, composition, and printing.
- Keep source pixel buffers in Rust; exchange image handles, parameters, and binary rendered buffers with the interface.
- Define versioned processing recipes, image-view state, annotations, and session documents.
- Save sessions as versioned JSON containing source references, fingerprints, processing settings, transformations, annotations, and layout.
- Save atomically. Detect changed or missing originals and offer explicit relinking.
- Save reusable presets separately and record their processing-version identity.

### Phase C — Printing and export

Build a shared page-composition model for preview, export, and printing.

- Default to **4 × 6 inch landscape**, with portrait available.
- Re-render from source images using current settings at the required output resolution.
- Preserve the arranged view and aspect ratios; default to fitting the complete composition.
- Show printer margins in preview. Do not assume borderless capability.
- Include annotation and caption visibility options.
- Export the composed page as PNG.
- Support Microsoft Print to PDF through the Windows print dialog.

Implement Windows printing in Rust using the Windows API bindings and the selected printer's device context. Read paper, resolution, and printable-area capabilities from the driver. Keep print submission off the UI thread.

Use the existing dye-sublimation driver. The app can run on its attached PC or use a printer queue exposed through Windows sharing.

Report spooler submission accurately; it does not establish that a physical print succeeded. Handle cancellation and printer errors without losing the session.

## 5. Multi-agent execution

The next orchestrator must use multiple agents and owns the final division of work. The following are suggested work boundaries, not a fixed agent count:

- DICOM decoding, metadata interpretation, and independent pixel verification.
- Enhancement algorithms, numerical tests, and performance.
- Tauri interface, comparison controls, and workspace interactions.
- Page composition, Windows printing, and session persistence.

The orchestrator should:

- Establish shared image, recipe, session, and IPC contracts before parallel implementation.
- Assign clear ownership boundaries and coordinate changes to shared dependencies and interfaces.
- Integrate the smallest working import → process → display path early.
- Keep the image-quality gate central to scheduling.
- Arrange an independent review of precision handling, transformations, source preservation, and rendering consistency.
- Keep patient samples and generated clinical references out of version control and external services.
- Consolidate tests and produce one integrated application; agent completion alone does not establish milestone completion.

## 6. Acceptance criteria and deliverables

### Decoding and precision

- Decode all four supplied samples.
- Compare decoded sample values against an independent decoder, such as DCMTK, before display transformations.
- Verify dimensions, polarity, bit depth, and preservation of the original files.
- Test 8/16-bit PNG, ordinary JPEG, malformed files, and unsupported DICOM encodings.

### Image quality

- Compare matched crops and scales against Carestream v7.
- Have the user assess proximal detail, enamel–dentin boundaries, restorations, and visibility of subtle findings.
- Check for noise amplification, halos, clipping, and lost detail.
- Evaluate additional representative bitewings beyond the images used for tuning.
- Use synthetic ramps, flat fields, edges, and noisy patterns to verify numerical behaviour.
- Record accepted settings and known limitations. Visual preference alone must not be reported as proven diagnostic superiority.

### Workflow and reliability

- Verify undo/reset, independent adjustments, annotations after transformations, save/reopen, and missing-file relinking.
- Rapid adjustment changes must never display an obsolete result.
- Benchmark the 20-image workspace on the available hardware.
- Target responsive controls and approximately one second or less for a settled full-resolution intraoral enhancement; measure and report actual performance.
- Record cold and warm startup, file-open-to-first-image, slider-to-preview, settled full-resolution processing time, and zoom/pan frame times on the development PC. Initial engineering targets on local files are a usable shell within 2 seconds of a warm launch, a selected supplied RVG visible within 1 second after opening, slider feedback within 150 milliseconds, and smooth zoom/pan targeting 60 frames per second where the display environment supports it. These are measured acceptance targets, not guarantees inferred from choosing Rust; report any misses explicitly.
- Verify opening existing radiographs while Carestream remains running. Do not require importing a patient database, connecting a sensor, or altering Carestream configuration.

### Printing

- Verify that preview, exported composition, and print rendering agree.
- Test cancellation, printable margins, portrait/landscape, and Microsoft Print to PDF.
- Complete a physical 4 × 6 dye-sublimation test with radiographs and a grayscale ramp.
- Keep physical-printer acceptance explicitly pending until that printer has been tested.

### Deliverables

- Source code, pinned dependencies, and reproducible Windows build instructions.
- A comparison prototype and documented user review before Phase B.
- The completed viewer and Windows installer after subsequent phases.
- Saved preset examples, session-format documentation, and verification results.
- A final report distinguishing implemented features, verified behaviour, outstanding user validation, and limitations.
