// SPDX-License-Identifier: BSD-3-Clause
// Passive SSF DSP observation. No editor profile, audio owner or mutation API.
import {disassembleScspDsp} from './dsp_assembler.js';

const hex=value=>value.toString(16).toUpperCase().padStart(4,'0');
const list=values=>values.length?values.join(', '):'none';
const integers=(values,length,min,max)=>ArrayBuffer.isView(values)&&values.length===length&&
  Array.from(values).every(value=>Number.isInteger(value)&&value>=min&&value<=max);
const pan=code=>code===null?'unavailable':code===0||code===16?'Center':code===15?'Right only':code===31?'Left only':`${code<16?'Right':'Left'} · ${code}`;
const setting=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max?value:null;
const display=value=>value===null?'—':String(value);

/** Decode all 128 instructions without the Synth's safe execution profile.
 * RAW fields retain opaque bits; selector references do not prove audio paths.
 */
export function describeScspSsfDspProgram(program) {
  if(!integers(program,512,0,65535))throw new TypeError('Expected 512 raw SSF DSP program words');
  // The SSF renderer uses Mednafen's NOFL bit 8. The Synth/MAME field decoder
  // uses word3 bit 15 instead. Adapt only a private decoding image; the observed
  // word3 bit 15 is opaque in Mednafen and remains explicit beside the raw words.
  const decoding=Uint16Array.from(program);
  for(let step=0;step<128;step++){
    const at=step*4+3,word=program[at];decoding[at]=(word&~0x8100)|((word&0x0100)?0x8000:0);
  }
  let decoded=[];
  try{decoded=disassembleScspDsp(decoding,{includeTrailingZeros:true}).trimEnd().split('\n');}catch{}
  const inputs=new Set(),coefficients=new Set(),addresses=new Set(),outputs=new Set();
  let nonzero=0,opaque=0;
  const rows=Array.from({length:128},(_,step)=>{
    const words=Array.from(program.subarray(step*4,step*4+4)),[a,b,c,d]=words;
    if(words.some(value=>value!==0))nonzero++;
    const unknown=Boolean((a&0x8000)||(b&0x1000)||(d&0x8080));if(unknown)opaque++;
    const ira=(b>>6)&63;
    if(ira>=32&&ira<48)inputs.add(ira-32);
    if(((b>>13)&3)===1)coefficients.add((d>>9)&63);
    if(c&0x6000)addresses.add((d>>2)&31);
    if(c&0x1000)outputs.add((c>>8)&15);
    const text=decoded[step],valid=typeof text==='string'&&text.startsWith(`${String(step).padStart(3,'0')}:`);
    const fields=valid?text.slice(4).trim():'',extra=d&0x8000?'Opaque word3=0x8000':'';
    return {step,raw:words.map(hex).join(' '),instruction:valid?[fields,extra].filter(Boolean).join(' · ')||'(all fields zero)':'Undecoded · raw words retained',
      status:!valid?'undecoded':unknown?'opaque':'decoded'};
  });
  const sorted=set=>[...set].sort((a,b)=>a-b);
  return {rows,nonzero,opaque,references:{inputs:sorted(inputs),coefficients:sorted(coefficients),addresses:sorted(addresses),outputs:sorted(outputs)}};
}

