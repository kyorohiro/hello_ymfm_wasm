// SPDX-License-Identifier: BSD-3-Clause
import {createTestCycle,generateTestPcmWav} from './test_pcm.js?v=huc-media-tools-1';

/** Software PCM authoring. Drawing only changes a short local cycle; source
 * replacement happens at gesture end/change, never inside pointermove. */
export function setupTestPcmControls({root,id,title,saveWave,loadWave,onStatus=()=>{}}){
  const doc=root.ownerDocument,win=doc.defaultView??globalThis,listeners=[];
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  const details=make('details');details.className='huc-test-pcm';details.open=true;
  details.append(make('summary','Test waveform · Software PCM'));
  const canvas=make('canvas');canvas.width=768;canvas.height=150;canvas.id=id+'TestCycle';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+' test cycle; draw with mouse or touch');
  details.append(canvas);
  const shapes=make('div');shapes.className='huc-test-pcm-actions';
  let cycle=createTestCycle(),shape='sine',revision=0,loaded=-1,serial=0,controller=null,disposed=false,drag=null;
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
    listen(input,'input',()=>{render();changed(false);});
    listen(input,'change',()=>{input.blur();requestLoad();});
    return {input,render};
  }
  const frequency=parameter('Frequency','Frequency',20,4000,1,440,n=>`${n.toLocaleString()} Hz`);
  const level=parameter('Level','PCM level',0,1,.01,.5,n=>`${Math.round(n*100)}%`);
  const duration=parameter('Duration','Length',.1,4,.1,1,n=>`${n.toFixed(1)} s`);
  details.append(parameters);
  const actions=make('div');actions.className='huc-test-pcm-actions';
  const auto=make('input'),smooth=make('input');auto.type=smooth.type='checkbox';auto.checked=smooth.checked=true;
  auto.id=id+'TestAuto';smooth.id=id+'TestSmooth';
  for(const [input,label]of [[auto,'Auto load'],[smooth,'Smooth edges']]){const wrapper=make('label');wrapper.className='huc-check';wrapper.append(input,make('span',label));actions.append(wrapper);}
  const apply=make('button','Load test wave');apply.id=id+'TestLoad';apply.type='button';apply.className='primary';actions.append(apply);details.append(actions);
  const state=make('p');state.id=id+'TestStatus';state.className='huc-help';state.setAttribute('role','status');details.append(state);
  const help=make('details');help.className='spu-code-help';help.append(make('summary','?'),make('p',
    'Software creates a standard 44.1 kHz stereo PCM16 WAV in Files; use Play below to hear it. Drawing edits one cycle, then frequency repeats it. Auto load applies changes after release; it never starts playback. Smooth edges fades the first/last 5 ms; disable for seamless periodic loops. Repeated loads reuse this editor’s WAV while it remains unchanged. The file is included in Cassette exports. MSM5205 converts this PCM to four-bit ADPCM at the selected Rate; CD-DA plays PCM directly. These are software test sources, not extra hardware oscillators.'));
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
    const dirty=revision!==loaded;
    root.dataset.dirty=String(dirty);root.dataset.loading=String(Boolean(controller));
    apply.classList.toggle('is-pcm-pending',dirty);apply.textContent=controller?'Loading…':dirty?'Load test wave':'Reload test wave';
    for(const [button,value]of buttons)button.setAttribute('aria-pressed',String(shape===value));
  }
  function changed(redraw=true){revision++;state.textContent=auto.checked?'Changed · loads after the gesture.':'Unapplied test waveform · press Load test wave.';state.dataset.error='false';render();if(redraw)draw();}
  function requestLoad(){if(auto.checked&&!drag)void load();}
  async function load(){
    if(disposed)return false;controller?.abort();const current=new AbortController(),token=++serial,version=revision;controller=current;render();
    try{
      const settings={cycle:new Float32Array(cycle),frequency:Number(frequency.input.value),level:Number(level.input.value),duration:Number(duration.input.value),smoothEdges:smooth.checked},name=`${title} ${shape==='drawn'?'drawn':shape} · ${Number(frequency.input.value)} Hz`;
      const bytes=generateTestPcmWav(settings),path=await saveWave(bytes,{signal:current.signal});
      if(disposed||token!==serial||current.signal.aborted)return false;
      await loadWave(bytes,{path,name,signal:current.signal});
      if(disposed||token!==serial||current.signal.aborted)return false;
      loaded=version;state.textContent=`Loaded ${path.slice(1)} · press Play below. Changes stop only this sample player.`;state.dataset.error='false';
      onStatus(`${title} test WAV loaded · press Play. Saved in Files and Cassette.`);return true;
    }catch(error){
      if(!disposed&&token===serial&&error?.name!=='AbortError'){state.textContent=error.message;state.dataset.error='true';onStatus(title+': '+error.message,true);}return false;
    }finally{if(token===serial){controller=null;if(!disposed)render();}}
  }
  listen(apply,'click',()=>{apply.blur();void load();});
  listen(auto,'change',()=>{auto.blur();if(auto.checked&&revision!==loaded)requestLoad();});
  listen(smooth,'change',()=>{smooth.blur();changed(false);requestLoad();});
  function point(event){const r=canvas.getBoundingClientRect();return{index:Math.round(Math.max(0,Math.min(1,(event.clientX-r.left-12)/(r.width-24)))*(cycle.length-1)),value:Math.max(-1,Math.min(1,(r.height/2-(event.clientY-r.top))/(r.height/2-12)))};}
  listen(canvas,'pointerdown',event=>{if(event.button!==0||disposed)return;event.preventDefault();doc.activeElement?.blur?.();const p=point(event);drag={id:event.pointerId,...p};canvas.setPointerCapture?.(event.pointerId);cycle[p.index]=p.value;shape='drawn';changed();});
  listen(canvas,'pointermove',event=>{
    if(drag?.id!==event.pointerId)return;const p=point(event),start=drag.index,end=p.index,steps=Math.abs(end-start);
    for(let i=0;i<=steps;i++){const k=steps?i/steps:1,index=Math.round(start+(end-start)*k);cycle[index]=drag.value+(p.value-drag.value)*k;}
    drag={id:drag.id,...p};changed();
  });
  function endDrag(event,applyAfter){
    if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.id)return;const pointer=drag.id;drag=null;if(canvas.hasPointerCapture?.(pointer))canvas.releasePointerCapture(pointer);if(applyAfter)requestLoad();
  }
  listen(canvas,'pointerup',event=>endDrag(event,true));
  for(const type of ['pointercancel','lostpointercapture'])listen(canvas,type,event=>endDrag(event,false));
  listen(win,'blur',event=>endDrag(event,false));
  const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(draw):null;resize?.observe(canvas);
  state.textContent='Choose a shape or draw a cycle, then use Play below. Software PCM; nothing plays automatically.';render();draw();
  return{
    load,
    cancel({reset=false}={}){
      serial++;controller?.abort();controller=null;endDrag(null,false);
      if(reset){cycle=createTestCycle();shape='sine';revision=0;loaded=-1;frequency.input.value='440';level.input.value='.5';duration.input.value='1';auto.checked=smooth.checked=true;for(const value of [frequency,level,duration])value.render();state.textContent='New test waveform · choose a shape or press Load test wave.';draw();}
      if(!disposed)render();
    },
    dispose(){if(disposed)return;this.cancel();disposed=true;resize?.disconnect();for(const remove of listeners)remove();details.remove();},
  };
}
