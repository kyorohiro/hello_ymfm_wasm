import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readSource,exportSource,listSourceScoreChannels,inspectSourceSupport} from '../cli/index.js';
import {analyzeLilyPondSource} from '../docs/vgm_analyzer/vgm_lilypond.js';
import {isOpl,createOplMonitor,applyOplWrite,describeOplNotes} from '../docs/vgm_analyzer/opl_notes.js';
import {createPlaybackEngine,createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {getNodePlaybackFactory} from '../cli/render.js';
const fixture=name=>new URL(`./fixtures/y8950-${name}.vgz`,import.meta.url);
test('Y8950 FM notes survive ADPCM mixing, while ADPCM-only does not create pitches',async()=>{
  const fm=await readSource(fixture('fm')),mix=await readSource(fixture('mix')),pcm=await readSource(fixture('adpcm'));
  assert.deepEqual(analyzeLilyPondSource(fm).channels,analyzeLilyPondSource(mix).channels);
  assert(analyzeLilyPondSource(pcm).channels.every(ch=>ch.notes.length===0));
  assert.throws(()=>exportSource(pcm,{format:'midi'}),/No convertible/);
  for(const format of ['musicxml','lilypond'])assert.equal(exportSource(pcm,{format,bpm:120}).noteCount,0);
  for(const format of ['midi','musicxml','lilypond']){
    const r=exportSource(mix,{format,bpm:120});assert(r.noteCount>0);
    assert(r.warnings.some(w=>/Y8950 ADPCM.*omitted/.test(w)));
  }
  const support=await inspectSourceSupport(mix);
  for(const format of ['midi','musicxml','lilypond'])assert.equal(support.exports[format].status,'available');
  assert.equal(support.exports.tfi.status,'unavailable');
});
test('Y8950 + PSG exports keep FM and PSG; channel selection and grouping work',async()=>{
  const b=await readSource(fixture('psg')),score=analyzeLilyPondSource(b);
  assert.equal(score.channels.length,12);
  assert(score.channels.slice(0,9).some(ch=>ch.notes.length));
  assert(score.channels.slice(9).some(ch=>ch.notes.length));
  const channels=listSourceScoreChannels(b).channels;
  assert.equal(channels[0].id,'y8950-ch1');assert.equal(channels[8].id,'y8950-ch9');
  for(const format of ['musicxml','lilypond']){
    const selected=exportSource(b,{format,bpm:120,channels:['y8950-ch1']});
    assert.match(selected.text,/Y8950 CH1/);assert.doesNotMatch(selected.text,/PSG 1|Y8950 CH2/);
    const merged=exportSource(b,{format,bpm:120,groups:[{id:'lead',name:'Lead',channels:['y8950-ch1','psg-1']}],channels:['y8950-ch1','psg-1']});
    assert.match(merged.text,/Lead/);assert(merged.noteCount>0);
  }
  assert(exportSource(b,{format:'midi'}).noteCount>0);
});
test('Y8950 exports reject dual/variant headers and second-chip writes',async()=>{
  const b=await readSource(fixture('fm'));
  for(const mask of [0x40000000,0x80000000]){
    const bad=b.slice();new DataView(bad.buffer).setUint32(0x58,(3579545|mask)>>>0,true);
    for(const format of ['midi','musicxml','lilypond'])assert.throws(()=>exportSource(bad,{format,bpm:120}),/Dual/);
  }
  const bad=b.slice();assert.equal(bad[256],0x5c);bad[256]=0xac;
  assert.throws(()=>exportSource(bad,{format:'musicxml',bpm:120}),/Second OPL/);
  const mixed=b.slice();new DataView(mixed.buffer).setUint32(0x54,3579545,true);
  assert.throws(()=>exportSource(mixed,{format:'musicxml',bpm:120}),/mixed OPL/);
});
test('Analyzer hooks the real Y8950 writer; reset, ADPCM and mute controls remain usable',async()=>{
  const b=await readSource(fixture('mix'));
  const {Ym2612VGM}=await import('../docs/js/ym2612vgm.js');
  const engine=await createPlaybackEngine(new Ym2612VGM(b),{getFactory:getNodePlaybackFactory});
  const source=readFileSync(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
  const fn=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
  const c=vm.createContext({engine,isOpl,createOplMonitor,applyOplWrite,describeOplNotes,chip:'y8950',currentChipKind:'y8950',
    noteishHeader:{y8950Clock:3579545},apuNoteMonitor:null,apuNoteChannels:[],
    buildMonitorChannel:i=>({channel:i,noteHistory:[],noteMinMidi:null,noteMaxMidi:null}),songTimeMs:()=>0,
    pruneChannelNoteHistory(){},requestNoteishRender(){},requestChannelMonitorRender(){}});
  vm.runInContext(fn('updateApuNoteMonitor')+'\n'+fn('resetApuNoteChannels')+'\nresetApuNoteChannels();',c);
  const start=source.indexOf('      if (isOpl(chip)) {'),end=source.indexOf("      if (chip === 'ymf262' || chip === 'ymf278b')",start);
  vm.runInContext(source.slice(start,end),c);
  try{
    const player=createPlaybackPlayer(engine,b);player.setPrefetchFactor(1);player.play();
    player.process(new Float32Array(1),new Float32Array(1),1);
    assert.equal(c.apuNoteChannels.length,9);assert(c.apuNoteChannels.some(ch=>ch.keyOn&&ch.toneMidi!==null));
    engine.setAdpcmMuted(true);engine.setChannelMuted(0,true);engine.setY8950Muted(true);
    assert(engine.processFrames(100).left.every(x=>x===0));
    engine.setY8950Muted(false);engine.setChannelMuted(0,false);engine.setAdpcmMuted(false);
    player.reset();assert(c.apuNoteChannels.every(ch=>ch.toneMidi===null));
  }finally{engine.dispose();}
});
