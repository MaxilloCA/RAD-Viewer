import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ColorControls from './ColorControls';
import { useGrayscalePreview, useReferencePicker } from './useColorTools';
import { withColorMode, withRadiographDetail } from './model';
import ImagePane, { defaultPaneView } from './ImagePane';
import { contrastValue, dragAdjustment, orientedDimensions, processingLevel, toneValue, withContrast, withProcessingLevel, withTone } from './model';
import type { ImageEntry, ImageInfo, OpenImage, Recipe, RenderInfo } from './model';
import { nextRequest, useRenderedImage } from './useRenderedImage';

function Copy({ label, entry, onApply }: { label: string; entry: ImageEntry; onApply: (recipe: Recipe, rotation: number) => void }) {
  const initial = withRadiographDetail(entry.history!.present);
  const defaultRecipe = withRadiographDetail(entry.defaultRecipe!);
  const [recipe, setRecipe] = useState(initial);
  const [source, setSource] = useState<OpenImage>();
  const [error, setError] = useState('');
  const [interactive, setInteractive] = useState(false);
  const [rotation, setRotation] = useState(entry.rotationQuarterTurns);
  const [view, setView] = useState(defaultPaneView);
  const [size, setSize] = useState({width:500,height:600});
  const drag = useRef(initial);
  useEffect(() => {
    let cancelled = false; let id: string | undefined;
    void (async () => {
      const info = await invoke<ImageInfo>('import_image', {path:entry.path}); id=info.id;
      if (cancelled) { await invoke('release_image',{id}); return; }
      const frame = await invoke<RenderInfo>('render_image',{id,recipe:initial,requestId:nextRequest()});
      if (!cancelled) setSource({info,path:entry.path,initial:frame,initialRecipe:initial,defaultRecipe,history:{past:[],present:initial,future:[]}});
    })().catch(problem => {if (!cancelled) setError(String(problem));});
    return () => {cancelled=true;if(id) void invoke('release_image',{id});};
  }, [entry.path]);
  const {rendered,processing} = useRenderedImage(source,recipe,setError,interactive);
  const gray = useGrayscalePreview(source?.info.id, recipe, setError);
  const picker = useReferencePicker(JSON.stringify([source?.info.id, recipe]), setError);
  const info = source?.info ?? entry.details!;
  const base = info.suggested ?? info.neutral;
  const dims = orientedDimensions(info.width,info.height,rotation);
  const effective = {...view,scale:view.fit ? Math.max(.025, Math.min((size.width-6)/dims.width,(size.height-6)/dims.height)) : view.scale};
  const onSize=useCallback((_key:string,width:number,height:number)=>setSize({width,height}),[]);
  const change=(key:keyof Recipe,value:number|string|boolean)=>setRecipe(previous=>({...previous,[key]:value,version:2}));
  const slider=(name:string,value:number,min:number,max:number,step:number,onChange:(value:number)=>void)=><label>{name}<output>{Number(value.toFixed(2))}</output><input aria-label={`${label} ${name}`} type="range" min={min} max={max} step={step} value={value} onChange={event=>{setInteractive(true);onChange(Number(event.target.value));}} onPointerUp={()=>setInteractive(false)} onPointerCancel={()=>setInteractive(false)} onKeyUp={()=>setInteractive(false)} onBlur={()=>setInteractive(false)}/></label>;
  return <section className="comparison-copy" aria-label={`Comparison ${label}`}><div className="comparison-title"><strong>{label}</strong><button disabled={!source} onClick={()=>onApply(recipe,rotation)}>Use {label}</button><button onClick={()=>setRecipe(defaultRecipe)}>Reset {label}</button><button onClick={()=>setView(defaultPaneView)}>Fit {label}</button></div>
    {error && <p role="alert">{error}</p>}
    <ImagePane entry={{...entry,key:`compare-${label}`,details:info,image:source,rotationQuarterTurns:rotation}} render={gray.render ?? rendered} comparing={gray.held} pickingReference={picker.picking} onPickReference={point => { if (source) void picker.sample(source.info.id, recipe, point, level => setRecipe(value => ({ ...value, midtoneLevel: level }))); }} active view={effective} setView={update=>setView(typeof update==='function'?update(effective):update)} processing={processing} onSize={onSize} pixelRatio={window.devicePixelRatio||1} badge={label} onSelect={()=>{}} onPin={()=>{}} onRotate={()=>setRotation(value=>(value+1)%4)} onReset={()=>setRecipe(defaultRecipe)} ellipses={entry.ellipses}
      onEnhance={direction=>setRecipe(value=>withProcessingLevel(value,base,processingLevel(value,base).level+direction))}
      onAdjustStart={()=>{drag.current=recipe;setInteractive(true);}} onAdjustMove={(dx,dy)=>setRecipe(dragAdjustment(drag.current,base,dx,dy))} onAdjustEnd={()=>setInteractive(false)}/>
    <div className="comparison-controls">
      {slider('Processing level',processingLevel(recipe,base).level,0,7,1,value=>setRecipe(previous=>withProcessingLevel(previous,base,value)))}
      {slider('Gamma',recipe.gamma,.1,2,.01,value=>change('gamma',value))}
      {slider('Tone',toneValue(recipe,base,info.metadata.photometric),-100,100,1,value=>setRecipe(previous=>withTone(previous,base,value,info.metadata.photometric)))}
      {slider('Contrast',contrastValue(recipe,base),-100,100,1,value=>setRecipe(previous=>withContrast(previous,base,value)))}
      <details><summary>Detail and color</summary>
        {slider('Sharpness',recipe.sharpen,0,12,.1,value=>change('sharpen',value))}
        {slider('Noise reduction',recipe.denoise,0,1,.01,value=>change('denoise',value))}
        {slider('Local contrast',recipe.localContrast,0,1,.01,value=>change('localContrast',value))}
        {slider('Adaptive contrast',recipe.clahe,0,1,.01,value=>change('clahe',value))}
        {slider('Radius',recipe.radius,.5,8,.1,value=>change('radius',value))}
        {slider('Noise threshold',recipe.threshold,0,.05,.0005,value=>change('threshold',value))}
        {slider('Halo suppression',recipe.halo,0,1,.01,value=>change('halo',value))}
        <p className="control-note">Detail method: Radiograph multiscale</p>
        <label><input aria-label={`${label} Colorize`} type="checkbox" checked={recipe.colorize} onChange={event=>setRecipe(value=>({...value,version:2,colorize:event.target.checked}))}/>Colorize midtones</label>
        {recipe.colorize && <ColorControls prefix={`${label} `} recipe={recipe} onChange={patch => { setInteractive(true); setRecipe(value => ({ ...value, ...patch, version: 2 })); }} onCommit={() => setInteractive(false)} onMode={mode => { setInteractive(false); setRecipe(value => withColorMode(value, mode)); }} onPick={picker.toggle} picking={picker.picking} onHold={gray.setHeld} held={gray.held} busy={gray.busy}/>}
        <label><input aria-label={`${label} Invert`} type="checkbox" checked={recipe.invert} onChange={event=>change('invert',event.target.checked)}/>Invert</label>
      </details>
    </div>
  </section>;
}
export default function ComparisonView({entry,onClose,onApply}:{entry:ImageEntry;onClose:()=>void;onApply:(recipe:Recipe,rotation:number)=>void}) {
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{close.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Tab'){const elements=Array.from(close.current?.closest('[role=dialog]')?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,summary')??[]).filter(element=>element.getClientRects().length>0);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}if(event.key==='Escape' && document.querySelector('[aria-label$="Pick reference"][aria-pressed="true"]')) return;if(event.key==='Escape'||event.key==='F11'){event.preventDefault();event.stopImmediatePropagation();onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[onClose]);
  return <div className="comparison-view" role="dialog" aria-modal="true" aria-label="A/B processing comparison"><header><strong>A/B processing · {entry.name}</strong><span>Both copies adjust independently. Use A or B to save that version.</span><button ref={close} onClick={onClose}>Close comparison · Esc</button></header><div className="comparison-grid"><Copy label="A" entry={entry} onApply={onApply}/><Copy label="B" entry={entry} onApply={onApply}/></div></div>;
}
