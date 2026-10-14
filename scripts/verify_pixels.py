"""Compare every stored sample with independent pydicom + libjpeg decoding.

All inputs and temporary pixel buffers stay local. No patient DICOM attributes
are printed or copied to the report. Uses exact equality before any transforms.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import tempfile
import time

import numpy as np
from pydicom.pixels import pixel_array
import pydicom


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=Path, default=Path("Sample RAD Files"))
    parser.add_argument("--binary", type=Path, default=Path("target/release/examples/dump_pixels.exe"))
    parser.add_argument("--report", type=Path, default=Path("verification/pixel-fidelity.json"))
    args = parser.parse_args()
    results = []
    with tempfile.TemporaryDirectory(prefix="rad-pixel-verify-") as temporary:
        for filename in ["R1.rvg", "R2.rvg", "R4.rvg", "P2.pano"]:
            source = args.samples / filename
            before = sha256(source)
            # raw=True prevents color conversion and does not apply modality/VOI.
            started = time.perf_counter()
            expected = pixel_array(source, raw=True, decoding_plugin="pylibjpeg")
            independent_ms = (time.perf_counter() - started) * 1000
            metadata = pydicom.dcmread(source, stop_before_pixels=True, specific_tags=[
                "Rows", "Columns", "BitsStored", "PixelRepresentation", "PhotometricInterpretation",
            ])
            output = Path(temporary) / "pixels.f32le"
            invocation = subprocess.run([str(args.binary.resolve()), str(source.resolve()), str(output)],
                                        capture_output=True, text=True, check=True)
            decoded = json.loads(invocation.stdout)
            actual = np.fromfile(output, dtype="<f4").reshape(expected.shape)
            difference = actual.astype(np.float64) - expected.astype(np.float64)
            mismatch = int(np.count_nonzero(difference))
            unchanged = before == sha256(source)
            checks = {
                "dimensionsMatch": [decoded["height"], decoded["width"]] == list(expected.shape),
                "bitsStoredMatch": decoded["bitsStored"] == int(metadata.BitsStored),
                "signednessMatch": decoded["signed"] == bool(metadata.PixelRepresentation),
                "polarityMatch": decoded["photometric"] == metadata.PhotometricInterpretation,
                "sourceUnchanged": unchanged,
                "pixelsExactlyEqual": mismatch == 0,
            }
            item = {"file": filename, "width": decoded["width"], "height": decoded["height"],
                    "bitsStored": decoded["bitsStored"], "signed": decoded["signed"],
                    "photometric": decoded["photometric"], "pixelCount": int(expected.size),
                    "differentPixels": mismatch, "maxAbsoluteDifference": float(np.max(np.abs(difference))),
                    "sourceSha256Before": before, "sourceSha256After": sha256(source),
                    "rustDecodeMs": round(decoded["decodeMs"], 3),
                    "independentDecodeMs": round(independent_ms, 3), "checks": checks}
            results.append(item)
            print(f"{filename}: {expected.size:,} pixels, {mismatch} mismatches; source unchanged={unchanged}")
    report = {
        "method": "Every native sample, before modality, VOI, polarity or enhancement; exact float32 vs independent integer equality",
        "independentDecoder": "pydicom pixel_array(raw=True, decoding_plugin='pylibjpeg') with pylibjpeg-libjpeg",
        "versions": {name: importlib.metadata.version(name) for name in ["pydicom", "pylibjpeg", "pylibjpeg-libjpeg", "numpy"]},
        "allPassed": all(all(item["checks"].values()) for item in results), "images": results,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not report["allPassed"]:
        raise SystemExit("Pixel fidelity verification failed")


if __name__ == "__main__":
    main()
