// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleScspDsp} from './dsp_assembler.js';
import {describeScspSsfDspProgram,describeScspSsfDsp,setupScspSsfDspView} from './ssf_dsp_view.js';

function snapshot(){
  return {frame:44100,slots:Array.from({length:32},(_,index)=>({voice:{directLevel:7,pan:index%32},dsp:{input:index%16,send:index%8,returnLevel:index%8,pan:index%32}})),
    dsp:{frame:44100,program:assembleScspDsp('000: XSEL=1 IRA=32 YSEL=1 COEF=63\n001: EWT=1 EWA=15 MRD=1 MASA=31\n127: RAW0=0x8000 RAW1=0x1000 RAW3=0x0180'),
      coefficients:Int16Array.from({length:64},(_,index)=>index===63?-4096:index),addresses:Uint16Array.from({length:32},(_,index)=>index*1024),outputs:Int16Array.from({length:16},(_,index)=>index===15?-32768:index*100)}};
}

test('full game DSP observation keeps all instructions, signed coefficients, addresses and sixteen return settings',()=>{
  const value=snapshot(),before=structuredClone(value),model=describeScspSsfDsp(value,{slot:31,playback:'paused'});
  assert(model.available);assert.equal(model.frame,44100);assert.equal(model.playback,'Paused');
  assert.deepEqual(model.source,{direct:7,pan:31,input:15,send:7});
  assert.equal(model.program.rows.length,128);assert.equal(model.coefficients.length,64);assert.equal(model.addresses.length,32);assert.equal(model.returns.length,16);
  assert.deepEqual(model.coefficients[63],{index:63,code:-4096,multiplier:-1});assert.equal(model.addresses[31].address,31744);
  assert.deepEqual(model.returns[15],{index:15,value:-32768,hex:'8000',level:7,pan:15,written:true});
  assert.deepEqual(model.returns[0],{index:0,value:0,hex:'0000',level:0,pan:0,written:false});
  assert.deepEqual(value,before,'The observer never changes snapshot registers or DSP arrays');
  value.dsp.outputs[15]=0;value.dsp.coefficients[63]=0;assert.equal(model.returns[15].value,-32768);assert.equal(model.coefficients[63].code,-4096);
});

test('the whole-instruction decoder accepts game fields outside the Synth profile and labels opaque raw bits',()=>{
  const program=snapshot().dsp.program,model=describeScspSsfDspProgram(program);
  assert.deepEqual(model.references,{inputs:[0],coefficients:[63],addresses:[31],outputs:[15]});
  assert.match(model.rows[0].instruction,/COEF=63/);assert.equal(model.rows[127].status,'opaque');
  assert.equal(model.rows[127].raw,'8000 1000 0000 0180');assert.match(model.rows[127].instruction,/RAW0=0x8000/);
  assert.match(model.rows[127].instruction,/NOFL=1/);assert.match(model.rows[127].instruction,/RAW3=0x0080/);
  assert.equal(model.rows[126].instruction,'(all fields zero)');assert.equal(model.nonzero,3);assert.equal(model.opaque,1);
  assert.throws(()=>describeScspSsfDspProgram(new Uint16Array(508)),/512/);
});
test('Mednafen NOFL bit8 and opaque bit15 are independent without altering observed words',()=>{
  const program=new Uint16Array(512),values=[0,0x0100,0x8000,0x8100];
  values.forEach((word,index)=>program[index*4+3]=word);
  const before=program.slice(),model=describeScspSsfDspProgram(program);
  for(const [index,word]of values.entries()){
    const row=model.rows[index];assert.equal(row.raw,`0000 0000 0000 ${word.toString(16).toUpperCase().padStart(4,'0')}`);
    assert.equal(/NOFL=1/.test(row.instruction),Boolean(word&0x0100));
    assert.equal(/Opaque word3=0x8000/.test(row.instruction),Boolean(word&0x8000));
    assert.equal(row.status,word&0x8000?'opaque':'decoded');
    assert.doesNotMatch(row.instruction,/RAW3=0x0100/);
  }
  assert.deepEqual(program,before);assert.equal(model.opaque,2);
});

