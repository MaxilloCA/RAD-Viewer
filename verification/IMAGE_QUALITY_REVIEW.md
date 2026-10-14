# Image-quality revision: Carestream comparison

Review date: 2026-10-13 (America/Toronto). The user accepted the layout and functionality but rejected the first prototype's image detail. This revision remains Phase A; image-quality acceptance is pending.

## Finding from the supplied comparison

The two screenshots match the supplied R4 source. Approximate same-size comparison of the old app capture with the decoded source gave correlation 0.9978 and a slope near 255/4095. The app capture was essentially the neutral linear mapping of the 12-bit samples, not the Carestream presentation. There is no frontend CSS blur, opacity reduction or intermediate 8-bit decoding.

R4 is marked `FOR PROCESSING`, with `MONOCHROME2`, identity rescale and no supplied window. Its stored range is 0–4095, including black padding and a white device label; most anatomy occupies the upper part of this range. Mapping all 4096 levels linearly compresses the useful contrast. A 2% inset, excluding exact endpoint samples, gives approximately q1=1619 and q99=3594. These are image statistics, not a tissue segmentation.

The old Bitewing preset kept that same window and used gamma 0.94. Its detail threshold 0.016 corresponds to about four output gray levels; the former 3×3 halo clamp also suppressed much of the added contrast. Pixel-exact decoding was necessary but did not produce a suitable presentation by itself.

## Research and implementation decisions

| Evidence | Consequence for this implementation |
| --- | --- |
| Carestream distinguishes DEJ emphasis in radio-opaque tissues, Endo grayscale optimization, and separate sensor-specific sharpness controls. [Official RVG preferences](https://help.carestreamdental.com/rh/web/server/CS_Imaging/projects_responsive/CS3155_CSIWorkbook/Setting_RVG_Preferences.htm) | Tone and detail need separate changes. Carestream's documentation does not publish its processing coefficients; we implement independent adjustable presets. |
| DICOM's Pixel Intensity Relationship describes acquisition response, not a prescribed display transform. Presentation follows modality, VOI and presentation mapping. [DICOM PS3.3 C.8.11.3.1.2](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.8.11.3.html) | Do not infer an undocumented logarithmic attenuation transform from `LIN`, bit depth or private tags. Use explicit reversible display window/gamma settings. |
| DICOM GSDF standardizes a grayscale display relationship; it does not prescribe modality presentation or a sharpening filter. [DICOM PS3.14 scope](https://dicom.nema.org/medical/dicom/current/output/chtml/part14/chapter_1.html) | There is no universal “DICOM-standard sharpening” setting. This update is not a display-calibration or GSDF-conformance claim. |
| Stahl, Aach and Dippel describe nonlinear multiscale radiographic enhancement, treating noise amplification separately and retaining original weak detail. [Medical Physics, 2000](https://www.lfb.rwth-aachen.de/files/publications/old/STA00a.pdf) | Independently implemented scale bands add bounded, noise-gated gain. They do not discard the original coefficients or synthesize anatomy. |
| Dippel et al. compare radiographic multiscale decompositions and discuss broad-structure artifacts and nonlinear coefficient enhancement. [IEEE TMI, 2002](https://www.andrew.cmu.edu/course/15-440-s13/applications/labs/lab4/old/paper2.pdf) | Use separate fine and broad scales, constrain strong-edge gain, and test moderate as well as high-contrast steps. Simply multiplying unsharp strength is insufficient. |
| A later experimental study compares generations of vendor multiscale processing in skeletal radiography. [Scientific Reports, 2022](https://www.nature.com/articles/s41598-022-08699-8) | Supports investigating the method family, but does not validate our dental implementation, settings, or diagnostic performance. |

## Implemented scope

- Version 2 recipes with separate local contrast and radiograph multiscale detail. Version 1 recipes keep their existing rendering behavior.
- For eligible high-depth grayscale DICOM without supplied VOI, a suggested window uses q1 to q99 plus 7.5% headroom toward display-white and gamma 0.38. Statistics use a 2% inset and omit exact source extrema; all source pixels still render. Negative rescale and MONOCHROME1 are handled in modality/display-positive coordinates.
- This is a reversible heuristic. It does not identify teeth or lesions. PNG/JPEG, supplied windows, flat/tiny images and recognized panoramic images keep their neutral suggestion. Panoramic exclusion currently uses `.pano` or width/height greater than two, not anatomical classification.
- New presets expose the tone curve, fine gain, noise threshold, halo suppression and local contrast. CLAHE and denoising remain available but are disabled in the new built-ins.
- Original buffers remain immutable, enhancement runs at source resolution, and exported images use the same processing pipeline as previews. All clinical files, screenshots and comparison output remain local and excluded from Git.

## Interpretation of comparisons

The reference is a screenshot with different dimensions, capture borders and unknown preset/sharpness settings. For local review, the border crop `(2,3,866,651)` is compared with renders resampled to the same size. No histogram matching, learned reconstruction or anatomical warping is used. Matching screenshot appearance is not raw-pixel ground truth or clinical validation.

Use `compare_presets` and `scripts/compare_rendered_reference.py` to reproduce local comparisons. Numerical screenshot error is useful for detecting the gross tone mismatch; it cannot score diagnostic usefulness, distinguish signal from amplified noise, or establish equivalence to Carestream. Exact 100% source-pixel comparison still requires a corresponding full-resolution Carestream export.

Additional representative bitewings, known Carestream DEJ/Endo/Sharpness settings and the user's comparative acceptance remain required before the full workspace and printing phases.
