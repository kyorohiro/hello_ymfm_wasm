import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {
  MIXER_CALIBRATION_PS1_STARTER_PATH,
  mixerCalibrationPs1StarterOutsideSha256,
  mixerCalibrationReceiptObjectSha256,
  restoreMixerCalibrationPs1StarterRevision,
  readMixerCalibrationPs1StarterReceipt,
} from './mixer_calibration_sources.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});
const path='js/ps1synth.js';
const prefix="import {PS1_SPU_SAMPLE_RATE} from './ps1_spu.js';\nconst physicalVoiceCount=24;\n";
const suffix='\nexport class Ps1Synth { render(){ return physicalVoiceCount; } }\n';
const beforeFactory=`/** Original initial sample, quiet filter-0 sine. */
export function createPs1InitSample() {
  const adpcm=new Uint8Array(64);
  for (let block=0;block<4;block++) {
    adpcm[block*16]=4; // Filter 0, shift 4.
    adpcm[block*16+1]=block===3?3:block===0?6:0;
    for (let pair=0;pair<14;pair++) {
      const index=block*28+pair*2;
      const nibble=frame=>Math.round(7*Math.sin(2*Math.PI*frame/112))&15;
      adpcm[block*16+2+pair]=nibble(index)|(nibble(index+1)<<4);
    }
  }
  return {adpcm,baseFrequencyHz:PS1_SPU_SAMPLE_RATE/112,loopStartSamples:0};
}`;
const afterFactory=beforeFactory
  .replace('quiet filter-0 sine','reference-level filter-0 sine')
  .replace('adpcm[block*16]=4; // Filter 0, shift 4.','adpcm[block*16]=0; // Filter 0, shift 0.')
  .replace('Math.round(7*Math.sin','Math.round(5*Math.sin');
const reportPaths=['ps1','wonderswan','pokey'].map(kind=>'docs/issues/'+kind+'_chip_levels_01.json');

function fixture(){
  const before=Buffer.from(prefix+beforeFactory+suffix),after=Buffer.from(prefix+afterFactory+suffix);
  const report={schemaVersion:1,passed:true,verify:false,sources:{[path]:record(before)}};
  const reportBytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
  const identity={sha256:sha(reportBytes),objectSha256:sha(JSON.stringify(report))};
  const receipt={schemaVersion:1,scope:'ps1-initial-sample-revision',feature:'PS1 initial sine instrument level',
    reports:Object.fromEntries(reportPaths.map(name=>[name,{...identity}])),
    source:{path,before:record(before),after:record(after),function:'createPs1InitSample',
      beforeFactory,afterFactory,outsideSha256:mixerCalibrationPs1StarterOutsideSha256(before)}};
  return {before,after,report,reportBytes,receipt,reportSha256:sha(reportBytes),
    receiptObjectSha256:mixerCalibrationReceiptObjectSha256(receipt)};
}
function restore(f,extra={}){
  return restoreMixerCalibrationPs1StarterRevision({path,bytes:f.after,report:f.report,
    reportSha256:f.reportSha256,receipt:f.receipt,receiptObjectSha256:f.receiptObjectSha256,...extra});
}
function repinned(f,mutate,extra={}){
  const receipt=structuredClone(f.receipt);mutate(receipt);
  return {receipt,receiptObjectSha256:mixerCalibrationReceiptObjectSha256(receipt),...extra};
}

test('PS1 starter revision restores every predecessor byte and leaves evidence untouched',()=>{
  const f=fixture(),receiptJson=JSON.stringify(f.receipt),reportJson=JSON.stringify(f.report),after=Buffer.from(f.after);
  assert.equal(MIXER_CALIBRATION_PS1_STARTER_PATH,path);
  const result=restore(f);
  assert(Buffer.isBuffer(result));assert.deepEqual(result,f.before);
  assert.equal(sha(result),f.report.sources[path].sha256);
  assert.equal(JSON.stringify(f.receipt),receiptJson);assert.equal(JSON.stringify(f.report),reportJson);
  assert.deepEqual(f.after,after);
});

