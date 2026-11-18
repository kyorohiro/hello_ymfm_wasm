// SPDX-License-Identifier: BSD-3-Clause
import {createTestCycle,generateTestPcmWav} from './test_pcm.js?v=huc-media-tools-1';

/** Software PCM authoring. A bounded latest-only preview updates the current
 * source; portable WAV writes happen automatically after a gesture. */
export function setupTestPcmControls({root,id,title,saveWave,loadWave,previewWave,onStatus=()=>{}}){
  const doc=root.ownerDocument,win=doc.defaultView??globalThis,listeners=[];
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  const details=make('details');details.className='huc-test-pcm';details.open=true;
  details.append(make('summary','Test waveform · Software PCM'));
  const canvas=make('canvas');canvas.width=768;canvas.height=150;canvas.id=id+'TestCycle';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+' test cycle; draw with mouse or touch');
  details.append(canvas);
  const shapes=make('div');shapes.className='huc-test-pcm-actions';
  let cycle=createTestCycle(),shape='sine',revision=0,loaded=-1,saved=-1,path=null,serial=0,controller=null,disposed=false,drag=null;
  let timer=null,running=null,pending=null,initialized=false,defaultRevision=-1;
  const clearPreviewTimer=()=>{if(timer!==null){win.clearTimeout(timer);timer=null;}};
  const buttons=[];
  for(const value of ['sine','triangle','saw','square']){
    const button=make('button',value[0].toUpperCase()+value.slice(1));button.type='button';button.dataset.testShape=value;shapes.append(button);buttons.push([button,value]);
    listen(button,'click',()=>{button.blur();cycle=createTestCycle(value);shape=value;changed();requestLoad();});
  }
  details.append(shapes);
  const parameters=make('div');parameters.className='huc-test-pcm-parameters';
  function parameter(name,label,min,max,step,value,format){
    const wrapper=make('label'),input=make('input'),output=make('output');
    input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value);input.id=id+'Test'+name;input.setAttribute('aria-label',title+' test '+label.toLowerCase());
    wrapper.append(make('span',label),input,output);parameters.append(wrapper);
    const render=()=>{output.textContent=format(Number(input.value));};render();
    listen(input,'input',()=>{render();changed(false);requestPreview();});
    listen(input,'change',()=>{input.blur();requestLoad();});
    return {input,render};
  }
  const frequency=parameter('Frequency','Frequency',20,4000,1,440,n=>`${n.toLocaleString()} Hz`);
  const level=parameter('Level','PCM level',0,1,.01,.5,n=>`${Math.round(n*100)}%`);
  const duration=parameter('Duration','Length',.1,4,.1,1,n=>`${n.toFixed(1)} s`);
  details.append(parameters);
  const actions=make('div');actions.className='huc-test-pcm-actions';
  const smooth=make('input');smooth.type='checkbox';smooth.checked=true;smooth.id=id+'TestSmooth';
  const smoothing=make('label');smoothing.className='huc-check';smoothing.append(smooth,make('span','Smooth edges'));actions.append(smoothing);details.append(actions);
  const state=make('p');state.id=id+'TestStatus';state.className='huc-help';state.setAttribute('role','status');details.append(state);
  const help=make('details');help.className='spu-code-help';help.append(make('summary','?'),make('p',
    'Software creates a standard 44.1 kHz stereo PCM16 WAV; use Keyboard or Play to hear it. Drawing edits one cycle, then frequency repeats it. All edits apply automatically, using short faded sample replacements; they never start idle playback and are not phase-continuous oscillator controls. Updates are coalesced while ADPCM is prepared. The WAV is saved in Files after the gesture and included in Cassette exports. Smooth edges fades the first/last 5 ms; disable for seamless periodic loops. Repeated saves reuse this editor’s WAV while it remains unchanged. MSM5205 converts this PCM to four-bit ADPCM at the selected Rate; CD-DA plays PCM directly. These are software test sources, not extra hardware oscillators.'));
  details.append(help);root.append(details);
  const ctx=canvas.getContext('2d');
  function draw(){
    if(!ctx||disposed)return;
    const rect=canvas.getBoundingClientRect(),width=Math.max(240,Math.round(rect.width||768)),height=150,scale=Math.min(2,win.devicePixelRatio||1);
    canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.setTransform(scale,0,0,scale,0,0);
    ctx.fillStyle='#192128';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#526069';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(12,height/2);ctx.lineTo(width-12,height/2);ctx.stroke();
    ctx.strokeStyle='#78c9ed';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<=cycle.length;i++){const x=12+i/cycle.length*(width-24),y=height/2-cycle[i%cycle.length]*(height/2-12);i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();
    canvas.dataset.revision=String(revision);canvas.dataset.shape=shape;
  }
  function render(){
    const dirty=revision!==loaded||revision!==saved&&revision!==defaultRevision;
    root.dataset.dirty=String(dirty);root.dataset.loading=String(Boolean(controller));
    for(const [button,value]of buttons)button.setAttribute('aria-pressed',String(shape===value));
  }
  function changed(redraw=true){
    revision++;
    // A newer gesture supersedes a queued old gesture's save, not an update
    // already being applied. The single worker drains only the latest request.
    if(pending){pending.resolve(false);pending=null;}
    state.textContent='Changed · applies automatically; saves after the gesture.';state.dataset.error='false';render();if(redraw)draw();
  }
  function requestPreview(){
    if(disposed||timer!==null)return;
    timer=win.setTimeout(()=>{timer=null;void request(false);},120);
  }
  function requestLoad(){if(!drag)void request(true);}
  function request(persist,initial=false){
    if(disposed)return Promise.resolve(false);
    if(persist)clearPreviewTimer();
    pending?.resolve(false);
    const result=new Promise(resolve=>{pending={persist,initial,version:revision,token:serial,resolve,
      settings:{cycle:new Float32Array(cycle),frequency:Number(frequency.input.value),level:Number(level.input.value),duration:Number(duration.input.value),smoothEdges:smooth.checked},
      name:`${title} ${shape==='drawn'?'drawn':shape} · ${Number(frequency.input.value)} Hz`};});
    drain();return result;
  }
  async function drain(){
    if(running||!pending||disposed)return;
    const item=running=pending;pending=null;
    const current=new AbortController();controller=current;render();
    const valid=()=>!disposed&&item.token===serial&&!current.signal.aborted;
    let success=false;
    try{
      const bytes=generateTestPcmWav(item.settings);
      if(item.persist){const savedPath=await saveWave(bytes,{signal:current.signal});if(!valid())return;path=savedPath;saved=item.version;}
      if(!valid())return;
      const applied=await (previewWave??loadWave)(bytes,{...(path?{path}:{}),name:item.name,signal:current.signal});
      if(!valid()||applied===false)return;
      loaded=item.version;success=true;
      if(item.initial)defaultRevision=item.version;
      if(item.version===revision){
        state.textContent=item.initial?'Default Sine ready · use Keyboard or Play. Edits apply automatically.':item.persist?`Loaded ${path.slice(1)} · use Keyboard or Play. Saved in Files and Cassette.`:'Live test waveform updated · use Keyboard or Play. WAV saves after the gesture.';
        state.dataset.error='false';
        if(item.persist)onStatus(`${title} test WAV loaded · Keyboard or Play. Saved in Files and Cassette.`);
      }
    }catch(error){
      if(valid()&&item.version===revision&&error?.name!=='AbortError'){state.textContent=error.message+' · Adjust a control to retry.';state.dataset.error='true';onStatus(title+': '+error.message,true);}
    }finally{
      item.resolve(success);if(running===item)running=null;if(controller===current)controller=null;
      if(!disposed){render();drain();}
    }
  }
  const load=()=>request(true);
  function cancelUpdates(){
    clearPreviewTimer();
    if(pending){pending.resolve(false);pending=null;}
    controller?.abort();
  }
  listen(smooth,'change',()=>{smooth.blur();changed(false);requestLoad();});
  function point(event){const r=canvas.getBoundingClientRect();return{index:Math.round(Math.max(0,Math.min(1,(event.clientX-r.left-12)/(r.width-24)))*(cycle.length-1)),value:Math.max(-1,Math.min(1,(r.height/2-(event.clientY-r.top))/(r.height/2-12)))};}
  listen(canvas,'pointerdown',event=>{if(event.button!==0||disposed)return;event.preventDefault();doc.activeElement?.blur?.();const p=point(event);drag={id:event.pointerId,...p};canvas.setPointerCapture?.(event.pointerId);cycle[p.index]=p.value;shape='drawn';changed();requestPreview();});
  listen(canvas,'pointermove',event=>{
    if(drag?.id!==event.pointerId)return;const p=point(event),start=drag.index,end=p.index,steps=Math.abs(end-start);
    for(let i=0;i<=steps;i++){const k=steps?i/steps:1,index=Math.round(start+(end-start)*k);cycle[index]=drag.value+(p.value-drag.value)*k;}
    drag={id:drag.id,...p};changed();requestPreview();
  });
  function endDrag(event,applyAfter){
    if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.id)return;const pointer=drag.id;drag=null;if(canvas.hasPointerCapture?.(pointer))canvas.releasePointerCapture(pointer);if(applyAfter)requestLoad();else cancelUpdates();
  }
  listen(canvas,'pointerup',event=>endDrag(event,true));
  for(const type of ['pointercancel','lostpointercapture'])listen(canvas,type,event=>endDrag(event,false));
  listen(win,'blur',event=>{endDrag(event,false);cancelUpdates();});
  const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(draw):null;resize?.observe(canvas);
  state.textContent='Choose a shape or adjust a control · edits apply automatically. Use Keyboard or Play to hear them.';render();draw();
  return{
    load,
    initialize(){
      if(initialized||disposed||revision!==0||loaded!==-1||timer!==null||running||pending)return Promise.resolve(false);
      initialized=true;return request(false,true);
    },
    cancel({reset=false}={}){
      serial++;clearPreviewTimer();pending?.resolve(false);pending=null;controller?.abort();controller=null;endDrag(null,false);
      if(reset){cycle=createTestCycle();shape='sine';revision=0;loaded=saved=defaultRevision=-1;path=null;frequency.input.value='440';level.input.value='.5';duration.input.value='1';smooth.checked=true;for(const value of [frequency,level,duration])value.render();state.textContent='New test waveform · choose a shape or adjust a control. Edits apply automatically.';draw();}
      if(!disposed)render();
    },
    dispose(){if(disposed)return;this.cancel();disposed=true;resize?.disconnect();for(const remove of listeners)remove();details.remove();},
  };
}
