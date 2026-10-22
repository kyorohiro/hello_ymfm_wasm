import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {apiOperatorToDisplayOperator,displayOperatorToApiOperator} from '../synth/synth_controls.js';
import {YM2612Synth} from '../../web/ym2612synth.js';
import {YM2203Synth} from '../../web/ym2203synth.js';
import {YM2608Synth} from '../../web/ym2608synth.js';
import {FM_PRESETS} from '../../web/megasynth-fm-presets.js';

const source = (await readFile(new URL('./playground_operator_tab.js',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?;\n/gm,'').replace('export function createPlaygroundOperatorTab','function createPlaygroundOperatorTab');
function fixture() {
  const nodes = new Map(), frames = new Map(), updates = [], displayed = new Map(), documentEvents = new Map(), inputs = new Map();
  let frameId = 0, commonOptions, operatorOptions, envelopeDisposals = 0;
  function node() {
    return {style:{},options:[],events:new Map(),
      addEventListener(type,callback) {this.events.set(type,callback);},
      appendChild(child) {this.options.push(child);},blur() {},setAttribute() {},querySelectorAll() {return [];},
    };
  }
  const root = {...node(),querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector,node());
    return nodes.get(selector);
  }};
  const control = key => {const element=node(),interactive=[{disabled:false},{disabled:false}];inputs.set(key,interactive);element.querySelectorAll=()=>interactive;return {element,updateVisual(value) {updates.push([key,value]);displayed.set(key,value);}};};
  const document = {hidden:false,createElement:node,
    addEventListener(type,callback) {documentEvents.set(type,callback);},
    removeEventListener(type,callback) {assert.equal(documentEvents.get(type),callback);documentEvents.delete(type);},
  };
  const presets = {lead:FM_PRESETS['one-op-basic'],bell:FM_PRESETS['two-op-bell']};
  const scope = vm.createContext({document,apiOperatorToDisplayOperator,displayOperatorToApiOperator,
    createOperatorEnvelopeView:()=>({invalidate() {},setVisible() {},dispose() {envelopeDisposals++;}}),
    buildHeader() {},
    buildCommonControls(options) {
      commonOptions = options;
      for (const definition of options.defs) options.controlsMap.set(definition.id,control('common:'+definition.id));
    },
    buildOperatorControls(options) {
      operatorOptions = options;
      for (const operator of options.operatorNumbers) options.controlsMap.set(operator,new Map(
        options.defs.map(definition => [definition.id,control(`op${operator}:${definition.id}`)])));
    },
    createParamControl:options=>control('special:'+options.label),
  });
  vm.runInContext(source,scope);
  const tab = scope.createPlaygroundOperatorTab({root,presets,presetOrder:['lead','bell'],
    requestAnimationFrame(callback) {frames.set(++frameId,callback);return frameId;},
    cancelAnimationFrame(id) {frames.delete(id);},
  });
  updates.length = 0;
  return {tab,presets,frames,updates,displayed,nodes,document,documentEvents,inputs,
    editCommon:(id,value)=>commonOptions.onChange(id,value),
    editOperator:(operator,id,value)=>operatorOptions.onChange(operator,id,value),
    get envelopeDisposals() {return envelopeDisposals;},
    advance() {const batch=[...frames.values()];frames.clear();for (const callback of batch) callback();},
    setDocumentHidden(hidden) {document.hidden=hidden;documentEvents.get('visibilitychange')?.();},
  };
}

test('YM2203 shows mono output and disables unsupported pan and LFO controls without bus writes',()=>{
  const f=fixture(),writes=[];
  f.tab.attachSynth(new YM2203Synth({transport:{write:(...args)=>writes.push(args)}}));
  for(const id of ['#operatorTabPanLeft','#operatorTabPanRight']){assert.equal(f.nodes.get(id).disabled,true);assert.equal(f.nodes.get(id).checked,true);}
  for(const id of ['ams','pms','lfoEnabled','lfoFrequency'])assert(f.inputs.get('common:'+id).every(input=>input.disabled));
  assert(f.inputs.get('common:algorithm').every(input=>!input.disabled));assert.deepEqual(writes,[]);
  f.tab.attachSynth(new YM2612Synth({transport:{write:(...args)=>writes.push(args)}}));
  for(const id of ['#operatorTabPanLeft','#operatorTabPanRight'])assert.equal(f.nodes.get(id).disabled,false);
  for(const id of ['ams','pms','lfoEnabled','lfoFrequency'])assert(f.inputs.get('common:'+id).every(input=>!input.disabled));
  assert.deepEqual(writes,[]);f.tab.dispose();
});

