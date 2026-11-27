// SPDX-License-Identifier: BSD-3-Clause
import {advanceAdpcm} from '../js/qsoundpcm.js';

export function createPadWave(canvas, caption, cursor){
  const ctx=canvas.getContext('2d'), width=canvas.width, height=canvas.height;
  let previousBank,previousRange;
  return (pad,bytes,tickRate,playingAddress=null)=>{
    const span=((pad.end-pad.start)&65535)||65536;
    const range=[pad.start,pad.end,pad.volume,tickRate,pad.configured].join(',');
    const available=bytes?.length && pad.configured!==false;
    if(previousBank!==bytes || previousRange!==range){
      previousBank=bytes;previousRange=range;
      ctx.clearRect(0,0,width,height);
      if(available){
        const voice={...pad,bank:0,trigger:true};
        const count=span*2,low=new Int16Array(width),high=new Int16Array(width);
        let peak=1;
        for(let i=0;i<count;i++){
          advanceAdpcm(voice,bytes,i%2);
          const x=Math.floor(i*width/count),sample=voice.output;
          low[x]=Math.min(low[x],sample);high[x]=Math.max(high[x],sample);
          peak=Math.max(peak,Math.abs(sample));
        }
        ctx.fillStyle='#8ae2d1';
        const scale=(height/2-2)/peak;
        for(let x=0;x<width;x++)ctx.fillRect(x,height/2-high[x]*scale,Math.max(1,width/count),1+(high[x]-low[x])*scale);
        caption.textContent=span+' bytes · '+(span*6/tickRate).toFixed(3)+' s · Peak-normalized waveform';
      }else caption.textContent=pad.configured===false?'No range configured':'No sample ROM in this bank';
    }
    const offset=(playingAddress-pad.start)&65535;
    cursor.hidden=!available || playingAddress===null || offset>=span;
    if(!cursor.hidden)cursor.style.left=(100*offset/span)+'%';
  };
}
