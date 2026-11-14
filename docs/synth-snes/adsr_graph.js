// SPDX-License-Identifier: BSD-3-Clause
// Schematic rate-code coordinates, deliberately not elapsed-time or live ENVX.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function adsrGraphLayout(envelope){
 const attack={x:.1+.22*(1-envelope.attack/15),y:.14};
 const level=(envelope.sustainLevel+1)/8;
 const decay={x:attack.x+.18+.14*(1-envelope.decay/7),y:.88-.74*level};
 const sustain={x:decay.x+.18+.12*(1-envelope.sustainRate/31),y:.88-.74*level*(1-envelope.sustainRate/31)};
 return {attack,decay,sustain,release:{x:.98,y:.88}};
}
export function adsrGraphEdit(handle,x,y,envelope){
 const layout=adsrGraphLayout(envelope);
 if(handle==='attack')return {attack:clamp(Math.round((1-(x-.1)/.22)*15),0,15)};
 if(handle==='decay')return {decay:clamp(Math.round((1-(x-layout.attack.x-.18)/.14)*7),0,7),sustainLevel:clamp(Math.round((.88-y)/.74*8-1),0,7)};
 if(handle==='sustain')return {sustainRate:clamp(Math.round((1-(x-layout.decay.x-.18)/.12)*31),0,31)};
 throw new RangeError('Unknown ADSR graph handle');
}
/** The same passive view and gestures are used for Auto and SPC voices. */
export function createAdsrGraph({root,onChange=()=>{}}){
 const doc=root.ownerDocument,win=doc.defaultView??globalThis,cleanups=[],buttons=new Map();let state=null,drag=null,disposed=false;
 const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const listen=(node,type,fn)=>{node.addEventListener(type,fn);cleanups.push(()=>node.removeEventListener(type,fn));};
 root.className='sdsp-adsr-graph';root.id='adsrGraph';root.setAttribute('role','group');root.setAttribute('aria-label','ADSR envelope graph');
 const plot=make('div');plot.className='sdsp-adsr-plot';plot.id='adsrGraphPlot';root.append(plot);
 const svg=(tag,attrs)=>{const node=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
 const canvas=svg('svg',{viewBox:'0 0 1000 240',preserveAspectRatio:'none',role:'img','aria-label':'ADSR shape guide; rate-code spacing, not elapsed time'});plot.append(canvas);
 for(const [y,label]of [[.14,'1'],[.51,'½'],[.88,'0']]){canvas.append(svg('path',{d:`M 28 ${y*240} H 984`,class:'sdsp-adsr-grid'}));const text=svg('text',{x:4,y:y*240+4});text.textContent=label;canvas.append(text);}
 const path=svg('path',{id:'adsrEnvelopePath',class:'sdsp-adsr-curve',fill:'none'});canvas.append(path);
 const release=make('span','R · fixed');release.className='sdsp-adsr-release';release.title='Hardware KOFF release has a fixed slope.';plot.append(release);
 const help=make('p');help.id='adsrGraphHelp';help.className='sdsp-help';root.append(help);
 function stopDrag(){if(!drag)return;const {button,id}=drag;drag=null;button.classList.remove('is-dragging');if(button.hasPointerCapture?.(id))button.releasePointerCapture(id);}
 function apply(changes){if(!state||state.disabled||disposed)return;const changed=Object.fromEntries(Object.entries(changes).filter(([key,value])=>value!==state.envelope[key]));if(Object.keys(changed).length)onChange(changed);}
 function move(event){if(!drag||drag.id!==event.pointerId)return;const rect=plot.getBoundingClientRect();if(!rect.width||!rect.height)return;apply(adsrGraphEdit(drag.handle,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height,state.envelope));}
 for(const handle of ['attack','decay','sustain']){
  const button=make('button');button.type='button';button.id='adsrGraph-'+handle;button.dataset.adsrHandle=handle;button.className='sdsp-adsr-handle';button.setAttribute('aria-describedby','adsrGraphHelp');
  if(handle!=='decay'){button.setAttribute('role','slider');button.setAttribute('aria-valuemin','0');button.setAttribute('aria-valuemax',handle==='attack'?'15':'31');}
  plot.append(button);buttons.set(handle,button);
  listen(button,'pointerdown',event=>{if(event.button!==0||!state||state.disabled)return;event.preventDefault();button.focus({preventScroll:true});drag={button,id:event.pointerId,handle};button.classList.add('is-dragging');button.setPointerCapture(event.pointerId);});
  listen(button,'pointermove',move);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(button,type,event=>{if(drag?.id===event.pointerId)stopDrag();});
  listen(button,'keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stopDrag();return;}
   if(event.key===' '||event.key==='Enter'){event.preventDefault();event.stopPropagation();return;}
   if(!state||state.disabled||event.ctrlKey||event.metaKey||event.altKey)return;
   const e=state.envelope,level=handle==='decay'&&['ArrowUp','ArrowDown'].includes(event.key),key=level?'sustainLevel':handle==='attack'?'attack':handle==='decay'?'decay':'sustainRate',maximum=key==='attack'?15:key==='sustainRate'?31:7;
   const delta={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:10,PageDown:-10}[event.key];
   if(delta===undefined&&!['Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();
   apply({[key]:event.key==='Home'?0:event.key==='End'?maximum:clamp(e[key]+delta*(event.shiftKey?10:1),0,maximum)});
  });
 }
 listen(win,'blur',stopDrag);listen(doc,'visibilitychange',()=>{if(doc.hidden)stopDrag();});
 function update(next){
  if(disposed)return;if(state&&(state.owner!==next.owner||next.disabled))stopDrag();state=next;
  const e=next.envelope,p=adsrGraphLayout(e),point=p=>`${p.x*1000} ${p.y*240}`;
  root.setAttribute('aria-disabled',String(next.disabled));root.dataset.mode=e.mode;
  path.setAttribute('d',`M 28 211.2 L ${point(p.attack)} C ${p.attack.x*1000+30} 33.6 ${p.decay.x*1000-30} ${p.decay.y*240} ${point(p.decay)} L ${point(p.sustain)} L ${point(p.release)}`);
  for(const [handle,button]of buttons){button.style.left=`${p[handle].x*100}%`;button.style.top=`${p[handle].y*100}%`;button.disabled=next.disabled;
   const value=handle==='attack'?e.attack:handle==='decay'?e.decay:e.sustainRate;
   button.textContent=handle==='attack'?`A ${value}`:handle==='decay'?`D ${value} / L ${e.sustainLevel}`:`S ${value}`;
   const label=handle==='attack'?`Attack code ${value}`:handle==='decay'?`Decay code ${value}, sustain level code ${e.sustainLevel}`:`Sustain rate code ${value}`;button.setAttribute('aria-label',label);button.title=label;
   if(handle!=='decay'){button.setAttribute('aria-valuenow',String(value));button.setAttribute('aria-valuetext',label);}
  }
  help.textContent=(e.mode==='gain'?'ADSR is inactive in GAIN mode. ':'')+'Shape guide · not a time scale or live envelope level. Drag points; arrows change codes, D/L ↑↓ changes level. Release is fixed.';
 }
 return{update,cancel:stopDrag,dispose(){disposed=true;stopDrag();for(const cleanup of cleanups)cleanup();root.replaceChildren();}};
}
