// Measure Analyzer-only output routes with synthetic, single-voice references.
// This script opens no audio device and never changes application defaults.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createPlaybackEngine} from '../docs/vgm_analyzer/playback_core.js';
import {createVgmTargets} from '../docs/js/vgmplayer.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {OPLSynth} from '../docs/js/opl_synth.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const frequencies = [220, 440, 880];
const sampleRate = 44_100;
const warmupFrames = Math.round(sampleRate * .2);
const captureFrames = Math.round(sampleRate * .4);
const targetAmplitude = .12881777435541153;
const referenceFrequencyHz = 440;
const maximumGain = 2;
const routes = [
  {id:'segaPcm', variant:'sega-pcm', clock:4_000_000, header:'segaPcmClock', command:'0xc0'},
  {id:'k051649', variant:'scc', clock:1_789_773, header:'k051649Clock', command:'0xd2'},
  {id:'k051649', variant:'scc-plus', clock:1_789_773, header:'k051649Clock', command:'0xd2'},
  {id:'ymf278b', variant:'fm-only', clock:33_868_800, header:'ymf278bClock', command:'0xd0'},
  {id:'msm5205', variant:'4bit-internal-vclk', clock:1_536_000, header:'msm5205Clock', command:'0xc7'},
  {id:'okim6295', variant:'one-voice-pin7-high', clock:1_000_000, header:'okim6295Clock', command:'0xb8'},
];

function sineWave(length) {
  return Uint8Array.from({length}, (_, index) => Math.round(Math.sin(index * 2 * Math.PI / length) * 127) & 255);
}

function writeAddress(bytes, offset, address) {
  bytes[offset]=address>>>16; bytes[offset+1]=address>>>8; bytes[offset+2]=address;
}

function configure(route, frequencyHz, engine) {
  const targets = engine.vgmTargets ?? createVgmTargets(engine);
  let actualFrequencyHz = frequencyHz;
  let reference;
  let render = frames => engine.processFrames(frames);
  if (route.id === 'segaPcm') {
    const target=targets.segapcm, wave=sineWave(32);
    const rom=Uint8Array.from({length:256},(_,index)=>((wave[index%wave.length]<<24>>24)+128)&255);
    target.loadSampleMemory(rom,0,rom.length);
    const step=Math.round(frequencyHz*256*wave.length*128/route.clock);
    assert(step>=1&&step<=255,'Sega PCM reference step out of range');
    for(const [register,value] of [[2,127],[3,127],[4,0],[5,0],[6,0],[7,step],[0x84,0],[0x85,0],[0x86,0]])target.writeRegister(register,value);
    actualFrequencyHz=route.clock/128*step/(256*wave.length);
    reference={waveform:'32-sample sine repeated through a 256-byte looping ROM',channels:1,
      positiveSampleCode:255,negativeSampleCode:1,centerCode:128,peakSignedMagnitude:127,
      quantizationHeadroom:1/128,channelVolume:127,clockDivider:128,pitchStep:step};
  } else if (route.id === 'k051649') {
    const target=targets.k051649, wave=sineWave(32), wavePort=route.variant==='scc-plus'?4:0;
    for(let index=0;index<wave.length;index++)target.writeRegister(wavePort,index,wave[index]);
    const period=Math.round(route.clock/(32*frequencyHz))-1;
    target.writeRegister(1,0,period&255);target.writeRegister(1,1,period>>>8);
    target.writeRegister(2,0,15);target.writeRegister(3,0,1);
    actualFrequencyHz=route.clock/(32*(period+1));
    reference={waveform:'32-sample signed sine wavetable',channels:1,wavePort,
      positiveSampleCode:127,negativeSampleCode:-127,peakSignedMagnitude:127,
      quantizationHeadroom:1/128,channelVolume:15,frequencyRegister:period};
  } else if (route.id === 'ymf278b') {
    const target=targets.ymf278b;
    // OPL4 clocks its FM engine at input/(19*36), then downsamples to
    // input/768. Adapt OPLSynth's OPL3 clock/288 pitch formula accordingly.
    const fm=new OPLSynth({chip:'ymf262',clock:route.clock*288/684,transport:{
      reset:()=>engine.reset(),writeRegister:(register,value,port=0)=>target.writeRegister(register,value,port),
    }});
    fm.initialize();
    fm.setPreset(0,{algorithm:0,feedback:0,pan:{left:true,right:true},operators:[
      {tl:63,ar:15,dr:0,sl:0,rr:0,egt:true,multi:1,waveform:0},
      {tl:0,ar:15,dr:0,sl:0,rr:0,egt:true,multi:1,waveform:0},
    ]});
    const pitch=fm.setFrequency(0,frequencyHz);fm.keyOn(0);
    actualFrequencyHz=route.clock/(684*2**20)*pitch.fnum*2**pitch.block;
    reference={waveform:'sustained FM sine carrier, modulator at maximum attenuation',channels:1,carrierTotalLevel:0,
      modulatorTotalLevel:63,feedback:0,attackRate:15,decayRate:0,sustainLevel:0,
      fmClockDivider:684,pitch,
      fmOutput:'DO2 mixed stereo, PCM silent',mixRegisters:'chip reset defaults; no artificial FM mix boost',
      quantizationHeadroom:0};
  } else if (route.id === 'msm5205') {
    const target=targets.msm5205, divider=48, nibbleRate=route.clock/divider;
    let phase=0,nibble=0;
    render=frames=>{
      const pcm={left:new Float32Array(frames),right:new Float32Array(frames)};
      for(let frame=0;frame<frames;frame++) {
        phase+=route.clock;
        while(phase>=sampleRate*divider) {
          phase-=sampleRate*divider;
          target.writeRegister(1,Math.floor(nibble++*frequencyHz*2/nibbleRate)%2?15:7);
        }
        const sample=engine.processFrames(1);pcm.left[frame]=sample.left[0];pcm.right[frame]=sample.right[0];
      }
      return pcm;
    };
    reference={waveform:'synthetic alternating positive/negative maximum-delta ADPCM nibbles (7/F)',
      channels:1,bits:4,prescaler:2,clockDivider:divider,nibbleRate,
      positiveDecoderCode:2047,negativeDecoderCode:-2048,quantizationHeadroom:1/4096,
      note:'The seven-entry FIFO is fed only for the upcoming internal VCLK decode; no overflow/underflow.'};
  } else {
    const target=targets.okim6295,nibbleRate=route.clock/132,start=0x400,length=4096;
    const rom=new Uint8Array(start+length).fill(255);
    writeAddress(rom,0,start);writeAddress(rom,3,start+length-1);
    for(let byte=0;byte<length;byte++) {
      const code=index=>Math.floor(index*frequencyHz*2/nibbleRate)%2?15:7;
      rom[start+byte]=(code(byte*2)<<4)|code(byte*2+1);
    }
    target.loadSampleMemory(rom,0,rom.length);
    target.writeRegister(0,0x80);target.writeRegister(0,0x10);
    reference={waveform:'synthetic alternating positive/negative maximum-delta ADPCM nibbles (7/F)',
      channels:1,voice:0,volumeTableIndex:0,pin7High:true,clockDivider:132,nibbleRate,
      positiveDecoderCode:2047,negativeDecoderCode:-2048,quantizationHeadroom:1/4096,
      sampleBytes:length,sampleDurationSeconds:2*length/nibbleRate};
  }
  return {render,actualFrequencyHz,reference};
}