test('outside-factory identity ignores only this one complete JSDoc and named factory',()=>{
  const f=fixture(),expected=mixerCalibrationPs1StarterOutsideSha256(f.before);
  assert.equal(mixerCalibrationPs1StarterOutsideSha256(f.after),expected);
  for(const changed of [
    f.after.toString().replace('physicalVoiceCount=24','physicalVoiceCount=25'),
    f.after.toString().replace('return physicalVoiceCount','return physicalVoiceCount+1'),
    f.after.toString()+'// another byte\n',
  ])assert.notEqual(mixerCalibrationPs1StarterOutsideSha256(Buffer.from(changed)),expected);
});

test('starter revision requires an independent exact receipt pin',()=>{
  const f=fixture();
  for(const receiptObjectSha256 of [undefined,'', '0'.repeat(64)])assert.throws(()=>restore(f,{receiptObjectSha256}));
  const receipt=structuredClone(f.receipt);receipt.source.after.sha256='0'.repeat(64);
  assert.throws(()=>restore(f,{receipt}));
  assert.throws(()=>restore(f,{receipt:undefined}));
});

test('starter revision binds both raw report bytes and parsed report identity',()=>{
  const f=fixture();
  assert.throws(()=>restore(f,{reportSha256:'0'.repeat(64)}));
  assert.throws(()=>restore(f,{reportSha256:undefined}));
  assert.throws(()=>restore(f,{report:{...f.report,extra:'changed after measurement'}}));
  // Reformatting JSON preserves the object but must retain its distinct raw-file identity.
  assert.throws(()=>restore(f,{reportSha256:sha(JSON.stringify(f.report))}));
  assert.throws(()=>restore(f,repinned(f,r=>{
    for(const identity of Object.values(r.reports))identity.objectSha256='0'.repeat(64);
  })));
});

test('even repinned receipts cannot widen the exact feature, path or report inventory',()=>{
  const f=fixture(),mutations=[
    r=>r.schemaVersion=2,r=>r.scope='any-initial-sample',r=>r.feature='all PS1 synthesis',
    r=>r.source.path='js/another_synth.js',r=>r.source.function='render',
    r=>delete r.reports[reportPaths[2]],
    r=>r.reports['docs/issues/other_chip_levels_01.json']=r.reports[reportPaths[0]],
  ];
  for(const mutate of mutations)assert.throws(()=>restore(f,repinned(f,mutate)));
});

test('starter receipt never authorizes another DSP, UI, transport or WASM file',()=>{
  const f=fixture();
  for(const other of ['js/ps1_spu.js','js/playground_runtime.js','js/chip_worklet_transport.js',
    'playground/playground_ps1_voice_panel.js','generated/ps1_spu_wasm.wasm']){
    assert.throws(()=>restore(f,{path:other}));
  }
});

test('current factory bytes must exactly match the reviewed after record',()=>{
  const f=fixture();
  for(const bytes of [f.before,Buffer.from(f.after.toString().replace('Math.round(5*','Math.round(6*')),
    Buffer.concat([f.after,Buffer.from('\n')])])assert.throws(()=>restore(f,{bytes}));
  assert.throws(()=>restore(f,repinned(f,r=>r.source.after.bytes++)));
  assert.throws(()=>restore(f,repinned(f,r=>r.source.after.sha256='0'.repeat(64))));
});

test('same-length changes outside the factory remain forbidden after repinning after records',()=>{
  const f=fixture(),bytes=Buffer.from(f.after.toString().replace('physicalVoiceCount=24','physicalVoiceCount=25'));
  assert.equal(bytes.length,f.after.length);
  assert.throws(()=>restore(f,repinned(f,r=>r.source.after=record(bytes),{bytes})));
  // An attacker cannot make wider changes legitimate by also replacing the outside hash.
  assert.throws(()=>restore(f,repinned(f,r=>{
    r.source.after=record(bytes);r.source.outsideSha256=mixerCalibrationPs1StarterOutsideSha256(bytes);
  },{bytes})));
});

test('restored predecessor must remain attached to the unchanged measurement record',()=>{
  const f=fixture();
  for(const mutate of [r=>r.source.before.bytes++,r=>r.source.before.sha256='0'.repeat(64),
    r=>r.source.beforeFactory=r.source.beforeFactory.replace('Math.round(7*','Math.round(6*')]){
    assert.throws(()=>restore(f,repinned(f,mutate)));
  }
});