/** Detach display facts from one audible-position slot / DSP snapshot. */
function describeSnapshot(snapshot,{slot=0,playback='playing'}={},readProgram=describeScspSsfDspProgram) {
  const frame=snapshot?.frame,source=snapshot?.slots?.[slot];
  const result={available:false,frame:Number.isSafeInteger(frame)&&frame>=0?frame:null,
    playback:playback==='paused'?'Paused':playback==='seeking'?'Seeking':'Live',slot,
    source:{direct:setting(source?.voice?.directLevel,0,7),pan:setting(source?.voice?.pan,0,31),
      input:setting(source?.dsp?.input,0,15),send:setting(source?.dsp?.send,0,7)},
    program:null,coefficients:[],addresses:[],returns:[],reason:'DSP snapshot unavailable in this recording engine.'};
  const dsp=snapshot?.dsp;
  if(!dsp)return result;
  if(!Number.isInteger(slot)||slot<0||slot>31||!source){result.reason='Choose an available SSF channel.';return result;}
  if(result.frame===null||dsp.frame!==frame){result.reason='DSP and channel snapshot frames do not match.';return result;}
  if(!integers(dsp.program,512,0,65535)||!integers(dsp.coefficients,64,-4096,4095)||
    !integers(dsp.addresses,32,0,65535)||!integers(dsp.outputs,16,-32768,32767)){
    result.reason='DSP snapshot is incomplete or unsupported; missing values are not zero.';return result;
  }
  result.available=true;result.reason='Read-only SSF observation · paths are program-defined.';
  result.program=readProgram(dsp.program);
  result.coefficients=Array.from(dsp.coefficients,(code,index)=>({index,code,multiplier:code/4096}));
  result.addresses=Array.from(dsp.addresses,(address,index)=>({index,address,hex:hex(address)}));
  result.returns=Array.from(dsp.outputs,(value,index)=>{
    const route=snapshot.slots[index]?.dsp;
    return {index,value,hex:hex(value&65535),level:setting(route?.returnLevel,0,7),pan:setting(route?.pan,0,31),
      written:result.program.references.outputs.includes(index)};
  });
  return result;
}
export function describeScspSsfDsp(snapshot,options){return describeSnapshot(snapshot,options);}