async function renderReference(route,frequencyHz,partitioned) {
  const header={[route.header]:route.id==='okim6295'?0x80000000+route.clock:route.clock,
    msm5205Flags:6,segaPcmBankShift:0,segaPcmBankMask:0};
  const vgm={header,analyzeCommandUsage:()=>new Map([[route.command,1]])};
  const engine=await createPlaybackEngine(vgm,{getFactory:getNodePlaybackFactory,masterVolume:1});
  try {
    const configured=configure(route,frequencyHz,engine);
    // The application may gain calibrated defaults later. Measurement is unity.
    for(const id of engine.playbackMixer.strips.keys())engine.playbackMixer.set(id,{gain:1,pan:0,muted:false});
    engine.playbackMixer.reset();
    assert.equal(engine.sampleRate(),sampleRate);
    const total=warmupFrames+captureFrames;
    const pcm={left:new Float32Array(total),right:new Float32Array(total)};
    const chunks=partitioned?[1,127,512,4096,37]:[total];
    for(let offset=0,index=0;offset<total;index++) {
      const count=Math.min(chunks[index%chunks.length],total-offset),block=configured.render(count);
      pcm.left.set(block.left,offset);pcm.right.set(block.right,offset);offset+=count;
    }
    return {...configured,render:undefined,
      pcm:{left:pcm.left.slice(warmupFrames),right:pcm.right.slice(warmupFrames)},
      mixer:[...engine.playbackMixer.strips.keys()].map(id=>({id,...engine.playbackMixer.get(id)}))};
  } finally {engine.dispose();}
}

function summarize(samples) {
  let minimum=Infinity,maximum=-Infinity,sum=0,square=0;
  for(const value of samples) {
    assert(Number.isFinite(value),'Non-finite Analyzer output');
    minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);sum+=value;square+=value*value;
  }
  const amplitude=(maximum-minimum)/2,mean=sum/samples.length;
  assert(amplitude>1e-6,'Silent Analyzer reference');
  return {minimum,maximum,amplitude,peak:Math.max(Math.abs(minimum),Math.abs(maximum)),mean,
    rms:Math.sqrt(square/samples.length),acRms:Math.sqrt(Math.max(0,square/samples.length-mean*mean))};
}

