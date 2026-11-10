import { useEffect, useRef } from 'react';
import { buildInfo } from './buildInfo';
import Icon from './Icon';
import { isMac, modifierLabel } from './platform';

export default function AboutDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); previousFocus?.focus(); };
  }, []);
  return <dialog ref={dialog} className="about-dialog" aria-labelledby="about-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <header className="about-heading"><div><p className="about-eyebrow">RAD VIEWER</p><h2 id="about-title">About &amp; help</h2></div><button onClick={onClose} aria-label="Close About and help"><Icon name="close" /></button></header>
    <div className="about-content">
      <section aria-labelledby="about-creator"><h3 id="about-creator">Created by</h3><p className="creator-name">Michal Goralski, DDS, MSc FRCD(C)</p><p>Pediatric dentist</p><p className="about-contact">goralsi@kidsdentistry.ca<br />Barrie, ON - Canada</p></section>
      <section aria-labelledby="about-build"><h3 id="about-build">Build information</h3><dl className="about-build"><dt>Version</dt><dd>{buildInfo.version}</dd><dt>Built</dt><dd><time dateTime={buildInfo.builtAt}>{new Date(buildInfo.builtAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time></dd><dt>Platform</dt><dd>{buildInfo.platform}</dd><dt>Runtime</dt><dd>{buildInfo.engine}</dd></dl></section>
      <section className="about-help" aria-labelledby="about-help-title"><h3 id="about-help-title">Quick help</h3><dl>
        <dt>Open radiographs</dt><dd>{isMac ? 'Use Open Images to choose local files, or drop files into the viewer. Open John Smith demo is available on the start screen. Patient-number lookup is unavailable in this Mac version.' : 'Use Open Patient to load a patient number, Open Images to choose files, or drop files into the viewer. The John Smith demo is available in Open Patient.'}</dd>
        <dt>Arrange your workspace</dt><dd>The grid adapts to the number of visible images. Drag image titles to swap positions. Close a pane to hide it; click its preview to reopen it. Collapse Previews or Adjustments for more image space.</dd>
        <dt>Select &amp; adjust</dt><dd>Click an image to select it; {modifierLabel} + click selects multiple images. Processing levels, Tone and detailed adjustments apply to the selection. Press Ctrl + 0 through Ctrl + 7 to select a processing level. Level 0 disables sharpening, denoising, local contrast and CLAHE, restores baseline contrast, and retains tone, gamma and color settings. Use Undo, Redo or Reset as needed. Adjustments save automatically; original image files are preserved.</dd>
        <dt>Keyboard shortcuts</dt><dd>Ctrl+A: A/B comparison; Ctrl+F: fullscreen; Ctrl+C: colorize; Ctrl+Q: rotate; Ctrl+E: Export for Letter; Ctrl+P: print; Ctrl+O: open images; Ctrl+R: reload images. Newly opened viewer images are pinned by default.</dd><dt>Mouse controls</dt><dd>Scroll to zoom. Shift + drag or middle-button drag pans. In Adjust mode, left-drag horizontally changes contrast and vertically changes gamma. {modifierLabel} + scroll changes processing level. Right-click rotates; double right-click toggles a pin.</dd>
        <dt>Compare &amp; annotate</dt><dd>A/B compare opens two versions for comparison. Hold “Hold to compare with neutral” to see the neutral rendering. Choose Ellipse to mark an area. Hide annotations temporarily hides viewer marks without changing exports. Choose Select annotation, click an ellipse, measurement or calibration reference, then Delete selected annotation to remove only that mark. Deleting a calibration reference returns measurements to uncalibrated values.</dd>
        {!isMac && <><dt>Measure &amp; calibrate</dt><dd>Choose Measure, then Calibrate. Drag across a structure of known length, enter its actual length in mm, and Apply calibration. Existing and new measurements on that radiograph use this scale and display estimated lengths to one decimal place. Recalibrate replaces the reference; Clear calibration removes the scale. Measurements and calibration last for this viewing session and are not saved, exported or printed.</dd></>}
        <dt>Fullscreen &amp; shortcuts</dt><dd>F11 or Fullscreen shows the visible grid. Double-click an image to view it alone. Esc returns to the previous view. {modifierLabel} + Z undoes; {isMac ? 'Command + Shift + Z' : 'Ctrl + Y or Ctrl + Shift + Z'} redoes. Fit and Fit all restore image framing.</dd>
        <dt>Print &amp; export</dt><dd>{isMac ? 'Direct printing is unavailable in this Mac version. Export for Letter saves the combined JPEG with dates and office branding under Pictures / RAD Viewer / Exports (demo: John Smith).' : 'Print Current View previews the visible grid before printing. Export for Letter combines the visible images with dates and office branding.'} Export to JPEG saves selected images at full resolution and 70% quality, including processing, colorization, rotation and ellipse annotations. Choose the destination folder when prompted.</dd>
        <dt>Delete</dt><dd>Delete opens a review of the selected files. Check the preview and confirm only when you intend to delete them. Closing an image pane does not delete its file.</dd>
      </dl></section>
    </div><footer className="about-footer"><span>Help is available offline.</span><button className="primary" onClick={onClose}>Done</button></footer>
  </dialog>;
}
