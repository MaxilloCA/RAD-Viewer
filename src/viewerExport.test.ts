// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {drawExportBranding,drawExportFrame,viewerLayout} from './viewerExport';
afterEach(()=>vi.unstubAllGlobals());

it('keeps every grid cell clear of the sidebar, within the sheet, and in viewer order',()=>{
  for(const [width,height] of [[3840,2160],[1800,1200],[800,1200],[4096,1080]]){
    for(let count=1;count<=24;count++){
      const layout=viewerLayout(count,width,height);
      expect(layout.cells).toHaveLength(count);
      for(const [index,cell] of layout.cells.entries()){
        expect(cell.x).toBeGreaterThanOrEqual(layout.sidebar+layout.margin);
        expect(cell.y).toBeGreaterThanOrEqual(layout.margin);
        expect(cell.x+cell.width).toBeLessThanOrEqual(width-layout.margin+.001);
        expect(cell.y+cell.height).toBeLessThanOrEqual(height-layout.margin+.001);
        expect(cell.height).toBeGreaterThan(layout.dateHeight);
        if(index){const previous=layout.cells[index-1];expect(cell.y>previous.y || cell.x>previous.x).toBe(true);}
        if(count<=12){
          const columns=count===1?1:count<=4?2:count<=9?3:4;
          expect(cell.x).toBeCloseTo(layout.sidebar+layout.margin+index%columns*(cell.width+layout.gap));
          expect(cell.y).toBeCloseTo(layout.margin+Math.floor(index/columns)*(cell.height+layout.gap));
        }
      }
    }
  }
});

it('uses the original bitmap at fit without cropping or distortion, and keeps the date outside the image',()=>{
  const layout=viewerLayout(4,3840,2160),cell=layout.cells[0];
  const ctx={save:vi.fn(),restore:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),drawImage:vi.fn(),fillText:vi.fn()} as unknown as CanvasRenderingContext2D;
  const bitmap={} as CanvasImageSource;
  for(const [width,height] of [[1200,900],[900,1200],[2861,1316]]){
    drawExportFrame(ctx,bitmap,{url:'image',width,height,imageDate:'2026-09-23'},undefined,cell,layout.dateHeight,2);
    const [source,x,y,w,h]=vi.mocked(ctx.drawImage).mock.calls.at(-1)! as unknown as [CanvasImageSource,number,number,number,number];
    expect(source).toBe(bitmap);expect(w/h).toBeCloseTo(width/height);
    expect(x).toBeGreaterThanOrEqual(cell.x-.001);expect(y).toBeGreaterThanOrEqual(cell.y-.001);
    expect(x+w).toBeLessThanOrEqual(cell.x+cell.width+.001);
    expect(y+h).toBeLessThanOrEqual(cell.y+cell.height-layout.dateHeight+.001);
  }
  expect(ctx.fillText).toHaveBeenLastCalledWith('23-Sep-2026',cell.x+cell.width/2,cell.y+cell.height-layout.dateHeight/2);
  drawExportFrame(ctx,bitmap,{url:'image',width:900,height:1200},{fit:false,scale:.5,x:20,y:-30},cell,layout.dateHeight,2);
  expect(vi.mocked(ctx.drawImage).mock.calls.at(-1)?.slice(-2)).toEqual([900,1200]);
  expect(ctx.clip).toHaveBeenCalledTimes(4);
});

it('draws the bundled logo and complete patient name without ID or doctor names, even for long names',async()=>{
  vi.stubGlobal('Image',class {naturalWidth=934;naturalHeight=469;onload?:()=>void;set src(value:string){expect(value).toBe('/office-logo.png');queueMicrotask(()=>this.onload?.());}});
  for(const name of ['Kooring, Daniel','A'.repeat(80),'Alexandria-Marguerite van der Westhuizen, Christopher Alexander']){
    for(const [width,height] of [[3840,2160],[800,1200],[4096,1080]]){
      const text:{value:string;x:number;y:number;width:number}[]=[];
      const ctx={font:'',save:vi.fn(),restore:vi.fn(),drawImage:vi.fn(),fillRect:vi.fn(),measureText(this:{font:string},value:string){return {width:value.length*parseFloat(this.font.replace(/^600 /,''))*.55};},fillText(this:{measureText:(value:string)=>{width:number}},value:string,x:number,y:number){text.push({value,x,y,width:this.measureText(value).width});}} as unknown as CanvasRenderingContext2D;
      await drawExportBranding(ctx,width,height,name);
      const layout=viewerLayout(1,width,height);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      expect(vi.mocked(ctx.fillRect).mock.calls[0]).toEqual([0,0,layout.sidebar,height]);
      expect(text.map(t=>t.value)).toContain('info@KidsDentistry.ca');
      expect(text.some(t=>/^Dr\./.test(t.value) || /Patient ID|Goralski|Ghatak/.test(t.value))).toBe(false);
      const patientLines=text.slice(1,-4);
      expect(patientLines.map(t=>t.value).join('').replaceAll(' ','')).toBe(name.replaceAll(' ',''));
      for(const line of patientLines){expect(line.x+line.width).toBeLessThanOrEqual(layout.sidebar-32*layout.unit+.001);expect(line.y).toBeLessThan(height-194*layout.unit);}
    }
  }
});
