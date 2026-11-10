import { buildInfo } from './buildInfo';

export const isMac = buildInfo.os === 'macos';
export const supportsPatientLookup = buildInfo.os === 'windows';
export const supportsPrinting = buildInfo.os === 'windows';
export const modifierLabel = isMac ? 'Command' : 'Ctrl';
export const patientLookupUnavailable = 'Patient-number lookup is unavailable in this Mac version. Use Open Images to choose local radiographs.';
export const printingUnavailable = 'Direct printing is unavailable in this Mac version. Export images to print from another app.';

// Control-click is a secondary click on macOS. Trackpad pinch can also arrive
// as Control+wheel, so only Command modifies selection/processing on a Mac.
export function selectionModifier(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}
