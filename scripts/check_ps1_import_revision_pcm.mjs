// SPDX-License-Identifier: BSD-3-Clause
// Compare the pinned pre-import-fix API and current API numerically. No audio device.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import factory from '../docs/generated/ps1_spu_wasm.js';
import {Ps1Spu,PS1_SPU_SAMPLE_RATE,PS1_SPU_RAM_BYTES} from '../tetorica_src/runtime/ps1_spu.js';
import {Ps1Resampler} from '../tetorica_src/runtime/ps1_resampler.js';
import {noteToHz} from '../tetorica_src/runtime/soundchip_pitch.js';
import {decodePs1Envelope,patchPs1Envelope,PS1_REVERB_PRESETS} from '../tetorica_src/runtime/ps1_parameters.js';
import {buildPs1CalibrationReference} from './soundchip_calibration_ps1.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>readFile(new URL('../'+path,import.meta.url));
function classFrom(source) {
  const body=source.toString().replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  return vm.runInNewContext(body+'\nPs1Synth;',{
    noteToHz,PS1_SPU_SAMPLE_RATE,PS1_SPU_RAM_BYTES,decodePs1Envelope,patchPs1Envelope,PS1_REVERB_PRESETS,
    Uint8Array,Uint16Array,Float32Array,ArrayBuffer,DataView,Math,Number,RangeError,TypeError,
  });
}
const pcmHash=({left,right})=>sha(Buffer.concat([Buffer.from(left.buffer,left.byteOffset,left.byteLength),Buffer.from(right.buffer,right.byteOffset,right.byteLength)]));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

export async function measurePs1ImportRevisionPcm({beforeSource,afterSource}) {
  const wasmBinary=await read('docs/generated/ps1_spu_wasm.wasm'),module=await factory({wasmBinary});
  const OldSynth=classFrom(beforeSource),NewSynth=classFrom(afterSource),routes=[];
  for(const role of ['primary','extra'])for(const frequencyHz of [220,440,880])for(const outputRate of [44100,48000]) {
    const program=buildPs1CalibrationReference(frequencyHz,{role}),runs=[];
    for(const Type of [OldSynth,NewSynth]) {
      const core=await Ps1Spu.create({moduleFactory:async()=>module}),trace=[];
      const transport={sampleRate:44100,get nativeFrames(){return core.nativeFrames;},
        reset(options){trace.push(['reset',options===undefined?null:{clearRam:options.clearRam}]);core.reset(options);},
        write(address,value){trace.push(['write',address,value]);core.write(address,value);},
        read(address){const value=core.read(address);trace.push(['read',address,value]);return value;},
        loadRam(bytes,address){trace.push(['load',address,bytes.length,sha(bytes)]);core.loadRam(bytes,address);},
        readRam:(...args)=>core.readRam(...args),
        renderInto(left,right,frames,offset=0){core.renderInto(left,right,frames,offset);},
        dispose(){core.dispose();},
      };
      const synth=new Type({core:transport}),context={};
      const execute=source=>new AsyncFunction('createSoundChip','useSoundChip','context',source)(
        async(kind,options)=>{assert.equal(kind,'ps1');assert.deepEqual(options,{id:'calibration-source'});return synth;},
        async kind=>{assert.equal(kind,'ps1');return synth;},context);
      try {
        await execute(program.setup);
        const resampler=new Ps1Resampler(transport,outputRate);
        const render=frames=>{const left=new Float32Array(frames),right=new Float32Array(frames);resampler.render(left,right,frames);return {left,right};};
        render(Math.round(outputRate*.2));const pcm=render(outputRate);
        assert(pcm.left.every(Number.isFinite));assert(pcm.right.every(Number.isFinite));
        assert(Math.max(...pcm.left)>.8,'full-unit reference remains audible in numeric PCM');
        const registers=[core.read(4),core.read(12),core.read(0x180),core.read(0x182)];
        await execute(program.stop);const stopped=render(2048);
        assert(stopped.left.subarray(-256).every(value=>value===0));assert(stopped.right.subarray(-256).every(value=>value===0));
        runs.push({pcm,stopped,trace,registers,ramSha256:sha(core.readRam())});
      } finally {synth.dispose();}
    }
    const [before,after]=runs;
    assert.deepEqual(after.pcm,before.pcm,`${role}/${frequencyHz}/${outputRate} held PCM`);
    assert.deepEqual(after.stopped,before.stopped,'raw key-off PCM');assert.deepEqual(after.trace,before.trace,'register / sample upload trace');
    assert.deepEqual(after.registers,before.registers);assert.equal(after.ramSha256,before.ramSha256);
    routes.push({role,frequencyHz,outputRate,frames:outputRate,pcmSha256:pcmHash(after.pcm),stoppedFrames:2048,stoppedPcmSha256:pcmHash(after.stopped),
      registerTraceSha256:sha(JSON.stringify(after.trace)),registers:after.registers,ramSha256:after.ramSha256,maximumDifference:0,keyOffSilence:true});
  }
  return {schemaVersion:1,passed:true,method:'Exact pre-revision versus current Ps1Synth; original public calibration programs, actual unchanged SPU WASM and host-rate resampler',
    audioContextCreated:false,physicalAudio:false,listeningPerformed:false,nativeSampleRate:44100,
    beforeSource:{bytes:beforeSource.length,sha256:sha(beforeSource)},afterSource:{bytes:afterSource.length,sha256:sha(afterSource)},
    wasm:{path:'docs/generated/ps1_spu_wasm.wasm',bytes:wasmBinary.length,sha256:sha(wasmBinary)},
    referenceProgram:{path:'scripts/soundchip_calibration_ps1.mjs',sha256:sha(await read('scripts/soundchip_calibration_ps1.mjs'))},routes};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'))throw Error('Usage: node scripts/check_ps1_import_revision_pcm.mjs [--out REPORT.json]');
  const {restoreMixerCalibrationPs1ImportRevision}=await import('./mixer_calibration_ps1_import_revision.mjs');
  const current=await read('docs/js/ps1synth.js'),before=restoreMixerCalibrationPs1ImportRevision('js/ps1synth.js',current);
  assert.notEqual(before,current,'current module must match the independently pinned revision');
  const report=await measurePs1ImportRevisionPcm({beforeSource:before,afterSource:current}),json=JSON.stringify(report,null,2)+'\n';
  if(args.length)await writeFile(args[1],json);else process.stdout.write(json);
}
