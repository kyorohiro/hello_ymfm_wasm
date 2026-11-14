import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {restoreMixerCalibrationSynthControlsRevision,SYNTH_CONTROLS_REVISION_SOURCE_PATH as path,
  SYNTH_CONTROLS_REVISION_RECEIPT_PATH,SYNTH_CONTROLS_REVISION_RECEIPT_OBJECT_SHA256,
  SYNTH_CONTROLS_RANGE_REVISION_RECEIPT_PATH,SYNTH_CONTROLS_RANGE_REVISION_RECEIPT_OBJECT_SHA256} from './mixer_calibration_synth_controls_revision.mjs';
import * as current from '../docs/synth/synth_controls.js';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=await readFile(new URL('docs/'+path,root));
const receipt=JSON.parse(await readFile(new URL(SYNTH_CONTROLS_REVISION_RECEIPT_PATH,root),'utf8'));
const rangeReceipt=JSON.parse(await readFile(new URL(SYNTH_CONTROLS_RANGE_REVISION_RECEIPT_PATH,root),'utf8'));
const original=restoreMixerCalibrationSynthControlsRevision(path,bytes);
const previous=await import('data:text/javascript;base64,'+original.toString('base64'));

test('the reviewed FM UI revision reconstructs the complete measured source and leaves all four reports untouched',async()=>{
  assert.equal(sha(JSON.stringify(receipt)),SYNTH_CONTROLS_REVISION_RECEIPT_OBJECT_SHA256);
  assert.equal(sha(JSON.stringify(rangeReceipt)),SYNTH_CONTROLS_RANGE_REVISION_RECEIPT_OBJECT_SHA256);
  assert.deepEqual(rangeReceipt.source.before,receipt.source.after,'the range review chains to the exact earlier UI revision');
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
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:rangeReceipt.source.after}),'raw','a later exact measurement requires no exception');
});

test('the earlier exact UI body remains independently supported by receipt01',()=>{
  const parts=[];let cursor=0;
  for(const hunk of rangeReceipt.source.reverseHunks){parts.push(bytes.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
  parts.push(bytes.subarray(cursor));const earlier=Buffer.concat(parts);
  assert.equal(earlier.length,receipt.source.after.bytes);assert.equal(sha(earlier),receipt.source.after.sha256);
  assert.deepEqual(restoreMixerCalibrationSynthControlsRevision(path,earlier),original);
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:earlier,record:receipt.source.before}),'ui-synth-controls');
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:earlier,record:receipt.source.after}),'raw');
});

test('one-byte, same-length and future callback/default/control edits cannot use the FM UI receipt',()=>{
  const changedByte=Buffer.from(bytes);changedByte[12]^=1;
  for(const changed of [changedByte,Buffer.concat([bytes,Buffer.from('\n')]),
    Buffer.from(bytes.toString().replace('onOperatorGateChange = null','onOperatorGateChange = true')),
    Buffer.from(bytes.toString().replace('getOperatorEnabled = () => true','getOperatorEnabled = () => false')),
    Buffer.from(bytes.toString().replace('return operator - 1;','return operator + 1;')),
    Buffer.from(bytes.toString().replace('onChange(currentValue);','onChange(currentValue * 2);')),
    Buffer.from(bytes.toString().replace('Math.max(step,max-min)','Math.max(step,max+min)')),
    Buffer.from(bytes.toString().replace('let min=initialMin,max=initialMax;','let min=initialMin,max=127;')),
    Buffer.concat([bytes,Buffer.from("\n// ?v=unreviewed-cache-revision\n")]),
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

test('the measured Playground default call preserves controls and edits with only the reviewed pointer cleanup listener',async()=>{
  const previousDocument=globalThis.document;
  globalThis.document={createElement:element};
  try {
    const before=controls(previous),after=controls(current);
    let cleanupListeners=0;
    const expected=structuredClone(before);
    const addReviewedCleanup=node=>{
      if(node.className.split(/\s+/).includes('param-value')){
        assert.deepEqual(node.events,['pointerdown','pointermove','pointerup','pointercancel']);
        node.events.push('lostpointercapture');cleanupListeners++;
      }
      for(const child of node.children)addReviewedCleanup(child);
    };
    addReviewedCleanup(expected.root);
    assert.equal(cleanupListeners,8);
    assert.deepEqual(after,expected,'the sole event addition is lostpointercapture; default DOM, visible values, edit basis and parameter callbacks are otherwise identical');
    assert(after.root.children.every(row=>row.children[0].tag==='div'&&row.children[0].events.length===0),'Playground defaults install no gate button or keyboard callback');
  } finally {globalThis.document=previousDocument;}
  const caller=await readFile(new URL('docs/playground/playground_operator_tab.js',root),'utf8');
  const start=caller.indexOf('  buildOperatorControls({'),end=caller.indexOf('\n  });',start);
  assert(start>=0&&end>start);
  const invocation=caller.slice(start,end);
  assert(!/onOperatorGateChange|gateControls|getOperatorEnabled/.test(invocation),'the current Playground does not opt into Synth gate controls');
});

test('fixed-range gestures retain the measured values and parameter callbacks',()=>{
  const previousDocument=globalThis.document;
  globalThis.document={createElement:element};
  const gestures=api=>{
    const changes=[];
    const control=api.createParamControl({label:'TL',min:0,max:127,step:1,value:30,onChange:value=>changes.push(value)});
    const wrapper=control.element,value=wrapper.children[2];
    value.emit('pointerdown',{pointerId:3,clientX:100});
    for(const x of [80,120,180,260,100])value.emit('pointermove',{pointerId:3,clientX:x});
    value.emit('pointerup',{pointerId:3});
    wrapper.children[1].emit('click');wrapper.children[3].emit('click');
    wrapper.emit('wheel',{deltaY:-1});wrapper.emit('wheel',{deltaY:1});
    value.emit('pointerdown',{pointerId:4,clientX:0});value.emit('pointercancel',{pointerId:4});
    return{changes,text:value.textContent,captures:[...value.captures],className:value.className};
  };
  try{assert.deepEqual(gestures(current),gestures(previous));}finally{globalThis.document=previousDocument;}
});
