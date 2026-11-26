// SPDX-License-Identifier: BSD-3-Clause
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';

export function inspectSample(rom,sample,columns=640) {
  if (8*sample+6 > rom.length) return {message:'No sample table entry in this ROM.'};
  const chip = new Oki6295AudioEngine({clock:1000000+0x80000000});
  chip.loadOki6295Rom(rom);
  const {start,stop} = chip.sampleRange(sample);
  const hex = n => '0x'+n.toString(16).toUpperCase().padStart(5,'0');
  const range = hex(start)+' – '+hex(stop);
  if (start>=stop) return {message:range+' · Empty or reversed range'};
  if (stop>=rom.length) return {message:range+' · Extends beyond loaded ROM'};
  const count = (stop-start+1)*2;
  const width = Math.min(columns,count);
  const min = new Float32Array(width).fill(Infinity), max = new Float32Array(width).fill(-Infinity);
  chip.command(0x80|sample); chip.command(0x10);
  for (let i=0;i<count;i++) {
    chip.tick();
    const bin = Math.floor(i*width/count), value = chip.voices[0].output;
    min[bin] = Math.min(min[bin],value); max[bin] = Math.max(max[bin],value);
  }
  return {min,max,message:range+' (inclusive) · '+(stop-start+1)+' bytes · '+(count*132/1000000).toFixed(3)+' s'};
}

export function displaySample(canvas,caption,rom,sample) {
  const {min,max,message} = inspectSample(rom,sample,canvas.width);
  caption.textContent = message;
  canvas.hidden = !min;
  if (!min) return;
  const ctx = canvas.getContext('2d'), mid = canvas.height/2;
  ctx.fillStyle = '#10191a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#345248'; ctx.fillRect(0,mid,canvas.width,1);
  ctx.fillStyle = '#a5df69';
  const columnWidth = canvas.width/min.length;
  for (let i=0;i<min.length;i++) {
    ctx.fillRect(i*columnWidth,mid-max[i]*mid,columnWidth,Math.max(1,(max[i]-min[i])*mid));
  }
}
