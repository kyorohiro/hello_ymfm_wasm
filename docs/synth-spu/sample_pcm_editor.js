// SPDX-License-Identifier: BSD-3-Clause
// Full source PCM stays in this UI component, never in periodic SPU snapshots.
import {decodeSpuSamplePcm} from './spu_sample_pcm.js';

const BLOCK=32;
const same=(a,b)=>a?.sampleId===b?.sampleId&&a?.token===b?.token;
const validIdentity=value=>value&&Number.isSafeInteger(value.sampleId)&&value.sampleId>=0&&
  (typeof value.token==='string'&&value.token.length>0||Number.isSafeInteger(value.token));
const cancelled=()=>new DOMException('Sample PCM edit cancelled','AbortError');
function peaksFor(pcm) {
  const low=new Float32Array(Math.ceil(pcm.length/BLOCK)),high=new Float32Array(low.length);
  const peaks={low,high};refreshPeaks(peaks,pcm,0,pcm.length);return peaks;
}
function refreshPeaks(peaks,pcm,first,last) {
  for(let block=Math.floor(first/BLOCK);block<Math.ceil(last/BLOCK);block++) {
    let low=1,high=-1;
    for(let i=block*BLOCK;i<Math.min(pcm.length,(block+1)*BLOCK);i++){low=Math.min(low,pcm[i]);high=Math.max(high,pcm[i]);}
    peaks.low[block]=low;peaks.high[block]=high;
  }
}
function rangePeak(pcm,peaks,start,end) {
  let low=1,high=-1,at=start;
  while(at<end&&at%BLOCK){low=Math.min(low,pcm[at]);high=Math.max(high,pcm[at++]);}
  while(at+BLOCK<=end){low=Math.min(low,peaks.low[at/BLOCK]);high=Math.max(high,peaks.high[at/BLOCK]);at+=BLOCK;}
  while(at<end){low=Math.min(low,pcm[at]);high=Math.max(high,pcm[at++]);}
  return [low,high];
}

