// SPDX-License-Identifier: BSD-3-Clause
import {advanceAdpcm} from '../js/qsoundpcm.js';

export function createRomPages(request){
  const canvas=document.getElementById('rom-preview'),bank=document.getElementById('rom-bank');
  const ctx=canvas.getContext('2d');
  let page=0,adpcm=false,lastBank=-1,lastBytes,lastKind,lastPage=-1;
  function selectPage(index,decodeAdpcm=false){page=index;adpcm=decodeAdpcm;refresh();}
  function refresh(){request(Number(bank.value),page);}
  function draw({bank:selectedBank,page:selectedPage,size,bytes}){
    if(selectedBank!==Number(bank.value)||selectedPage!==page)return;
    const available=Math.max(0,Math.min(256,Math.ceil((size-selectedBank*65536)/256)));
    if(page>=available && page!==0){page=0;refresh();return;}
    if(lastBank===selectedBank && lastPage===page && adpcm===lastKind &&
      bytes.length===lastBytes?.length && bytes.every((v,i)=>v===lastBytes[i]))return;
    lastBank=selectedBank;lastPage=page;lastBytes=bytes;lastKind=adpcm;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!bytes.length)return;
    const voice={start:0,end:bytes.length,bank:0,volume:32767,trigger:true};
    const count=bytes.length*(adpcm?2:1);
    ctx.strokeStyle='#8ae2d1';ctx.beginPath();
    for(let i=0;i<count;i++){
      if(adpcm)advanceAdpcm(voice,bytes,i%2);
      const value=adpcm?voice.output/32768:((bytes[i]<<24)>>24)/128;
      const x=i*canvas.width/Math.max(1,count-1),y=(1-value)*canvas.height/2;
      if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    }
    ctx.stroke();
  }
  bank.addEventListener('change',()=>selectPage(0));
  return {draw,refresh,selectPage};
}
