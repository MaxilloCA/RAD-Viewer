"""Local screenshot-scale appearance comparison, not a diagnostic quality score.

Use a recorded crop to remove capture borders; no nonlinear registration or
histogram matching is performed. All output pixels remain local and private.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('--reference', type=Path, required=True)
parser.add_argument('--renders', type=Path, required=True)
parser.add_argument('--crop', type=int, nargs=4, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
reference = Image.open(args.reference).convert('RGB').crop(tuple(args.crop))
images = [Image.open(args.renders / f'{name}.png').convert('RGB').resize(
    reference.size, Image.Resampling.LANCZOS) for name in ['neutral', 'bitewing']]
images.append(reference)
labels = ['Previous neutral mapping', 'Revised Bitewing', 'Carestream reference']
panel_w = 540
panel_h = round(panel_w * reference.height / reference.width)
sheet = Image.new('RGB', (panel_w * 3, panel_h + 65), '#171b20')
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 19)
    small = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 13)
except OSError:
    font = small = ImageFont.load_default()
for index, (label, image) in enumerate(zip(labels, images)):
    draw.text((index * panel_w + 12, 10), label, fill='white', font=font)
    sheet.paste(image.resize((panel_w, panel_h), Image.Resampling.LANCZOS), (index * panel_w, 42))
draw.text((12, panel_h + 45), 'Same source and approximate capture scale. Screenshot settings unknown; appearance comparison only.', fill='#b0bcc8', font=small)
args.out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(args.out)
# Exclude capture margins/overlays. Rescaling does not establish pixel registration.
margin = round(reference.width * .05)
ref = np.asarray(reference.convert('L'), dtype=float)[margin:-margin, margin:-margin]
metrics = {}
for name, image in zip(['previous-neutral', 'revised-bitewing'], images[:2]):
    pixels = np.asarray(image.convert('L'), dtype=float)[margin:-margin, margin:-margin]
    metrics[name] = {'mean': float(pixels.mean()), 'std': float(pixels.std()),
        'approximateScreenshotRMSE': float(np.sqrt(np.mean((pixels - ref)**2)))}
metrics['reference'] = {'mean': float(ref.mean()), 'std': float(ref.std())}
metrics['method'] = 'Reference border crop; matched size Lanczos; 5% margins excluded. Not clinical validation or exact registration.'
args.out.with_suffix('.json').write_text(json.dumps(metrics, indent=2))
print(json.dumps(metrics, indent=2))