export function createSpuSamplePcmEditor({element,canvas,readSample,prepareSampleEdit,applySample,
  decode=decodeSpuSamplePcm,onError=()=>{},onChange=()=>{}}={}) {
  if(!element||!canvas||[readSample,prepareSampleEdit,applySample,decode,onError,onChange].some(fn=>typeof fn!=='function'))
    throw TypeError('Full sample PCM editor needs its canvas and host callbacks.');
  const doc=element.ownerDocument,listeners=[],controls={};element.classList.add('spu-sample-pcm-editor');element.hidden=true;
  let identity=null,source=null,pcm=null,peaks=null,draft=null,draftPeaks=null,active=false,disposed=false,phase='idle',message='',bad=false;
  let revision=0,painted=-1,epoch=0,controller=null,stroke=null,start=0,span=1,index=0,pendingView=null;
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node.addEventListener(type,fn,options);listeners.push(()=>node.removeEventListener(type,fn,options));};
  const row=className=>{const node=make('div');node.className=className;element.append(node);return node;};
  function number(parent,key,label,min,max,step=1) {
    const field=make('label',label+' '),input=make('input');input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);
    input.dataset.samplePcm=key;input.setAttribute('aria-label',label);field.append(input);parent.append(field);controls[key]=input;return input;
  }
  function button(parent,key,label) {
    const node=make('button',label);node.type='button';node.dataset.samplePcm=key;parent.append(node);controls[key]=node;
    listen(node,'pointerdown',event=>{if(event.button===0)event.preventDefault();});return node;
  }
  const values=row('spu-sample-pcm-controls');number(values,'index','Sample index',0,0);number(values,'value','PCM value',-1,1,.001);
  const view=row('spu-sample-pcm-view');number(view,'start','View start',0,0);number(view,'span','Visible samples',1,1);
  button(view,'zoom-in','Zoom +');button(view,'zoom-out','Zoom −');button(view,'full','Full sample');button(view,'cancel','Cancel edit');
  const status=make('output');status.dataset.samplePcmStatus='';status.setAttribute('role','status');element.append(status);
  const note=make('p','Software sample editor · ADPCM quantization is lossy. Held notes continue at their current positions; length, loop, tuning and ADSR are kept.');note.className='subtext';element.append(note);
  const busy=()=>phase==='loading'||phase==='encoding'||phase==='applying';
  const data=()=>draft??pcm,peakData=()=>draftPeaks??peaks;
  function read(){return {active,phase,ready:active&&phase==='ready'&&Boolean(pcm),frames:pcm?.length??0,
    sampleId:identity?.sampleId??null,token:identity?.token??null,viewStart:start,viewSpan:span,index,value:data()?.[index]??null,
    loopStartSamples:source?.loopStartSamples??null,message,error:bad};}
  function sync() {
    element.hidden=!active;element.dataset.phase=phase;element.dataset.error=String(bad);element.setAttribute('aria-busy',String(busy()));
    const length=pcm?.length??1;
    for(const key of ['index','start'])controls[key].max=String(length-1);controls.span.max=String(length);
    controls.index.value=String(index);controls.value.value=data()?String(data()[index]):'';controls.start.value=String(start);controls.span.value=String(span);
    for(const [key,node]of Object.entries(controls))node.disabled=key==='cancel'?!active||!['loading','encoding'].includes(phase):!active||phase!=='ready';
    const loop=source?.loopStartSamples==null?'One shot':`Loop from sample ${source.loopStartSamples}`;
    status.textContent=message||(pcm?`${pcm.length.toLocaleString()} samples · ${loop} · view ${start}–${start+span-1}`:'Loading the complete ADPCM sample…');
    revision++;draw();onChange(read());
  }
  function stopStroke() {
    const pointer=stroke?.pointerId;stroke=null;
    if(pointer!==undefined&&canvas.hasPointerCapture?.(pointer))canvas.releasePointerCapture(pointer);
  }
  function invalidate({clear=false}={}) {
    epoch++;controller?.abort();controller=null;stopStroke();draft=null;draftPeaks=null;
    if(clear){source=null;pcm=null;peaks=null;start=0;span=1;index=0;}
    phase=pcm?'ready':'idle';message='';bad=false;revision++;
  }
  async function load() {
    const target={...identity},request=++epoch;controller=new AbortController();phase='loading';message='Loading complete sample PCM…';bad=false;sync();
    try {
      const value=await readSample();
      if(disposed||!active||request!==epoch||!same(target,identity))return;
      if(!same(value,target))throw cancelled();
      const decoded=decode(value);
      if(!(decoded instanceof Float32Array)||!decoded.length||decoded.length>910336||decoded.some(sample=>!Number.isFinite(sample)||sample< -1||sample>1))throw Error('Invalid complete sample PCM.');
      source=value;pcm=decoded;peaks=peaksFor(pcm);start=0;span=pcm.length;index=0;
      restoreView();phase='ready';message='';sync();
    }catch(error) {
      if(disposed||!active||request!==epoch)return;
      phase='error';message=error?.name==='AbortError'?'Sample changed. Reopen PCM to load its latest data.':`Sample PCM unavailable: ${error.message??error}`;bad=true;sync();
      if(error?.name!=='AbortError')onError(error);
    }
  }
  function update({source:next,active:enabled=false,clear=false}={}) {
    if(disposed)return;
    next=validIdentity(next)?{sampleId:next.sampleId,token:next.token}:null;
    const changed=!same(next,identity),wasActive=active;active=Boolean(enabled&&next);
    if(changed||clear){if(clear||!same(next,pendingView))pendingView=null;invalidate({clear:true});identity=next;}
    else if(wasActive&&!active)invalidate();
    if(active&&!pcm&&phase==='idle')void load();
    else if(changed||clear||wasActive!==active)sync();
  }
  async function commit(edited) {
    if(!active||phase!=='ready'||!source||edited.length!==pcm.length)return;
    const request=++epoch,original=source,viewAfter={start,span,index,frames:pcm.length},signal=(controller=new AbortController()).signal;
    draft=edited;draftPeaks=peaksFor(edited);phase='encoding';message='Encoding the complete sample…';bad=false;sync();
    try {
      const prepared=await prepareSampleEdit(original,edited,{signal});
      if(disposed||!active||request!==epoch||signal.aborted||!same(original,identity))return;
      phase='applying';message='Applying sample PCM…';sync();
      const result=await applySample(prepared);
      if(result===false)throw cancelled();
      if(validIdentity(result)&&!disposed) {
        pendingView={...result,...viewAfter};
        if(same(result,identity)&&pcm){restoreView();sync();}
      }
      // The canonical token changes on every commit. The owner's next state
      // reloads the quantized source; do not reuse the old token for a new edit.
    }catch(error) {
      if(disposed||request!==epoch)return;
      draft=null;draftPeaks=null;phase='ready';message=error?.name==='AbortError'?'Edit cancelled. Original sample kept.':`Edit not applied: ${error.message??error}`;bad=error?.name!=='AbortError';sync();
      if(bad)onError(error);
    }
  }
  function restoreView() {
    if(pendingView&&same(pendingView,identity)&&pcm?.length===pendingView.frames) {
      span=Math.max(1,Math.min(pcm.length,pendingView.span));start=Math.max(0,Math.min(pcm.length-span,pendingView.start));
      index=Math.max(0,Math.min(pcm.length-1,pendingView.index));pendingView=null;
    }
  }
  function cancel() {
    if(!active||phase==='applying')return false;
    invalidate();message=pcm?'Edit cancelled. Original sample kept.':'Loading cancelled. Reopen PCM to try again.';phase=pcm?'ready':'error';sync();return true;
  }
  function integer(node,min,max) {
    const value=Number(node.value),valid=node.value.trim()!==''&&Number.isInteger(value)&&value>=min&&value<=max;
    node.setCustomValidity?.(valid?'':`Enter an integer from ${min} to ${max}.`);if(!valid)node.reportValidity?.();return valid?value:null;
  }
  function setView(nextStart,nextSpan) {
    if(!pcm)return;span=Math.max(1,Math.min(pcm.length,Math.round(nextSpan)));start=Math.max(0,Math.min(pcm.length-span,Math.round(nextStart)));message='';sync();
  }
  listen(controls.index,'change',()=>{
    if(!active||phase!=='ready')return;const value=integer(controls.index,0,pcm.length-1);if(value===null)return;index=value;
    if(index<start||index>=start+span)start=Math.max(0,Math.min(pcm.length-span,index-Math.floor(span/2)));message='';sync();
  });
  listen(controls.value,'change',()=>{
    if(!active||phase!=='ready')return;const value=Number(controls.value.value);
    if(!controls.value.value.trim()||!Number.isFinite(value)||value< -1||value>1){controls.value.setCustomValidity?.('Enter PCM from -1 to +1.');controls.value.reportValidity?.();return;}
    controls.value.setCustomValidity?.('');const edited=pcm.slice();edited[index]=value;if(edited[index]!==pcm[index])void commit(edited);
  });
  listen(controls.start,'change',()=>{if(active&&phase==='ready'){const value=integer(controls.start,0,pcm.length-1);if(value!==null)setView(value,Math.min(span,pcm.length-value));}});
  listen(controls.span,'change',()=>{if(active&&phase==='ready'){const value=integer(controls.span,1,pcm.length);if(value!==null)setView(start,value);}});
  for(const [key,factor]of [['zoom-in',.5],['zoom-out',2]])listen(controls[key],'click',()=>{if(active&&phase==='ready'){const next=Math.max(1,Math.min(pcm.length,Math.round(span*factor)));setView(start+(span-next)/2,next);}});
  listen(controls.full,'click',()=>{if(active&&phase==='ready')setView(0,pcm.length);});listen(controls.cancel,'click',cancel);
  function point(event) {
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
    const at=Math.max(start,Math.min(start+span-1,start+Math.floor((event.clientX-rect.left)/rect.width*span))),value=Math.max(-1,Math.min(1,1-2*(event.clientY-rect.top)/rect.height));
    const first=stroke.lastIndex??at,previous=stroke.lastValue??value,low=Math.min(first,at),high=Math.max(first,at);
    for(let i=low;i<=high;i++)draft[i]=first===at?value:previous+(value-previous)*(i-first)/(at-first);
    refreshPeaks(draftPeaks,draft,low,high+1);stroke.lastIndex=at;stroke.lastValue=value;index=at;revision++;draw();
    controls.index.value=String(index);controls.value.value=String(draft[index]);
  }
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])listen(canvas,type,event=>{
    if(!active)return;event.stopImmediatePropagation();
    if(type==='pointercancel'||type==='lostpointercapture'){if(stroke?.pointerId===event.pointerId){stopStroke();draft=null;draftPeaks=null;sync();}return;}
    if(type==='pointerdown') {
      if(phase!=='ready'||stroke||event.button!==0||event.isPrimary===false)return;event.preventDefault();
      draft=pcm.slice();draftPeaks={low:peaks.low.slice(),high:peaks.high.slice()};stroke={pointerId:event.pointerId};
      canvas.setPointerCapture?.(event.pointerId);point(event);
    }else if(stroke?.pointerId===event.pointerId) {
      event.preventDefault();point(event);
      if(type==='pointerup'){const edited=draft;stopStroke();draft=null;draftPeaks=null;if(edited.some((value,i)=>value!==pcm[i]))void commit(edited);else sync();}
    }
  },true);
  listen(doc.defaultView,'blur',()=>{if(stroke){stopStroke();draft=null;draftPeaks=null;sync();}});
  listen(doc,'visibilitychange',()=>{if(doc.hidden&&stroke){stopStroke();draft=null;draftPeaks=null;sync();}});
  function draw(force=false) {
    if(!active||disposed||!force&&painted===revision)return;painted=revision;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const w=canvas.width,h=canvas.height,y=value=>8+(1-value)*(h-16)/2;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#101820';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#34444e';ctx.lineWidth=1;
    for(const value of [-1,0,1]){ctx.beginPath();ctx.moveTo(0,y(value));ctx.lineTo(w,y(value));ctx.stroke();}
    const values=data(),summary=peakData();
    if(!values){ctx.fillStyle='#b5c2cc';ctx.font='13px sans-serif';ctx.fillText(message||'Loading full sample PCM…',12,25);return;}
    ctx.strokeStyle='#7bbcf7';ctx.lineWidth=1;ctx.beginPath();
    if(span<=w) {
      if(span===1){ctx.moveTo(0,y(values[start]));ctx.lineTo(w,y(values[start]));}
      else for(let i=0;i<span;i++){const x=i*w/(span-1);if(i)ctx.lineTo(x,y(values[start+i]));else ctx.moveTo(x,y(values[start+i]));}
    }else for(let x=0;x<w;x++) {
      const first=start+Math.floor(x*span/w),last=Math.min(values.length,Math.max(first+1,start+Math.ceil((x+1)*span/w)));
      const [low,high]=rangePeak(values,summary,first,last),bottom=y(low),top=y(high);
      ctx.moveTo(x,bottom);ctx.lineTo(x,Math.abs(bottom-top)<1?bottom-1:top);
    }
    ctx.stroke();ctx.strokeStyle='#ef9ac2';
    for(const at of [index,source?.loopStartSamples])if(Number.isInteger(at)&&at>=start&&at<start+span){const x=(at-start)*w/span;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    ctx.fillStyle='#b5c2cc';ctx.font='12px sans-serif';ctx.fillText(`${start}–${start+span-1} / ${values.length} samples`,8,h-7);
  }
  function clear(){if(disposed)return;active=false;pendingView=null;invalidate({clear:true});identity=null;sync();}
  return {update,read,draw,cancel,clear,controls,dispose(){if(disposed)return;active=false;invalidate({clear:true});disposed=true;for(const remove of listeners)remove();element.hidden=true;}};
}
