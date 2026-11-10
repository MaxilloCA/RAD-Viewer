import { paneGrid } from './ImagePane';
import { formatImageDate } from './model';
import type { PaneView } from './ImagePane';
export type ExportFrame = { url: string; width: number; height: number; imageDate?: string | null };
export const loadBitmap = (url: string): Promise<HTMLImageElement> => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not load an export image or office logo'));image.src=url;});
export function viewerLayout(count:number,width:number,height:number) {
  const unit=Math.min(width/1920,height/1080);
  const sidebar=Math.round(width*.22), margin=28*unit, gap=18*unit, dateHeight=32*unit;
  const grid=paneGrid(count,width-sidebar-2*margin,height-2*margin);
  const cellWidth=(width-sidebar-2*margin-gap*(grid.columns-1))/grid.columns;
  const cellHeight=(height-2*margin-gap*(grid.rows-1))/grid.rows;
  return {unit,sidebar,margin,gap,dateHeight,cells:Array.from({length:count},(_,i)=>({
    x:sidebar+margin+i%grid.columns*(cellWidth+gap),
    y:margin+Math.floor(i/grid.columns)*(cellHeight+gap),width:cellWidth,height:cellHeight,
  }))};
}
export function drawExportFrame(ctx:CanvasRenderingContext2D,image:CanvasImageSource,frame:ExportFrame,view:PaneView|undefined,cell:{x:number;y:number;width:number;height:number},dateHeight:number,factor:number) {
  const {x,y,width,height}=cell;
  const drawingHeight=height-dateHeight;
  const scale=!view || view.fit ? Math.min(width/frame.width,drawingHeight/frame.height) : view.scale*factor;
  ctx.save();ctx.fillStyle='#000';ctx.fillRect(x,y,width,height);
  ctx.beginPath();ctx.rect(x,y,width,drawingHeight);ctx.clip();
  ctx.drawImage(image,x+width/2+(view?.x??0)*scale-frame.width*scale/2,y+drawingHeight/2+(view?.y??0)*scale-frame.height*scale/2,frame.width*scale,frame.height*scale);ctx.restore();
  ctx.save();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`500 ${dateHeight*.6}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(formatImageDate(frame.imageDate),x+width/2,y+drawingHeight+dateHeight/2);ctx.restore();
}

// Measure glyphs so long names, including unbroken names, stay inside the sidebar.
function nameLines(ctx:CanvasRenderingContext2D,name:string,width:number):string[] {
  const lines:string[]=[];
  let line='';
  for(const word of name.trim().split(/\s+/)) {
    const candidate=line?`${line} ${word}`:word;
    if(ctx.measureText(candidate).width<=width){line=candidate;continue;}
    if(line){lines.push(line);line='';}
    for(const character of word){
      if(line && ctx.measureText(line+character).width>width){lines.push(line);line='';}
      line+=character;
    }
  }
  if(line)lines.push(line);
  return lines;
}

export async function drawExportBranding(ctx:CanvasRenderingContext2D,width:number,height:number,name:string) {
  const logo=await loadBitmap('/office-logo.png');
  const {unit,sidebar}=viewerLayout(1,width,height);
  const left=32*unit, textWidth=sidebar-2*left, top=44*unit;
  const logoHeight=textWidth*logo.naturalHeight/logo.naturalWidth;
  ctx.save();ctx.fillStyle='#fff';ctx.fillRect(0,0,sidebar,height);
  ctx.fillStyle='#35bfe7';ctx.fillRect(sidebar-2*unit,0,2*unit,height);
  ctx.drawImage(logo,left,top,textWidth,logoHeight);
  const ruleY=top+logoHeight+36*unit;
  ctx.fillRect(left,ruleY,textWidth,unit);
  ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle='#626b73';
  ctx.font=`600 ${24*unit}px "Segoe UI", Arial, sans-serif`;
  const labelY=ruleY+48*unit;
  ctx.fillText('Radiographs',left,labelY);
  const nameY=labelY+52*unit, contactY=height-170*unit;
  let fontSize=58*unit, lines:string[];
  do {
    ctx.font=`600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    lines=nameLines(ctx,name,textWidth);
    if(lines.length*fontSize*1.12<=contactY-nameY-50*unit || fontSize<=20*unit)break;
    fontSize-=2*unit;
  }while(true);
  ctx.fillStyle='#18222c';
  lines.forEach((line,index)=>ctx.fillText(line,left,nameY+index*fontSize*1.12));
  ctx.fillStyle='#35bfe7';ctx.fillRect(left,contactY-24*unit,textWidth,unit);
  ctx.fillStyle='#4e5963';ctx.font=`${19*unit}px "Segoe UI", Arial, sans-serif`;
  ['300 Lakeshore Dr. Suite 200','Barrie, ON L4N 0B4','705 722 3213','info@KidsDentistry.ca'].forEach((line,index)=>ctx.fillText(line,left,contactY+index*29*unit));
  ctx.restore();
}
