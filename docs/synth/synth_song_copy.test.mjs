import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthSongCopyPreset} from './synth_song_copy.js';
import {createYm2612RegisterState} from './synth_song_state.js';
import {createSynthProject,synthStatePath} from './synth_project.js';
import {createToneRecovery,parseToneRecovery} from './synth_recovery.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

function snapshot(channel=0,{special=false,csm=false,dac=false,baseFnum=1200}={}) {
  const shadow=createYm2612RegisterState(),port=channel>=3?1:0,offset=channel%3;
  shadow.write(0,0x22,0x0d);
  shadow.write(port,0xb0+offset,0x2c);
  shadow.write(port,0xb4+offset,0x6d); // Right pan, AMS2, PMS5, reserved bit3.
  for(const [index,slot] of [0,8,4,12].entries()) {
    for(const [register,value] of [[0x30,0x31+index],[0x40,10+index*9],[0x50,0x80+24+index],
      [0x60,0x80+index+3],[0x70,index+2],[0x80,0x56+index],[0x90,index+8]]) {
      shadow.write(port,register+slot+offset,value);
    }
  }
  shadow.write(port,0xa4+offset,0x20|(baseFnum>>8));shadow.write(port,0xa0+offset,baseFnum&255);
  if(special) {
    for(const [low,high,block,fnum] of [[0xa9,0xad,2,900],[0xaa,0xae,3,1100],[0xa8,0xac,5,700]]) {
      shadow.write(0,high,(block<<3)|(fnum>>8));shadow.write(0,low,fnum&255);
    }
    shadow.write(0,0x27,csm?0x80:0x40);
  }
  shadow.write(0,0x2b,dac?0x80:0);
  const code=offset|(channel>=3?4:0);
  shadow.write(0,0x28,0xa0|code);shadow.write(0,0x28,code);
  return shadow.snapshot(12345);
}
const capture = (channel=0,options) => createSynthSongCopyPreset(snapshot(channel,options),channel);
const filesAt = (project,paths) => paths.map(path=>project.fs.get(path));

test('copy retains logical operators, pan/LFO and the released source key mask without changing the snapshot',()=>{
  const source=snapshot(),before=JSON.stringify(source),copy=createSynthSongCopyPreset(source,0);
  assert.equal(copy.algorithm,4);assert.equal(copy.feedback,5);
  assert.deepEqual(copy.pan,{left:false,right:true});assert.equal(copy.ams,2);assert.equal(copy.pms,5);
  assert.deepEqual(copy.lfo,{enabled:true,frequency:5});assert.equal(copy.b4,0x6d);
  assert.deepEqual(copy.capturedVoice,{keyMask:10,specialMode:false,specialFrequencies:[]});
  for(let operator=1;operator<=4;operator++) assert.deepEqual(copy.operators[operator],source.channels[0].preset.operators[operator]);
  copy.operators[2].tl=127;copy.lfo.frequency=0;copy.pan.right=false;copy.capturedVoice.keyMask=1;
  assert.equal(JSON.stringify(source),before,'the observed state is never used as mutable editor state');
});

test('CH3 copy preserves four raw frequency pairs and partial KON independently of computed pitch labels',()=>{
  const source=snapshot(2,{special:true}),before=JSON.stringify(source),copy=createSynthSongCopyPreset(source,2);
  assert.deepEqual(copy.capturedVoice,{keyMask:10,specialMode:true,specialFrequencies:[
    {block:2,fnum:900},{block:3,fnum:1100},{block:5,fnum:700},{block:4,fnum:1200},
  ]});
  assert(!('midi' in copy.capturedVoice.specialFrequencies[0]));
  assert(!('frequencyHz' in copy.capturedVoice.specialFrequencies[0]));
  copy.capturedVoice.specialFrequencies[0].fnum=1;
  assert.equal(JSON.stringify(source),before);
});

test('DAC, CSM and missing CH3 base pitch cannot create a misleading FM copy or change the project',()=>{
  const project=createSynthProject();project.createTone(capture(),'Existing');
  const before=project.snapshot();
  for(const [source,channel,reason] of [
    [snapshot(5,{dac:true}),5,/DAC \/ PCM/],
    [snapshot(2,{special:true,csm:true}),2,/CSM/],
    [snapshot(2,{special:true,baseFnum:0}),2,/OP4 base pitch/],
    [null,0,/No YM2612/],
  ]) {
    assert.throws(()=>project.createTone(createSynthSongCopyPreset(source,channel),'Rejected'),reason);
    assert.deepEqual(project.snapshot(),before);
  }
  assert.equal(createSynthSongCopyPreset(snapshot(0,{dac:true}),0).capturedVoice.keyMask,10,'other FM voices can be copied while CH6 uses DAC');
});

