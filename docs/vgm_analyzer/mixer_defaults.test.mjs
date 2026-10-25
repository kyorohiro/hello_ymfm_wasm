import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mixerDefaults,legacyEngineTrim} from './mixer_defaults.js';
import {SOUNDCHIP_MIXER_PRESETS, SOUNDCHIP_MIXER_LISTENING_LEVELS} from '../js/soundchip_mixer_presets.js';
import {ANALYZER_MIXER_DEFAULTS} from './mixer_calibration_data.js';
import {measureAnalyzerNesReference} from '../../scripts/measure_analyzer_nes_levels.mjs';

const baseline = SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds;
const aliases = {segapsg:'psg',gameboy:'gameBoyDmg',nes:'nesApu'};
const canonicalKinds = Object.fromEntries(Object.entries(aliases).map(([kind,id])=>[id,kind]));
const round = value => Number(value.toFixed(6));
const psgLevels=JSON.parse(await readFile(new URL('../issues/analyzer_psg_levels_01.json',import.meta.url),'utf8'));
const psgGain=.35;

test('Analyzer uses canonical listening levels before historical renderer measurements',async()=>{
 for(const {name,volume} of baseline){
  const id=aliases[name]??name;
  assert.deepEqual(mixerDefaults(id),{gain:SOUNDCHIP_MIXER_LISTENING_LEVELS[name]??ANALYZER_MIXER_DEFAULTS[id]??volume,pan:0,muted:false},id);
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

test('source-unit defaults do not depend on legacy downstream FM/PSG balance',()=>{
 const genesis={kind:'ym2612'},opl={kind:'ym3812'};
 assert.equal(mixerDefaults('ym2612',genesis).gain,.775938);
 assert.equal(mixerDefaults('psg',genesis).gain,psgGain);
 for(const configuration of [undefined,opl,{kind:'ym2151'},{kind:'ym2413'},{kind:'mixed',parts:[{id:'ym3812',kind:'ym3812',chips:['ym3812','psg']}]}]){
  assert.equal(mixerDefaults('psg',configuration).gain,psgGain,'Other PSG owners receive no Genesis compensation');
 }
 const mixed={kind:'mixed',parts:[{id:'genesis',kind:'ym2612',chips:['ym2612','psg']},{id:'nesApu',kind:'nes',chips:['nesApu']}]};
 assert.equal(mixerDefaults('psg',mixed).gain,psgGain);
 assert.equal(mixerDefaults('ym2612',mixed).gain,.775938);
 assert.equal(mixerDefaults('nesApu',mixed).gain,mixerDefaults('nesApu').gain);
 assert.equal(mixerDefaults('rf5c164',genesis).gain,.280286);
 assert.equal(legacyEngineTrim('psg',genesis),.35);
 assert.equal(legacyEngineTrim('ym2612',mixed),.9);
 assert.equal(legacyEngineTrim('psg',opl),1);
});

test('Analyzer-specific measurements remain intact beneath explicit listening defaults',async()=>{
 for(const name of ['analyzer_nes_levels_01','analyzer_extra_levels_01']){
  const report=JSON.parse(await readFile(new URL(`../issues/${name}.json`,import.meta.url),'utf8'));
  assert.equal(report.passed,true);
  for(const [id,gain] of Object.entries(report.defaults)){
   const historical=psgLevels.defaults[id]??gain;
   const current=SOUNDCHIP_MIXER_LISTENING_LEVELS[canonicalKinds[id]??id]??historical;
   assert.equal(ANALYZER_MIXER_DEFAULTS[id],historical,id+' historical generated measurement');
   assert.deepEqual(mixerDefaults(id,{kind:'ym2612'},1),{gain:current,pan:0,muted:false},id+' actual route');
  }
 }
});

test('legacy trim arguments do not alter source-unit defaults or silently clamp them',()=>{
 assert.equal(mixerDefaults('psg',{kind:'ym2612'},1).gain,psgGain);
 assert.equal(mixerDefaults('psg',{kind:'ym3812'},.35).gain,psgGain);
 assert.equal(mixerDefaults('ym2612',undefined,.9).gain,.775938);
 for(const trim of [0,-1,NaN,Infinity])assert.throws(()=>mixerDefaults('ym2612',undefined,trim),RangeError);
 assert.equal(mixerDefaults('ym2612',undefined,.1).gain,.775938,'Legacy engine balance is handled at the app renderer boundary');
});

test('NES raw reference remains reproducible while its final gain uses the shared listening policy',async()=>{
 const report=JSON.parse(await readFile(new URL('../issues/analyzer_nes_levels_01.json',import.meta.url),'utf8'));
 assert.equal(report.passed,true);assert.equal(report.referenceSampleRate,44100);
 assert.equal(report.defaults.nesApu,1.981272);
 assert.equal(psgLevels.defaults.nesApu,1.512236,'The old Analyzer AC-RMS measurement remains intact');
 assert.equal(mixerDefaults('nesApu').gain,1.16);
 assert.notEqual(mixerDefaults('nesApu').gain,report.defaults.nesApu,'The listening policy supersedes the old peak-based default');
 assert.equal(mixerDefaults('nesApu').gain,baseline.find(record=>record.name==='nes').volume);
 for(const frequencyHz of [220,440,880]){
  const expected=report.rows.find(row=>row.frequencyHz===frequencyHz&&row.sampleRate===44100&&!row.fds);
  const actual=measureAnalyzerNesReference({frequencyHz,sampleRate:44100,fds:false});
  assert.equal(actual.amplitude,expected.amplitude);
  assert.deepEqual(actual.pcm,expected.pcm);
 }
 const reference=report.rows.find(row=>row.frequencyHz===440&&row.sampleRate===44100&&!row.fds);
 assert.equal(round(report.targetAmplitude/reference.amplitude),report.defaults.nesApu,'Historical raw/peak measurement remains intact');
});

test('historical PSG measurements and OPN balance remain intact beneath shared listening levels',()=>{
 assert.equal(psgLevels.passed,true);assert.equal(psgLevels.sampleRate,44100);
 assert.deepEqual(psgLevels.defaults,{psg:.455420,ay8910:1.100331,nesApu:1.512236});
 assert.equal(psgLevels.reference.id,'ym2608');assert.equal(psgLevels.reference.gain,1.03357);
 assert.equal(psgLevels.reference.targetAcRms,.09108396077488734);
 for(const [id,gain] of Object.entries({ym2612:.775938,ym2203:.516785,ym2608:1.03357,ym2610:1.03357,ym2610b:1.03357})){
  assert.equal(mixerDefaults(id).gain,gain,id+' whole-chip gain and internal section balance are unchanged');
 }
 for(const [id,gain] of Object.entries(psgLevels.defaults)){
  const row=psgLevels.rows.find(record=>record.id===id&&record.frequencyHz===440&&record.canonical);
  assert.equal(round(psgLevels.reference.targetAcRms/row.rawAcRms),gain,id+' measured fixed gain');
  assert.equal(mixerDefaults(id).gain,SOUNDCHIP_MIXER_LISTENING_LEVELS[canonicalKinds[id]??id]);
  assert.ok(Math.abs(row.rawAcRms*gain/psgLevels.reference.targetAcRms-1)<1e-6,id+' AC-RMS target');
 }
 assert.equal(mixerDefaults('psg',{kind:'ym2612'}).gain,.35,'Genesis and standalone PSG use identical source units');
 assert.deepEqual(SOUNDCHIP_MIXER_LISTENING_LEVELS,{segapsg:.35,ay8910:.85,nes:1.16,gameboy:.36,huc6280:.44});
 for(const [name,volume] of Object.entries(SOUNDCHIP_MIXER_LISTENING_LEVELS)){
  assert.equal(baseline.find(record=>record.name===name).volume,volume,name+' library default follows its measured or listening policy');
 }
 assert.equal(mixerDefaults('nesApu').gain,baseline.find(record=>record.name==='nes').volume,'The selected listening level is shared while each backend keeps its raw measurement');
 assert.equal(mixerDefaults('gameBoyDmg').gain,.36);
 assert.equal(mixerDefaults('huc6280').gain,.44);
 const ayAlternate=psgLevels.rows.find(row=>row.id==='ay8910'&&row.frequencyHz===440&&row.ayFlags===0);
 assert.equal(ayAlternate.canonical,false,'A different AY DAC model must not set or clamp the common AY default');
 assert.ok(ayAlternate.after.acRms<psgLevels.reference.targetAcRms);
});