test('even a repinned exact factory cannot change tuning, loop, packet size or other synthesis logic',()=>{
  const f=fixture();
  for(const [from,to] of [
    ['baseFrequencyHz:PS1_SPU_SAMPLE_RATE/112','baseFrequencyHz:PS1_SPU_SAMPLE_RATE/111'],
    ['loopStartSamples:0','loopStartSamples:28'],
    ['new Uint8Array(64)','new Uint8Array(80)'],
    ['block===3?3:block===0?6:0','block===3?1:block===0?6:0'],
    ['Math.round(5*Math.sin','Math.round(6*Math.sin'],
    ['shift 0.','shift 1.'],
  ]){
    const alteredFactory=afterFactory.replace(from,to);
    assert.notEqual(alteredFactory,afterFactory);
    const bytes=Buffer.from(prefix+alteredFactory+suffix);
    assert.throws(()=>restore(f,repinned(f,r=>{
      r.source.afterFactory=alteredFactory;r.source.after=record(bytes);
    },{bytes})));
  }
});

test('receipt factory fields must be exact factory captures, not adjacent executable code',()=>{
  const f=fixture();
  for(const mutate of [
    r=>r.source.afterFactory='const injected=true;\n'+r.source.afterFactory,
    r=>r.source.beforeFactory=r.source.beforeFactory+'\n'+suffix,
    r=>r.source.afterFactory=r.source.afterFactory.replace('createPs1InitSample','otherFactory'),
    r=>r.source.beforeFactory=r.source.beforeFactory.replace('/** Original','/* Original'),
    r=>r.source.outsideSha256='0'.repeat(64),
  ])assert.throws(()=>restore(f,repinned(f,mutate)));
});

test('missing or duplicate factories cannot be canonicalized or restored',()=>{
  const f=fixture();
  for(const text of [prefix+suffix,prefix+afterFactory+suffix+afterFactory+'\n',
    prefix+afterFactory.replace('export function createPs1InitSample()','export function otherFactory()')+suffix,
    prefix+afterFactory.replace('/** Original','/* Original')+suffix]){
    const bytes=Buffer.from(text);
    assert.throws(()=>mixerCalibrationPs1StarterOutsideSha256(bytes));
    assert.throws(()=>restore(f,repinned(f,r=>r.source.after=record(bytes),{bytes})));
  }
});

test('invalid UTF-8 cannot be hidden by replacing the factory region',()=>{
  const f=fixture(),bytes=Buffer.concat([Buffer.from([0xff]),f.after]);
  assert.throws(()=>mixerCalibrationPs1StarterOutsideSha256(bytes));
  assert.throws(()=>restore(f,repinned(f,r=>r.source.after=record(bytes),{bytes})));
});

test('committed starter receipt retains its historical identities and rejects the later live DSP revision',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const evidence=await readMixerCalibrationPs1StarterReceipt(root);
  const bytes=await readFile(new URL('../docs/'+MIXER_CALIBRATION_PS1_STARTER_PATH,import.meta.url));
  assert.equal(mixerCalibrationReceiptObjectSha256(evidence.receipt),evidence.receiptObjectSha256);
  for(const kind of ['ps1','wonderswan','pokey']){
    const reportBytes=await readFile(new URL('../docs/issues/'+kind+'_chip_levels_01.json',import.meta.url)),report=JSON.parse(reportBytes);
    const identity=evidence.receipt.reports['docs/issues/'+kind+'_chip_levels_01.json'];
    assert.equal(identity.sha256,sha(reportBytes));assert.equal(identity.objectSha256,sha(JSON.stringify(report)));
    assert.deepEqual(evidence.receipt.source.before,report.sources[MIXER_CALIBRATION_PS1_STARTER_PATH]);
    assert.notEqual(sha(bytes),evidence.receipt.source.after.sha256,'later DSP bytes are not the reviewed sample-level-only revision');
    assert.throws(()=>restoreMixerCalibrationPs1StarterRevision({path:MIXER_CALIBRATION_PS1_STARTER_PATH,bytes,report,reportSha256:sha(reportBytes),...evidence}),/PS1 starter revision changed|outside-factory source changed/);
  }
});
