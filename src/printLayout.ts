import { paneGrid } from './ImagePane';
import type { Ellipse } from './workspace';

export type PrintImage = { url: string; width: number; height: number; rotation: number; scale: number; ellipses: Ellipse[] };
export const PRINT_WIDTH = 1800;
export const PRINT_HEIGHT = 1200;
export const PRINT_GAP = 5;
type Size = { width: number; height: number };

// Use the viewer's row-major grid with one common scale to preserve magnification.
export function printLayout(sizes: Size[], width = PRINT_WIDTH, height = PRINT_HEIGHT, gap = PRINT_GAP) {
  if (!sizes.length || sizes.some(s => !Number.isFinite(s.width + s.height) || s.width <= 0 || s.height <= 0)) throw new Error('No printable images');
  const { columns, rows } = paneGrid(sizes.length, width, height);
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const cellHeight = (height - gap * (rows - 1)) / rows;
  const scale = Math.min(...sizes.map(size => Math.min(cellWidth / size.width, cellHeight / size.height)));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Too many images for one print');
  return sizes.map((size, index) => ({
    x: (index % columns) * (cellWidth + gap) + (cellWidth - size.width * scale) / 2,
    y: Math.floor(index / columns) * (cellHeight + gap) + (cellHeight - size.height * scale) / 2,
    width: size.width * scale,
    height: size.height * scale,
  }));
}

export async function composePrint(images: PrintImage[]) {
  const boxes = printLayout(images.map(i => ({ width: (i.rotation % 2 ? i.height : i.width) * i.scale, height: (i.rotation % 2 ? i.width : i.height) * i.scale })));
  const canvas = document.createElement('canvas'); canvas.width = PRINT_WIDTH; canvas.height = PRINT_HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Print preview is unavailable');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < images.length; i++) {
    const item = images[i], box = boxes[i], image = new Image();
    image.src = item.url; await image.decode();
    const scale = box.width / (item.rotation % 2 ? item.height : item.width);
    ctx.save(); ctx.translate(box.x + box.width / 2, box.y + box.height / 2); ctx.rotate(item.rotation * Math.PI / 2); ctx.scale(scale, scale);
    ctx.drawImage(image, -item.width / 2, -item.height / 2, item.width, item.height);
    ctx.lineWidth = 3 / item.scale;
    for (const e of item.ellipses) { ctx.beginPath(); ctx.strokeStyle = e.color === 'red' ? '#ff3030' : '#ffe600'; ctx.ellipse(e.x + e.width / 2 - item.width / 2, e.y + e.height / 2 - item.height / 2, e.width / 2, e.height / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  return canvas.toDataURL('image/png');
}
