import {createParamControl} from './synth_controls.js?v=op-gates-1';
import {PCM_MAX_FRAMES,pcmSampleBytes,createPcmBuiltinPreset} from './synth_pcm.js?v=pcm-live-end-1';

/** Compact RF5C164 authoring controls; writes and file decoding belong to the host. */
export function setupSynthPcmControls({voice,onSettingsChange=()=>{},onBuiltin=()=>{},onLoad=()=>{},onVisualModeChange=()=>{}}={}) {
  if(typeof voice?.getState!=='function')throw new TypeError('PCM controls need a voice');
  for(const callback of [onSettingsChange,onBuiltin,onLoad,onVisualModeChange])if(typeof callback!=='function')throw new TypeError('PCM controls need callbacks');
  const byId=id=>document.getElementById(id),root=byId('synthChipPcm'),canvas=byId('synthPcmCanvas');
  const context=canvas.getContext('2d'),info=byId('synthPcmSampleInfo'),rootName=byId('synthPcmRootName');
  const description=byId('synthPcmVisualizerDescription'),help=byId('synthPcmHelp'),loopButton=byId('synthPcmLoopEnabled');
  const input=byId('synthPcmAudioFile'),loadButton=byId('synthPcmLoadButton');
  const builtinButtons=[...root.querySelectorAll('[data-pcm-builtin]')],visualButtons=[...root.querySelectorAll('[data-pcm-visual-mode]')];
  const listeners=[],controls=new Map(),controlButtons=[];
  const builtins=new Map(['sine','triangle','saw','square'].map(shape=>[shape,createPcmBuiltinPreset(shape).sample]));
  let state=voice.getState(),liveDisplay=null,visualMode='sample',disposed=false,drag=null,decodedData=null,sampleBytes=null,lastDraw=null;
  const listen=(node,type,callback)=>{
    if(!node)return;
    node.addEventListener(type,callback);listeners.push(()=>node.removeEventListener(type,callback));
  };
  function clampedPatch(field,value) {
    const {settings,frames}=voice.getState();
    if(field==='loopStart')value=Math.max(0,Math.min(settings.loopEnd-1,frames-1,Math.round(value)));
    else if(field==='loopEnd')value=Math.max(settings.loopStart+1,Math.min(frames,Math.round(value)));
    return settings[field]===value?null:{[field]:value};
  }
  function change(field,value) {
    if(disposed||liveDisplay)return;
    const patch=clampedPatch(field,value);
    if(patch)onSettingsChange(patch);
    update();
  }
  for(const [field,name,max,min,category] of [
    ['volume','Volume',255,0,'level'],['panLeft','PanLeft',15,0,'level'],['panRight','PanRight',15,0,'level'],
    ['rootNote','RootNote',127,0,'frequency'],['loopStart','LoopStart',PCM_MAX_FRAMES-1,0,'frequency'],['loopEnd','LoopEnd',PCM_MAX_FRAMES,1,'frequency'],
  ]) {
    const label={volume:'PCM volume',panLeft:'PCM left pan',panRight:'PCM right pan',rootNote:'PCM root note',loopStart:'PCM loop start frame',loopEnd:'PCM end frame, exclusive'}[field];
    const control=createParamControl({label,min,max,step:1,value:state.settings[field],showLabel:false,category,onChange:value=>change(field,value)});
    control.element.classList.add('synth-pcm-number');
    byId(`synthPcm${name}Control`).replaceWith(control.element);
    const value=control.element.querySelector('.param-value');value.id=`synthPcm${name}`;
    value.title=field==='loopStart'?'Loop start frame · drag left/right.':field==='loopEnd'?'Exclusive end frame · updates shared RAM while held notes keep playing.':`${label} · drag left/right.`;
    for(const [index,button]of [...control.element.querySelectorAll('.param-button')].entries()) {
      button.dataset.pcmField=field;button.dataset.pcmStep=String(index?1:-1);
      button.setAttribute('aria-label',`${index?'Increase':'Decrease'} ${label.toLowerCase()}`);
    }
    controls.set(field,control);controlButtons.push(...control.element.querySelectorAll('button'));
    listen(value,'lostpointercapture',()=>value.classList.remove('is-dragging'));
  }
  function releaseDrag() {
    if(!drag)return;
    const {id}=drag;drag=null;canvas.classList.remove('is-dragging');
    if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
  }
  function dimensions() {return {width:canvas.width,height:canvas.height,left:28,right:12,top:21,bottom:22};}
  function drawSample() {
    if(disposed||visualMode!=='sample'||!context)return;
    if(!state.preset) {
      const message=liveDisplay?.reason||'No bounded PCM sample at this position.';
      if(lastDraw?.message===message&&lastDraw.width===canvas.width&&lastDraw.height===canvas.height)return;
      context.fillStyle='#10191a';context.fillRect(0,0,canvas.width,canvas.height);
      context.fillStyle='#b8cac6';context.font='12px sans-serif';context.textAlign='left';context.textBaseline='top';
      const words=message.split(' ');let line='',y=24;
      for(const word of words) {const next=line?line+' '+word:word;if(context.measureText(next).width>canvas.width-40&&line){context.fillText(line,20,y);y+=18;line=word;}else line=next;}
      context.fillText(line,20,y);lastDraw={message,width:canvas.width,height:canvas.height};return;
    }
    const {width,height,left,right,top,bottom}=dimensions(),{sample,settings}=state.preset;
    if(lastDraw&&lastDraw.data===sample.data&&lastDraw.start===settings.loopStart&&lastDraw.end===settings.loopEnd&&
      lastDraw.enabled===settings.loopEnabled&&lastDraw.width===width&&lastDraw.height===height)return;
    if(decodedData!==sample.data){sampleBytes=pcmSampleBytes(sample);decodedData=sample.data;}
    const frames=sampleBytes.length,w=Math.max(1,width-left-right),h=Math.max(1,height-top-bottom),middle=top+h/2;
    const x=frame=>left+frame/frames*w,y=value=>middle-value*h*.45;
    context.fillStyle='#10191a';context.fillRect(0,0,width,height);
    context.strokeStyle='#304647';context.lineWidth=1;
    for(const level of [-1,0,1]){context.beginPath();context.moveTo(left,y(level));context.lineTo(width-right,y(level));context.stroke();}
    context.fillStyle=settings.loopEnabled?'#46b6aa22':'#7e8b8a11';
    context.fillRect(x(settings.loopStart),top,Math.max(1,x(settings.loopEnd)-x(settings.loopStart)),h);
    const amplitude=byte=>(byte&127)/126*(byte&128?1:-1);
    context.strokeStyle='#83c8e6';context.lineWidth=1.5;context.beginPath();
    if(frames<=w) {
      for(let frame=0;frame<frames;frame++) {
        const px=left+frame/Math.max(1,frames-1)*w,py=y(amplitude(sampleBytes[frame]));
        if(frame)context.lineTo(px,py);else context.moveTo(px,py);
      }
    } else {
      for(let pixel=0;pixel<Math.ceil(w);pixel++) {
        const start=Math.floor(pixel/w*frames),end=Math.min(frames,Math.max(start+1,Math.floor((pixel+1)/w*frames)));
        let low=1,high=-1;
        for(let index=start;index<end;index++){const level=amplitude(sampleBytes[index]);low=Math.min(low,level);high=Math.max(high,level);}
        context.moveTo(left+pixel,y(low));context.lineTo(left+pixel,y(high));
      }
    }
    context.stroke();
    for(const [frame,color]of [[settings.loopStart,settings.loopEnabled?'#70d9b7':'#708b83'],[settings.loopEnd,'#e7af6e']]) {
      context.strokeStyle=color;context.lineWidth=2;context.beginPath();context.moveTo(x(frame),top);context.lineTo(x(frame),height-bottom);context.stroke();
    }
    context.font='11px sans-serif';context.fillStyle='#b8cac6';context.textBaseline='top';context.textAlign='left';
    context.fillText('0',left,height-bottom+5);context.textAlign='right';context.fillText(`${frames} frames`,width-right,height-bottom+5);
    context.textAlign='left';context.fillText('8-bit source PCM',left,4);
    context.textAlign='right';context.fillStyle='#e7af6e';context.fillText(`End ${settings.loopEnd}`,width-right,4);
    lastDraw={data:sample.data,start:settings.loopStart,end:settings.loopEnd,enabled:settings.loopEnabled,width,height};
  }
  function update(display=liveDisplay) {
    if(disposed)return state;
    const wasLive=Boolean(liveDisplay);liveDisplay=display;
    const next=display?{preset:display.preset,frames:display.frames,settings:display.preset?.settings??{
      volume:display.volume,panLeft:display.panLeft,panRight:display.panRight,rootNote:60,loopEnabled:false,loopStart:0,loopEnd:0}}:voice.getState();
    if(next.preset?.sample.data!==state.preset?.sample.data||wasLive!==Boolean(display))releaseDrag();
    state=next;
    for(const [field,control]of controls)control.updateVisual(display&&field==='loopStart'?display.sourceLoopStart:
      display&&field==='loopEnd'?(display.sourceEnd??'—'):state.settings[field]);
    loopButton.setAttribute('aria-pressed',String(state.settings.loopEnabled));
    loopButton.classList.toggle('is-selected',state.settings.loopEnabled);
    loopButton.textContent=display&&!state.preset?'Loop: —':state.settings.loopEnabled?'Loop: On':'Loop: Off';
    const sample=state.preset?.sample;
    for(const button of builtinButtons) {
      const builtin=builtins.get(button.dataset.pcmBuiltin),selected=Boolean(sample&&builtin?.data===sample.data&&builtin.sampleRate===sample.sampleRate);
      button.setAttribute('aria-pressed',String(selected));button.classList.toggle('is-selected',selected);
    }
    const hex=value=>Number.isInteger(value)?'$'+value.toString(16).toUpperCase().padStart(4,'0'):'—';
    const text=display?`PCM CH${display.channel+1} · ${state.frames?state.frames+' frames':'Sample unavailable'} · ${Number.isFinite(display.sampleRateHz)?display.sampleRateHz.toFixed(1)+' samples/s':'—'} · Start ${hex(display.sourceStart)} · Loop ${hex(display.sourceLoopStart)}`:
      `${sample.name} · ${state.frames} frames · ${sample.sampleRate.toFixed(1)} Hz · 8-bit mono · shared 64 KiB RAM`;
    if(info.textContent!==text)info.textContent=text;
    byId('synthPcmRootField').hidden=Boolean(display);byId('synthPcmStepField').hidden=!display;
    byId('synthPcmStep').textContent=display?String(display.step):'0';
    byId('synthPcmLoopStartLabel').textContent=display?'Loop address · RAM':'Loop Start · frame';
    byId('synthPcmLoopEndLabel').textContent=display?'End marker · RAM':'Loop End · exclusive frame';
    byId('synthPcmLoadStatus').hidden=Boolean(display)||!byId('synthPcmLoadStatus').textContent;
    const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'],note=state.settings.rootNote;
    const rootText=names[note%12]+(Math.floor(note/12)-1);
    if(rootName&&rootName.textContent!==rootText)rootName.textContent=rootText;
    for(const button of controlButtons)if(button.dataset.pcmField) {
      const field=button.dataset.pcmField,step=Number(button.dataset.pcmStep),value=state.settings[field];
      const min=field==='loopEnd'?state.settings.loopStart+1:0;
      const max=field==='volume'?255:field==='rootNote'?127:field==='loopStart'?state.settings.loopEnd-1:field==='loopEnd'?state.frames:15;
      button.disabled=step<0?value<=min:value>=max;
    }
    refreshDescription();drawSample();return state;
  }
  function refreshDescription() {
    if(description)description.textContent=visualMode==='sample'?(liveDisplay?'Recorded sample RAM · read-only.':'Sample view · drag L / E to set loop start / end.'):
      visualMode==='waveform'?'Final output waveform · after volume.':'Final output spectrum · after volume · dB.';
  }
  function chooseVisualMode(mode) {
    if(!['sample','waveform','spectrum'].includes(mode)||visualMode===mode)return;
    visualMode=mode;
    for(const button of visualButtons) {
      const selected=button.dataset.pcmVisualMode===mode;
      button.setAttribute('aria-pressed',String(selected));button.classList.toggle('is-selected',selected);
    }
    refreshDescription();
    canvas.setAttribute('aria-label',mode==='sample'?'Source PCM with loop start and end markers':mode==='waveform'?'Final output waveform':'Final output frequency spectrum');
    releaseDrag();lastDraw=null;drawSample();onVisualModeChange(mode);
  }
  for(const button of [...builtinButtons,...visualButtons,...controlButtons,loopButton,loadButton]) {
    listen(button,'pointerdown',event=>event.preventDefault());
    listen(button,'keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
    listen(button,'keyup',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
  }
  for(const button of builtinButtons)listen(button,'click',()=>{onBuiltin(button.dataset.pcmBuiltin);update();});
  for(const button of visualButtons)listen(button,'click',()=>chooseVisualMode(button.dataset.pcmVisualMode));
  listen(loopButton,'click',()=>change('loopEnabled',!voice.getState().settings.loopEnabled));
  listen(loadButton,'click',()=>{input.value='';input.click();});
  listen(input,'change',()=>{const[file]=input.files??[];input.value='';if(file)onLoad(file);});
  function dragMarker(event) {
    const rect=canvas.getBoundingClientRect(),{left,right}=dimensions(),scale=canvas.width/Math.max(1,rect.width);
    const frame=Math.round(((event.clientX-rect.left)*scale-left)/Math.max(1,canvas.width-left-right)*state.frames);
    change(drag.field,frame);
  }
  listen(canvas,'pointerdown',event=>{
    if(liveDisplay||visualMode!=='sample'||drag||event.button!==0)return;
    event.preventDefault();
    const rect=canvas.getBoundingClientRect(),{left,right}=dimensions(),scale=canvas.width/Math.max(1,rect.width);
    const frame=((event.clientX-rect.left)*scale-left)/Math.max(1,canvas.width-left-right)*state.frames;
    drag={id:event.pointerId,field:Math.abs(frame-state.settings.loopStart)<Math.abs(frame-state.settings.loopEnd)?'loopStart':'loopEnd'};
    canvas.setPointerCapture(event.pointerId);canvas.classList.add('is-dragging');dragMarker(event);
  });
  listen(canvas,'pointermove',event=>{if(drag?.id===event.pointerId){event.preventDefault();dragMarker(event);}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,type,event=>{if(drag?.id===event.pointerId)releaseDrag();});
  const summary=help?.querySelector('summary');
  listen(summary,'keydown',event=>{if([' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))event.stopPropagation();});
  listen(help,'keydown',event=>{if(event.key==='Escape'&&help.open){event.preventDefault();event.stopPropagation();help.open=false;summary.focus();}});
  listen(document,'pointerdown',event=>{if(help?.open&&!help.contains(event.target))help.open=false;});
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{
    const {width,height}=entries[0].contentRect;if(width<=0||height<=0)return;
    const w=Math.round(width),h=Math.round(height);if(canvas.width===w&&canvas.height===h)return;
    canvas.width=w;canvas.height=h;lastDraw=null;drawSample();onVisualModeChange(visualMode);
  });
  resize?.observe(canvas);update();
  return {canvas,getVisualMode:()=>visualMode,update,drawSample,dispose(){
    if(disposed)return;disposed=true;releaseDrag();resize?.disconnect();for(const remove of listeners)remove();
    if(help)help.open=false;
  }};
}
