"""Verify the supplied P2 neutral native-UI export against an independent mapping.

Run after exporting P2 with its neutral recipe (WC 2048, WW 4096, gamma 1).
This checks a generated local artifact without uploading or copying patient tags.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from pydicom.pixels import pixel_array

raw = pixel_array(Path("Sample RAD Files/P2.pano"), raw=True, decoding_plugin="pylibjpeg").astype(np.float32)
expected = np.floor(np.clip(raw / 4095, 0, 1) * 255 + 0.5).astype(np.uint8)
actual = np.asarray(Image.open("local-verification/pano-neutral.png"))
assert actual.shape == (*expected.shape, 4), "Export dimensions differ"
different = int(np.count_nonzero(actual[:, :, :3] != expected[:, :, None]))
assert different == 0, f"{different} RGB samples differ"
assert np.all(actual[:, :, 3] == 255), "Export must be opaque"
print(f"PASS: {expected.shape[1]} x {expected.shape[0]}, zero different RGB samples, opaque alpha")