for (const [parameter,value,register] of [['algorithm',3,0xb0],['feedback',6,0xb0],['ams',1,0xb4],['pms',7,0xb4]]) {
  test(`editing ${parameter} writes only its register without altering operators, global modes or CH3 pitch`, () => {
    const f=fixture(),writes=[];
    const synth=new YM2612Synth({transport:{write:(port,register,value)=>writes.push([port,register,value])}});
    const preset={...f.presets.lead,ams:2,pms:5,pan:{left:true,right:false}};
    synth.setPreset(0,preset); f.tab.syncPreset(0,'',preset);
    synth.setLfo(true,6); synth.setDacEnabled(true); synth.setChannel3SpecialMode(true);
    for (let operator=0;operator<4;operator++) synth.setChannel3SpecialFrequency(operator,operator+2,400+operator);
    synth.setFrequency(2,5,900);
    f.tab.attachSynth(synth);writes.length=0;
    const expected=synth.getState();expected.channels[0][parameter]=value;
    f.editCommon(parameter,value);
    assert.deepEqual(synth.getState(),expected);
    assert.equal(writes.length,1);
    assert.equal(writes[0][0],0);assert.equal(writes[0][1],register);
    assert.equal(f.tab.getChannelPreset()[parameter],value,'the model changes immediately');
    f.editCommon(parameter,value);
    assert.equal(writes.length,1,'repeated pointer positions do not rewrite an unchanged value');
    f.tab.dispose();
  });
}

test('selecting a voice preserves playing CH3 and chip-wide controls', () => {
  const f=fixture(),writes=[];
  const synth=new YM2612Synth({transport:{write:(port,register,value)=>writes.push([port,register,value])}});
  synth.setLfo(true,6);synth.setDacEnabled(true);synth.setChannel3SpecialMode(true);
  for(let operator=0;operator<4;operator++)synth.setChannel3SpecialFrequency(operator,operator+2,400+operator);
  synth.setFrequency(2,5,900);
  f.tab.attachSynth(synth);writes.length=0;
  const before=synth.getState();
  f.tab.selectPreset(0,'lead');
  const after=synth.getState();
  assert.deepEqual(after.channels.slice(1),before.channels.slice(1));
  assert.deepEqual({...after,channels:null},{...before,channels:null});
  assert.ok(!writes.some(([,register])=>[0x22,0x27,0x2b].includes(register)||(register>=0xa0&&register<=0xaf)));
  assert.equal(after.channels[0].algorithm,f.presets.lead.algorithm);
  f.tab.dispose();
});

for(const Type of [YM2203Synth,YM2608Synth])test(`offline voice edits attach to ${Type.name} without unsupported pan/LFO/DAC writes`, () => {
  const f=fixture(),writes=[];
  const synth=new Type({transport:{write:(port,register,value)=>writes.push([port,register,value])}});
  f.tab.selectPreset(0,'lead');
  assert.doesNotThrow(()=>f.tab.attachSynth(synth));
  assert.equal(synth.getState().channels[0].algorithm,f.presets.lead.algorithm);
  writes.length=0;
  f.tab.selectPreset(0,'bell');
  assert.equal(synth.getState().channels[0].algorithm,f.presets.bell.algorithm);
  assert.ok(!writes.some(([,register])=>[0x22,0x27,0x2b].includes(register)||(register>=0xa0&&register<=0xaf)));
  f.tab.dispose();
});

test('bursts of synth observations update the model immediately and render at most once per frame without audio writes', () => {
  const f=fixture(),writes=[];
  f.tab.attachSynth(new YM2612Synth({transport:{write:(port,register,value)=>writes.push([port,register,value])}}));
  f.tab.setVisible(true);
  for (let index=0;index<1000;index++) f.tab.syncOperator(0,3,{tl:index%128});
  f.tab.syncAlgo(0,4,6);f.tab.syncLfo(true,5);f.tab.syncDacEnabled(true);
  f.tab.syncChannel3SpecialMode(true);f.tab.syncChannel3SpecialFrequency(3,5,777);
  assert.equal(f.tab.getChannelPreset().operators[4].tl,999%128);
  assert.equal(f.tab.getChannelPreset().algorithm,4);
  assert.equal(f.updates.length,0,'audio event handlers perform no control rendering');
  assert.equal(f.frames.size,1);
  assert.equal(writes.length,0,'observation never feeds registers back to audio');
  f.advance();
  assert.equal(f.updates.filter(([key])=>key==='common:algorithm').length,1);
  assert.equal(f.displayed.get('op4:tl'),999%128);
  assert.equal(f.displayed.get('common:algorithm'),4);
  assert.equal(f.displayed.get('common:lfoFrequency'),5);
  assert.equal(f.displayed.get('common:dacEnabled'),true);
  assert.equal(f.displayed.get('special:OP4F'),777);
  assert.equal(f.frames.size,0);
  f.advance();assert.equal(f.updates.filter(([key])=>key==='common:algorithm').length,1);
  f.tab.dispose();
});

