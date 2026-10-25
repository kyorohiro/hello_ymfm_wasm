/** Actual Native RF5C164 versus shipped WASM PCM. No audio device is opened. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/rf5c164_wasm.js';
import {Rf5c164} from '../web/rf5c164.js';
import {RF5C164Synth} from '../web/rf5c164synth.js';
import {encodeRf5c164} from '../web/rf5c164_pcm.js';
import {ChipClockResampler} from '../web/playground_chip_clock.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const sdk=path.join(project,'vendor/tetorica-soundchip-native');
const option=name=>{const index=process.argv.indexOf(name);assert(index<0||process.argv[index+1],`${name} requires a value`);return index<0?null:process.argv[index+1];};
let fixture=option('--fixture'),temporary;
const output=option('--out');
const report={schemaVersion:1,startedAt:new Date().toISOString(),deviceOpened:false,
  rates:[44100,48000,96000],clock:12500000,channels:2,cases:[],maximumDifference:0,
  limits:'Compares the Native RF core, outer clock adapter and per-chip gain ramp with shipped WASM. Browser IPC uses a mocked Native device; whole-bus routing and cancellation are covered by Rust tests.'};
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/rf5c164_wasm.wasm'));
report.wasmSha256=createHash('sha256').update(wasmBinary).digest('hex');
if(!fixture) {
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'tetorica-native-megacd-'));
  fixture=path.join(temporary,'fixture');
  const sources=[path.join(project,'src/native_megacd_fixture.cpp'),
    path.join(sdk,'native/reference/tauri/native_genesis_rf5c164.cpp'),path.join(sdk,'vendor/mame-rf5c164/rf5c164.cpp')];
  report.nativeSources=await Promise.all(sources.map(async file=>({file:path.relative(root,file),
    sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
  execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(sdk,'vendor/mame-rf5c164'),'-I'+path.join(sdk,'vendor/ymfm'),
    '-I'+path.join(project,'src'),...sources,'-o',fixture],{stdio:'pipe'});
}
const events=[];
let at=0;
const add=(op,...args)=>events.push({frame:at,op,args});
const control=new RF5C164Synth({transport:{write:(...args)=>add('write',...args),loadMemory:(bytes,address)=>add('load',address,bytes.slice()),reset:()=>add('reset')}});
const wave=(length=128)=>Uint8Array.from({length:length+1},(_,i)=>i===length?255:(Math.round(Math.abs(Math.sin(i*2*Math.PI/length))*100)|(Math.sin(i*2*Math.PI/length)>=0?128:0)));
function prepare(channel,options={}) {control.setChannel(channel,{start:0,loopStart:0,step:2048,volume:100,pan:{left:15,right:15},...options});control.keyOn(channel);}
function makeScenario(name,build,frames=4608,checks={}) {
  events.length=0;at=0;control.channelMask=255;build();
  return {name,frames,events:events.map(event=>({...event,args:event.args.slice()})),checks};
}
const scenarios=[
  makeScenario('loop, pitch, left/right pan and retrigger',()=>{
    control.loadMemory(wave());prepare(0,{pan:{left:15,right:0}});
    at=701;control.setPitch(0,4096);at=1403;control.setChannel(0,{pan:{left:0,right:15}});
    at=2101;control.keyOff(0);at=2303;control.keyOn(0);at=3107;control.setPitch(0,512);
  }),
  makeScenario('all eight physical voices and independent key gates',()=>{
    for(let channel=0;channel<8;channel++) {
      control.loadMemory(wave(64),channel*256);
      prepare(channel,{start:channel*256,loopStart:channel*256,step:683+channel*271,volume:24,pan:{left:15-channel,right:channel+1}});
    }
    at=903;control.keyOff(3);at=1807;control.keyOff(7);at=2401;control.keyOn(3);at=3101;control.keyOn(7);
  }),
  makeScenario('finite sample, silent tail and marker at loop destination',()=>{
    const encoded=encodeRf5c164({channels:[Float32Array.from({length:256},(_,i)=>Math.sin(i*Math.PI*2/32)*.6)],sampleRate:16000});
    control.loadMemory(encoded.bytes);prepare(0,{step:encoded.step,loopStart:257});
    at=2203;control.loadMemory(new Uint8Array([255]),512);prepare(1,{start:512,loopStart:512});
  },4608,{silentAfter:3500}),
  makeScenario('absolute RAM, banked writes, Stop/restart and reset retain RAM',()=>{
    control.loadMemory(wave(),0x4000);control.writeRegister(7,0x84);
    add('memory',17,0xb2);add('memory',18,0x32);
    prepare(0,{start:0x4000,loopStart:0x4000,step:2048});
    at=1103;add('stop');at=1601;control.keyOn(0);
    at=2503;control.reset();at=2801;prepare(0,{start:0x4000,loopStart:0x4000,step:4096});
    at=3901;add('clear');
  },5120,{silentAfter:4300}),
  makeScenario('per-chip volume and pan use a five millisecond ramp',()=>{
    control.loadMemory(wave());prepare(0,{volume:160});
    at=7;add('mix',.25,.75);at=997;add('mix',0,.5);at=2099;add('mix',1,0);at=3101;add('mix',.2,.3);
  }),
  makeScenario('maximum pitch, end guards and final RAM address',()=>{
    const encoded=encodeRf5c164({channels:[Float32Array.from({length:512},(_,i)=>Math.sin(i*Math.PI*2/64)*.5)],sampleRate:16000});
    const guarded=new Uint8Array(544);guarded.set(encoded.bytes.subarray(0,512));guarded.fill(255,512);
    control.loadMemory(guarded);control.loadMemory(new Uint8Array([128,255]),65534);
    prepare(0,{loopStart:513,step:65535});
  },4608,{silentAfter:2500}),
  makeScenario('outer chip clock at half, 1.25 and double rate, reset and restoration',()=>{
    control.loadMemory(wave());prepare(0,{step:683});
    at=3;add('clock',6250000);at=701;add('clock',15625000);at=1403;add('clock',25000000);
    at=2101;control.reset();prepare(0,{step:683});at=3107;add('clock',12500000);
  }),
];

function eventText(event) {
  if(event.op==='load')return `${event.frame} load ${event.args[0]} ${Buffer.from(event.args[1]).toString('hex')}`;
  return `${event.frame} ${event.op}${event.args.length?' '+event.args.join(' '):''}`;
}
function energy(pcm,start=0,end=pcm.length/2) {let total=0;for(let i=start*2;i<end*2;i++)total+=pcm[i]*pcm[i];return total;}
try {
  for(const rate of report.rates)for(const scenario of scenarios) {
    const nativeBytes=execFileSync(path.resolve(fixture),[String(rate),String(scenario.frames)],{
      input:scenario.events.map(eventText).join('\n')+'\n',maxBuffer:scenario.frames*8+1024*1024,timeout:20000,
    });
    assert.equal(nativeBytes.length,scenario.frames*8,'Native fixture must return every stereo frame');
    const actual=new Float32Array(nativeBytes.buffer,nativeBytes.byteOffset,nativeBytes.length/4);
    const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:rate});
    const expected=new Float32Array(actual.length),gain=[1,1],target=[1,1];let ramp=0,next=0,clockAdapter;
    const adaptedLeft=new Float32Array(1),adaptedRight=new Float32Array(1);
    const sorted=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    try {
      for(let frame=0;frame<scenario.frames;frame++) {
        while(next<sorted.length&&sorted[next].frame===frame) {
          const {op,args}=sorted[next++];
          if(op==='write')chip.writeRegister(...args);
          else if(op==='load')chip.loadMemory(args[1],args[0]);
          else if(op==='memory')chip.writeMemory(...args);
          else if(op==='reset'){chip.reset();clockAdapter?.resetPhase();}
          else if(op==='clear')chip.clearMemory();
          else if(op==='stop')chip.writeRegister(8,255);
          else if(op==='mix'){target[0]=Math.fround(args[0]);target[1]=Math.fround(args[1]);ramp=Math.max(1,Math.floor(rate/200));}
          else if(op==='clock'){(clockAdapter??=new ChipClockResampler()).setClock(args[0],12500000);}
          else throw Error('Unexpected reference event '+op);
        }
        if(ramp){for(let channel=0;channel<2;channel++)gain[channel]=Math.fround(gain[channel]+Math.fround(Math.fround(target[channel]-gain[channel])/ramp));ramp--;}
        const pcm=clockAdapter?(clockAdapter.render(chip,adaptedLeft,adaptedRight),{left:adaptedLeft,right:adaptedRight}):chip.generateStereo(1);
        expected[frame*2]=pcm.left[0]*gain[0];expected[frame*2+1]=pcm.right[0]*gain[1];
      }
      let maximumDifference=0,peak=0;
      for(let i=0;i<actual.length;i++) {
        assert(Number.isFinite(actual[i]),`${scenario.name}: finite Native PCM`);
        maximumDifference=Math.max(maximumDifference,Math.abs(actual[i]-expected[i]));peak=Math.max(peak,Math.abs(actual[i]));
      }
      assert(maximumDifference<=1e-7,`${rate} Hz ${scenario.name}: PCM difference ${maximumDifference}`);
      assert(peak>.001,`${scenario.name}: the comparison must contain a sounding interval`);
      if(scenario.checks.silentAfter)assert.equal(energy(actual,scenario.checks.silentAfter),0,`${scenario.name}: tail must be silent`);
      if(scenario.name.includes('Stop/restart')) {
        assert.equal(energy(actual,1150,1550),0,'Stop must release voices without waiting for a future gate');
        assert(energy(actual,1650,2100)>.001,'Stop must retain RAM and the programmed voice for a later retrigger');
        assert(energy(actual,2850,3300)>.001,'Reset must retain loaded waveform RAM');
      }
      report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);
      report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});
    } finally {chip.dispose();}
  }
  report.totalStereoFrames=report.cases.reduce((total,result)=>total+result.frames,0);report.status='passed';
  if(output)await fs.writeFile(path.resolve(output),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS: actual Native RF5C164 versus WASM, ${report.cases.length} cases / ${report.totalStereoFrames} stereo frames at ${report.rates.join('/')} Hz; max difference ${report.maximumDifference}; no audio device.`);
} finally {if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
