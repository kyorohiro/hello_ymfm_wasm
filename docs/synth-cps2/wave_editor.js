// SPDX-License-Identifier: BSD-3-Clause
import {createParamControl} from '../synth/synth_controls.js';
import {demoRom} from './demo.js';

export function createWaveEditor(onEdit) {
  const rom = demoRom();
  const canvas = document.getElementById('pcm-wave');
  const ctx = canvas.getContext('2d');
  const caption = document.getElementById('pcm-caption');
  const controls = {};
  for (const [key,label,max] of [['rate','Rate',65535],['end','End',256],['loop','Loop length',256]]) {
    controls[key] = createParamControl({label,min:0,max,step:1,value:0,
      onChange:value=>onEdit(key,value)});
    document.getElementById('pcm-controls').append(controls[key].element);
  }
  let previous = '';
  return function draw({sample,rate,end,loop}, address = null, view = null) {
    const signature = [sample,rate,end,loop,address].join(',');
    if (!view && signature === previous) return;
    previous = view ? null : signature;
    const start = view?.start ?? sample * 256, span=view?.span ?? 256, {width,height} = canvas;
    controls.end.updateRange(view?0:start+1,view?65535:start+256);
    controls.loop.updateRange(0,view?65535:end-start);
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
      const signedByte = (view?view.wave[i]:rom[start+i]) << 24 >> 24;
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
    caption.textContent = (view?'ROM bank '+view.bank+' · ':'')+'Loop '+((end-loop)&65535)+'–'+end+' (end exclusive) · Position '+(address ?? '—');
  };
}
