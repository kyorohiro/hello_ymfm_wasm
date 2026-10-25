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
const psgLevels=JSON.parse(await readFile(new URL('../issues/analyzer_psg_levels_01.json',import.meta.url),'utf8'));
const psgGain=.455420;

test('Analyzer uses canonical kind levels, measured renderer overrides and the Game Boy listening policy',async()=>{
 for(const {name,volume} of baseline){
  const id=aliases[name]??name;
  assert.deepEqual(mixerDefaults(id),{gain:ANALYZER_MIXER_DEFAULTS[id]??volume,pan:0,muted:false},id);
 }
 assert.equal(mixerDefaults('rf5c164').gain,.280286,'Existing RF decoder trim is already present in the measured output');
 assert.equal(mixerDefaults('gameBoyDmg').gain,.36,'Game Boy uses the chosen listening level');
 const peakReport=JSON.parse(await readFile(new URL('../issues/playground_chip_levels_01.json',import.meta.url),'utf8'));
 for(const role of ['primary','extra'])assert.equal(peakReport.calibration.routes.find(row=>row.kind==='gameboy'&&row.role===role).volume,
  .515271,'Historical Game Boy wave calibration remains intact');
 for(const id of ['unknown','YM2612','__proto__'])assert.deepEqual(mixerDefaults(id),{gain:1,pan:0,muted:false});
 const settings=mixerDefaults('ym2612');settings.gain=2;
 assert.equal(mixerDefaults('ym2612').gain,.775938,'Returned defaults are not shared mutable state');
});

test('Genesis compensation accounts for downstream FM/PSG trim only on its own routes',()=>{
 const genesis={kind:'ym2612'},opl={kind:'ym3812'};
 assert.equal(mixerDefaults('ym2612',genesis).gain,round(.775938/.9));
 assert.equal(mixerDefaults('psg',genesis).gain,round(psgGain/.35));
 for(const configuration of [undefined,opl,{kind:'ym2151'},{kind:'ym2413'},{kind:'mixed',parts:[{id:'ym3812',kind:'ym3812',chips:['ym3812','psg']}]}]){
  assert.equal(mixerDefaults('psg',configuration).gain,psgGain,'Other PSG owners receive no Genesis compensation');
 }
 const mixed={kind:'mixed',parts:[{id:'genesis',kind:'ym2612',chips:['ym2612','psg']},{id:'nesApu',kind:'nes',chips:['nesApu']}]};
 assert.equal(mixerDefaults('psg',mixed).gain,round(psgGain/.35));
 assert.equal(mixerDefaults('ym2612',mixed).gain,round(.775938/.9));
 assert.equal(mixerDefaults('nesApu',mixed).gain,mixerDefaults('nesApu').gain);
 assert.equal(mixerDefaults('rf5c164',genesis).gain,.280286);
});

test('all Analyzer-specific renderer measurements reach their strip defaults without another trim',async()=>{
 for(const name of ['analyzer_nes_levels_01','analyzer_extra_levels_01']){
  const report=JSON.parse(await readFile(new URL(`../issues/${name}.json`,import.meta.url),'utf8'));
  assert.equal(report.passed,true);
  for(const [id,gain] of Object.entries(report.defaults)){
   const current=psgLevels.defaults[id]??gain;
   assert.equal(ANALYZER_MIXER_DEFAULTS[id],current,id+' generated data');
   assert.deepEqual(mixerDefaults(id,{kind:'ym2612'},1),{gain:current,pan:0,muted:false},id+' actual route');
  }
 }
});

test('an actual source owner can override inferred trim, without hidden clipping or a second multiplier',()=>{
 assert.equal(mixerDefaults('psg',{kind:'ym2612'},1).gain,psgGain);
 assert.equal(mixerDefaults('psg',{kind:'ym3812'},.35).gain,round(psgGain/.35));
 assert.equal(mixerDefaults('ym2612',undefined,.9).gain,round(.775938/.9));
 for(const trim of [0,-1,NaN,Infinity])assert.throws(()=>mixerDefaults('ym2612',undefined,trim),RangeError);
 assert.throws(()=>mixerDefaults('ym2612',undefined,.1),RangeError,'An impossible reference must not be silently clamped');
});

