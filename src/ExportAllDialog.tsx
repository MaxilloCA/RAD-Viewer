import { isMac } from './platform';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ImageAppearance } from './model';
import type { PaneView } from './ImagePane';
import { drawExportBranding, drawExportFrame, loadBitmap, viewerLayout } from './viewerExport';
import type { ExportFrame } from './viewerExport';
export type ExportItem = { path: string; sourceSha256: string; appearance: ImageAppearance; annotationStroke: number; view?: PaneView };
export default function ExportAllDialog({ items, patientName, patientId='', onClose, onBusy }: { items: ExportItem[]; patientName: string; patientId?: string; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const dialog=useRef<HTMLDialogElement>(null), started=useRef(false), cancelled=useRef(false), mounted=useRef(true), saving=useRef(false);
  const [name,setName]=useState(patientName),[stage,setStage]=useState<'name'|'running'|'preview'|'saving'|'done'|'error'>(patientName?'running':'name');
  const [completed,setCompleted]=useState(0),[destination,setDestination]=useState(''),[failure,setFailure]=useState('');
  const [preview,setPreview]=useState<{png:string;url:string;name:string}|null>(null);
  const saveLocation=patientId==='DEMO'?'your Pictures folder under RAD Viewer / John Smith':isMac?'your Pictures folder under RAD Viewer / Exports':'\\\\server\\incoming';
  const cancel=()=>{if(saving.current)return;cancelled.current=true;onBusy(false);onClose();};
  const run=async(value:string)=>{
    if(started.current||!value.trim())return;
    started.current=true;onBusy(true);setStage('running');
    try {
      const cssWidth=window.screen.width||window.innerWidth||1920,cssHeight=window.screen.height||window.innerHeight||1080;
      const factor=Math.min(2,4096/Math.max(cssWidth,cssHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(cssWidth*factor);canvas.height=Math.round(cssHeight*factor);
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not prepare the export canvas');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      const layout=viewerLayout(items.length,canvas.width,canvas.height);
      for(let index=0;index<items.length;index++){
        const frame=await invoke<ExportFrame>('prepare_export_image',{item:items[index]});
        if(cancelled.current||!mounted.current)return;
        const image=await loadBitmap(frame.url);
        if(cancelled.current||!mounted.current)return;
        drawExportFrame(ctx,image,frame,items[index].view,layout.cells[index],layout.dateHeight,factor);
        setCompleted(index+1);
      }
      await drawExportBranding(ctx,canvas.width,canvas.height,value.trim());
      if(cancelled.current||!mounted.current)return;
      const png=canvas.toDataURL('image/png');
      const url=await invoke<string>('preview_viewer_jpg',{png});
      if(cancelled.current||!mounted.current)return;
      setPreview({png,url,name:value.trim()});setStage('preview');
    }catch(error){if(!cancelled.current&&mounted.current){setFailure(String(error));setStage('error');}}finally{if(mounted.current&&!cancelled.current)onBusy(false);}
  };
  const save=async()=>{
    if(!preview||saving.current||cancelled.current)return;
    saving.current=true;onBusy(true);setStage('saving');
    try {
      const result=await invoke<{directory:string;path:string}>('export_viewer_jpg',{patientName:preview.name,patientId,png:preview.png});
      if(mounted.current){setDestination(result.path);setStage('done');}
    }catch(error){if(mounted.current){setFailure(String(error));setStage('error');}}finally{saving.current=false;if(mounted.current)onBusy(false);}
  };
  useEffect(()=>{mounted.current=true;dialog.current?.showModal();if(patientName)void run(patientName);return()=>{mounted.current=false;};},[]);
  return <dialog ref={dialog} className={`export-dialog ${stage==='preview'?'export-preview-dialog':''}`} aria-labelledby="export-title" onCancel={event=>{event.preventDefault();cancel();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}}}>
    <h2 id="export-title">{stage==='done'?'Export complete':stage==='error'?'Export failed':'Export for Letter'}</h2>
    {stage==='name'?<form onSubmit={event=>{event.preventDefault();void run(name);}}><p>Enter the patient name as Last name, First name.</p><label>Patient name<input autoFocus value={name} onChange={event=>setName(event.target.value)} maxLength={80}/></label><div className="export-actions"><button type="button" onClick={cancel}>Cancel</button><button className="primary" disabled={!name.trim()}>Export for Letter</button></div></form>:<>
      {stage==='running'&&<div className="export-progress" role="status"><span className="export-orbit" aria-hidden="true"/><p>{completed<items.length?`Preparing radiograph ${completed+1} of ${items.length}…`:'Preparing JPEG preview…'}</p><progress value={completed} max={items.length} aria-label="Radiographs prepared"/><small>One combined JPEG · Dates and office logo · Quality 7/10</small></div>}
      {stage==='running'&&<div className="export-actions"><button onClick={cancel}>Cancel</button></div>}
      {stage==='preview'&&preview&&<><img className="export-preview-image" src={preview.url} alt="JPEG export preview"/><p>Review the JPEG before saving to {saveLocation}. Press Escape to cancel.</p><div className="export-actions"><button onClick={cancel}>Cancel</button><button className="primary" autoFocus onClick={()=>void save()}>Confirm and save</button></div></>}
      {stage==='saving'&&<p role="status">Saving JPEG…</p>}
      {stage==='done' &&<p role="status">Exported {items.length} radiographs together in one JPEG.</p>}
      {stage==='error'&&<p role="alert" className="export-error">{failure}</p>}
      {destination&&<div className="export-destination"><span>Saved to</span><code>{destination}</code></div>}
      {(stage==='done'||stage==='error')&&<div className="export-actions"><button className="primary" autoFocus onClick={onClose}>Done</button></div>}
    </>}
  </dialog>;
}
