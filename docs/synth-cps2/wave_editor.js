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
  return function draw({sample,rate,end,loop}, address = null) {
    const signature = [sample,rate,end,loop,address].join(',');
    if (signature === previous) return;
    previous = signature;
    const start = sample * 256, {width,height} = canvas;
    controls.end.updateRange(start+1,start+256);
    controls.loop.updateRange(0,end-start);
    controls.rate.updateVisual(rate);
    controls.end.updateVisual(end);
    controls.loop.updateVisual(loop);
    ctx.clearRect(0,0,width,height);
    const x = byte => (byte-start)*width/256;
    ctx.fillStyle = '#235956';
    ctx.fillRect(x(end-loop),0,x(end)-x(end-loop),height);
    ctx.strokeStyle = '#afeacb';
    ctx.beginPath();
    for (let i=0;i<256;i++) {
      const signedByte = rom[start+i] << 24 >> 24;
      const y = height/2 - signedByte*height/256;
      if (i===0) ctx.moveTo(0,y);
      else ctx.lineTo(x(start+i),y);
    }
    ctx.stroke();
    ctx.fillStyle = '#65bcb4';
    ctx.fillRect(Math.min(width-2,x(end)),0,2,height);
    if (address !== null && address >= start && address < start+256) {
      ctx.fillStyle = '#ffc45b';
      ctx.fillRect(x(address),0,3,height);
    }
    caption.textContent = 'Loop '+(end-loop)+'–'+end+' (end exclusive) · Position '+(address ?? '—');
  };
}