test('new copies avoid tones, folders and orphan current/checkpoint sidecars, preserving edited bytes',()=>{
  const project=createSynthProject(),prefix='/presets/Source CH1';
  project.createTone(capture(),'Source CH1');project.syncTone(prefix+'.vgi');
  project.writeTone(prefix+'.vgi',{...project.readTone(prefix+'.vgi').preset,feedback:6});
  project.fs.writeText(prefix+'-2.vgi.synth.json','orphan-current');
  project.fs.writeBinary('/.tet.ss'+prefix+'-3.vgi',new Uint8Array([0,17,255]));
  project.fs.writeText('/.tet.ss'+prefix+'-4.vgi.synth.json','orphan-checkpoint');
  project.mkdir(prefix+'-5.vgi');project.mkdir(prefix+'-6.vgi.synth.json');
  const preserved=[prefix+'.vgi',synthStatePath(prefix+'.vgi'),'/.tet.ss'+prefix+'.vgi',
    '/.tet.ss'+synthStatePath(prefix+'.vgi'),prefix+'-2.vgi.synth.json','/.tet.ss'+prefix+'-3.vgi','/.tet.ss'+prefix+'-4.vgi.synth.json'];
  const before=filesAt(project,preserved),copy=project.createTone(capture(),'Source CH1');
  assert.equal(copy.path,prefix+'-7.vgi');assert.equal(project.selectedPath,copy.path);
  assert.deepEqual(filesAt(project,preserved),before);
  assert.equal(project.createTone(capture(),'Source CH1').path,prefix+'-8.vgi');
  assert.deepEqual(filesAt(project,preserved),before);
  assert.equal(project.readTone(prefix+'.vgi').preset.feedback,6,'unsynced old edits stay intact');
});

test('copied settings survive readTone, TFI/VGI sidecars and Cassette without a project format bump',async()=>{
  const project=createSynthProject(),preset=capture(2,{special:true});
  const tone=project.createTone(preset,'CH3');
  project.writeTone('/presets/also.tfi',preset);
  for(const path of [tone.path,'/presets/also.tfi']) {
    const read=project.readTone(path).preset,state=JSON.parse(project.fs.get(synthStatePath(path)).data);
    assert.equal(state.version,1);assert.equal(state.kind,'tetorica-fm2612-synth');
    assert.deepEqual(read.capturedVoice,preset.capturedVoice);assert.deepEqual(read.lfo,preset.lfo);
    assert.deepEqual(read.pan,preset.pan);assert.equal(read.ams,2);assert.equal(read.pms,5);
    for(let operator=1;operator<=4;operator++) assert.equal(read.operators[operator].am,true);
    read.capturedVoice.specialFrequencies[0].fnum=2;
    assert.equal(project.readTone(path).preset.capturedVoice.specialFrequencies[0].fnum,900,'reads are independent');
  }
  const archive=project.exportCassette(),cassette=await loadPlaygroundCassette(archive),restored=createSynthProject();
  await restored.importCassette(archive);
  assert.equal(restored.snapshot().version,1);
  for(const path of [tone.path,'/presets/also.tfi']) {
    assert.deepEqual(restored.readTone(path).preset.capturedVoice,preset.capturedVoice);
    assert.deepEqual(cassette.files.get(path.slice(1)),project.fs.get(path).data);
    assert.deepEqual(cassette.files.get(synthStatePath(path).slice(1)),new TextEncoder().encode(project.fs.get(synthStatePath(path)).data));
  }
  project.writeTone('/presets/ordinary.vgi',{algorithm:7,operators:{1:{tl:0}}});
  assert(!('capturedVoice' in project.readTone('/presets/ordinary.vgi').preset),'legacy/ordinary tones retain their existing shape');
});

test('metadata-only edits participate in checkpoints, Revert and crash recovery as a complete tone pair',()=>{
  const project=createSynthProject(),tone=project.createTone(capture(2,{special:true}),'CH3');
  project.syncTone(tone.path);
  const original=project.readTone(tone.path),edited=structuredClone(original.preset);
  edited.capturedVoice.keyMask=8;edited.capturedVoice.specialFrequencies[0].fnum=999;
  project.writeTone(tone.path,edited);
  assert.deepEqual(project.fs.get(tone.path).data,original.bytes,'capture metadata is stored separately from VGI');
  assert.equal(project.isToneModified(tone.path),true);
  const recovery=parseToneRecovery(createToneRecovery(project,tone.path,'captured-workspace',1));
  const restored=createSynthProject();restored.fs.writeFiles(recovery.entries,{checkpointChanges:false});
  assert.deepEqual(restored.readTone(tone.path).preset.capturedVoice,edited.capturedVoice);
  assert.deepEqual(restored.revertTone(tone.path).preset.capturedVoice,original.preset.capturedVoice);
  assert.deepEqual(project.revertTone(tone.path).preset.capturedVoice,original.preset.capturedVoice);
  assert.equal(project.isToneModified(tone.path),false);
});