test('NES raw reference remains reproducible while its final Analyzer gain uses the AC-RMS policy',async()=>{
 const report=JSON.parse(await readFile(new URL('../issues/analyzer_nes_levels_01.json',import.meta.url),'utf8'));
 assert.equal(report.passed,true);assert.equal(report.referenceSampleRate,44100);
 assert.equal(report.defaults.nesApu,1.981272);
 assert.equal(mixerDefaults('nesApu').gain,1.512236);
 assert.notEqual(mixerDefaults('nesApu').gain,report.defaults.nesApu,'New steady AC-RMS policy supersedes only the old peak-based default');
 assert.notEqual(mixerDefaults('nesApu').gain,baseline.find(record=>record.name==='nes').volume);
 for(const frequencyHz of [220,440,880]){
  const expected=report.rows.find(row=>row.frequencyHz===frequencyHz&&row.sampleRate===44100&&!row.fds);
  const actual=measureAnalyzerNesReference({frequencyHz,sampleRate:44100,fds:false});
  assert.equal(actual.amplitude,expected.amplitude);
  assert.deepEqual(actual.pcm,expected.pcm);
 }
 const reference=report.rows.find(row=>row.frequencyHz===440&&row.sampleRate===44100&&!row.fds);
 assert.equal(round(report.targetAmplitude/reference.amplitude),report.defaults.nesApu,'Historical raw/peak measurement remains intact');
});

test('only standalone Sega PSG, AY and NES defaults use the measured OPNA-FM AC-RMS anchor',()=>{
 assert.equal(psgLevels.passed,true);assert.equal(psgLevels.sampleRate,44100);
 assert.deepEqual(psgLevels.defaults,{psg:.455420,ay8910:1.100331,nesApu:1.512236});
 assert.equal(psgLevels.reference.id,'ym2608');assert.equal(psgLevels.reference.gain,1.03357);
 assert.equal(psgLevels.reference.targetAcRms,.09108396077488734);
 assert.equal(mixerDefaults('ym2608').gain,1.03357,'The OPNA whole-chip gain and internal section balance are unchanged');
 for(const [id,gain] of Object.entries(psgLevels.defaults)){
  const row=psgLevels.rows.find(record=>record.id===id&&record.frequencyHz===440&&record.canonical);
  assert.equal(round(psgLevels.reference.targetAcRms/row.rawAcRms),gain,id+' measured fixed gain');
  assert.equal(mixerDefaults(id).gain,gain);
  assert.ok(Math.abs(row.rawAcRms*gain/psgLevels.reference.targetAcRms-1)<1e-6,id+' AC-RMS target');
 }
 assert.equal(mixerDefaults('psg',{kind:'ym2612'}).gain,1.3012,'Existing Genesis .35 trim is compensated once');
 for(const [name,volume] of [['segapsg',.455420],['ay8910',1.100331],['nes',1.514209],['gameboy',.36],['huc6280',.798619]]){
  assert.equal(baseline.find(record=>record.name===name).volume,volume,name+' library default follows its measured or listening policy');
 }
 assert.notEqual(mixerDefaults('nesApu').gain,baseline.find(record=>record.name==='nes').volume,'Analyzer JSNES retains its own AC-RMS calibration rather than borrowing the WASM NES gain');
 assert.equal(mixerDefaults('gameBoyDmg').gain,.36);
 assert.equal(mixerDefaults('huc6280').gain,.798619);
 const ayAlternate=psgLevels.rows.find(row=>row.id==='ay8910'&&row.frequencyHz===440&&row.ayFlags===0);
 assert.equal(ayAlternate.canonical,false,'A different AY DAC model must not set or clamp the common AY default');
 assert.ok(ayAlternate.after.acRms<psgLevels.reference.targetAcRms);
});
