import {createParamControl} from './synth_controls.js?v=op-gates-1';
import {PCM_MAX_FRAMES,pcmSampleBytes,createPcmBuiltinPreset} from './synth_pcm.js?v=pcm-live-draw-1';
import {createPcmWaveDraft} from './synth_pcm_wave_edit.js?v=pcm-live-draw-1';

/** Compact RF5C164 authoring controls; writes and file decoding belong to the host. */
export function setupSynthPcmControls({voice,onSettingsChange=()=>{},onBuiltin=()=>{},onLoad=()=>{},onSampleEdit=()=>{},onVisualModeChange=()=>{},onObservationEdit=()=>{}}={}) {
  if(typeof voice?.getState!=='function')throw new TypeError('PCM controls need a voice');
  for(const callback of [onSettingsChange,onBuiltin,onLoad,onSampleEdit,onVisualModeChange,onObservationEdit])if(typeof callback!=='function')throw new TypeError('PCM controls need callbacks');
  const byId=id=>document.getElementById(id),root=byId('synthChipPcm'),canvas=byId('synthPcmCanvas');
  const context=canvas.getContext('2d'),info=byId('synthPcmSampleInfo'),rootName=byId('synthPcmRootName');
  const description=byId('synthPcmVisualizerDescription'),help=byId('synthPcmHelp'),loopButton=byId('synthPcmLoopEnabled');
  const input=byId('synthPcmAudioFile'),loadButton=byId('synthPcmLoadButton');
  const builtinButtons=[...root.querySelectorAll('[data-pcm-builtin]')],visualButtons=[...root.querySelectorAll('[data-pcm-visual-mode]')];
  const editButtons=[...root.querySelectorAll('[data-pcm-edit-mode]')],editGroup=byId('synthPcmEditModeControls');
  const listeners=[],controls=new Map(),controlButtons=[];
  const builtins=new Map(['sine','triangle','saw','square'].map(shape=>[shape,createPcmBuiltinPreset(shape).sample]));
  let state=voice.getState(),liveDisplay=null,visualMode='sample',editMode='range',disposed=false,drag=null,stroke=null,decodedData=null,sampleBytes=null,lastDraw=null;
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
    if(disposed)return;
    if(liveDisplay) {
      if(liveDisplay.editable&&['volume','panLeft','panRight','step'].includes(field))onObservationEdit({[field]:value});
      return;
    }
    if(field==='step')return;
    const patch=clampedPatch(field,value);
    if(patch)onSettingsChange(patch);
    update();
  }
  for(const [field,name,max,min,category] of [
    ['volume','Volume',255,0,'level'],['panLeft','PanLeft',15,0,'level'],['panRight','PanRight',15,0,'level'],
    ['step','Step',65535,0,'frequency'],
    ['rootNote','RootNote',127,0,'frequency'],['loopStart','LoopStart',PCM_MAX_FRAMES-1,0,'frequency'],['loopEnd','LoopEnd',PCM_MAX_FRAMES,1,'frequency'],
  ]) {
    const label={volume:'PCM volume',panLeft:'PCM left pan',panRight:'PCM right pan',step:'PCM playback step',rootNote:'PCM root note',loopStart:'PCM loop start frame',loopEnd:'PCM end frame, exclusive'}[field];
    const control=createParamControl({label,min,max,step:1,value:state.settings[field]??0,showLabel:false,category,onChange:value=>change(field,value)});
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
  const sameSample=(a,b)=>Boolean(a&&b&&['data','name','sampleRate','encoding'].every(key=>a[key]===b[key]));
  function releaseStroke() {
    if(!stroke)return;
    const {id}=stroke;stroke=null;canvas.classList.remove('is-dragging');
    if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
  }
  function cancelEdit() {releaseDrag();releaseStroke();drawSample();}
  function editable() {
    return !disposed&&!liveDisplay&&visualMode==='sample'&&!canvas.inert&&!root.hidden&&
      root.closest('.synth-editor')?.getAttribute('aria-busy')!=='true';
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
      lastDraw.enabled===settings.loopEnabled&&lastDraw.width===width&&lastDraw.height===height&&
      lastDraw.editMode===editMode&&lastDraw.draftRevision===(stroke?.revision??0))return;
    if(decodedData!==sample.data){sampleBytes=pcmSampleBytes(sample);decodedData=sample.data;}
    const bytes=stroke?.draft.bytes??sampleBytes;
    const frames=bytes.length,w=Math.max(1,width-left-right),h=Math.max(1,height-top-bottom),middle=top+h/2;
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
        const px=left+frame/Math.max(1,frames-1)*w,py=y(amplitude(bytes[frame]));
        if(frame)context.lineTo(px,py);else context.moveTo(px,py);
      }
    } else {
      for(let pixel=0;pixel<Math.ceil(w);pixel++) {
        const start=Math.floor(pixel/w*frames),end=Math.min(frames,Math.max(start+1,Math.floor((pixel+1)/w*frames)));
        let low=1,high=-1;
        for(let index=start;index<end;index++){const level=amplitude(bytes[index]);low=Math.min(low,level);high=Math.max(high,level);}
        context.moveTo(left+pixel,y(low));context.lineTo(left+pixel,y(high));
      }
    }
    context.stroke();
    for(const [frame,color]of [[settings.loopStart,settings.loopEnabled?'#70d9b7':'#708b83'],[settings.loopEnd,'#e7af6e']]) {
      context.strokeStyle=color;context.lineWidth=2;context.beginPath();context.moveTo(x(frame),top);context.lineTo(x(frame),height-bottom);context.stroke();
    }
    context.font='11px sans-serif';context.fillStyle='#b8cac6';context.textBaseline='top';context.textAlign='left';
    context.fillText('0',left,height-bottom+5);context.textAlign='right';context.fillText(`${frames} frames`,width-right,height-bottom+5);
    context.textAlign='left';context.fillText(stroke?'8-bit PCM · drawing':'8-bit source PCM',left,4);
    context.textAlign='right';context.fillStyle='#e7af6e';context.fillText(`End ${settings.loopEnd}`,width-right,4);
    lastDraw={data:sample.data,start:settings.loopStart,end:settings.loopEnd,enabled:settings.loopEnabled,width,height,
      editMode,draftRevision:stroke?.revision??0};
  }
  function update(display=liveDisplay) {
    if(disposed)return state;
    const wasLive=Boolean(liveDisplay);liveDisplay=display;
    const next=display?{preset:display.preset,frames:display.frames,settings:display.preset?.settings??{
      volume:display.volume,panLeft:display.panLeft,panRight:display.panRight,rootNote:60,loopEnabled:false,loopStart:0,loopEnd:0}}:voice.getState();
    if(!sameSample(next.preset?.sample,state.preset?.sample)||wasLive!==Boolean(display)) {releaseDrag();releaseStroke();}
    state=next;
    for(const [field,control]of controls) {
      control.updateVisual(field==='step'?(display?.step??0):display&&field==='loopStart'?display.sourceLoopStart:
        display&&field==='loopEnd'?(display.sourceEnd??'—'):state.settings[field]);
      control.element.inert=display?(!display.editable||!['volume','panLeft','panRight','step'].includes(field)):field==='step';
      for(const button of control.element.querySelectorAll('button'))button.disabled=control.element.inert;
    }
    loopButton.disabled=loadButton.disabled=Boolean(display);
    loopButton.setAttribute('aria-pressed',String(state.settings.loopEnabled));
    loopButton.classList.toggle('is-selected',state.settings.loopEnabled);
    loopButton.textContent=display&&!state.preset?'Loop: —':state.settings.loopEnabled?'Loop: On':'Loop: Off';
    const sample=state.preset?.sample;
    for(const button of builtinButtons) {
      const builtin=builtins.get(button.dataset.pcmBuiltin),selected=Boolean(sample&&builtin?.data===sample.data&&builtin.sampleRate===sample.sampleRate);
      button.setAttribute('aria-pressed',String(selected));button.classList.toggle('is-selected',selected);
      button.disabled=Boolean(display);
    }
    const hex=value=>Number.isInteger(value)?'$'+value.toString(16).toUpperCase().padStart(4,'0'):'—';
    const text=display?`PCM CH${display.channel+1} · ${state.frames?state.frames+' frames':'Bounded waveform unavailable'} · ${Number.isFinite(display.sampleRateHz)?display.sampleRateHz.toFixed(1)+' samples/s':'—'} · Start ${hex(display.sourceStart)} · Loop ${hex(display.sourceLoopStart)}${display.editable?' · C4 reference step '+(display.referenceStep??display.step):''}`:
      `${sample.name} · ${state.frames} frames · ${sample.sampleRate.toFixed(1)} Hz · 8-bit mono · shared 64 KiB RAM`;
    if(info.textContent!==text)info.textContent=text;
    byId('synthPcmRootField').hidden=Boolean(display);byId('synthPcmStepField').hidden=!display;
    byId('synthPcmLoopStartLabel').textContent=display?'Loop address · RAM':'Loop Start · frame';
    byId('synthPcmLoopEndLabel').textContent=display?'End marker · RAM':'Loop End · exclusive frame';
    byId('synthPcmLoadStatus').hidden=Boolean(display)||!byId('synthPcmLoadStatus').textContent;
    const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'],note=state.settings.rootNote;
    const rootText=names[note%12]+(Math.floor(note/12)-1);
    if(rootName&&rootName.textContent!==rootText)rootName.textContent=rootText;
    for(const button of controlButtons)if(button.dataset.pcmField) {
      const field=button.dataset.pcmField,step=Number(button.dataset.pcmStep),value=field==='step'?(display?.step??0):state.settings[field];
      const min=field==='loopEnd'?state.settings.loopStart+1:0;
      const max=field==='volume'?255:field==='step'?65535:field==='rootNote'?127:field==='loopStart'?state.settings.loopEnd-1:field==='loopEnd'?state.frames:15;
      button.disabled=controls.get(field).element.inert||(step<0?value<=min:value>=max);
    }
    refreshEditMode();refreshDescription();drawSample();return state;
  }
  function refreshEditMode() {
    editGroup.hidden=visualMode!=='sample';
    for(const button of editButtons) {
      const selected=button.dataset.pcmEditMode===editMode;
      button.setAttribute('aria-pressed',String(selected));button.classList.toggle('is-selected',selected);
      button.disabled=Boolean(liveDisplay)||canvas.inert||!state.preset;
    }
    canvas.dataset.pcmTool=visualMode==='sample'&&!liveDisplay?editMode:'readonly';
    canvas.setAttribute('aria-label',visualMode==='sample'?(liveDisplay?'Recorded PCM sample, read-only':
      editMode==='draw'?'Draw source PCM waveform; release to apply':'Source PCM with loop start and end markers'):
      visualMode==='waveform'?'Final output waveform':'Final output frequency spectrum');
  }
  function refreshDescription() {
    if(description)description.textContent=visualMode==='sample'?(liveDisplay?'Recorded sample RAM · read-only.':
      editMode==='draw'?'Draw · software wave editing · release to apply; held notes keep playing.':'Sample view · drag L / E to set loop start / end.'):
      visualMode==='waveform'?'Final output waveform · after volume.':'Final output spectrum · after volume · dB.';
  }
  function chooseEditMode(mode) {
    if(!['range','draw'].includes(mode)||editMode===mode||liveDisplay||canvas.inert)return;
    cancelEdit();editMode=mode;refreshEditMode();refreshDescription();drawSample();
  }
  function chooseVisualMode(mode) {
    if(!['sample','waveform','spectrum'].includes(mode)||visualMode===mode)return;
    visualMode=mode;
    for(const button of visualButtons) {
      const selected=button.dataset.pcmVisualMode===mode;
      button.setAttribute('aria-pressed',String(selected));button.classList.toggle('is-selected',selected);
    }
    refreshDescription();
    releaseDrag();releaseStroke();refreshEditMode();lastDraw=null;drawSample();onVisualModeChange(mode);
  }
  for(const button of [...builtinButtons,...visualButtons,...editButtons,...controlButtons,loopButton,loadButton]) {
    listen(button,'pointerdown',event=>event.preventDefault());
    listen(button,'keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
    listen(button,'keyup',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
  }
  for(const button of builtinButtons)listen(button,'click',()=>{onBuiltin(button.dataset.pcmBuiltin);update();});
  for(const button of visualButtons)listen(button,'click',()=>chooseVisualMode(button.dataset.pcmVisualMode));
  for(const button of editButtons) {
    listen(button,'pointerdown',()=>document.activeElement?.blur());
    listen(button,'click',()=>chooseEditMode(button.dataset.pcmEditMode));
  }
  listen(loopButton,'click',()=>change('loopEnabled',!voice.getState().settings.loopEnabled));
  listen(loadButton,'click',()=>{input.value='';input.click();});
  listen(input,'change',()=>{const[file]=input.files??[];input.value='';if(file)onLoad(file);});
  function dragMarker(event) {
    const rect=canvas.getBoundingClientRect(),{left,right}=dimensions(),scale=canvas.width/Math.max(1,rect.width);
    const frame=Math.round(((event.clientX-rect.left)*scale-left)/Math.max(1,canvas.width-left-right)*state.frames);
    change(drag.field,frame);
  }
  function moveStroke(event) {
    if(stroke?.id!==event.pointerId)return;
    if(!editable()) {cancelEdit();return;}
    const rect=canvas.getBoundingClientRect(),{left,right,top,bottom}=dimensions();
    const x=(event.clientX-rect.left)*canvas.width/Math.max(1,rect.width),y=(event.clientY-rect.top)*canvas.height/Math.max(1,rect.height);
    const w=Math.max(1,canvas.width-left-right),h=Math.max(1,canvas.height-top-bottom);
    stroke.draft.setPoint({index:Math.round(Math.max(0,Math.min(1,(x-left)/w))*(stroke.draft.bytes.length-1)),
      value:Math.max(-1,Math.min(1,(top+h/2-y)/(h*.45)))});
    stroke.revision++;drawSample();
  }
  listen(canvas,'pointerdown',event=>{
    if(!editable()||drag||stroke||event.button!==0)return;
    event.preventDefault();document.activeElement?.blur();
    if(editMode==='draw') {
      stroke={id:event.pointerId,draft:createPcmWaveDraft(state.preset),source:{...state.preset.sample},revision:0};
      canvas.setPointerCapture(event.pointerId);canvas.classList.add('is-dragging');moveStroke(event);return;
    }
    const rect=canvas.getBoundingClientRect(),{left,right}=dimensions(),scale=canvas.width/Math.max(1,rect.width);
    const frame=((event.clientX-rect.left)*scale-left)/Math.max(1,canvas.width-left-right)*state.frames;
    drag={id:event.pointerId,field:Math.abs(frame-state.settings.loopStart)<Math.abs(frame-state.settings.loopEnd)?'loopStart':'loopEnd'};
    canvas.setPointerCapture(event.pointerId);canvas.classList.add('is-dragging');dragMarker(event);
  });
  listen(canvas,'pointermove',event=>{
    if(drag?.id===event.pointerId){event.preventDefault();dragMarker(event);}
    else if(stroke?.id===event.pointerId){event.preventDefault();moveStroke(event);}
  });
  listen(canvas,'pointerup',event=>{
    if(drag?.id===event.pointerId)releaseDrag();
    if(stroke?.id!==event.pointerId)return;
    const current=voice.getState().preset;
    if(!editable()||!sameSample(stroke.source,current?.sample)){cancelEdit();update();return;}
    moveStroke(event);
    const next=stroke.draft.finish(current);releaseStroke();
    if(next)onSampleEdit(next);
    update();
  });
  for(const type of ['pointercancel','lostpointercapture'])listen(canvas,type,event=>{
    if(drag?.id===event.pointerId)releaseDrag();
    if(stroke?.id===event.pointerId){releaseStroke();drawSample();}
  });
  listen(window,'blur',cancelEdit);
  listen(document,'visibilitychange',()=>{if(document.hidden)cancelEdit();});
  listen(document,'keydown',event=>{if(event.key==='Escape'&&stroke){event.preventDefault();event.stopPropagation();cancelEdit();}});
  const summary=help?.querySelector('summary');
  listen(summary,'keydown',event=>{if([' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))event.stopPropagation();});
  listen(help,'keydown',event=>{if(event.key==='Escape'&&help.open){event.preventDefault();event.stopPropagation();help.open=false;summary.focus();}});
  listen(document,'pointerdown',event=>{if(help?.open&&!help.contains(event.target))help.open=false;});
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{
    const {width,height}=entries[0].contentRect;if(width<=0||height<=0)return;
    const w=Math.round(width),h=Math.round(height);if(canvas.width===w&&canvas.height===h)return;
    releaseDrag();releaseStroke();canvas.width=w;canvas.height=h;lastDraw=null;drawSample();onVisualModeChange(visualMode);
  });
  const editObserver=typeof MutationObserver==='undefined'?null:new MutationObserver(()=>{
    if(canvas.inert||root.hidden)cancelEdit();refreshEditMode();
  });
  editObserver?.observe(canvas,{attributes:true,attributeFilter:['inert']});
  editObserver?.observe(root,{attributes:true,attributeFilter:['hidden']});
  resize?.observe(canvas);update();
  return {canvas,getVisualMode:()=>visualMode,getEditMode:()=>editMode,cancelEdit,update,drawSample,dispose(){
    if(disposed)return;disposed=true;releaseDrag();releaseStroke();resize?.disconnect();editObserver?.disconnect();for(const remove of listeners)remove();
    if(help)help.open=false;
  }};
}
