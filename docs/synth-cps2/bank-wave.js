// SPDX-License-Identifier: BSD-3-Clause
import {advanceAdpcm} from '../js/qsoundpcm.js';

export function drawSampleWave(canvas,item){
  const {width,height}=canvas,ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,width,height);
  if(!item){
    ctx.fillStyle='#527083';ctx.fillRect(0,height/2,width,1);
    return;
  }
  const adpcm=item.kind==='ADPCM';
  const voice={start:0,end:item.length,bank:0,volume:32767,trigger:true};
  const count=item.length*(adpcm?2:1);
  ctx.fillStyle='#8ae2d1';
  for(let x=0,i=0;x<width;x++){
    let min=1,max=-1;
    const until=Math.ceil((x+1)*count/width);
    for(;i<until;i++){
      if(adpcm)advanceAdpcm(voice,item.pcm,i%2);
      const v=adpcm?voice.output/32768:((item.pcm[i]<<24)>>24)/128;
      min=Math.min(min,v);max=Math.max(max,v);
    }
    if(max>=min)ctx.fillRect(x,(1-max)*height/2,1,1+(max-min)*height/2);
  }
}

// Draw in bank-byte coordinates, including selections crossing address 0xffff.
export function drawLoopRegion(canvas,origin,span,end,length){
  if(!span || !length)return;
  const ctx=canvas.getContext('2d'),{width,height}=canvas;
  const start=(end-length)&65535;
  for(const base of [start-65536,start,start+65536]){
    const from=Math.max(origin,base),to=Math.min(origin+span,base+length);
    if(from>=to)continue;
    const x=(from-origin)*width/span,right=(to-origin)*width/span;
    ctx.fillStyle='rgba(41,196,231,.26)';
    ctx.fillRect(x,0,right-x,height);
    ctx.fillStyle='#62ddff';
    ctx.fillRect(x,height-4,Math.max(1,right-x),3);
    if(from!==base)continue;
    const pin=Math.min(width-1,x);
    ctx.fillRect(pin,0,1,height);
    ctx.beginPath();ctx.moveTo(pin,height-1);ctx.lineTo(pin-5,height-9);ctx.lineTo(pin+5,height-9);ctx.fill();
    ctx.font='bold 11px sans-serif';
    const labelWidth=ctx.measureText('Loop').width+6;
    const labelX=pin+6+labelWidth<=width?pin+6:Math.max(0,pin-6-labelWidth);
    ctx.fillStyle='#102c43';ctx.fillRect(labelX,height-18,labelWidth,14);
    ctx.fillStyle='#62ddff';ctx.fillText('Loop',labelX+3,height-7);
  }
}

export function createBankWave(canvas){
  const cache=document.createElement('canvas');
  const {width,height}=canvas;
  cache.width=width;cache.height=height;
  const ctx=canvas.getContext('2d');
  let previousRom,previousBase,previousKind;
  return (rom,base,kind,start,end,address=null,loop=0)=>{
    const size=Math.max(0,Math.min(65536,(rom?.length??0)-base));
    if(rom!==previousRom || base!==previousBase || kind!==previousKind){
      drawSampleWave(cache,size?{pcm:rom.subarray(base,base+size),length:size,kind}:null);
      previousRom=rom;previousBase=base;previousKind=kind;
    }
    ctx.clearRect(0,0,width,height);ctx.drawImage(cache,0,0);
    if(!size)return;
    const x=n=>Math.min(width,n*width/size);
    ctx.fillStyle='rgba(255,196,66,.24)';
    if(end>=start)ctx.fillRect(x(start),0,x(end)-x(start),height);
    else{ctx.fillRect(x(start),0,width-x(start),height);ctx.fillRect(0,0,x(end),height);}
    ctx.fillStyle='#ffd674';
    for(const n of [start,start && !end?65536:end])ctx.fillRect(Math.min(width-2,x(n)),0,2,height);
    if(kind==='PCM')drawLoopRegion(canvas,0,size,end,loop);
    if(address!==null && address<size){ctx.fillStyle='#ffc45b';ctx.fillRect(x(address),0,3,height);}
  };
}
