// SPDX-License-Identifier: BSD-3-Clause
import {createBankWave,drawLoopRegion} from './bank-wave.js';
import {createParamControl} from '../synth/synth_controls.js';


export function createWaveEditor(onEdit,itemFor,getRom,isFull) {
  const canvas = document.getElementById('pcm-wave');
  const ctx = canvas.getContext('2d');
  const caption = document.getElementById('pcm-caption');
  const paintBank=createBankWave(canvas);
  const controls = {};
  for (const [key,label,max] of [['rate','Rate',65535],['end','End',256],['loop','Loop length',256]]) {
    controls[key] = createParamControl({label,min:0,max,step:1,value:0,directEntry:true,coarseDragSteps:256,dragPixelsPerStep:4,
      formatValue:key==='end'?n=>'0x'+n.toString(16).toUpperCase().padStart(4,'0'):String,
      onChange:value=>onEdit(key,value)});
    document.getElementById('pcm-controls').append(controls[key].element);
  }
  let previous = '';
  let editRange, drag;
  const edges=['start','end','loop'];
  const grips=edges.map(edge=>{
    const grip=document.createElement('span');
    grip.className='wave-grip';grip.dataset.edge=edge;
    grip.textContent=edge[0].toUpperCase()+edge.slice(1);
    grip.title='Drag to adjust '+edge;
    canvas.parentElement.append(grip);
    return grip;
  });
  canvas.style.touchAction='none';
  function edgeAddress(range,edge){
    return edge==='loop'?range.end-range.loop:range[edge];
  }
  function move(event){
    if(!drag || event.pointerId!==drag.id)return;
    const {range,edge}=drag;
    const delta=(event.clientX-drag.x)*range.span/canvas.getBoundingClientRect().width;
    const address=Math.round(drag.initial+delta);
    if(edge==='start'){
      const start=Math.max(0,Math.min(range.end-1,address));
      if(range.loop>range.end-start)onEdit('loop',range.end-start);
      onEdit('start',start);
    }else if(edge==='end'){
      const end=Math.max(range.start+1,Math.min(range.maxEnd,address));
      if(range.loop>end-range.start)onEdit('loop',end-range.start);
      onEdit('end',end);
    }else onEdit('loop',Math.max(0,Math.min(range.end-range.start,range.end-address)));
  }
  for(const target of [canvas,...grips]){
    target.onpointerdown=event=>{
      if(!editRange || event.button!==0 || drag)return;
      const box=canvas.getBoundingClientRect();
      const byte=editRange.origin+(event.clientX-box.left)*editRange.span/box.width;
      const edge=target.dataset.edge??edges.reduce((a,b)=>
        Math.abs(byte-edgeAddress(editRange,a))<=Math.abs(byte-edgeAddress(editRange,b))?a:b);
      drag={id:event.pointerId,range:editRange,edge,x:event.clientX,
        initial:target===canvas?byte:edgeAddress(editRange,edge)};
      target.setPointerCapture(event.pointerId);event.preventDefault();
      if(target===canvas)move(event);
    };
    target.onpointermove=move;
    target.onlostpointercapture=()=>{drag=null;};
  }
  let previousItem,previousRom;
  return function draw(voice, address = null, view = null) {
    const rom=getRom();
    const {sample,rate,end,loop}=voice,item=view?null:itemFor(voice);
    const full=isFull(), bank=view?.bank??item?.bank??voice.bank??0;
    const signature = [full,sample,voice.start,voice.bank,rate,end,loop,address].join(',');
    if (!view && signature === previous && previousItem===item && previousRom===rom) return;
    previousItem=item;previousRom=rom;
    previous = view ? null : signature;
    const start = view?.start ?? item?.start ?? voice.start ?? sample * 256, span=view?.span ?? (((end-start)&65535)||65536), {width,height} = canvas;
    const size=Math.max(0,Math.min(65536,rom.length-bank*65536));
    const maxEnd=Math.min(65535,size,item?item.start+item.length:65535);
    editRange=start>=end || end>maxEnd?null:{start,origin:full?0:start,span:full?size:span,end,loop,maxEnd};
    for(const grip of grips){
      grip.hidden=!editRange;
      if(editRange)grip.style.setProperty('--position',100*(edgeAddress(editRange,grip.dataset.edge)-editRange.origin)/editRange.span+'%');
    }
    controls.end.updateRange(view||!item?0:start+1,view||!item?65535:item.start+item.length);
    controls.loop.updateRange(0,view||!item?65535:end-start);
    controls.rate.updateVisual(rate);
    controls.end.updateVisual(end);
    controls.loop.updateVisual(loop);
    caption.textContent='ROM bank '+bank+' · Loop '+((end-loop)&65535)+'–'+end+' (end exclusive) · Position '+(address ?? '—');
    canvas.setAttribute('aria-label',full?'Full PCM bank with selected range':'Selected PCM waveform with loop region');
    if(full){paintBank(rom,bank*65536,'PCM',start,end,address,loop);return;}
    ctx.clearRect(0,0,width,height);
    if(start===end && !loop)return;
    const x = byte => (byte-start)*width/span;
    const boundary=view ? start+span : end;
    ctx.strokeStyle = '#afeacb';
    ctx.beginPath();
    for (let i=0;i<256;i++) {
      const signedByte = (view?view.wave[i]:item?item.pcm[Math.floor(i*span/256)]:rom[(voice.bank??0)*65536+((start+Math.floor(i*span/256))&65535)]) << 24 >> 24;
      const y = height/2 - signedByte*height/256;
      if (i===0) ctx.moveTo(0,y);
      else ctx.lineTo(i*width/256,y);
    }
    ctx.stroke();
    ctx.fillStyle = '#65bcb4';
    ctx.fillRect(Math.min(width-2,x(boundary)),0,2,height);
    drawLoopRegion(canvas,start,span,end,loop);
    const position = address===null ? null : view ? start+((address-start)&65535) : address;
    if (position !== null && position >= start && position < start+span) {
      ctx.fillStyle = '#ffc45b';
      ctx.fillRect(x(position),0,3,height);
    }
  };
}
