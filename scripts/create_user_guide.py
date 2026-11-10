"""Generate the one-page guide included in the Windows share package."""
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
DESTINATION = ROOT / 'output/pdf/RAD-Viewer-Quick-Guide.pdf'
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
INK = colors.HexColor('#172D37')
MUTED = colors.HexColor('#53636A')
ACCENT = colors.HexColor('#27717D')
STYLES = {
    'title': ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=27, leading=31, textColor=INK),
    'subtitle': ParagraphStyle('Subtitle', fontName='Helvetica', fontSize=10, leading=14, textColor=MUTED),
    'heading': ParagraphStyle('Heading', fontName='Helvetica-Bold', fontSize=12, leading=16, textColor=ACCENT, spaceBefore=16, spaceAfter=5),
    'body': ParagraphStyle('Body', fontName='Helvetica', fontSize=10, leading=14.5, textColor=INK, alignment=TA_LEFT),
    'small': ParagraphStyle('Small', fontName='Helvetica', fontSize=8.5, leading=12, textColor=MUTED),
}

def paragraph(text, style='body'):
    return Paragraph(text, STYLES[style])

story = [paragraph('RAD Viewer', 'title'), paragraph(f'QUICK GUIDE  /  VERSION {VERSION}  /  WINDOWS', 'subtitle')]

story += [paragraph('1  Install and load images', 'heading'), paragraph(
    f'Run <b>RAD-Viewer-{VERSION}-Setup.exe</b>, then launch RAD Viewer. '
    'Choose <b>Open John Smith demo</b> to try five built-in radiographs. '
    'To load your own files, choose <b>+ Open Images</b> or drag files into the window. '
    'RVG, PANO, SC, DICOM, PNG and JPEG are supported. The included <b>John Smith</b> folder also contains the samples. '
    '<b>+ Open Patient</b> uses the office patient-folder setup.')]

story += [paragraph('2  Adjust the images', 'heading'), paragraph(
    'Click an image or thumbnail to select it. Processing starts at <b>level 4 of 7</b>; '
    'higher levels apply stronger enhancement. Level <b>0</b> disables sharpening, denoising, local contrast and CLAHE. Use <b>Detailed adjustments</b> for gamma, contrast and sharpening. '
    '<b>Reset</b> restores defaults; <b>Ctrl+Z</b> undoes an adjustment. '
    '<b>Hide annotations</b> hides viewer marks without changing exports. To remove one mark, '
    'choose <b>Select annotation</b>, click it, then <b>Delete selected annotation</b>.')]

shortcuts = [
    ('Left-drag in Adjust', 'Right/left changes contrast; up/down changes gamma.'),
    ('Ctrl + scroll wheel', 'Increase/decrease the processing level.'),
    ('Scroll wheel', 'Zoom around the pointer.'),
    ('Shift + left-drag / middle-drag', 'Pan the image.'),
    ('Ctrl + left-click', 'Add/remove images from a shared adjustment selection.'),
    ('Right-click / double right-click', 'Rotate / pin an image to keep it visible.'),
    ('Double left-click / Esc', 'View one image fullscreen / return to the layout.'),
]
table = Table([[paragraph(key, 'small'), paragraph(value, 'small')] for key, value in shortcuts], colWidths=[178, 326])
table.setStyle(TableStyle([
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F0F5F5')),
    ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
    ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
]))
story += [Spacer(1, 8), table, Spacer(1, 6), paragraph('<b>Keyboard:</b> Ctrl+A compare; Ctrl+F fullscreen; Ctrl+C colorize; Ctrl+Q rotate; Ctrl+E Export for Letter; Ctrl+P print; Ctrl+O open images; Ctrl+R reload images.', 'small')]

story += [paragraph('3  Print one copy', 'heading'), paragraph(
    'Images open pinned by default. Unpin or close unwanted panes and arrange the rest. '
    'Choose <b>Print Current View</b>, review the 6 x 4 inch landscape preview, select an installed printer, '
    'then choose <b>Print 1 copy</b>. The printer must support the requested paper size.')]

story += [paragraph('4  Export for the referring dentist', 'heading'), paragraph(
    '<b>Export for Letter</b> combines the visible radiographs, dates and office logo into one JPEG. '
    'Enter the patient name if prompted, review the preview, then choose <b>Confirm and save</b>. '
    'Demo exports save under <b>Pictures / RAD Viewer / John Smith</b>; other letter exports require '
    'the office <b>\\\\server\\incoming</b> share.<br/>'
    'On a friend\'s PC, use <b>Export to JPEG</b> to save individual full-resolution JPEGs at 70% quality to a chosen location. '
    'Attach the saved image(s) to the referral using your usual sharing method.')]

story += [Spacer(1, 14), paragraph(
    '<b>Remove an image:</b> select it, choose the red <b>Delete</b> button, review it fullscreen, then confirm '
    '<b>Move to DELETED</b>. Cancel or Esc keeps it. Moved files remain in the patient\'s DELETED folder and are excluded from the viewer.', 'small')]

def footer(canvas, _document):
    canvas.setStrokeColor(colors.HexColor('#CCD8DC'))
    canvas.line(54, 40, 558, 40)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(54, 27, 'RAD Viewer  |  Quick reference')
    canvas.drawRightString(558, 27, '1 / 1')

document = SimpleDocTemplate(str(DESTINATION), pagesize=letter, rightMargin=54, leftMargin=54,
                             topMargin=42, bottomMargin=54, title='RAD Viewer - Quick Guide', author='RAD Viewer')
document.build(story, onFirstPage=footer, onLaterPages=footer)
reader = PdfReader(DESTINATION)
assert len(reader.pages) == 1, 'Quick guide must fit on one page'
text = reader.pages[0].extract_text()
for phrase in ['Ctrl + scroll wheel', 'Print 1 copy', 'Export for Letter', 'Export to JPEG']:
    assert phrase in text, f'Missing guide instruction: {phrase}'
print(DESTINATION)