test('missing, incomplete and mismatched-frame DSP is unavailable rather than an invented zero program',()=>{
  const value=snapshot();delete value.dsp;
  let model=describeScspSsfDsp(value);assert(!model.available);assert.equal(model.program,null);assert.deepEqual(model.returns,[]);assert.match(model.reason,/unavailable/);
  value.dsp=snapshot().dsp;value.dsp.frame++;model=describeScspSsfDsp(value);assert(!model.available);assert.match(model.reason,/frames do not match/);
  value.dsp.frame=value.frame;value.dsp.coefficients=new Int16Array(63);model=describeScspSsfDsp(value);assert(!model.available);assert.match(model.reason,/missing values are not zero/);
  const complete=snapshot();complete.dsp.program.fill(0);complete.dsp.coefficients.fill(0);complete.dsp.outputs.fill(0);
  model=describeScspSsfDsp(complete);assert(model.available,'A captured zero program is distinct from no capture');assert.equal(model.program.nonzero,0);
});

class Node extends EventTarget {
  constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.content='';this.hidden=false;this.open=false;}
  set textContent(value){this.content=value;this.ownerDocument.writes++;}
  get textContent(){return this.content;}
  append(...children){this.children.push(...children);this.ownerDocument.writes++;}
  replaceChildren(...children){this.children=children;this.ownerDocument.writes++;}
  setAttribute(name,value){this.attributes.set(name,value);this.ownerDocument.writes++;}
  getAttribute(name){return this.attributes.get(name)??null;}
  focus(){throw Error('A passive view cannot focus a control');}
}
function fixture(){
  const doc={writes:0,createElement:tag=>new Node(doc,tag)};Object.defineProperty(doc,'activeElement',{get(){throw Error('A passive view cannot inspect focus');}});
  const root=new Node(doc,'section'),all=node=>[node,...node.children.flatMap(all)],find=id=>all(root).find(node=>node.id===id);
  return {doc,root,all:()=>all(root),find,view:setupScspSsfDspView({root})};
}
test('read-only view builds no edit controls and preserves disclosure and focus while showing a detached paused frame',()=>{
  const {view,root,all,find}=fixture(),value=snapshot(),before=structuredClone(value);
  view.update(value,{slot:15,playback:'paused'});
  assert.equal(root.dataset.frame,'44100');assert.equal(find('scspSsfDspBadge').textContent,'Paused');assert.match(find('scspSsfDspSelected').textContent,/CH16.*MIXS15.*IMXL 7/);
  assert(!all().some(node=>['INPUT','BUTTON','TEXTAREA','SELECT'].includes(node.tagName)));
  for(const name of ['Program','Coefficient','Address','Return'])assert.equal(find(`scspSsfDsp${name}Rows`).children.length,0);
  value.dsp.outputs[15]=123;value.dsp.program.fill(0);
  const details=find('scspSsfDspReturn');details.open=true;details.dispatchEvent(new Event('toggle'));
  assert.equal(find('scspSsfDspReturnRows').children.length,16);assert.match(find('scspSsfDspReturnRows').children[15].children[3].textContent,/-32768.*8000/);
  assert(details.open);assert.deepEqual(before.dsp.program,snapshot().dsp.program);
  assert.match(all().map(node=>node.textContent).join(' '),/not audio meters/);view.dispose();
});
test('opening complete program / COEF / MADRS tables is passive; equal polling and disposal leave the DOM unchanged',()=>{
  const {view,root,find,doc}=fixture(),value=snapshot();view.update(value);
  for(const [name,count]of [['Program',128],['Coefficient',64],['Address',32]]){
    const details=find(`scspSsfDsp${name}`);details.open=true;details.dispatchEvent(new Event('toggle'));assert.equal(find(`scspSsfDsp${name}Rows`).children.length,count);
  }
  const writes=doc.writes;view.update(structuredClone(value));assert.equal(doc.writes,writes);
  const frame=root.dataset.frame;view.dispose();value.frame++;value.dsp.frame++;view.update(value);find('scspSsfDspReturn').dispatchEvent(new Event('toggle'));
  assert.equal(doc.writes,writes);assert.equal(root.dataset.frame,frame);
});
test('missing capture clears earlier values without changing user disclosure state',()=>{
  const {view,root,find}=fixture(),value=snapshot();find('scspSsfDspProgram').open=true;view.update(value);
  assert.equal(find('scspSsfDspProgramRows').children.length,128);delete value.dsp;view.update(value);
  assert.equal(root.dataset.available,'false');assert.equal(find('scspSsfDspBadge').textContent,'Unavailable');assert.equal(find('scspSsfDspProgramRows').children.length,0);
  assert(find('scspSsfDspProgram').open);assert(find('scspSsfDspProgram').hidden);assert.match(find('scspSsfDspStatus').textContent,/unavailable/);view.dispose();
});
test('an older cached page without the SSF DSP section can still initialize',()=>{
  const view=setupScspSsfDspView();assert.doesNotThrow(()=>{view.update(snapshot());view.dispose();});
});
