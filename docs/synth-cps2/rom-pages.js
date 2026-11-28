// SPDX-License-Identifier: BSD-3-Clause
import {advanceAdpcm} from '../js/qsoundpcm.js';

export function createRomPages(request){
  const canvas=document.getElementById('rom-preview'),bank=document.getElementById('rom-bank');
  const ctx=canvas.getContext('2d');
  let page=0,adpcm=false,lastBank=-1,lastBytes,lastKind,lastPage=-1;
  function selectPage(index,decodeAdpcm=false){page=index;adpcm=decodeAdpcm;refresh();}
  function refresh(){request(Number(bank.value),page);}
  const grid=document.getElementById('bank-grid');
  let bankSignature='';
  function drawBanks(size,loadedBanks,bankUsage){
    const states=['loaded','pcm','adpcm','both'];
    const options=Array.from(bank.options,o=>Number(o.value));
    const cells=options.map(i=>{
      const loaded=loadedBanks?loadedBanks[i]:i*65536<size;
      const read=bankUsage?.[i]??0;
      return [i,states[read],Boolean(loaded),read];
    });
    const signature=JSON.stringify(cells);
    if(signature!==bankSignature){
      bankSignature=signature;
      const buttons=cells.map(([i,state,loaded,read])=>{
        const b=document.createElement('button');
        b.dataset.state=read||loaded?state:'empty';b.value=i;b.textContent='0x'+i.toString(16).toUpperCase().padStart(2,'0');
        b.title='Bank '+b.textContent+' · '+(loaded?'Loaded':'No data')+
          (read?' · '+['','PCM','ADPCM','PCM + ADPCM'][read]+' read':'');
        b.setAttribute('aria-label',b.title);
        b.onclick=()=>{bank.value=b.value;bank.dispatchEvent(new Event('change'));};
        return b;
      });
      grid.replaceChildren(...buttons);
    }
    for(const b of grid.children)b.setAttribute('aria-pressed',String(b.value===bank.value));
  }
  function draw({bank:selectedBank,page:selectedPage,size,bytes,loadedBanks,bankUsage}){
    if(selectedBank!==Number(bank.value)||selectedPage!==page)return;
    drawBanks(size,loadedBanks,bankUsage);
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