/** Stable, read-only DOM. Disclosures and focus belong to the user. */
export function setupScspSsfDspView({root}={}) {
  if(!root?.ownerDocument)return {update(){},dispose(){}};
  const doc=root.ownerDocument,node=(tag,id,text)=>{
    const value=doc.createElement(tag);if(id)value.id=id;if(text!==undefined)value.textContent=text;return value;
  };
  const heading=node('div');heading.className='scsp-dsp-program-heading';
  heading.append(node('h3',null,'SSF DSP · Read-only'));
  const badge=node('span','scspSsfDspBadge','Unavailable'),frame=node('span','scspSsfDspFrame','Frame —');
  badge.className='scsp-dsp-program-applied';heading.append(badge,frame);
  const status=node('p','scspSsfDspStatus'),selected=node('p','scspSsfDspSelected');
  const refs=node('p','scspSsfDspReferences');refs.className='scsp-dsp-program-summary';
  const help=node('details');help.className='scsp-inline-help';
  const helpSummary=node('summary',null,'?');helpSummary.setAttribute('aria-label','About read-only SSF DSP observation');
  help.append(helpSummary,node('p',null,'This is the playing SSF machine, separate from your Synth draft. Program, COEF, MADRS, returns and selected CH come from one audible-position snapshot. Instruction selector references do not prove a CH-to-return path: arbitrary programs are program-defined. EFREG values are sampled signed raw hardware values, not audio meters. EFSDL/EFPAN for Return 0–15 are stored in CH1–CH16 register sets. This listing follows the Mednafen renderer layout: NOFL is word3 bit 8; word3 bit 15 is opaque. RAW fields and explicit Opaque labels retain unknown bits. This observation listing is not a promise of Synth/MAME assembly compatibility. Viewing never applies or copies the game program into Synth.'));
  function table(id,title,headers){
    const details=node('details',id),summary=node('summary',id+'Summary',title),scroll=node('div'),table=node('table'),head=node('thead'),row=node('tr'),body=node('tbody',id+'Rows');
    scroll.className='scsp-dsp-program-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',title);
    table.className='scsp-dsp-program-table';for(const title of headers){const cell=node('th',null,title);cell.scope='col';row.append(cell);}
    head.append(row);table.append(head,body);scroll.append(table);details.append(summary,scroll);
    return {details,summary,body,key:null};
  }
  const program=table('scspSsfDspProgram','Program · 128 instructions',['Step','Raw words','Decoded fields']);
  const coefficients=table('scspSsfDspCoefficient','COEF · 64 signed codes',['COEF','Code','Multiplier']);
  const addresses=table('scspSsfDspAddress','MADRS · 32 addresses',['MADRS','Raw hex','Unsigned value']);
  const returns=table('scspSsfDspReturn','Shared returns · 16 EFREG values',['Return','Program EWT','EFSDL / EFPAN','Observed raw EFREG']);
  root.replaceChildren(heading,status,selected,refs,help,program.details,coefficients.details,addresses.details,returns.details);
  let disposed=false,model=null,programWords=null,programDescription=null;
  const readProgram=words=>{
    if(!programWords||words.some((value,index)=>value!==programWords[index])){
      programWords=Uint16Array.from(words);programDescription=describeScspSsfDspProgram(words);
    }
    return programDescription;
  };
  const text=(target,value)=>{if(target.textContent!==value)target.textContent=value;};
  const data=(name,value)=>{if(root.dataset[name]!==String(value))root.dataset[name]=String(value);};
  function fill(target,rows){
    const key=JSON.stringify(rows);if(key===target.key)return;target.key=key;
    target.body.replaceChildren(...rows.map(values=>{
      const row=node('tr');values.forEach((value,index)=>{const cell=node(index?'td':'th',null,String(value));if(!index)cell.scope='row';row.append(cell);});return row;
    }));
  }
  function renderTable(target){
    if(disposed||!model||!target.details.open)return;
    if(!model.available){fill(target,[]);return;}
    if(target===program)fill(target,model.program.rows.map(row=>[String(row.step).padStart(3,'0'),row.raw,row.instruction+(row.status==='opaque'?' · Opaque bits retained':row.status==='undecoded'?' · Unsupported decoding':'')]));
    else if(target===coefficients)fill(target,model.coefficients.map(value=>[value.index,value.code,value.multiplier]));
    else if(target===addresses)fill(target,model.addresses.map(value=>[value.index,'0x'+value.hex,value.address]));
    else fill(target,model.returns.map(value=>[value.index,value.written?'EWT selector':'No EWT selector',`${display(value.level)} / ${display(value.pan)} · ${pan(value.pan)}`,`${value.value} · 0x${value.hex}`]));
  }
  const tables=[program,coefficients,addresses,returns];
  const listeners=tables.map(target=>{const listener=()=>renderTable(target);target.details.addEventListener('toggle',listener);return [target.details,listener];});
  return {
    update(snapshot,options){
      if(disposed)return;model=describeSnapshot(snapshot,options,readProgram);
      data('available',model.available);data('frame',model.frame??'');data('slot',model.slot);data('playback',model.playback);
      text(badge,model.available?model.playback:'Unavailable');text(frame,`Frame ${display(model.frame)}`);text(status,model.reason);
      const source=model.source;
      text(selected,`CH${model.slot+1} · Direct ${display(source.direct)} / Pan ${display(source.pan)} · Send MIXS${display(source.input)} / IMXL ${display(source.send)} · program-defined`);
      text(refs,model.available?`IRA selectors: ${list(model.program.references.inputs.map(value=>'MIXS'+value))} · COEF selectors: ${list(model.program.references.coefficients)} · EWT selectors: ${list(model.program.references.outputs.map(value=>'EFREG'+value))}`:'Program references unavailable.');
      text(program.summary,model.available?`Program · 128 instructions · ${model.program.nonzero} nonzero · ${model.program.opaque} opaque`:'Program · unavailable');
      for(const target of tables){
        if(!model.available)fill(target,[]);
        if(target.details.hidden===model.available)target.details.hidden=!model.available;
        renderTable(target);
      }
    },
    dispose(){if(disposed)return;disposed=true;for(const [target,listener]of listeners)target.removeEventListener('toggle',listener);},
  };
}
