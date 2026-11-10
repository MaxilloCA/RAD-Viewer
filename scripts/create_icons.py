"""Build the shared vector, PNG and Windows icon assets from Segoe UI Bold."""
import argparse
import json
from pathlib import Path
import struct
import sys
from io import BytesIO

parser = argparse.ArgumentParser()
parser.add_argument('--fonttools-dir', type=Path)
options = parser.parse_args()
if options.fonttools_dir:
    sys.path.insert(0, str(options.fonttools_dir))

from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = Path('C:/Windows/Fonts/segoeuib.ttf')
ICONS = ROOT / 'src-tauri/icons'
PUBLIC = ROOT / 'public'
OUTPUT = ROOT / 'output/icons'
for directory in (ICONS, PUBLIC, OUTPUT):
    directory.mkdir(parents=True, exist_ok=True)

# Use visible outline bounds, not the font's advance or baseline, to center R.
font = TTFont(FONT)
glyphs = font.getGlyphSet()
glyph = glyphs[font.getBestCmap()[ord('R')]]
bounds_pen = BoundsPen(glyphs)
glyph.draw(bounds_pen)
x_min, y_min, x_max, y_max = bounds_pen.bounds
scale = 1024 * .64 / (y_max - y_min)
cx, cy = (x_min + x_max) / 2, (y_min + y_max) / 2
pen = SVGPathPen(glyphs)
glyph.draw(pen)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="184.32" fill="#000"/>
  <path d="{pen.getCommands()}" fill="#c0c0c0" transform="translate(512 512) scale({scale} {-scale}) translate({-cx} {-cy})"/>
</svg>
'''
(PUBLIC / 'rad-viewer-icon.svg').write_text(svg, encoding='utf-8')
(OUTPUT / 'rad-viewer-icon.svg').write_text(svg, encoding='utf-8')

def render(size):
    factor = 8 if size <= 128 else 4
    edge = size * factor
    canvas = Image.new('RGBA', (edge, edge))
    drawing = ImageDraw.Draw(canvas)
    drawing.rounded_rectangle((0, 0, edge - 1, edge - 1), radius=edge * .18, fill=(0, 0, 0, 255))
    base = ImageFont.truetype(str(FONT), 1024)
    box = base.getbbox('R')
    font_size = round(edge * .64 * 1024 / (box[3] - box[1]))
    face = ImageFont.truetype(str(FONT), font_size)
    glyph_mask = face.getmask('R', mode='L')
    glyph_image = Image.frombytes('L', glyph_mask.size, bytes(glyph_mask))
    glyph_image = glyph_image.crop(glyph_image.getbbox())
    origin = ((edge - glyph_image.width) // 2, (edge - glyph_image.height) // 2)
    canvas.paste((192, 192, 192, 255), origin, glyph_image)
    image = canvas.resize((size, size), Image.Resampling.LANCZOS)
    # Keep the four outside vertices fully transparent even in tiny frames.
    for corner in [(0, 0), (0, size - 1), (size - 1, 0), (size - 1, size - 1)]:
        image.putpixel(corner, (0, 0, 0, 0))
    assert image.size == (size, size)
    assert image.getpixel((0, 0))[3] == 0
    background = image.getpixel((size // 2, 0))
    assert max(background[:3]) <= 3 and background[3] == 255, (size, background)
    # The downsampled glyph must have equal opposing margins within one pixel.
    mask = image.convert('RGB').point(lambda value: 255 if value > 32 else 0).convert('L')
    box = mask.getbbox()
    assert abs(box[0] - (size - box[2])) <= 1, (size, box)
    assert abs(box[1] - (size - box[3])) <= 1, (size, box)
    return image

sizes = [16, 20, 22, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]
images = {size: render(size) for size in sizes}
images[1024].save(ICONS / 'icon.png')
images[1024].save(ICONS / 'icon.icns', format='ICNS')
images[32].save(ICONS / '32x32.png')
images[128].save(ICONS / '128x128.png')
images[256].save(ICONS / '128x128@2x.png')
images[32].save(PUBLIC / 'rad-viewer-icon-32.png')
images[1024].save(OUTPUT / 'rad-viewer-icon-1024.png')
images[22].save(OUTPUT / 'rad-viewer-opendental-22.png')

# Store each size rendered directly at its target scale, rather than asking
# Windows to shrink the old single-frame 64px icon.
frames = []
for size in sizes:
    if size > 256:
        continue
    data = BytesIO()
    images[size].save(data, format='PNG')
    frames.append((size, data.getvalue()))
offset = 6 + 16 * len(frames)
header = bytearray(struct.pack('<HHH', 0, 1, len(frames)))
for size, data in frames:
    dimension = 0 if size == 256 else size
    header += struct.pack('<BBBBHHII', dimension, dimension, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
ico = bytes(header) + b''.join(data for _, data in frames)
(ICONS / 'icon.ico').write_bytes(ico)
(OUTPUT / 'rad-viewer.ico').write_bytes(ico)
with Image.open(ICONS / 'icon.ico') as check:
    assert check.ico.sizes() == {(size, size) for size, _ in frames}
print(json.dumps({'font': str(FONT), 'pngSizes': sizes, 'icoSizes': [size for size, _ in frames], 'output': str(OUTPUT)}, indent=2))
