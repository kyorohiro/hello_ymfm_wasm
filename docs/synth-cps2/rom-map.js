// SPDX-License-Identifier: BSD-3-Clause
const bankSize=0x10000;
const hex=n=>'0x'+n.toString(16).toUpperCase().padStart(4,'0');

// Start is the most recent address write, while voice.address is the moving cursor.
export function chipRomMap(chip,starts){
  const voices=[];
  chip.voices.forEach((v,i)=>{
    if(chip.lastWrites[i*8+5]>=0)
      voices.push({id:i,bank:v.bank,start:starts[i],end:v.end&65535,loop:v.loop});
  });
  chip.adpcm.forEach((v,i)=>{
    if(chip.lastWrites[0xcb+4*i]>=0)
      voices.push({id:16+i,bank:v.bank,start:v.start,end:v.end,loop:0});
  });
  return {size:chip.rom.length,voices};
}

export function intervals(start,end){
  if(start<end)return [[start,end]];
  if(start===end)return [];
  return [[start,bankSize],...(end?[[0,end]]:[])];
}

export function createRomMap(openVoice){
  const element=id=>document.getElementById(id);
  const selector=element('rom-bank'),rows=element('rom-rows');
  let latest=null,source='',previousMap='',previousBanks='',previousView='';
  const buttons=Array.from({length:19},(_,id)=>{
    const button=document.createElement('button');
    button.type='button';button.hidden=true;button.className='rom-row';
    button.dataset.voice=id;
    const name=document.createElement('strong'),address=document.createElement('span'),track=document.createElement('span');
    name.textContent=id<16?'PCM CH'+(id+1):'ADPCM Voice '+(id-15);
    address.className='rom-address';track.className='rom-track';track.setAttribute('aria-hidden','true');
    button.append(name,address,track);rows.append(button);
    button.onclick=()=>openVoice(id);
    return {button,address,track};
  });
  function paint(){
    const bank=Number(selector.value),available=Math.min(bankSize,Math.max(0,latest.size-bank*bankSize));
    const visible=latest.voices.filter(v=>v.bank===bank);
    const signature=JSON.stringify([bank,available,visible,latest.samples]);
    if(signature===previousView)return;
    previousView=signature;
    // Expand small factory ROMs to the width of the plot. Include any configured addresses outside the ROM.
    let limit=available || bankSize;
    for(const v of visible){
      limit=Math.max(limit,v.start,v.end);
      if(v.start>v.end || v.loop>v.end)limit=bankSize;
    }
    element('rom-scale').textContent=hex(0)+' – '+hex(limit)+' · '+available.toLocaleString()+' bytes in bank';
    const list=element('rom-samples');
    if(list)list.replaceChildren(...(latest.samples??[]).filter(s=>s.bank===bank).map(s=>{
      const line=document.createElement('div');
      const label=document.createElement('span'),track=document.createElement('div'),segment=document.createElement('span');
      label.textContent=s.path+' · '+s.kind+' · '+hex(s.start)+' – '+hex(s.end);
      track.className='rom-track';segment.className='rom-segment '+(s.kind==='ADPCM'?'rom-adpcm':'rom-pcm');
      segment.style.left=100*s.start/limit+'%';segment.style.width=100*(s.end-s.start)/limit+'%';
      track.append(segment);line.append(label,track);
      return line;
    }));
    element('rom-empty').hidden=visible.length>0;
    const ids=new Set(visible.map(v=>v.id));
    buttons.forEach(({button},i)=>button.hidden=!ids.has(i));
    for(const v of visible){
      const {button,address,track}=buttons[v.id];
      const loopStart=(v.end-v.loop)&65535;
      const loopText=v.loop>0?' · Loop '+hex(loopStart):v.loop<0?' · Signed loop '+v.loop:'';
      address.textContent=hex(v.start)+' – '+hex(v.end)+loopText;
      button.title=button.firstChild.textContent+' · '+address.textContent+' (end exclusive)';
      track.replaceChildren();
      function segment(start,end,kind){
        const part=document.createElement('span');
        part.className='rom-segment '+kind;
        part.style.left=100*start/limit+'%';part.style.width=100*(end-start)/limit+'%';
        track.append(part);
      }
      if(available<limit)segment(available,limit,'rom-unavailable');
      for(const [a,b] of intervals(v.start,v.end))segment(a,b,v.id<16?'rom-pcm':'rom-adpcm');
      if(v.loop>0)for(const [a,b] of intervals(loopStart,v.end))segment(a,b,'rom-loop');
    }
  }
  selector.onchange=()=>{if(latest)paint();};
  return (map,path)=>{
    const mapKey=JSON.stringify(map);
    if(mapKey===previousMap && path===source)return;
    previousMap=mapKey;latest=map;
    const banks=new Set(Array.from({length:Math.ceil(map.size/bankSize)},(_,i)=>i));
    for(const v of map.voices)banks.add(v.bank);
    const ordered=[...banks].sort((a,b)=>a-b);
    selector.disabled=!ordered.length;
    const signature=ordered.join(',');
    if(signature!==previousBanks || source!==path){
      const old=source===path?selector.value:'';
      selector.replaceChildren(...ordered.map(n=>new Option(hex(n),String(n))));
      const first=map.voices[0]?.bank??ordered[0];
      selector.value=old!=='' && banks.has(Number(old))?old:String(first??'');
      previousBanks=signature;
    }
    const counts=new Map();
    for(const v of map.voices)counts.set(v.bank,(counts.get(v.bank)??0)+1);
    for(const option of selector.options){
      const bank=Number(option.value),count=counts.get(bank);
      const text=hex(bank)+(count?' · '+count+(count===1?' voice':' voices'):'');
      if(option.text!==text)option.text=text;
    }
    source=path;
    const label=path+' · '+map.size.toLocaleString()+' bytes';
    if(element('rom-source').textContent!==label)element('rom-source').textContent=label;
    paint();
  };
}
