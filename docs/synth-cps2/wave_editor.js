// SPDX-License-Identifier: BSD-3-Clause
import {createParamControl} from '../synth/synth_controls.js';


export function createWaveEditor(onEdit,itemFor,getRom) {
  const canvas = document.getElementById('pcm-wave');
  const ctx = canvas.getContext('2d');
  const caption = document.getElementById('pcm-caption');
  const controls = {};
  for (const [key,label,max] of [['rate','Rate',65535],['end','End',256],['loop','Loop length',256]]) {
    controls[key] = createParamControl({label,min:0,max,step:1,value:0,dragPixelsPerStep:4,
      onChange:value=>onEdit(key,value)});
    document.getElementById('pcm-controls').append(controls[key].element);
  }
  let previous = '';
  let editRange,drag;
  canvas.style.touchAction='none';
  function move(event){
    const r=canvas.getBoundingClientRect();
    const byte=editRange.start+Math.round((event.clientX-r.left)*editRange.span/r.width);
    if(drag==='end')onEdit('end',Math.max(editRange.start+1,Math.min(editRange.start+editRange.span,byte)));
    else onEdit('loop',Math.max(0,Math.min(editRange.end-editRange.start,editRange.end-byte)));
  }
  canvas.onpointerdown=e=>{
    if(!editRange || e.button!==0)return;
    const r=canvas.getBoundingClientRect(),byte=editRange.start+(e.clientX-r.left)*editRange.span/r.width;
    drag=Math.abs(byte-editRange.end)<Math.abs(byte-(editRange.end-editRange.loop))?'end':'loop';
    canvas.setPointerCapture(e.pointerId);move(e);
  };
  canvas.onpointermove=e=>{if(drag && editRange)move(e);};
  canvas.onlostpointercapture=()=>{drag=null;};
  let previousItem,previousRom;
  return function draw(voice, address = null, view = null) {
    const rom=getRom();
    const {sample,rate,end,loop}=voice,item=view?null:itemFor(voice);
    const signature = [sample,voice.start,voice.bank,rate,end,loop,address].join(',');
    if (!view && signature === previous && previousItem===item && previousRom===rom) return;
    previousItem=item;previousRom=rom;
    previous = view ? null : signature;
    const start = view?.start ?? item?.start ?? voice.start ?? sample * 256, span=view?.span ?? item?.length ?? (((end-start)&65535)||65536), {width,height} = canvas;
    editRange=view||start>=end?null:{start,span,end,loop};
    controls.end.updateRange(view||!item?0:start+1,view||!item?65535:start+span);
    controls.loop.updateRange(0,view||!item?65535:end-start);
    controls.rate.updateVisual(rate);
    controls.end.updateVisual(end);
    controls.loop.updateVisual(loop);
    ctx.clearRect(0,0,width,height);
    const x = byte => (byte-start)*width/span;
    ctx.fillStyle = '#235956';
    const boundary=view ? start+span : end;
    ctx.fillRect(x(boundary-loop),0,x(boundary)-x(boundary-loop),height);
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
    const position = address===null ? null : view ? start+((address-start)&65535) : address;
    if (position !== null && position >= start && position < start+span) {
      ctx.fillStyle = '#ffc45b';
      ctx.fillRect(x(position),0,3,height);
    }
    caption.textContent = (view||item?'ROM bank '+(view??item).bank+' · ':'')+'Loop '+((end-loop)&65535)+'–'+end+' (end exclusive) · Position '+(address ?? '—');
  };
}