const sourcePaths=[
  'scripts/calibrate_analyzer_extra_levels.mjs','docs/vgm_analyzer/playback_core.js',
  'docs/vgm_analyzer/playback_mixer.js','docs/js/vgmplayer.js','docs/js/opl_synth.js',
  'docs/js/segapcmaudioengine.js','docs/js/segapcm.js','docs/generated/segapcm_wasm.wasm',
  'docs/js/msxaudioengine.js','docs/js/k051649audioengine.js','docs/js/k051649.js','docs/generated/k051649_wasm.wasm',
  'docs/js/ymf278baudioengine.js','docs/js/ymf278b.js','docs/generated/ymf278b_wasm.wasm',
  'docs/js/msm5205audioengine.js','docs/js/okim6295audioengine.js',
];

export async function calibrateAnalyzerExtraLevels() {
  const rows=[];
  for(const route of routes)for(const frequencyHz of frequencies) {
    const full=await renderReference(route,frequencyHz,false),chunks=await renderReference(route,frequencyHz,true);
    let maxPartitionDifference=0;
    const hash=createHash('sha256');
    for(const channel of ['left','right']) {
      assert.equal(full.pcm[channel].length,captureFrames);
      for(let index=0;index<captureFrames;index++)maxPartitionDifference=Math.max(maxPartitionDifference,Math.abs(full.pcm[channel][index]-chunks.pcm[channel][index]));
      hash.update(Buffer.from(full.pcm[channel].buffer,full.pcm[channel].byteOffset,full.pcm[channel].byteLength));
    }
    assert.equal(maxPartitionDifference,0,`${route.id}/${route.variant}: render partition changed PCM`);
    const left=summarize(full.pcm.left),right=summarize(full.pcm.right);
    const amplitude=(left.amplitude+right.amplitude)/2;
    const derivedGain=targetAmplitude/amplitude;
    if(derivedGain>maximumGain)throw new Error(`${route.id}/${route.variant}/${frequencyHz}: required gain ${derivedGain} exceeds ${maximumGain}; no clamping was applied`);
    rows.push({id:route.id,variant:route.variant,frequencyHz,actualFrequencyHz:full.actualFrequencyHz,
      clockHz:route.clock,referencePeak:1,
      referencePeakMeaning:'Maximum symmetric source/decoder range; quantization retained, no artificial codec-headroom correction.',
      reference:full.reference,downstreamTrim:1,mixer:full.mixer,
      measuredAmplitude:amplitude,amplitude,left,right,
      ...(frequencyHz===referenceFrequencyHz?{derivedGain,volume:Number(derivedGain.toFixed(6))}:{}),
      maxPartitionDifference,pcmSha256:hash.digest('hex')});
  }
  const defaults={};
  for(const row of rows.filter(row=>row.frequencyHz===referenceFrequencyHz)) {
    if(Object.hasOwn(defaults,row.id))assert.equal(row.volume,defaults[row.id],`${row.id}: SCC/SCC+ levels differ`);
    defaults[row.id]=row.volume;
  }
  const sources={};
  for(const pathname of sourcePaths) {
    const bytes=await readFile(resolve(root,pathname));
    sources[pathname]={sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
  }
  return {schemaVersion:1,passed:true,method:'actual Analyzer createPlaybackEngine/processFrames, synthetic one-voice references, unity Mixer/master, no device',
    sampleRate,warmupFrames,captureFrames,frequencies,referenceFrequencyHz,targetAmplitude,maximumGain,
    normalization:'None. Fixed gain uses measured peak-to-peak amplitude at 440 Hz. Input quantization and core frequency response are retained.',
    limitations:['YMF278B measures the current core FM section with reset mix registers; its PCM instrument levels, external wave ROM, and physical hardware mix accuracy are not calibrated.',
      'ADPCM references exercise decoder full scale, not perceptual loudness or arbitrary encoded samples.',
      'SCC/SCC+ references use channel 0; their waveform-sharing differences do not alter this single-channel output scale.',
      'Requested pitches may be quantized by a chip frequency register or nibble timing. 220/880 Hz captures check the actual frequency response; they do not set separate gains.'],
    defaults,rows,sources};
}

async function main() {
  const argumentsList=process.argv.slice(2);
  if(argumentsList.includes('--help')) {
    console.log('Usage: node scripts/calibrate_analyzer_extra_levels.mjs [--out=report.json] [--check=report.json]');
    return;
  }
  for(const argument of argumentsList)if(!argument.startsWith('--out=')&&!argument.startsWith('--check='))throw new Error(`Unknown argument: ${argument}`);
  const report=await calibrateAnalyzerExtraLevels();
  const check=argumentsList.find(value=>value.startsWith('--check='))?.slice(8);
  if(check)assert.deepEqual(report,JSON.parse(await readFile(resolve(check),'utf8')),'Calibration report is stale');
  const output=argumentsList.find(value=>value.startsWith('--out='))?.slice(6);
  if(output) {const filename=resolve(output);await mkdir(dirname(filename),{recursive:true});await writeFile(filename,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,rows:report.rows.length,defaults:report.defaults,...(output?{output:resolve(output)}:{})}));
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