test('observing a pan-only change preserves modulation for the next UI edit', () => {
  const f=fixture(),writes=[];
  const synth=new YM2612Synth({transport:{write:(port,register,value)=>writes.push([port,register,value])}});
  synth.setPan(0,true,true,2,5);f.tab.syncPan(0,true,true,2,5);
  synth.setPan(0,false,true);f.tab.syncPan(0,false,true);
  f.tab.attachSynth(synth);writes.length=0;
  f.editCommon('ams',1);
  assert.equal(synth.getState().channels[0].pms,5);
  assert.deepEqual(writes,[[0,0xb4,0x55]]);
  f.tab.dispose();
});

test('reset, preset and parameter observations retain their order while drawing only the latest state', () => {
  const f=fixture();f.tab.setVisible(true);
  f.tab.syncLfo(true,7);f.tab.syncDacEnabled(true);f.tab.syncChannel3SpecialMode(true);
  f.tab.syncOperator(0,3,{tl:99});f.tab.syncReset();
  f.tab.syncPreset(0,'bell',f.presets.bell);f.tab.syncOperator(0,3,{tl:21});
  f.tab.syncPan(0,false,true,1,3);
  assert.equal(f.tab.getChannelPreset().algorithm,f.presets.bell.algorithm);
  assert.equal(f.tab.getChannelPreset().operators[4].tl,21);
  assert.equal(f.frames.size,1);assert.equal(f.updates.length,0);
  f.advance();
  assert.equal(f.displayed.get('op4:tl'),21);
  assert.equal(f.displayed.get('common:lfoEnabled'),false,'reset clears global model state');
  assert.equal(f.displayed.get('common:dacEnabled'),false);
  assert.equal(f.displayed.get('special:MODE'),false);
  assert.equal(f.displayed.get('special:OP4F'),0);
  assert.equal(f.nodes.get('#operatorTabPanLeft').checked,false);
  assert.equal(f.nodes.get('#operatorTabPanRight').checked,true);
  f.updates.length=0;
  f.tab.syncOperator(0,3,{tl:12});f.tab.syncPreset(0,'lead',f.presets.lead);
  assert.equal(f.tab.getChannelPreset().operators[4].tl,f.presets.lead.operators[3].tl,'later preset replaces earlier patch');
  f.advance();
  assert.equal(f.displayed.get('op4:tl'),f.presets.lead.operators[3].tl);
  assert.equal(f.updates.filter(([key])=>key==='common:algorithm').length,1);
  f.tab.dispose();
});

test('hidden panels retain current models without scheduling or rendering, then draw the latest visible channel', () => {
  const f=fixture();
  f.tab.syncOperator(0,3,{tl:31});f.tab.syncOperator(1,3,{tl:71});
  assert.equal(f.frames.size,0);assert.equal(f.updates.length,0);
  f.tab.setVisible(true);assert.equal(f.frames.size,1);
  f.tab.setVisible(false);assert.equal(f.frames.size,0);
  f.tab.syncOperator(0,3,{tl:53});
  f.tab.setVisible(true);f.advance();assert.equal(f.displayed.get('op4:tl'),53);
  f.updates.length=0;
  f.tab.syncOperator(1,3,{tl:88});assert.equal(f.frames.size,0,'nonselected channel updates need no render');
  f.tab.selectChannel(1);assert.equal(f.displayed.get('op4:tl'),88);
  f.tab.dispose();
});

test('a background document cancels rendering and disposal cannot schedule more frames', () => {
  const f=fixture();f.tab.setVisible(true);f.tab.syncAlgo(0,2,1);
  assert.equal(f.frames.size,1);
  f.setDocumentHidden(true);assert.equal(f.frames.size,0);
  f.tab.syncAlgo(0,5,2);assert.equal(f.frames.size,0);assert.equal(f.updates.length,0);
  f.setDocumentHidden(false);assert.equal(f.frames.size,1);f.advance();
  assert.equal(f.displayed.get('common:algorithm'),5);
  f.tab.syncAlgo(0,6,2);f.tab.dispose();assert.equal(f.frames.size,0);
  f.tab.syncAlgo(0,7,2);assert.equal(f.frames.size,0);
  assert.equal(f.documentEvents.size,0);assert.equal(f.envelopeDisposals,1);
});
