/** YM2608 applied rhythm/ADPCM controls. Uploads remain in the public chip API. */
export function createPlaygroundOpnaSampleEditor({root,onEdit,onTargetChange=()=>{}}){
  const doc=root.ownerDocument;let disposed=false,snapshot=null,voice=0,section='rhythm';
  root.dataset.extraOpnaEditor='';
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  function activate(next){if(disposed)return;section=next;onTargetChange();}
  function card(title){const node=make('section');node.className='chip-section';node.append(make('h3',title));root.append(node);return node;}
  function fields(parent){const node=make('div');node.className='chip-fields';parent.append(node);return node;}
  function field(parent,label,node){const wrapper=make('label');wrapper.className='chip-field';wrapper.append(make('span',label),node);parent.append(wrapper);return node;}
  function bind(node,kind){node.addEventListener('focus',()=>activate(kind));node.addEventListener('click',()=>activate(kind));}
  function send(kind,method,args){if(disposed)return;activate(kind);onEdit(`${kind}.${method}`,args);}
  function number(parent,kind,label,name,max,change,min=0){const node=field(parent,label,make('input'));node.type='number';node.min=String(min);node.max=String(max);node.step='1';node.dataset.opnaControl=name;bind(node,kind);
    node.addEventListener('change',()=>{if(disposed)return;const n=Number(node.value);if(!node.value.trim()||!Number.isInteger(n)||n<min||n>max){node.setCustomValidity?.(`Enter ${min}–${max}.`);node.reportValidity?.();return;}node.setCustomValidity?.('');change(n);});return node;}
  function checkbox(parent,kind,label,name,change){const node=field(parent,label,make('input'));node.type='checkbox';node.dataset.opnaControl=name;bind(node,kind);node.addEventListener('change',()=>{if(!disposed)change();});return node;}
  function keyboard(parent,kind){const node=make('button','Use Keyboard');node.type='button';node.dataset.opnaKeyboard=kind;node.addEventListener('click',()=>activate(kind));parent.append(node);}
  const rhythm=card('Rhythm · 6 fixed ROM voices'),rf=fields(rhythm),select=field(rf,'Voice / Keyboard target',make('select'));select.dataset.opnaControl='rhythm-voice';
  ['Bass drum','Snare','Cymbal','Hi-hat','Tom','Rimshot'].forEach((label,i)=>{const option=make('option',label);option.value=String(i);select.append(option);});bind(select,'rhythm');
  const rhythmLevel=number(rf,'rhythm','Global level (0–63)','rhythm-global',63,n=>send('rhythm','setVolume',[n]));
  const voiceLevel=number(rf,'rhythm','Voice level (0–31)','rhythm-level',31,n=>send('rhythm','setVoice',[voice,{volume:n}]));
  const rhythmLeft=checkbox(rf,'rhythm','Left','rhythm-left',()=>sendRhythmPan()),rhythmRight=checkbox(rf,'rhythm','Right','rhythm-right',()=>sendRhythmPan());
  keyboard(rf,'rhythm');const rom=make('p');rom.className='subtext';rhythm.append(rom);
  rhythm.append(make('p','Keyboard retriggers the selected fixed ROM voice. Pitch is determined by the chip.'));
  const adpcm=card('ADPCM-B · external sample RAM'),af=fields(adpcm);
  const start=number(af,'adpcm','Sample start (bytes, 32 aligned)','adpcm-start',0x1fffff,()=>sendRange());
  const end=number(af,'adpcm','Sample end (exclusive, 32 aligned)','adpcm-end',0x200000,()=>sendRange(),32);
  const delta=number(af,'adpcm','Delta-N / playback speed','adpcm-delta',65535,n=>send('adpcm','setDeltaN',[n]),1);
  const level=number(af,'adpcm','Linear level (0–255)','adpcm-level',255,n=>send('adpcm','setVolume',[n]));
  const adpcmLeft=checkbox(af,'adpcm','Left','adpcm-left',()=>sendAdpcmPan()),adpcmRight=checkbox(af,'adpcm','Right','adpcm-right',()=>sendAdpcmPan());
  keyboard(af,'adpcm');const memory=make('p');memory.className='subtext';adpcm.append(memory);
  adpcm.append(make('p','Range edits select 8-bit DRAM addressing. Load encoded samples with adpcm.loadMemory() or audio with adpcm.loadSample(). Keyboard plays the configured range at its configured speed.'));
  function sendRhythmPan(){send('rhythm','setVoice',[voice,{left:!!rhythmLeft.checked,right:!!rhythmRight.checked}]);}
  function sendAdpcmPan(){send('adpcm','setPan',[!!adpcmLeft.checked,!!adpcmRight.checked]);}
  function sendRange(){const a=Number(start.value),b=Number(end.value),valid=start.value.trim()&&end.value.trim()&&Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>a&&b<=0x200000&&a%32===0&&b%32===0;
    for(const node of [start,end])node.setCustomValidity?.(valid?'':'Use a nonempty range aligned to 32 bytes.');
    if(!valid){start.reportValidity?.();return;}send('adpcm','setSample',[{start:a,end:b}]);}
  function value(node,n){if(doc.activeElement!==node)node.value=String(n);}
  function checked(node,v){if(doc.activeElement!==node)node.checked=!!v;}
  function update(data){if(disposed||!data)return;snapshot=data;const [r,a]=data.registers??[];if(!r||!a)return;
    const v=r[0x18+voice];value(select,voice);value(rhythmLevel,r[0x11]&63);value(voiceLevel,v&31);checked(rhythmLeft,v&128);checked(rhythmRight,v&64);
    rom.textContent=`Rhythm ROM: ${data.romLoaded?'ready':'not loaded'}${data.held?.includes(`rhythm:${voice}`)?' · Keyboard held':''}`;
    value(start,(a[2]|a[3]<<8)*32);value(end,((a[4]|a[5]<<8)+1)*32);value(delta,a[9]|a[10]<<8);value(level,a[11]);checked(adpcmLeft,a[1]&128);checked(adpcmRight,a[1]&64);
    memory.textContent=`RAM loaded extent: ${data.adpcmMemoryBytes??0} / 2097152 bytes · status 0x${Number(data.statusHi??0).toString(16).padStart(2,'0')}${data.held?.includes('adpcm-b:0')?' · Keyboard held':''}`;
  }
  select.addEventListener('change',()=>{if(disposed)return;voice=Number(select.value);update(snapshot);activate('rhythm');});
  return {update,getSelectedTarget:()=>section==='adpcm'?'adpcm-b:0':`rhythm:${voice}`,dispose(){disposed=true;}};
}