test('all-Off OP settings survive TFI/VGI, Sync/Revert, Cassette and crash recovery',async()=>{
  for(const special of [false,true]) {
    const project=createSynthProject(),preset=capture(special?2:0,{special});
    preset.capturedVoice.keyMask=0;
    const tone=project.createTone(preset,special?'Silent CH3':'Silent FM');
    project.writeTone('/presets/silent.tfi',preset);
    project.syncTone(tone.path);
    const edited=project.readTone(tone.path).preset;edited.capturedVoice.keyMask=15;
    project.writeTone(tone.path,edited);
    assert.equal(project.readTone(tone.path).preset.capturedVoice.keyMask,15);
    assert.equal(project.revertTone(tone.path).preset.capturedVoice.keyMask,0);
    project.syncTone(tone.path);
    project.writeTone(tone.path,edited);
    const recovery=parseToneRecovery(createToneRecovery(project,tone.path,'all-Off-workspace',1));
    const recovered=createSynthProject();recovered.fs.writeFiles(recovery.entries,{checkpointChanges:false});
    assert.equal(recovered.readTone(tone.path).preset.capturedVoice.keyMask,15);
    assert.equal(recovered.revertTone(tone.path).preset.capturedVoice.keyMask,0,'the silent checkpoint survives recovery');
    project.revertTone(tone.path);
    const restored=createSynthProject();await restored.importCassette(project.exportCassette());
    for(const path of [tone.path,'/presets/silent.tfi']) {
      assert.deepEqual(restored.readTone(path).preset.capturedVoice,preset.capturedVoice);
      const sidecar=restored.fs.get(synthStatePath(path)).data;
      assert.equal(JSON.parse(typeof sidecar==='string'?sidecar:new TextDecoder().decode(sidecar)).version,1);
    }
  }
});

test('malformed captured metadata is rejected before changing tone, selection, snapshots or Cassette',async()=>{
  const project=createSynthProject(),tone=project.createTone(capture(2,{special:true}),'Valid');
  project.syncTone(tone.path);const before=project.snapshot(),good=project.readTone(tone.path).preset;
  const badStates=[null,{},
    {...good.capturedVoice,keyMask:-1},{...good.capturedVoice,keyMask:16},{...good.capturedVoice,keyMask:1.5},
    {...good.capturedVoice,specialMode:'true'},
    {...good.capturedVoice,specialMode:false},
    {...good.capturedVoice,specialFrequencies:good.capturedVoice.specialFrequencies.slice(1)},
    {...good.capturedVoice,specialFrequencies:[{block:8,fnum:1},...good.capturedVoice.specialFrequencies.slice(1)]},
    {...good.capturedVoice,specialFrequencies:[...good.capturedVoice.specialFrequencies.slice(0,3),{block:4,fnum:0}]},
  ];
  for(const capturedVoice of badStates) {
    const bad={...good,capturedVoice};
    assert.throws(()=>project.writeTone(tone.path,bad));
    assert.throws(()=>project.createTone(bad,'Rejected'));
    assert.deepEqual(project.snapshot(),before);
    const sidecar=JSON.parse(project.fs.get(synthStatePath(tone.path)).data);sidecar.capturedVoice=capturedVoice;
    const invalidSnapshot=structuredClone(before);
    invalidSnapshot.files.find(file=>file.path===synthStatePath(tone.path)).data=JSON.stringify(sidecar);
    assert.throws(()=>project.restore(invalidSnapshot));assert.deepEqual(project.snapshot(),before);
    const archive=createPlaygroundCassetteZip(invalidSnapshot.files,{directories:invalidSnapshot.directories});
    await assert.rejects(project.importCassette(archive));assert.deepEqual(project.snapshot(),before);
    const recovery=JSON.parse(createToneRecovery(project,tone.path,'workspace',0));
    recovery.entries.find(entry=>entry.path==='/.tet.ss'+synthStatePath(tone.path)).data=JSON.stringify(sidecar);
    assert.throws(()=>parseToneRecovery(JSON.stringify(recovery)));
  }
});
