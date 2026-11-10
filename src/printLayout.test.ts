import { describe, expect, it } from 'vitest';
import { printLayout } from './printLayout';

describe('4x6 composition', () => {
  it('fills a landscape page and keeps precisely five pixels between two images', () => {
    const boxes = printLayout([{ width: 600, height: 800 }, { width: 600, height: 800 }]);
    expect(boxes[1].x - boxes[0].x - boxes[0].width).toBeCloseTo(5);
    expect(boxes[0].x).toBeCloseTo(0);
    expect(boxes[1].x + boxes[1].width).toBeCloseTo(1800);
    expect(boxes[0].width / boxes[0].height).toBeCloseTo(.75);
  });
  it('preserves relative magnification and order across rows without cropping or overlap', () => {
    const sizes = [{ width: 1600, height: 400 }, { width: 500, height: 900 }, { width: 1000, height: 1800 }, { width: 800, height: 600 }, { width: 600, height: 800 }];
    const boxes = printLayout(sizes), scale = boxes[0].width / sizes[0].width;
    boxes.forEach((box, i) => {
      expect(box.width / sizes[i].width).toBeCloseTo(scale);
      expect(box.height / sizes[i].height).toBeCloseTo(scale);
      expect(box.x).toBeGreaterThanOrEqual(-1e-6); expect(box.y).toBeGreaterThanOrEqual(-1e-6);
      expect(box.x + box.width).toBeLessThanOrEqual(1800 + 1e-6); expect(box.y + box.height).toBeLessThanOrEqual(1200 + 1e-6);
      boxes.slice(i + 1).forEach(other => {
        expect(other.x >= box.x + box.width + 5 - 1e-6 || other.y >= box.y + box.height + 5 - 1e-6).toBe(true);
      });
    });
  });
  it('rejects empty or invalid compositions', () => {
    expect(() => printLayout([])).toThrow();
    expect(() => printLayout([{ width: NaN, height: 500 }])).toThrow();
  });
});

it('uses the same row and column counts as the main viewer for every count through twelve',()=>{
  for(const [count,rows,columns] of [[1,1,1],[2,1,2],[3,2,2],[4,2,2],[5,2,3],[6,2,3],[7,3,3],[8,3,3],[9,3,3],[10,3,4],[11,3,4],[12,3,4]]){
    const boxes=printLayout(Array.from({length:count},()=>({width:600,height:800})));
    const cellWidth=(1800-5*(columns-1))/columns,cellHeight=(1200-5*(rows-1))/rows;
    boxes.forEach((box,index)=>{
      expect(box.x+box.width/2).toBeCloseTo(index%columns*(cellWidth+5)+cellWidth/2);
      expect(box.y+box.height/2).toBeCloseTo(Math.floor(index/columns)*(cellHeight+5)+cellHeight/2);
    });
  }
});
