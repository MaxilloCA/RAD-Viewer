# Selective local Colorize — 0.3.5

## Problem and design

The user found a global yellow-to-purple intensity map unhelpful and asked to emphasize midrange regions only where surrounding image density changes. A one-dimensional lookup cannot distinguish a flat gray patch from a gray patch that differs from its surroundings. The replacement retains grayscale detail and adds amber/cyan chroma according to signed local brightness differences.

The overlay analyzes the prepared image before fine sharpening, compares neighborhoods at two scales, and suppresses small/noisy, inconsistent or very strong transitions. A smooth midtone gate reduces color near black and white. Amber indicates darker than nearby; cyan indicates lighter than nearby. This is relative displayed brightness after window/gamma/local contrast, not calibrated attenuation, a diagnosis, or tissue classification. Strong-edge/noise suppression can hide real features as well as artifacts; absence of color is not evidence that an area is normal.

## Research basis and limits

- Multiscale differences between an image and local low-pass representations are an established way to represent localized image information. The implementation uses deterministic Gaussian neighborhood differences, informed by scale-space methods; it is not a full Laplacian pyramid reconstruction. [Burt and Adelson, 1983, original paper](https://www.rctn.org/bruno/public/papers/Laplacian-pyramid-Burt%2BAdelson1983.pdf).
- A dental observer study found conventional pseudocolor filters did not significantly improve interproximal caries detection. That evidence does not validate this new spatial overlay and is a reason to evaluate visibility without claiming improved diagnostic performance. [Efficacy of application of pseudocolor filters in the detection of interproximal caries](https://pubmed.ncbi.nlm.nih.gov/22991603/).
- DICOM defines pseudocolor presentation through a palette applied to grayscale presentation values. This neighborhood-dependent overlay is a custom display operation, not a standardized DICOM palette or a certified clinical processing algorithm. [DICOM pseudocolor presentation states](https://dicom.nema.org/MEDICAL/Dicom/2015a/output/chtml/part04/chapter_N.html).

## Controls and reproducibility

Color amount defaults to 80%, with 0% producing grayscale. Feature size defaults to 8 source pixels and spans 2–24. It changes the neighborhood scale, not a calibrated feature diameter; image resolution affects its apparent anatomical extent. All processing is local and deterministic. Original samples stay immutable and exports are separate PNGs. The overlay preserves weighted display RGB brightness before quantization, not physical or perceptual luminance.

The `compare_colorize` Rust example renders grayscale, default selective, full-strength and broader-scale variants. It checks identical histogram/clipping, unchanged source samples and weighted display brightness within one 8-bit level. Generated images and reports stay in ignored `local-verification/` folders. Automated and local-render results are recorded in [STATUS.md](STATUS.md); these checks do not constitute user image-quality acceptance or clinical validation.
