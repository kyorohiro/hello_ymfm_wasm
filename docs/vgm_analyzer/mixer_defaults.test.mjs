import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mixerDefaults} from './mixer_defaults.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';
import {ANALYZER_MIXER_DEFAULTS} from './mixer_calibration_data.js';
import {measureAnalyzerNesReference} from '../../scripts/measure_analyzer_nes_levels.mjs';

const baseline = SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds;
const aliases = {segapsg:'psg',gameboy:'gameBoyDmg',nes:'nesApu'};
const round = value => Number(value.toFixed(6));

test('Analyzer uses canonical measured kind levels and its explicitly measured renderer overrides',()=>{
 for(const {name,volume} of baseline){
  const id=aliases[name]??name;
  assert.deepEqual(mixerDefaults(id),{gain:ANALYZER_MIXER_DEFAULTS[id]??volume,pan:0,muted:false},id);
 }
 assert.equal(mixerDefaults('rf5c164').gain,.280286,'Existing RF decoder trim is already present in the measured output');
 assert.equal(mixerDefaults('gameBoyDmg').gain,.515271,'Measured Game Boy default replaces the old .28 heuristic');
 for(const id of ['unknown','YM2612','__proto__'])assert.deepEqual(mixerDefaults(id),{gain:1,pan:0,muted:false});
 const settings=mixerDefaults('ym2612');settings.gain=2;
 assert.equal(mixerDefaults('ym2612').gain,.775938,'Returned defaults are not shared mutable state');
});

test('Genesis compensation accounts for downstream FM/PSG trim only on its own routes',()=>{
 const genesis={kind:'ym2612'},opl={kind:'ym3812'};
 assert.equal(mixerDefaults('ym2612',genesis).gain,round(.775938/.9));
 assert.equal(mixerDefaults('psg',genesis).gain,round(.644089/.35));
 for(const configuration of [undefined,opl,{kind:'ym2151'},{kind:'ym2413'},{kind:'mixed',parts:[{id:'ym3812',kind:'ym3812',chips:['ym3812','psg']}]}]){
  assert.equal(mixerDefaults('psg',configuration).gain,.644089,'Other PSG owners receive no Genesis compensation');
 }
 const mixed={kind:'mixed',parts:[{id:'genesis',kind:'ym2612',chips:['ym2612','psg']},{id:'nesApu',kind:'nes',chips:['nesApu']}]};
 assert.equal(mixerDefaults('psg',mixed).gain,round(.644089/.35));
 assert.equal(mixerDefaults('ym2612',mixed).gain,round(.775938/.9));
 assert.equal(mixerDefaults('nesApu',mixed).gain,mixerDefaults('nesApu').gain);
 assert.equal(mixerDefaults('rf5c164',genesis).gain,.280286);
});

test('all Analyzer-specific renderer measurements reach their strip defaults without another trim',async()=>{
 for(const name of ['analyzer_nes_levels_01','analyzer_extra_levels_01']){
  const report=JSON.parse(await readFile(new URL(`../issues/${name}.json`,import.meta.url),'utf8'));
  assert.equal(report.passed,true);
  for(const [id,gain] of Object.entries(report.defaults)){
   assert.equal(ANALYZER_MIXER_DEFAULTS[id],gain,id+' generated data');
   assert.deepEqual(mixerDefaults(id,{kind:'ym2612'},1),{gain,pan:0,muted:false},id+' actual route');
  }
 }
});

test('an actual source owner can override inferred trim, without hidden clipping or a second multiplier',()=>{
 assert.equal(mixerDefaults('psg',{kind:'ym2612'},1).gain,.644089);
 assert.equal(mixerDefaults('psg',{kind:'ym3812'},.35).gain,round(.644089/.35));
 assert.equal(mixerDefaults('ym2612',undefined,.9).gain,round(.775938/.9));
 for(const trim of [0,-1,NaN,Infinity])assert.throws(()=>mixerDefaults('ym2612',undefined,trim),RangeError);
 assert.throws(()=>mixerDefaults('ym2612',undefined,.1),RangeError,'An impossible reference must not be silently clamped');
});

test('NES Analyzer gain reproduces the actual JS renderer rather than borrowing the WASM measurement',async()=>{
 const report=JSON.parse(await readFile(new URL('../issues/analyzer_nes_levels_01.json',import.meta.url),'utf8'));
 assert.equal(report.passed,true);assert.equal(report.referenceSampleRate,44100);
 assert.equal(report.defaults.nesApu,1.981272);
 assert.equal(mixerDefaults('nesApu').gain,report.defaults.nesApu);
 assert.notEqual(mixerDefaults('nesApu').gain,baseline.find(record=>record.name==='nes').volume);
 for(const frequencyHz of [220,440,880]){
  const expected=report.rows.find(row=>row.frequencyHz===frequencyHz&&row.sampleRate===44100&&!row.fds);
  const actual=measureAnalyzerNesReference({frequencyHz,sampleRate:44100,fds:false});
  assert.equal(actual.amplitude,expected.amplitude);
  assert.deepEqual(actual.pcm,expected.pcm);
 }
 const reference=report.rows.find(row=>row.frequencyHz===440&&row.sampleRate===44100&&!row.fds);
 assert.equal(round(report.targetAmplitude/reference.amplitude),mixerDefaults('nesApu').gain);
 assert.ok(Math.abs(reference.amplitude*mixerDefaults('nesApu').gain-report.targetAmplitude)<1e-7);
});
