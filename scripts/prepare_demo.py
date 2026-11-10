"""Create local, metadata-minimized demo DICOMs; never rewrite the input files.

Usage: python scripts/prepare_demo.py SOURCE_FOLDER
Patient-derived output is excluded from Git. Requires pydicom, numpy and a decoder
for the source transfer syntax. Pixel data and acquisition dates are retained.
"""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import sys
import re
import xml.etree.ElementTree as ET
import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import generate_uid, PYDICOM_IMPLEMENTATION_UID

source = Path(sys.argv[1]).resolve(strict=True)
root = Path(__file__).resolve().parents[1]
destination = root / "demo" / "John Smith"
destination.mkdir(parents=True, exist_ok=True)
report = []
original_identities = [source.name]
metadata = source / "PatientInfo.xml"
if metadata.exists():
    for parameter in ET.parse(metadata).iter("parameter"):
        if parameter.get("key") in ("first_name", "last_name", "internal_id"):
            original_identities.extend(re.split(r"[\s,^]+", parameter.get("value", "")))
# Construct new datasets instead of trying to enumerate every identifying tag.
allowed = [
    "SamplesPerPixel", "PhotometricInterpretation", "PlanarConfiguration",
    "NumberOfFrames", "Rows", "Columns", "BitsAllocated", "BitsStored",
    "HighBit", "PixelRepresentation", "RescaleIntercept", "RescaleSlope",
    "WindowCenter", "WindowWidth", "VOILUTFunction", "PixelPaddingValue",
    "PixelPaddingRangeLimit", "PixelSpacing", "ImagerPixelSpacing",
    "PresentationLUTShape", "LossyImageCompression", "LossyImageCompressionRatio",
    "AcquisitionDate", "ContentDate", "StudyDate", "SeriesDate",
]
for path in sorted(source.iterdir()):
    if path.suffix.lower() not in (".rvg", ".sc", ".pano", ".dcm", ".dicom"):
        continue
    original_bytes = path.read_bytes()
    original_hash = sha256(original_bytes).hexdigest()
    original = pydicom.dcmread(path)
    pixels = original.pixel_array
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = original.SOPClassUID
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = original.file_meta.TransferSyntaxUID
    meta.ImplementationClassUID = PYDICOM_IMPLEMENTATION_UID
    target = destination / f"Radiograph-{len(report)+1:02}.dcm"
    ds = FileDataset(str(target), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.PatientName = "Smith^John"
    ds.PatientID = "DEMO"
    ds.PatientIdentityRemoved = "YES"
    ds.DeidentificationMethod = "Demo copy; direct identifiers removed; image dates retained"
    ds.Modality = "DX"
    for keyword in allowed:
        if keyword in original:
            ds.add(deepcopy(original.data_element(keyword)))
    # Normalize AcquisitionDateTime to just its calendar date; never keep times.
    if "AcquisitionDateTime" in original:
        ds.AcquisitionDate = str(original.AcquisitionDateTime)[:8]
    ds.add(deepcopy(original.data_element("PixelData")))
    # The source pixels were visually reviewed separately for identifying text.
    ds.save_as(target, enforce_file_format=True)
    restored = pydicom.dcmread(target)
    assert restored.PixelData == original.PixelData
    assert np.array_equal(restored.pixel_array, pixels)
    assert not any(element.tag.is_private for element in restored.iterall())
    assert str(restored.PatientName) == "Smith^John" and restored.PatientID == "DEMO"
    assert sha256(path.read_bytes()).hexdigest() == original_hash
    identities = [str(original.get("PatientName", "")), str(original.get("PatientID", "")), *original_identities]
    identities += str(original.get("PatientName", "")).replace("^", " ").split()
    packaged_bytes = target.read_bytes().lower()
    for identity in identities:
        if len(identity) >= 4:
            assert identity.lower().encode("utf8") not in packaged_bytes, "Original identity present in demo file"
    report.append({"demoFile": target.name, "sha256": sha256(target.read_bytes()).hexdigest(),
                   "pixelDataSha256": sha256(restored.PixelData).hexdigest(),
                   "shape": list(pixels.shape), "pixelArraysEqual": True, "sourceUnchanged": True})
if not report:
    raise SystemExit("No radiographs were found")
(destination / "PatientInfo.xml").write_text('''<?xml version="1.0" encoding="UTF-8"?>
<trophy><patient>
  <parameter key="first_name" value="John"/>
  <parameter key="last_name" value="Smith"/>
  <parameter key="directory" value="."/>
</patient></trophy>
''', encoding="utf8")
verification = root / "local-verification" / "v085"
verification.mkdir(parents=True, exist_ok=True)
(verification / "demo-verification.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print(json.dumps({"demoFolder": str(destination), "images": len(report), "allPixelArraysEqual": True,
                  "allSourcesUnchanged": True}, indent=2))
