import type { CSSProperties } from 'react';

const paths = {
  reload: 'M20 7v5h-5 M19 12a7 7 0 1 0-2 5 M20 7l-3-3',
  print: 'M7 8V3h10v5 M7 17H4V9h16v8h-3 M7 14h10v7H7z M17 11h.01',
  export: 'M12 15V3 M8 7l4-4 4 4 M5 13v7h14v-7',
  letter: 'M4 5h16v14H4z M4 6l8 7 8-7',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  folder: 'M3 6h7l2 3h9v11H3z',
  patient: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  compare: 'M3 4h7v16H3z M14 4h7v16h-7z',
  adjust: 'M3 6h4 M11 6h10 M3 12h10 M17 12h4 M3 18h4 M11 18h10 M7 3v6 M17 9v6 M7 15v6',
  measure: 'M4 17L17 4l3 3L7 20z M8 13l3 3 M12 9l3 3 M16 5l3 3',
  ellipse: 'M21 12a9 7 0 1 1-18 0 9 7 0 0 1 18 0',
  rotate: 'M20 4v6h-6 M19 10a8 8 0 1 0 0 6',
  fit: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  fitAll: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  fullscreen: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
  undo: 'M8 4L3 9l5 5 M3 9h10a6 6 0 0 1 0 12',
  redo: 'M16 4l5 5-5 5 M21 9H11a6 6 0 0 0 0 12',
  reset: 'M4 4v6h6 M5 10a8 8 0 1 1 0 6',
  chevron: 'M9 5l7 7-7 7',
  check: 'M5 12l4 4L19 6',
  pin: 'M8 3h8l-1 7 4 4H5l4-4z M12 14v7',
  close: 'M5 5l14 14 M19 5L5 19',
  save: 'M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-8h8v8',
} as const;

/** Decorative icons keep the visible text as each control's accessible name. */
export default function Icon({ name, style }: { name: keyof typeof paths; style?: CSSProperties }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}><path d={paths[name]} /></svg>;
}
