// SPDX-License-Identifier: BSD-3-Clause
import {advanceAdpcm} from '../js/qsoundpcm.js';

const hex=n=>n.toString(16).toUpperCase().padStart(4,'0');
const labels=['Unused','PCM','ADPCM','PCM + ADPCM'];

export function createRomPages(request){
  const grid=document.getElementById('rom-pages'),canvas=document.getElementById('rom-preview');
  const caption=document.getElementById('rom-page-caption'),bank=document.getElementById('rom-bank');
  const ctx=canvas.getContext('2d');
  let page=0,lastBank=-1,lastBytes,lastKind=-1,lastPage=-1;
  const cells=Array.from({length:256},(_,i)=>{
    const b=document.createElement('button');
    b.type='button';
    b.onclick=()=>{page=i;refresh();};
    grid.append(b);return b;
  });
  grid.onkeydown=e=>{
    const delta={ArrowRight:1,ArrowLeft:-1,ArrowUp:-16,ArrowDown:16}[e.key];
    if(!delta || !cells.includes(e.target))return;
    e.preventDefault();e.stopPropagation();
    const cell=cells[page+delta];
    if(cell && !cell.disabled){cell.click();cell.focus();}
  };
  function refresh(){request(Number(bank.value),page);}
  function draw({bank:selectedBank,page:selectedPage,size,usage,bytes}){
    if(selectedBank!==Number(bank.value)||selectedPage!==page)return;
    const available=Math.max(0,Math.min(256,Math.ceil((size-selectedBank*65536)/256)));
    if(page>=available && page!==0){page=0;refresh();return;}
    for(let i=0;i<cells.length;i++){
      const b=cells[i],kind=usage[i]??0,active=i===page;
      if(b.dataset.kind!==String(kind)){
        b.dataset.kind=kind;
        b.title=hex(i*256)+'–'+hex(i*256+255)+' · '+labels[kind];
        b.setAttribute('aria-label',b.title);
      }
      if(b.disabled!==(i>=available))b.disabled=i>=available;
      if(b.getAttribute('aria-pressed')!==String(active)){b.setAttribute('aria-pressed',String(active));b.tabIndex=active?0:-1;}
    }
    const kind=usage[page]??0;
    if(lastBank===selectedBank && lastPage===page && kind===lastKind &&
      bytes.length===lastBytes?.length && bytes.every((v,i)=>v===lastBytes[i]))return;
    lastBank=selectedBank;lastPage=page;lastBytes=bytes;lastKind=kind;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!bytes.length){caption.textContent='No ROM bytes';return;}
    const adpcm=kind===2;
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
    caption.textContent='Bank '+hex(selectedBank)+' · '+hex(page*256)+'–'+hex(page*256+bytes.length-1)+
      ' · '+labels[kind]+' · '+(adpcm?'ADPCM preview (decoder reset at block start)':'Signed PCM bytes');
  }
  bank.addEventListener('change',()=>{page=0;refresh();});
  return {draw,refresh};
}
