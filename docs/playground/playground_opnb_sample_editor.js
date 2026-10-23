/** Applied YM2610 ADPCM-A/B controls. Encoded ROM uploads stay in the chip API. */
export function createPlaygroundOpnbSampleEditor({root,onEdit,onTargetChange=()=>{}}){
  const doc=root.ownerDocument;let disposed=false,snapshot=null,voice=0,section='adpcmA';
  root.dataset.extraOpnbEditor='';
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  function activate(next){if(disposed)return;section=next;onTargetChange();}
  function card(title){const node=make('section');node.className='chip-section';node.append(make('h3',title));root.append(node);return node;}
  function fields(parent){const node=make('div');node.className='chip-fields';parent.append(node);return node;}
  function field(parent,label,node){const wrap=make('label');wrap.className='chip-field';wrap.append(make('span',label),node);parent.append(wrap);return node;}
  function bind(node,kind){node.addEventListener('focus',()=>activate(kind));node.addEventListener('click',()=>activate(kind));}
  function send(kind,method,args){if(disposed)return;activate(kind);onEdit(`${kind}.${method}`,args);}
  function number(parent,kind,label,name,max,change,min=0){const node=field(parent,label,make('input'));node.type='number';node.min=String(min);node.max=String(max);node.step='1';node.dataset.opnbControl=name;bind(node,kind);
    node.addEventListener('change',()=>{if(disposed)return;const n=Number(node.value);if(!node.value.trim()||!Number.isInteger(n)||n<min||n>max){node.setCustomValidity?.(`Enter ${min}–${max}.`);node.reportValidity?.();return;}node.setCustomValidity?.('');change(n);});return node;}
  function checkbox(parent,kind,label,name,change){const node=field(parent,label,make('input'));node.type='checkbox';node.dataset.opnbControl=name;bind(node,kind);node.addEventListener('change',()=>{if(!disposed)change();});return node;}
  function keyboard(parent,kind){const node=make('button','Use Keyboard');node.type='button';node.dataset.opnbKeyboard=kind;node.addEventListener('click',()=>activate(kind));parent.append(node);}
  const a=card('ADPCM-A · 6 ROM voices'),af=fields(a),select=field(af,'Voice / Keyboard target',make('select'));select.dataset.opnbControl='a-voice';
  for(let i=0;i<6;i++){const option=make('option',`Voice ${i+1}`);option.value=String(i);select.append(option);}bind(select,'adpcmA');
  const global=number(af,'adpcmA','Global level (0–63)','a-global',63,n=>send('adpcmA','setVolume',[n]));
  const aLevel=number(af,'adpcmA','Voice level (0–31)','a-level',31,n=>send('adpcmA','setVoice',[voice,{volume:n}]));
  const aStart=number(af,'adpcmA','Sample start (bytes, 256 aligned)','a-start',0xffffff,()=>rangeA());
  const aEnd=number(af,'adpcmA','Sample end (exclusive, 256 aligned)','a-end',0x1000000,()=>rangeA(),256);
  const aLeft=checkbox(af,'adpcmA','Left','a-left',()=>send('adpcmA','setVoice',[voice,{left:!!aLeft.checked,right:!!aRight.checked}]));
  const aRight=checkbox(af,'adpcmA','Right','a-right',()=>send('adpcmA','setVoice',[voice,{left:!!aLeft.checked,right:!!aRight.checked}]));keyboard(af,'adpcmA');
  a.append(make('p','ADPCM-A plays at clock / 432, with no pitch or repeat control. Use a range shorter than 1 MiB. Upload encoded ADPCM-A with adpcmA.loadMemory().'));
  const b=card('ADPCM-B · 1 ROM voice'),bf=fields(b);
  const bStart=number(bf,'adpcmB','Sample start (bytes, 256 aligned)','b-start',0xffffff,()=>rangeB());
  const bEnd=number(bf,'adpcmB','Sample end (exclusive, 256 aligned)','b-end',0x1000000,()=>rangeB(),256);
  const delta=number(bf,'adpcmB','Delta-N / playback speed','b-delta',65535,n=>send('adpcmB','setDeltaN',[n]),1);
  const bLevel=number(bf,'adpcmB','Linear level (0–255)','b-level',255,n=>send('adpcmB','setVolume',[n]));
  const bLeft=checkbox(bf,'adpcmB','Left','b-left',()=>send('adpcmB','setPan',[!!bLeft.checked,!!bRight.checked]));
  const bRight=checkbox(bf,'adpcmB','Right','b-right',()=>send('adpcmB','setPan',[!!bLeft.checked,!!bRight.checked]));keyboard(bf,'adpcmB');
  b.append(make('p','Keyboard plays the configured range at its configured speed. Upload encoded ADPCM-B with adpcmB.loadMemory(); adpcm is the same ADPCM-B interface.'));
  const memory=make('p');memory.className='subtext';root.append(memory);
  function range(start,end,kind,limit){const lo=Number(start.value),hi=Number(end.value),valid=start.value.trim()&&end.value.trim()&&Number.isInteger(lo)&&Number.isInteger(hi)&&lo>=0&&hi>lo&&hi<=0x1000000&&lo%256===0&&hi%256===0&&hi-lo<limit;
    for(const node of [start,end])node.setCustomValidity?.(valid?'':`Use a nonempty 256-byte aligned range${kind==='adpcmA'?' shorter than 1 MiB':''}.`);
    if(!valid){start.reportValidity?.();return;}send(kind,'setSample',kind==='adpcmA'?[voice,{start:lo,end:hi}]:[{start:lo,end:hi}]);}
  function rangeA(){range(aStart,aEnd,'adpcmA',0x100000);}function rangeB(){range(bStart,bEnd,'adpcmB',Infinity);}
  function value(node,n){if(doc.activeElement!==node)node.value=String(n);}function checked(node,v){if(doc.activeElement!==node)node.checked=!!v;}
  function update(data){if(disposed||!data)return;snapshot=data;const [r,p]=data.registers??[];if(!r||!p)return;
    value(select,voice);value(global,p[1]&63);value(aLevel,p[8+voice]&31);checked(aLeft,p[8+voice]&128);checked(aRight,p[8+voice]&64);
    value(aStart,(p[0x10+voice]|p[0x18+voice]<<8)*256);value(aEnd,((p[0x20+voice]|p[0x28+voice]<<8)+1)*256);
    value(bStart,(r[0x12]|r[0x13]<<8)*256);value(bEnd,((r[0x14]|r[0x15]<<8)+1)*256);value(delta,r[0x19]|r[0x1a]<<8);value(bLevel,r[0x1b]);checked(bLeft,r[0x11]&128);checked(bRight,r[0x11]&64);
    const extent=data.romBytes??[0,0],resident=data.romAllocatedBytes??[0,0];memory.textContent=`ROM loaded extent: A ${extent[0]} / B ${extent[1]} bytes · allocated: A ${resident[0]} / B ${resident[1]} bytes · status 0x${Number(data.statusHi??0).toString(16).padStart(2,'0')}${data.held?.includes(`adpcm-a:${voice}`)?' · ADPCM-A Keyboard held':''}${data.held?.includes('adpcm-b:0')?' · ADPCM-B Keyboard held':''}`;
  }
  select.addEventListener('change',()=>{if(disposed)return;voice=Number(select.value);update(snapshot);activate('adpcmA');});
  return {update,getSelectedTarget:()=>section==='adpcmB'?'adpcm-b:0':`adpcm-a:${voice}`,dispose(){disposed=true;}};
}
