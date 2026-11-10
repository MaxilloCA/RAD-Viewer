import { expect,it } from 'vitest';
import { groupByDate } from './filmstrip';
import type { ImageEntry } from './model';
it('groups newest dates first, retains indices and puts undated images last',()=>{
  const images=['2025-01-01',undefined,'2026-10-16','2025-01-01'].map((imageDate,index)=>({key:String(index),details:{metadata:{imageDate}}})) as ImageEntry[];
  const groups=groupByDate(images);expect(groups.map(group=>group.date)).toEqual(['2026-10-16','2025-01-01','']);expect(groups[1].items.map(item=>item.index)).toEqual([0,3]);
});
