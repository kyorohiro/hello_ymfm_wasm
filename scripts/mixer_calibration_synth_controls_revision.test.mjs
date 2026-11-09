import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {restoreMixerCalibrationSynthControlsRevision,SYNTH_CONTROLS_REVISION_SOURCE_PATH as path,
  SYNTH_CONTROLS_REVISION_RECEIPT_PATH,SYNTH_CONTROLS_REVISION_RECEIPT_OBJECT_SHA256} from './mixer_calibration_synth_controls_revision.mjs';
import * as current from '../docs/synth/synth_controls.js';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=await readFile(new URL('docs/'+path,root));
const receipt=JSON.parse(await readFile(new URL(SYNTH_CONTROLS_REVISION_RECEIPT_PATH,root),'utf8'));
const original=restoreMixerCalibrationSynthControlsRevision(path,bytes);
const previous=await import('data:text/javascript;base64,'+original.toString('base64'));

test('the reviewed FM UI revision reconstructs the complete measured source and leaves all four reports untouched',async()=>{
  assert.equal(sha(JSON.stringify(receipt)),SYNTH_CONTROLS_REVISION_RECEIPT_OBJECT_SHA256);
  assert.notEqual(original,bytes);
  assert.equal(original.length,receipt.source.before.bytes);assert.equal(sha(original),receipt.source.before.sha256);
  for(const [reportPath,identity] of Object.entries(receipt.reports)) {
    const reportBytes=await readFile(new URL(reportPath,root)),report=JSON.parse(reportBytes),before=JSON.stringify(report);
    assert.equal(reportBytes.length,identity.bytes);assert.equal(sha(reportBytes),identity.sha256);
    assert.deepEqual(report.sources[path],receipt.source.before);
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:report.sources[path],report}),'ui-synth-controls');
    assert.equal(JSON.stringify(report),before,'validation retains every measured result and source fingerprint');
    assert.equal(sha(await readFile(new URL(reportPath,root))),identity.sha256,'validation never rewrites original measurements');
  }
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:receipt.source.after}),'raw','a later exact measurement requires no exception');
});

test('one-byte, same-length and future callback/default/control edits cannot use the FM UI receipt',()=>{
  const changedByte=Buffer.from(bytes);changedByte[12]^=1;
  for(const changed of [changedByte,Buffer.concat([bytes,Buffer.from('\n')]),
    Buffer.from(bytes.toString().replace('onOperatorGateChange = null','onOperatorGateChange = true')),
    Buffer.from(bytes.toString().replace('getOperatorEnabled = () => true','getOperatorEnabled = () => false')),
    Buffer.from(bytes.toString().replace('return operator - 1;','return operator + 1;')),
    Buffer.from(bytes.toString().replace('onChange(currentValue);','onChange(currentValue * 2);')),
    Buffer.from("import './changed-renderer.js';\n"+bytes),
  ]) {
    assert.equal(restoreMixerCalibrationSynthControlsRevision(path,changed),changed);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record:receipt.source.before}),/source changed; remeasure/);
  }
});

test('the exact reviewed body cannot authorize another path or a detached measurement record',()=>{
  for(const other of ['synth/other_controls.js','playground/playground_operator_tab.js','js/ym2612synth.js','js/soundchip_mixer.js','generated/ym2612_wasm.wasm']) {
    assert.equal(restoreMixerCalibrationSynthControlsRevision(other,bytes),bytes);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path:other,bytes,record:receipt.source.before}),/source changed; remeasure/);
  }
  for(const record of [undefined,{}, {...receipt.source.before,bytes:10019},{...receipt.source.before,sha256:'0'.repeat(64)}]) {
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record}),/source changed; remeasure/);
  }
});

function element(tagName) {
  const node={tagName,children:[],className:'',textContent:'',style:{},dataset:{},attributes:{},listeners:new Map(),captures:new Set(),
    appendChild(child){this.children.push(child);},setAttribute(name,value){this.attributes[name]=String(value);},
    addEventListener(type,callback){const callbacks=this.listeners.get(type)??[];callbacks.push(callback);this.listeners.set(type,callbacks);},
    setPointerCapture(id){this.captures.add(id);},hasPointerCapture(id){return this.captures.has(id);},releasePointerCapture(id){this.captures.delete(id);},
    blur(){},emit(type,event={}){for(const callback of this.listeners.get(type)??[])callback({preventDefault(){},stopPropagation(){},...event});},
  };
  const setClass=(name,enabled)=>{const values=new Set(node.className.split(/\s+/).filter(Boolean));if(enabled)values.add(name);else values.delete(name);node.className=[...values].join(' ');};
  node.classList={add:name=>setClass(name,true),remove:name=>setClass(name,false),toggle:setClass};
  return node;
}
function rendered(node) {
  return {tag:node.tagName,className:node.className,text:node.textContent,type:node.type,attributes:node.attributes,style:node.style,
    events:[...node.listeners.keys()],children:node.children.map(rendered)};
}
function controls(api) {
  const root=element('div'),controlsMap=new Map(),changes=[];
  const defs=[{id:'tl',label:'TL',min:0,max:127,step:1},{id:'am',label:'AM',min:0,max:1,step:1,booleanMode:true}];
  const operatorStates=Object.fromEntries([1,2,3,4].map(operator=>[operator,{tl:operator*10,am:operator%2===0}]));
  api.buildOperatorControls({root,operatorNumbers:[1,2,3,4],defs,operatorStates,controlsMap,wheelAdjust:false,
    onChange:(...args)=>changes.push(args)});
  for(const operator of [1,2,3,4]) {
    const control=controlsMap.get(operator).get('tl');
    for(const value of [25,25,127,0])control.updateVisual(value);
    control.element.children.at(-1).emit('click');
    const boolean=controlsMap.get(operator).get('am');boolean.updateVisual(false);boolean.updateVisual(false);
    boolean.element.children[0].emit('pointerdown',{pointerId:1,clientX:0});
  }
  return {root:rendered(root),changes};
}

test('the measured Playground default call renders the same controls and sends identical edits without OP gate handlers',async()=>{
  const previousDocument=globalThis.document;
  globalThis.document={createElement:element};
  try {
    const before=controls(previous),after=controls(current);
    assert.deepEqual(after,before,'default DOM, visible values, edit basis and parameter callbacks retain their measured behavior');
    assert(after.root.children.every(row=>row.children[0].tag==='div'&&row.children[0].events.length===0),'Playground defaults install no gate button or keyboard callback');
  } finally {globalThis.document=previousDocument;}
  const caller=await readFile(new URL('docs/playground/playground_operator_tab.js',root),'utf8');
  const start=caller.indexOf('  buildOperatorControls({'),end=caller.indexOf('\n  });',start);
  assert(start>=0&&end>start);
  const invocation=caller.slice(start,end);
  assert(!/onOperatorGateChange|gateControls|getOperatorEnabled/.test(invocation),'the current Playground does not opt into Synth gate controls');
});
