import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSegaPcmSamples} from './segapcm_samples.js';
import {extractSamples,listSamples,exportSamples} from './sample_core.js';
import {renderSamplePreview} from './sample_render.js';
import {getNodePlaybackFactory} from '../../cli/render.js';
import {exportNodeSamples} from '../../cli/index.js';
import {SegaPcm} from '../js/segapcm.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
const fixture=n=>readFileSync(new URL(`../../test/fixtures/${n}.vgm`,import.meta.url));
function setup(shift=8,mask=4){
 const t=createSegaPcmSamples(4000000,shift,mask);
 const w=(offset,value,time=0)=>t.apply({type:'segapcm-write',offset,value},time);
 const load=(offset,data,size=2048,time=0)=>t.apply({type:'segapcm-rom-data',offset,data:Uint8Array.from(data),memorySize:size},time);
 const voice=(ch=0,control=4,time=0,start=0,loop=0)=>{
  for(const [r,v] of [[2,64],[3,32],[4,loop&255],[5,loop>>8],[6,0],[7,128],[0x84,start&255],[0x85,start>>8],[0x86,control]])w(ch*8+r,v,time);
 };
 return {t,w,load,voice};
}
test('Sega PCM banks, alias volumes, shared definitions and repeated enables',()=>{
 const {t,w,load,voice}=setup();load(1024,Array(256).fill(180));voice();w(0x86,4);voice(1);
 assert.equal(t.samples.length,1);assert.equal(t.samples[0].byteStart,1024);assert.equal(t.samples[0].data[0],180);
 assert.deepEqual(t.events.map(e=>e.channel),[1,2]);assert.equal(t.events[0].rate,15625);
 w(0x82,17,10);w(0x86,5,20);assert.equal(t.events[0].leftLevel,64);assert.equal(t.events[0].changes[0].value,17);assert.equal(t.events[0].endTime,20);
 const d=setup(12,0);d.load(0x10000,Array(256).fill(200),0x10100);d.voice(0,0x10);assert.equal(d.t.samples[0].bank,0x10000);
 const limited=setup(24,255);limited.load(0,Array(256).fill(200));limited.voice(0,4);assert.equal(limited.t.samples[0].bank,0);
});
test('Sega PCM ROM generations, incomplete data, shrink and loop-before-start',()=>{
 const {t,w,load,voice}=setup();load(1024,[180]);voice();w(0x86,5);load(1024,Array(256).fill(190));voice();
 assert.equal(t.samples[0].data,null);assert.equal(t.samples[1].data[0],190);
 w(0x86,5);load(1024,Array(256).fill(200));voice(0,4,0,128,16);
 assert.equal(t.samples[1].data[0],190);assert.equal(t.samples[2].rangeStart,16);assert.equal(t.events[2].startAddress,128);
 w(0x86,5);load(0,[],1100);voice();assert.equal(t.samples.at(-1).data,null);assert.equal(t.samples.at(-1).available,76);
});
test('Sega PCM auto-stop, retrigger after EOS, loops and end-page rejection',()=>{
 const {t,w,load,voice}=setup();load(1024,Array(256).fill(180));voice(0,6);t.advance(1000);
 assert.equal(t.events[0].endReason,'sampleEnd');assert.equal(t.events[0].endTime,723);
 w(0x84,0,1000);w(0x85,0,1000);w(0x86,6,1000);assert.equal(t.events.length,2);
 const loop=setup();loop.load(1024,Array(256).fill(180));loop.voice();loop.t.advance(44100*600);loop.w(0x86,4,44100*600);assert.equal(loop.t.events.length,1);
 loop.t.finish(44100*600);assert.equal(loop.t.events[0].endReason,'vgmEnd');
 const bad=setup();bad.voice(0,4,0,512);assert.equal(bad.t.samples[0].data,null);assert.match([...bad.t.warnings].join(' '),/wrapped/);
});
test('Sega PCM stream scanning supports standalone and OPM/PSG combinations with native and ZIP export',async()=>{
 for(const name of ['segapcm-bank0','segapcm-bank1','segapcm-psg','segapcm-opm','segapcm-opm-psg']){
  const bytes=fixture(name),r=await extractSamples(bytes);assert.equal(r.samples.length,1);assert.equal(r.samples[0].size,256);
  const inv=await listSamples(bytes);assert.equal(inv.samples[0].representation,'raw-pcm');assert.equal(inv.samples[0].exportable,true);
  const raw=await exportSamples(bytes,{id:1});assert.deepEqual(raw.bytes,r.samples[0].data);assert.equal(raw.name,'segapcm-pcm-1.bin');
  const zip=await exportSamples(bytes,{all:true});assert.equal(zip.count,1);assert.equal(zip.bytes[0],0x50);
 }
});
test('Sega PCM one-pass preview agrees with real chip, preserves stereo, and CLI produces same WAV',async()=>{
 for(const name of ['segapcm-bank0','segapcm-bank1']){
  const bytes=fixture(name),r=await extractSamples(bytes),e=r.events[0],s=r.samples[0];
  const pcm=await renderSamplePreview(s,e,{getFactory:getNodePlaybackFactory});
  const chip=await SegaPcm.create({moduleFactory:await getNodePlaybackFactory('segapcm'),clock:e.clock,bankShift:e.bankShift,bankMask:e.bankMask});
  try{
   const p=new Ym2612VGM(bytes);while(p.playStep({segapcm:chip}).type!=='wait'){}
   // Force one pass on the original bank, then compare all samples including silence at EOS.
   chip.writeRegister(0x86,(e.bank/2**e.bankShift)|2);
   assert.deepEqual(chip.generateStereo(pcm.left.length),{left:pcm.left,right:pcm.right});
   assert(pcm.left.some(v=>v!==0));assert(pcm.left.every((v,i)=>v===2*pcm.right[i]));assert.equal(pcm.left.at(-1),0);
  }finally{chip.dispose();}
  const a=await exportNodeSamples(bytes,{id:1,format:'wav'}),b=await exportSamples(bytes,{id:1,format:'wav',getFactory:getNodePlaybackFactory});
  assert.deepEqual(a.bytes,b.bytes);assert.equal(new TextDecoder().decode(a.bytes.slice(0,4)),'RIFF');assert(a.seconds<=10);
  await assert.rejects(renderSamplePreview(s,{...e,rate:0},{getFactory:getNodePlaybackFactory}),/zero/);
  await assert.rejects(renderSamplePreview({...s,data:null},e),/missing/);
 }
});
test('Sega PCM ignores out-of-window registers and second ROMs; validates limits and cancellation',async()=>{
 const {t,w,load,voice}=setup();w(0x186,4);assert.equal(t.events.length,0);
 t.apply({type:'segapcm-rom-data',chipIndex:1},0);assert.match([...t.warnings].join(' '),/Second/);
 assert.throws(()=>load(0,[],0x200001),/ROM range/);
 voice();assert.equal(t.samples[0].data,null);
 await assert.rejects(extractSamples(fixture('segapcm-bank0'),{signal:AbortSignal.abort()}),{name:'AbortError'});
});
test('Analyzer enables and retains Samples for Sega PCM standalone and OPM mixes',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const start=source.indexOf('function updateChipSupport('),body=source.slice(start,source.indexOf('\n}',start)+2);
 for(const kind of ['segapcm','ym2151']){
  const context={...chipSupportContext(),currentChipKind:kind,currentBuffer:{},noteishHeader:{segaPcmClock:4000000},setOutputTab(n){context.selected=n;}};
  vm.createContext(context);vm.runInContext(body,context);context.updateChipSupport();assert.equal(context.sampleTab.disabled,false);
  context.sampleTab.getAttribute=()=> 'true';context.selected='samples';context.updateChipSupport();assert.equal(context.selected,'samples');
  context.noteishHeader={};context.updateChipSupport();assert.equal(context.sampleTab.disabled,true);
 }
});
test('Sega PCM Explorer displays waveform, saves PCM/WAV, auditions and stops',async()=>{
 const {mountSampleExplorer}=await import('./sample_explorer.js');
 const previousDocument=globalThis.document,previousAudio=globalThis.AudioContext;
 const downloads=[];let starts=0,stops=0,lines=0;
 const node=tag=>({tag,children:[],style:{},events:{},value:'0',append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},setAttribute(){},addEventListener(t,f){this.events[t]=f;},getContext(){return {beginPath(){},moveTo(){},lineTo(){lines++;},stroke(){}};},click(){if(tag==='a')downloads.push(this.download);}});
 globalThis.document={createElement:node};
 globalThis.AudioContext=class {async resume(){}createBuffer(){return {copyToChannel(){}};}createBufferSource(){return {connect(){},start(){starts++;},stop(){stops++;}};}};
 try{
  const panel=node('div'),ui=mountSampleExplorer(panel,()=>fixture('segapcm-opm-psg'));
  await panel.children[0].onclick();const row=panel.children[1].children.find(n=>n.tag==='details');assert(row);
  row.open=true;row.events.toggle();assert.equal(lines,512);
  const button=text=>row.children.find(n=>n.textContent===text);
  button('Save raw PCM').onclick();assert.equal(downloads[0],'segapcm-pcm-1.bin');
  await button('Save one-pass WAV').onclick();assert.equal(downloads[1],'segapcm-pcm-1.wav');
  await button('Preview stereo (up to 10 s)').onclick();assert.equal(starts,1);ui.stop();assert.equal(stops,1);
  ui.reset();assert.equal(panel.children[1].children.length,0);
 }finally{globalThis.document=previousDocument;globalThis.AudioContext=previousAudio;}
});
test('Samples tab routing opens Sega PCM and OPM mixes, keeps pure OPM unavailable',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const start=source.indexOf('function setOutputTab('),body=source.slice(start,source.indexOf('\n}',start)+2);
 const stub=()=>({setAttribute(){}}),visible=()=>({setVisible(){}});
 for(const kind of ['segapcm','ym2151']){
  const c={...chipSupportContext(),currentChipKind:kind,currentBuffer:{},noteishHeader:{segaPcmClock:4000000},
   sampleExplorer:{stop(){}},tfiInfo:visible(),opmInfo:visible(),sbiInfo:visible(),songTimeline:{active(){}},setStatus(){}};
  for(const n of ['sheetMusic','tfiInfo','sample','operatorInfo','parsedOutput','noteish']){c[n+'Tab']=stub();c[n+'Panel']=stub();}
  vm.createContext(c);vm.runInContext(body,c);c.setOutputTab('samples');assert.equal(c.samplePanel.hidden,false);
  if(kind==='ym2151'){c.noteishHeader={};c.setOutputTab('samples');assert.equal(c.samplePanel.hidden,true);assert.equal(c.parsedOutputPanel.hidden,false);}
 }
});
test('CLI samples command lists and exports Sega PCM through its public options',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'sega-samples-'));
 const cli=new URL('../../cli/main.js',import.meta.url),input=new URL('../../test/fixtures/segapcm-opm-psg.vgm',import.meta.url);
 const run=args=>execFileSync(process.execPath,[cli.pathname,'samples',input.pathname,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  const inventory=JSON.parse(run(['--json']));assert.equal(inventory.samples[0].chip,'segapcm');
  run(['--id','1','--output',join(dir,'sample.bin')]);assert.equal(readFileSync(join(dir,'sample.bin')).length,256);
  run(['--id','1','--format','wav','--output',join(dir,'sample.wav')]);assert.equal(readFileSync(join(dir,'sample.wav')).toString('ascii',0,4),'RIFF');
  run(['--all','--output',join(dir,'samples.zip')]);assert.equal(readFileSync(join(dir,'samples.zip')).toString('ascii',0,2),'PK');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
