# Decoder verification

Run from the repository root in PowerShell:

```powershell
$env:Path = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:Path
cargo test -p rad-core
cargo build -p rad-core --release --example dump_pixels
python -m pip install -r scripts/verification-requirements.txt
python scripts/verify_pixels.py
```

`verify_pixels.py` decodes all four supplied images independently using pydicom
3.0.1 and pylibjpeg-libjpeg 2.3.0. The Rust decoder uses the dicom-rs native JPEG
decoder. It compares **every sample** before rescale slope/intercept, windowing,
polarity or processing. Original file SHA-256 hashes are checked before and after.
Temporary raw pixel dumps are deleted on exit. The JSON report contains dimensions,
bits, polarity, exact-difference counts, hashes and timings; it contains no patient
DICOM tags and no pixel arrays. Nothing is uploaded.

Synthetic Rust tests cover native 8/16-bit PNG values, 16-bit RGB channels, JPEG
colour, signed 12-bit DICOM, big-endian DICOM, MONOCHROME1 metadata, rescale and VOI
retention, malformed files, multiframe rejection and unsupported transfer syntax.

The decoder accepts single-frame 8/16-bit integer MONOCHROME1/2 DICOM with
right-aligned stored bits. Supported unsigned 8-bit color DICOM is converted to
grayscale on import as described below. It explicitly rejects unsupported color layouts, LUT sequences,
functional-group transforms, non-LINEAR VOI and inconsistent presentation polarity.
PNG/JPEG transparency must be flattened first. PNG/JPEG colour samples stay native;
processing adjusts luminance. JPEG/PNG ICC colour management is not implemented.
12-bit grayscale samples are exact integers in `f32`, with signed values extended
from BitsStored; high unused container bits are masked. Source buffers are immutable
by application convention. Modality mapping and MONOCHROME1 inversion are deferred
to processing and each applied once. No source file is ever opened for writing.

These tests establish decoded pixel fidelity, not clinical image-quality acceptance.
The Carestream v7 comparison and user quality gate remain separate requirements.

## Color Secondary Capture converted to grayscale (0.3.9)

The reported files use Secondary Capture with JPEG Extended compression, three
8-bit channels and an RGB DICOM tag. The JPEG codestream carries a JFIF marker;
decompression must resolve its color space before grayscale conversion. The older
decoder rejected these files at SamplesPerPixel, before reaching the JPEG codec.

Supported color captures now decode to RGB, then to floating-point grayscale
using `0.2126 R + 0.7152 G + 0.0722 B`. This is the same display-luminance convention
used by the existing PNG/JPEG pipeline. The viewer uses MONOCHROME2 samples and a
full-range neutral window (center 128, width 256); it does not stretch each capture
to its observed extrema. Source files are read-only. New PNG exports contain the
processed grayscale image unless the user deliberately enables Colorize.

The supported color scope is single-frame, unsigned 8-bit native RGB/YBR_FULL
(interleaved or planar), or JPEG Baseline/Extended RGB/YBR_FULL/YBR_FULL_422.
Compressed JPEG output is already normalized to interleaved RGB by the bundled
codec and must not receive a second YBR conversion. Other color transfer syntaxes,
native subsampled YBR, palette color, and unsupported modality/VOI transforms are
rejected explicitly. Ordinary color PNG/JPEG import behavior is unchanged.

The interpretation of RGB/YBR channels and planar storage follows the
[DICOM Image Pixel Module](https://dicom.nema.org/medical/DICOM/current/output/chtml/part03/sect_C.7.6.3.html).
Grayscale conversion is an explicit viewer operation requested by the user, not
a claim that the original file was encoded as monochrome DICOM.
