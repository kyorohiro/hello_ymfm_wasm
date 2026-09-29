import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createOki6258Samples} from './oki6258_samples.js';
import {extractSamples,listSamples,exportSamples} from './sample_core.js';
import {renderSamplePreview} from './sample_render.js';
import {getNodePlaybackFactory} from '../../cli/render.js';
import {exportNodeSamples} from '../../cli/index.js';
import {Oki6258AudioEngine} from '../js/okim6258audioengine.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
const fixture=n=>readFileSync(new URL(`../../test/fixtures/${n}.vgm`,import.meta.url));
const write=(r,v)=>[0xb7,r,v];
function file(commands,flags=12,clock=8192000){
 const b=new Uint8Array(256+commands.length);b.set([86,103,109,32]);const v=new DataView(b.buffer);
 v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x90,clock,true);b[0x94]=flags;b.set(commands,256);return b;
}
test('OKI captures separate play/stop intervals, repeated play, initial settings and same-time ordering',()=>{
 const t=createOki6258Samples(8192000,12);t.write(2,1,0);t.write(12,2,0);t.write(1,0x77,0);
 t.write(0,2,100);t.write(1,0x12,100);t.write(0,2,100);t.write(1,0x34,100);t.write(0,1,200);
 t.write(0,2,300);t.write(1,0x56,300);t.finish(400,'VGM end');
 assert.equal(t.samples.length,2);assert.deepEqual([...t.samples[0].data],[0x12,0x34]);
 assert.deepEqual([...t.samples[0].times],[0,0,0,0,100]);assert.equal(t.samples[0].initial.pan,1);assert.equal(t.events[0].rate,16000);
 assert.equal(t.events[1].startTime,300);assert.equal(t.samples[1].boundary,'VGM end');
});
test('OKI direct and streamed writes enter one timeline without duplicates',async()=>{
 const b=file([0x67,0x66,0,2,0,0,0,0x12,0x34,...write(0,2),
  0x90,0,0x17,0,1,0x91,0,0,1,0,0x92,0,0x22,0x56,0,0,
  0x93,0,0,0,0,0,1,2,0,0,0,0x61,6,0,...write(1,0x56),...write(0,1),0x66]);
 const r=await extractSamples(b);assert.deepEqual([...r.samples[0].data],[0x12,0x34,0x56]);
 assert.deepEqual([...r.samples[0].times],[0,0,2,6,6]);assert(!r.warnings.some(w=>/target unavailable/.test(w)));
});
test('OKI standalone and OPM mix export timed JSON, metadata inventory and ZIP',async()=>{
 for(const name of ['okim6258-tone','opm-oki-mix']){
  const b=fixture(name),r=await extractSamples(b),s=r.samples[0];assert.equal(s.size,100);assert.equal(s.duration,1200);
  const inv=await listSamples(b);assert.equal(inv.samples[0].representation,'timed-adpcm');
  for(const field of ['data','times','registers','values'])assert.equal(inv.samples[0][field],undefined);
  const raw=await exportSamples(b,{id:1}),json=JSON.parse(new TextDecoder().decode(raw.bytes));
  assert.equal(raw.name,'okim6258-adpcm-stream-1.json');assert.equal(json.format,'tetorica-okim6258-capture');assert.equal(json.values.length,102);assert.equal(json.timebase,44100);
  assert.equal((await exportSamples(b,{all:true})).count,1);
 }
});
test('OKI preview matches real core playback including FIFO and live clock/divider/pan changes',async()=>{
 const commands=[...write(0,2)];
 for(let i=0;i<80;i++){
  commands.push(...write(1,i%2?0x99:0x11),0x61,12,0);
  if(i===20)commands.push(...write(2,1));
  if(i===40)commands.push(...write(12,1));
  if(i===60)commands.push(...write(8,0),...write(9,0x80),...write(10,0x3e),...write(11,0),...write(2,2));
 }
 commands.push(...write(0,1),0x66);
 const b=file(commands),r=await extractSamples(b),s=r.samples[0],pcm=await renderSamplePreview(s,r.events[0],{getFactory:getNodePlaybackFactory});
 const chip=await Oki6258AudioEngine.create({moduleFactory:await getNodePlaybackFactory('okim6258'),clock:8192000,flags:12});
 try{
  const p=new Ym2612VGM(b),left=[],right=[],targets={okim6258:{writeRegister:(r,v)=>chip.writeOki6258(r,v)}};
  while(true){const e=p.playStep(targets);if(e.type==='end')break;if(e.type==='wait')p.consumeWait(targets,e.samples,n=>{const x=chip.processFrames(n);left.push(...x.left);right.push(...x.right);});}
  assert.deepEqual(pcm.left,Float32Array.from(left));assert.deepEqual(pcm.right,Float32Array.from(right));assert(pcm.left.some(v=>v!==0));assert(pcm.left.some((v,i)=>v!==pcm.right[i]));
 }finally{chip.dispose();}
 assert.deepEqual((await exportNodeSamples(b,{id:1,format:'wav'})).bytes,(await exportSamples(b,{id:1,format:'wav',getFactory:getNodePlaybackFactory})).bytes);
});
test('OKI initial committed clock and unfinished clock writes survive a stopped interval',async()=>{
 const t=createOki6258Samples(8192000,12);
 t.write(8,0,0);t.write(9,0x80,0);t.write(10,0x3e,0);t.write(11,0,0);t.write(9,0,0);
 t.write(0,2,10);t.write(1,0x77,10);t.write(11,0,20);t.write(1,0x99,20);t.finish(100,'VGM end');
 assert.equal(t.samples[0].initial.clock,4096000);assert.equal(t.samples[0].initial.clockBuffer,4063232);
 const pcm=await renderSamplePreview(t.samples[0],t.events[0],{getFactory:getNodePlaybackFactory});assert(pcm.left.every(Number.isFinite));assert(pcm.left.some(v=>v!==0));
});
test('OKI unsupported formats, recording and second instance are explicit; preview bounded and cancellable scan',async()=>{
 for(const [flags,clock] of [[0,8192000],[12,0x407d0000]]){
  const r=await extractSamples(file([...write(0,2),...write(1,0x77),0x61,20,0,0x66],flags,clock));assert.equal(r.samples.length,0);assert.match(r.warnings.join(' '),/3-bit/);
 }
 const rec=await extractSamples(file([...write(0,4),...write(1,0x77),0x61,20,0,...write(0x80,2),0x66]));assert.equal(rec.samples.length,0);assert.match(rec.warnings.join(' '),/recording/);assert.match(rec.warnings.join(' '),/Second|second/);
 const t=createOki6258Samples(8192000,12);t.write(0,2,0);t.write(1,0x77,0);t.finish(882000,'VGM end');
 const pcm=await renderSamplePreview(t.samples[0],t.events[0],{getFactory:getNodePlaybackFactory});assert.equal(pcm.left.length,441000);
 await assert.rejects(renderSamplePreview(t.samples[0],t.events[0]),/factory/);
 await assert.rejects(extractSamples(fixture('okim6258-tone'),{signal:AbortSignal.abort()}),{name:'AbortError'});
});
test('Analyzer opens and retains OKI samples for standalone and YM2151 mixtures',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const start=source.indexOf('function updateChipSupport('),body=source.slice(start,source.indexOf('\n}',start)+2);
 for(const kind of ['okim6258','ym2151']){
  const c={...chipSupportContext(),currentChipKind:kind,currentBuffer:{},noteishHeader:{okim6258Clock:8192000},setOutputTab(n){c.selected=n;}};
  vm.createContext(c);vm.runInContext(body,c);c.updateChipSupport();assert.equal(c.sampleTab.disabled,false);
  c.sampleTab.getAttribute=()=> 'true';c.selected='samples';c.updateChipSupport();assert.equal(c.selected,'samples');
 }
});
test('OKI Explorer waveform, timed JSON, WAV, audition and reset use the shared decoder',async()=>{
 const {mountSampleExplorer}=await import('./sample_explorer.js');
 const previousDocument=globalThis.document,previousAudio=globalThis.AudioContext;let starts=0,stops=0,lines=0;const downloads=[];
 const node=tag=>({tag,children:[],style:{},events:{},value:'0',append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},setAttribute(){},addEventListener(t,f){this.events[t]=f;},getContext(){return {beginPath(){},moveTo(){},lineTo(){lines++;},stroke(){}};},click(){if(tag==='a')downloads.push(this.download);}});
 globalThis.document={createElement:node};globalThis.AudioContext=class {async resume(){}createBuffer(){return {copyToChannel(){}};}createBufferSource(){return {connect(){},start(){starts++;},stop(){stops++;}};}};
 try{
  const panel=node('div'),ui=mountSampleExplorer(panel,()=>fixture('opm-oki-mix'));await panel.children[0].onclick();
  const row=panel.children[1].children.find(n=>n.tag==='details');assert(row);const button=t=>row.children.find(n=>n.textContent===t);
  await button('Show waveform (up to 10 s)').onclick();assert.equal(lines,512);
  button('Save timed ADPCM-STREAM JSON').onclick();assert.equal(downloads[0],'okim6258-adpcm-stream-1.json');
  await button('Save capture WAV (up to 10 s)').onclick();assert.equal(downloads[1],'okim6258-adpcm-stream-1.wav');
  await button('Preview stereo (up to 10 s)').onclick();assert.equal(starts,1);ui.reset();assert.equal(stops,1);assert.equal(panel.children[1].children.length,0);
 }finally{globalThis.document=previousDocument;globalThis.AudioContext=previousAudio;}
});
test('OKI Samples tab routing allows standalone and OPM while pure OPM remains unavailable',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8'),start=source.indexOf('function setOutputTab('),body=source.slice(start,source.indexOf('\n}',start)+2);
 for(const kind of ['okim6258','ym2151']){
  const c={...chipSupportContext(),currentChipKind:kind,currentBuffer:{},noteishHeader:{okim6258Clock:8192000},sampleExplorer:{stop(){}},tfiInfo:{setVisible(){}},opmInfo:{setVisible(){}},sbiInfo:{setVisible(){}},songTimeline:{active(){}},setStatus(){}};
  for(const n of ['sheetMusic','tfiInfo','sample','operatorInfo','parsedOutput','noteish']){c[n+'Tab']={setAttribute(){}};c[n+'Panel']={};}
  vm.createContext(c);vm.runInContext(body,c);c.setOutputTab('samples');assert.equal(c.samplePanel.hidden,false);
  if(kind==='ym2151'){c.noteishHeader={};c.setOutputTab('samples');assert.equal(c.samplePanel.hidden,true);}
 }
});
test('CLI OKI inventory, native capture, ZIP and WAV commands succeed',async()=>{
 const {execFileSync}=await import('node:child_process');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'oki-samples-')),cli=new URL('../../cli/main.js',import.meta.url),input=new URL('../../test/fixtures/opm-oki-mix.vgm',import.meta.url);
 const run=args=>execFileSync(process.execPath,[cli.pathname,'samples',input.pathname,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  assert.equal(JSON.parse(run(['--json'])).samples[0].representation,'timed-adpcm');
  run(['--id','1','--output',join(dir,'capture.json')]);assert.equal(JSON.parse(readFileSync(join(dir,'capture.json'))).format,'tetorica-okim6258-capture');
  run(['--all','--output',join(dir,'captures.zip')]);assert.equal(readFileSync(join(dir,'captures.zip')).toString('ascii',0,2),'PK');
  run(['--id','1','--format','wav','--output',join(dir,'capture.wav')]);assert.equal(readFileSync(join(dir,'capture.wav')).toString('ascii',0,4),'RIFF');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
