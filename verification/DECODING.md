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

The decoder accepts only single-frame 8/16-bit integer MONOCHROME1/2 DICOM with
right-aligned stored bits. It explicitly rejects colour DICOM, LUT sequences,
functional-group transforms, non-LINEAR VOI and inconsistent presentation polarity.
PNG/JPEG transparency must be flattened first. PNG/JPEG colour samples stay native;
processing adjusts luminance. JPEG/PNG ICC colour management is not implemented.
12-bit grayscale samples are exact integers in `f32`, with signed values extended
from BitsStored; high unused container bits are masked. Source buffers are immutable
by application convention. Modality mapping and MONOCHROME1 inversion are deferred
to processing and each applied once. No source file is ever opened for writing.

These tests establish decoded pixel fidelity, not clinical image-quality acceptance.
The Carestream v7 comparison and user quality gate remain separate requirements.
