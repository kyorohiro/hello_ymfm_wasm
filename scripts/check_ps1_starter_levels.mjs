/** Bounded offline measurement of the shipped PS1 core and starter instrument.
 * No browser, AudioContext, physical audio output, or native compilation.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../web/ps1_spu.js';
import {Ps1Synth,createPs1InitSample} from '../web/ps1synth.js';
import {Ps1Resampler} from '../web/ps1_resampler.js';
import {preparePs1Waveform,PS1_WAVEFORM_FRAMES} from '../web/ps1_waveform.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../web/soundchip_mixer_presets.js';
import {createPlaygroundSoundChipMixer} from '../docs/playground/playground_mixer_defaults.js';
import {buildPs1CalibrationReference} from './soundchip_calibration_ps1.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const NATIVE_RATE=44100,FRAMES=112,BLOCK_FRAMES=128,FREQUENCY_HZ=440;
const WARMUP_SECONDS=.2,CAPTURE_SECONDS=1,STOP_FRAMES=2048;
const FROZEN_MIXER_VOLUME=.129331;
const hash=value=>createHash('sha256').update(value).digest('hex');

// Historical fixtures only, loaded solely by this offline check.
// The old starter was filter0/shift4 with signed codes -7..7; the calibration
// reference independently retained filter0/shift0 with the same codes.
function historicalSine(shift,peakCode=7) {
  const adpcm=new Uint8Array(64);
  for(let block=0;block<4;block++) {
    adpcm[block*16]=shift;
    adpcm[block*16+1]=block===0?6:block===3?3:0;
    for(let pair=0;pair<14;pair++) {
      const frame=block*28+pair*2;
      const nibble=i=>Math.round(peakCode*Math.sin(2*Math.PI*i/FRAMES))&15;
      adpcm[block*16+2+pair]=nibble(frame)|(nibble(frame+1)<<4);
    }
  }
  return {adpcm,baseFrequencyHz:NATIVE_RATE/FRAMES,loopStartSamples:0};
}

function filter0DecodedPeak(adpcm) {
  let peak=0;
  for(let offset=0;offset<adpcm.length;offset+=16) {
    assert.equal(adpcm[offset]>>4,0,'Raw peak calculation is limited to predictor0 packets');
    for(let i=offset+2;i<offset+16;i++)for(const nibble of [adpcm[i]&15,adpcm[i]>>4]) {
      const signed=nibble<8?nibble:nibble-16;
      peak=Math.max(peak,Math.abs((signed*4096)>>adpcm[offset])/32768);
    }
  }
  return peak;
}

// Only fixed-size PCM blocks and scalar statistics are retained. Hashes use
// canonical little-endian Float32 bytes, independent of host byte order.
class PcmStatistics {
  constructor(rate) {
    this.rate=rate;this.frames=0;this.minimum=Infinity;this.maximum=-Infinity;
    this.sum=0;this.squares=0;this.nonfinite=0;this.nonzero=0;this.overrange=0;
    this.crossings=0;this.firstCrossing=null;this.lastCrossing=null;
    this.previous=0;this.maximumAdjacentJump=0;
    this.digest=createHash('sha256');this.bytes=Buffer.alloc(BLOCK_FRAMES*4);
  }
  add(values,frames=values.length,offset=0) {
    assert(frames<=BLOCK_FRAMES,'Statistics accept only bounded blocks');
    for(let i=0;i<frames;i++) {
      const value=values[offset+i],frame=this.frames++;
      this.bytes.writeFloatLE(value,i*4);
      if(!Number.isFinite(value))this.nonfinite++;
      this.minimum=Math.min(this.minimum,value);this.maximum=Math.max(this.maximum,value);
      this.sum+=value;this.squares+=value*value;
      if(value!==0)this.nonzero++;if(Math.abs(value)>1)this.overrange++;
      if(frame) {
        this.maximumAdjacentJump=Math.max(this.maximumAdjacentJump,Math.abs(value-this.previous));
        if(this.previous<=0&&value>0) {
          const crossing=frame-1-this.previous/(value-this.previous);
          if(this.firstCrossing===null)this.firstCrossing=crossing;
          this.lastCrossing=crossing;this.crossings++;
        }
      }
      this.previous=value;
    }
    this.digest.update(this.bytes.subarray(0,frames*4));
  }
  finish() {
    const dc=this.sum/this.frames,rms=Math.sqrt(this.squares/this.frames);
    return {frames:this.frames,minimum:this.minimum,maximum:this.maximum,
      peak:Math.max(Math.abs(this.minimum),Math.abs(this.maximum)),
      halfPeakToPeak:(this.maximum-this.minimum)/2,dc,rms,
      acRms:Math.sqrt(Math.max(0,rms*rms-dc*dc)),
      measuredFrequencyHz:this.crossings>1?(this.crossings-1)*this.rate/(this.lastCrossing-this.firstCrossing):null,
      nonfinite:this.nonfinite,nonzero:this.nonzero,overrange:this.overrange,
      maximumAdjacentJump:this.maximumAdjacentJump,pcmFloat32LeSha256:this.digest.digest('hex')};
  }
}

function mixerPolicy() {
  const calibrated=SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(value=>value.name==='ps1')?.volume;
  const primary=createPlaygroundSoundChipMixer('ps1'),extra=createPlaygroundSoundChipMixer('genesis');
  primary.register('ps1','ps1',()=>{});extra.register('ps1:starter-check','ps1',()=>{});
  const volumes={standaloneCalibrated:calibrated,playgroundPrimary:primary.get('ps1').volume,
    playgroundExtra:extra.get('ps1:starter-check').volume};
  for(const [name,value] of Object.entries(volumes))assert.equal(value,FROZEN_MIXER_VOLUME,`${name} keeps the existing PS1 Mixer policy`);
  return {volume:volumes.playgroundPrimary,frozenExpectedVolume:FROZEN_MIXER_VOLUME,volumes,
    source:'Generated Playground defaults and opt-in standalone calibrated preset',changed:false};
}

async function measureFixture(module,fixture,outputRate,mixerVolume) {
  const core=await Ps1Spu.create({moduleFactory:async()=>module}),synth=new Ps1Synth({core});
  const left=new Float32Array(BLOCK_FRAMES),right=new Float32Array(BLOCK_FRAMES);
  try {
    synth.reset({clearRam:true});synth.setReverb({preset:'off',volumeLeft:0,volumeRight:0});
    const {adpcm,...options}=fixture.sample;
    const sample=fixture.editor?synth._setWaveformPrepared(0,fixture.editor):synth.loadADPCM(adpcm,options);
    synth.setPreset(0,{sample,volumeLeft:.75,volumeRight:.75,adsr1:0x000f,adsr2:0,reverb:false});
    synth.setFrequency(0,FREQUENCY_HZ);synth.keyOn(0);
    const resampler=new Ps1Resampler(synth,outputRate);
    const render=(frames,visit=()=>{})=>{
      for(let offset=0;offset<frames;offset+=BLOCK_FRAMES) {
        const count=Math.min(BLOCK_FRAMES,frames-offset);
        resampler.render(left,right,count);visit(left,right,count,offset);
      }
    };
    render(Math.round(outputRate*WARMUP_SECONDS));
    const captureFrames=Math.round(outputRate*CAPTURE_SECONDS),half=captureFrames/2;
    const statistics=[new PcmStatistics(outputRate),new PcmStatistics(outputRate)];
    const halves=[new PcmStatistics(outputRate),new PcmStatistics(outputRate)];
    let stereoMaximumDifference=0;
    render(captureFrames,(l,r,count,offset)=>{
      statistics[0].add(l,count);statistics[1].add(r,count);
      for(let i=0;i<count;i++)stereoMaximumDifference=Math.max(stereoMaximumDifference,Math.abs(l[i]-r[i]));
      const first=Math.max(0,Math.min(count,half-offset));
      if(first)halves[0].add(l,first);
      if(first<count)halves[1].add(l,count-first,first);
    });
    const channels=statistics.map(value=>value.finish()),halfStatistics=halves.map(value=>value.finish());
    const registers={volumeLeft:core.read(0),volumeRight:core.read(2),pitch:core.read(4),
      adsr1:core.read(8),adsr2:core.read(10),envelope:core.read(12),
      masterLeft:core.read(0x180),masterRight:core.read(0x182),
      reverbLeft:core.read(0x184),reverbRight:core.read(0x186)};
    const effectiveFrequencyHz=registers.pitch*NATIVE_RATE/(4096*FRAMES);
    assert.equal(registers.envelope,0x7fff,'Held voice reaches full sustain');
    assert.equal(registers.volumeLeft,Math.round(.75*0x3fff));
    assert.equal(registers.volumeRight,registers.volumeLeft);
    assert.equal(registers.masterLeft,0x3fff);assert.equal(registers.masterRight,0x3fff);
    assert.equal(registers.reverbLeft,0);assert.equal(registers.reverbRight,0);
    assert.equal(stereoMaximumDifference,0,'Centered voice is identical in both channels');
    for(const channel of channels) {
      assert.equal(channel.nonfinite,0);assert.equal(channel.overrange,0);
      assert(channel.acRms>0,'Held voice is nonzero');
      assert(Math.abs(channel.measuredFrequencyHz-effectiveFrequencyHz)<.3,'Actual PCM pitch matches the programmed register');
    }
    const heldRmsRelativeDifference=Math.abs(halfStatistics[0].acRms/halfStatistics[1].acRms-1);
    assert(heldRmsRelativeDifference<.005,'Held voice remains settled during capture');
    synth.keyOff(0);render(STOP_FRAMES);
    const keyOffTail=new PcmStatistics(outputRate);render(256,(l,r,count)=>keyOffTail.add(l,count));
    // Transport Stop must also reset the resampler's held interpolation frames.
    synth.stopVoices();resampler.reset();
    const stopped=[new PcmStatistics(outputRate),new PcmStatistics(outputRate)];
    render(STOP_FRAMES,(l,r,count)=>{stopped[0].add(l,count);stopped[1].add(r,count);});
    const keyOff=keyOffTail.finish(),stop=stopped.map(value=>value.finish());
    assert.equal(keyOff.nonzero,0,'Fast key-off reaches exact silence');
    assert(stop.every(channel=>channel.nonzero===0),'Stop plus resampler reset is exactly silent');
    return {fixture:fixture.id,outputRate,nativeSampleRate:NATIVE_RATE,
      requestedFrequencyHz:FREQUENCY_HZ,effectiveFrequencyHz,warmupFrames:Math.round(outputRate*WARMUP_SECONDS),
      captureFrames,registers,channels,stereoMaximumDifference,heldRmsRelativeDifference,
      keyOff:{renderedFramesBeforeTail:STOP_FRAMES,tail:keyOff},
      stop:{method:'Ps1Synth.stopVoices(); Ps1Resampler.reset()',channels:stop},
      estimatedPostMixer:{method:'Measured core/resampler statistics multiplied by generated source gain; no browser Mixer capture',
        gain:mixerVolume,channels:channels.map(channel=>({peak:channel.peak*mixerVolume,acRms:channel.acRms*mixerVolume}))},
      passed:true};
  } finally {synth.dispose();}
}

// Decode through the actual core rather than treating predictive packets as
// filter-0 nibbles. At phase zero Gaussian filtering centers on source frame -2;
// use that fixed documented delay (not a best-fit phase) for sine quality.
async function measureSineQuality(module,sample) {
  const core=await Ps1Spu.create({moduleFactory:async()=>module}),synth=new Ps1Synth({core});
  try {
    const {adpcm,...options}=sample,loaded=synth.loadADPCM(adpcm,options);
    synth.setPreset(0,{sample:loaded,volumeLeft:1,volumeRight:1,adsr1:15,adsr2:0,pitch:4096});synth.keyOn(0);
    core.generateStereo(FRAMES*16);const pcm=core.generateStereo(FRAMES*3),cycle=pcm.left.subarray(0,FRAMES);
    assert.deepEqual(pcm.left,pcm.right);assert.deepEqual(pcm.left.subarray(FRAMES,FRAMES*2),cycle);
    assert.deepEqual(pcm.left.subarray(FRAMES*2),cycle,'Actual predictive ADPCM loop repeats without drift');
    let squares=0,unalignedSquares=0,signal=0,maxError=0,maximumAdjacentJump=0,sum=0,peak=0;
    const bytes=Buffer.alloc(FRAMES*4);
    for(let i=0;i<FRAMES;i++){
      const expected=.65*Math.sin(2*Math.PI*(i-2)/FRAMES),value=cycle[i],error=value-expected;
      unalignedSquares+=(value-.65*Math.sin(2*Math.PI*i/FRAMES))**2;
      squares+=error*error;signal+=expected*expected;maxError=Math.max(maxError,Math.abs(error));
      maximumAdjacentJump=Math.max(maximumAdjacentJump,Math.abs(value-cycle[(i+FRAMES-1)%FRAMES]));
      sum+=value;peak=Math.max(peak,Math.abs(value));bytes.writeFloatLE(value,i*4);
    }
    return {method:'Actual deployed SPU, PITCH4096, full fixed voice/master levels, 16-cycle warmup, 3 exact repeated cycles',
      sourceFrames:FRAMES,referenceDelayFrames:2,unalignedRmsError:Math.sqrt(unalignedSquares/FRAMES),targetPeak:.65,actualPeak:peak,dc:sum/FRAMES,
      rmsError:Math.sqrt(squares/FRAMES),maxAbsoluteError:maxError,snrDb:10*Math.log10(signal/squares),
      maximumAdjacentJumpIncludingLoop:maximumAdjacentJump,loopRepeatsBitExactly:true,
      pcmFloat32LeSha256:hash(bytes)};
  }finally{synth.dispose();}
}

export async function measurePs1StarterLevels() {
  assert.equal(PS1_WAVEFORM_FRAMES,FRAMES);
  const mixer=mixerPolicy(),reference=buildPs1CalibrationReference(FREQUENCY_HZ),frozenReference=historicalSine(0);
  assert.deepEqual(Buffer.from(reference.decodedReference.adpcmBytes),Buffer.from(frozenReference.adpcm),
    'Calibration reference packets remain the independent original filter0/shift0 codes -7..7');
  assert.equal(reference.decodedReference.decodedPeak,.875);
  assert.deepEqual(reference.decodedReference.decodedSamples,
    Array.from({length:FRAMES},(_,i)=>(Math.round(7*Math.sin(2*Math.PI*i/FRAMES))||0)/8),
    'Calibration decoded metadata remains unchanged');
  const editor=preparePs1Waveform(Array.from({length:FRAMES},(_,i)=>.65*Math.sin(2*Math.PI*i/FRAMES)));
  const starterSample=createPs1InitSample();
  assert.deepEqual(starterSample.adpcm,editor.adpcm,'Precomputed starter packets exactly match the prepare-side panel Sine encoder');
  const fixtures=[
    {id:'oldStarterReference',sample:historicalSine(4),decodedPeak:7/128,
      authoring:'Historical factory reproduction only: filter0/shift4, signed sine codes -7..7'},
    {id:'coarseStarterReference',sample:historicalSine(0,5),decodedPeak:.625,
      authoring:'Former level-adjusted factory reproduction only: filter0/shift0, signed sine codes -5..5'},
    {id:'starter',sample:starterSample,inputPeak:.65,
      authoring:'Canonical createPs1InitSample(): precomputed packets from the panel .65-amplitude Sine encoder'},
    {id:'editorSine',sample:{adpcm:editor.adpcm,baseFrequencyHz:NATIVE_RATE/FRAMES,loopStartSamples:0},editor,
      inputPeak:.65,authoring:'Panel Sine formula: .65 * sin(2*pi*i/112), preparePs1Waveform(), private editor upload'},
    {id:'calibrationReference',sample:{adpcm:Uint8Array.from(reference.decodedReference.adpcmBytes),
      baseFrequencyHz:reference.decodedReference.baseFrequencyHz,loopStartSamples:0},decodedPeak:.875,
      authoring:'buildPs1CalibrationReference().decodedReference, unchanged independent reference'},
  ];
  for(const fixture of fixtures)if(fixture.decodedPeak!==undefined)assert.equal(filter0DecodedPeak(fixture.sample.adpcm),fixture.decodedPeak,
    `${fixture.id} peak agrees with its actual filter0 packet bytes`);
  const wasmBinary=await readFile(join(root,'docs/generated/ps1_spu_wasm.wasm'));
  const module=await factory({wasmBinary});
  const report={schemaVersion:1,passed:false,browserUsed:false,audioContextCreated:false,physicalAudio:false,listeningPerformed:false,
    method:'Actual shipped WASM -> Ps1Spu -> Ps1Synth -> Ps1Resampler, one settled held voice at L/R .75, full sustain, no FX',
    pcmBlockFrames:BLOCK_FRAMES,fullCaptureArraysRetained:false,mixer,
    fixtures:fixtures.map(({id,sample,decodedPeak,inputPeak,authoring})=>({id,authoring,
      adpcmBytes:sample.adpcm.length,adpcmSha256:hash(sample.adpcm),decodedPeak,inputPeak,
      packetHeaders:[0,16,32,48].map(offset=>sample.adpcm[offset]),
      baseFrequencyHz:sample.baseFrequencyHz,loopStartSamples:sample.loopStartSamples})),
    routes:[],comparisons:[],sources:[],
    limits:['Offline generated PCM only; no Main/Worker transport, browser Mixer, realtime deadline, physical output, or listening test.',
      'Estimated post-Mixer statistics are arithmetic projections using the unchanged generated gain, not measurements of a browser audio graph.',
      'The editor Sine and factory now use identical packets; numeric equivalence does not replace listening or a hardware-accuracy check.',
      'Calibration-reference stability compares against independently authored original packets through the same shipped core; it is not a new hardware-accuracy claim.']};
  const quality={starter:await measureSineQuality(module,starterSample),
    coarseStarterReference:await measureSineQuality(module,historicalSine(0,5))};
  quality.rmsErrorRatio=quality.starter.rmsError/quality.coarseStarterReference.rmsError;
  quality.snrImprovementDb=quality.starter.snrDb-quality.coarseStarterReference.snrDb;
  assert(quality.rmsErrorRatio<.6,'Predictive initial packets reduce actual sine RMS error versus the former coarse factory');
  assert(Math.abs(quality.starter.actualPeak-.65)<.02);assert(Math.abs(quality.starter.dc)<.005);
  report.initialSineQuality=quality;
  for(const outputRate of [44100,48000]) {
    const frozen=await measureFixture(module,{id:'frozenCalibrationReference',sample:frozenReference},outputRate,mixer.volume);
    for(const fixture of fixtures)report.routes.push(await measureFixture(module,fixture,outputRate,mixer.volume));
    const at=id=>report.routes.find(route=>route.outputRate===outputRate&&route.fixture===id);
    const starter=at('starter'),old=at('oldStarterReference'),coarse=at('coarseStarterReference'),sine=at('editorSine'),calibration=at('calibrationReference');
    const gain=starter.channels[0].acRms/old.channels[0].acRms;
    const editorDifferenceDb=20*Math.log10(starter.channels[0].acRms/sine.channels[0].acRms);
    assert(gain>10&&gain<13,'Starter AC RMS rises about elevenfold from the old quiet fixture');
    assert.deepEqual(starter.channels,sine.channels,'Starter and editor Sine actual PCM are bit-identical, including their RMS and spectrum-defining waveform');
    assert.equal(editorDifferenceDb,0,'Starter and editor Sine have the same AC RMS');
    assert.deepEqual(calibration.channels,frozen.channels,'Calibration reference output is bit-identical to its frozen independent baseline');
    report.comparisons.push({outputRate,starterToOldAcRmsGain:gain,
      actualCodecPeakGain:quality.starter.actualPeak/(7/128),allowedGainRange:[10,13],
      starterToCoarseAcRmsGain:starter.channels[0].acRms/coarse.channels[0].acRms,
      starterToEditorSineAcRmsDb:editorDifferenceDb,allowedEditorDifferenceDb:0,starterAndEditorPcmBitExact:true,
      calibrationReferenceUnchanged:true,
      frozenCalibrationAdpcmSha256:hash(frozenReference.adpcm),
      frozenCalibrationPcmFloat32LeSha256:frozen.channels.map(channel=>channel.pcmFloat32LeSha256),passed:true});
  }
  const sourcePaths=['scripts/check_ps1_starter_levels.mjs','scripts/soundchip_calibration_ps1.mjs',
    'web/ps1synth.js','web/ps1_spu.js','web/ps1_resampler.js','web/ps1_waveform.js','web/ps1_adpcm_encoder.js',
    'docs/playground/playground_ps1_voice_panel.js','docs/playground/playground_mixer_defaults.js',
    'web/soundchip_mixer_presets.js','docs/js/soundchip_mixer.js',
    'docs/generated/ps1_spu_wasm.js','docs/generated/ps1_spu_wasm.wasm'];
  report.sources=await Promise.all(sourcePaths.map(async path=>{
    const bytes=await readFile(join(root,path));return {path,bytes:bytes.length,sha256:hash(bytes)};
  }));
  report.passed=true;return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let out=null;
  for(let i=2;i<process.argv.length;i++) {
    if(process.argv[i]==='--out'&&process.argv[i+1])out=resolve(process.argv[++i]);
    else throw new Error('Usage: node scripts/check_ps1_starter_levels.mjs [--out REPORT.json]');
  }
  const report=await measurePs1StarterLevels();
  if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n');
  for(const row of report.comparisons)console.log(`PASS PS1 starter ${row.outputRate} Hz: ${row.starterToOldAcRmsGain.toFixed(4)}x old RMS, ${row.starterToEditorSineAcRmsDb.toFixed(4)} dB vs editor Sine; calibration unchanged; Mixer ${report.mixer.volume}.`);
}
