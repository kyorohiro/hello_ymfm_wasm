import test from 'node:test';
import assert from 'node:assert/strict';
import { createLilyPondScore, exportAnalysisLilyPond, lilyPitch, suggestLilyPondTempo, exportLilyPondAnalysis } from './vgm_lilypond.js';
const sample = tick => tick * 5512.5; // 120 BPM: 1/16 = 5512.5 VGM samples.
const note = (start, end, midi, key = 1) => ({start: sample(start), end: sample(end), midi, key});
const score = notes => createLilyPondScore([{name:'CH1', notes}], sample(32));

test('absolute pitch notation uses middle C, sharps and bass octaves', () => {
  assert.deepEqual([36,48,60,61,69,72].map(lilyPitch), ['c,','c',"c'","cis'","a'","c''"]);
});
test('rests, cross-bar ties, retriggers and complete aligned bars', () => {
  const result = score([note(4,20,60), note(20,24,60,2)]);
  assert.match(result.text, /r4 c'4~ c'2~ \|\n c'4 c'4 r2 \|/);
  assert.equal(result.noteCount, 2);
  assert.equal(result.skippedNotes, 0);
  const tokens = result.text.match(/(?:r|[a-g](?:is)?[',]*)(?:16|8|4|2|1)(?:~)?(?=\s)/g);
  assert.equal(tokens.reduce((sum,t) => sum + 16 / Number(t.match(/\d+/)[0]), 0),32);
});
test('same key rounded pitch merges; unknown and short intervals do not become notes', () => {
  const result = score([note(0,2,60), note(2,4,60.1), note(4,8,null,2), note(8,8.1,72,3)]);
  assert.match(result.text, /c'4 r4 r2/);
  assert.equal(result.noteCount,1); assert.equal(result.skippedNotes,2);
});
test('manual tempo, escaping, clefs and invalid tempo', () => {
  const result = createLilyPondScore([{name:'Bass', notes:[{start:0,end:22050,midi:36,key:1}]}],22050,{bpm:60,fileName:'a"\\\n曲'});
  assert.match(result.text,/\\clef bass/); assert.match(result.text,/c,8/);
  assert.ok(result.text.includes('title = "a\\"\\\\ 曲"'));
  for(const bpm of [0,NaN,120.5,1000]) assert.throws(()=>scoreWithBpm(bpm),/BPM/);
  function scoreWithBpm(bpm) { return createLilyPondScore([],0,{bpm}); }
});
function vgm(commands, offset, clock) {
  const bytes = new Uint8Array(256+commands.length); bytes.set([86,103,109,32]);
  const view=new DataView(bytes.buffer);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);view.setUint32(offset,clock,true);
  bytes.set(commands,256);return bytes;
}
test('real YM2612 and YM2151 extractors feed LilyPond',()=>{
  const opn=vgm([0x52,0xa4,0x22,0x52,0xa0,0x1d,0x52,0x28,0xf0,0x61,0x22,0x56,0x52,0x28,0,0x66],0x2c,7670454);
  const opm=vgm([0x54,0x28,0x4a,0x54,8,0x78,0x61,0x22,0x56,0x54,8,0,0x66],0x30,3579545);
  assert.match(exportAnalysisLilyPond(opn).text,/a4/);
  const result=exportAnalysisLilyPond(opm);assert.equal(result.noteCount,1);assert.match(result.text,/a'4/);
  assert.equal((result.text.match(/\\new Staff \\with/g)||[]).length,8);
});
test('PSG tone-only input exports and unsupported chip rejects',()=>{
  const psg=vgm([0x50,0x80,0x50,0x10,0x50,0x90,0x61,0x22,0x56,0x50,0x9f,0x66],0x0c,3579545);
  assert.equal(exportAnalysisLilyPond(psg).noteCount,1);
  assert.throws(()=>exportAnalysisLilyPond(vgm([0x66],0x10,3579545)),/requires/);
});


test('tempo suggestion uses key onsets, ignores pitch splits and falls back for sparse input',()=>{
  const notes=Array.from({length:32},(_,i)=>({start:i*44100*60/137,end:(i+0.8)*44100*60/137,midi:60,key:i}));
  assert.equal(suggestLilyPondTempo([{notes}]).bpm,137);
  assert.equal(suggestLilyPondTempo([{notes}]).estimated,true);
  assert.equal(suggestLilyPondTempo([{notes:notes.slice(0,2)}]).estimated,false);
  assert.equal(suggestLilyPondTempo([{notes:notes.map(n=>({...n,key:1}))}]).bpm,120);
  assert.equal(suggestLilyPondTempo([{notes:notes.map(n=>({...n,midi:null}))}]).estimated,false);
});
test('selected channels retain their original names and full score timing',()=>{
  const analysis={channels:[{name:'CH1',notes:[note(0,4,60)]},{name:'CH2',notes:[note(4,8,48)]}],time:sample(16),warnings:[]};
  const result=exportLilyPondAnalysis(analysis,{channelIndices:[1],bpm:120});
  assert.match(result.text,/CH2/);assert.doesNotMatch(result.text,/CH1/);assert.match(result.text,/r4 c4 r2/);
  assert.throws(()=>exportLilyPondAnalysis(analysis,{channelIndices:[]}),/Select/);
  assert.throws(()=>exportLilyPondAnalysis(analysis,{channelIndices:[2]}),/Invalid/);
});
test('dialog recommends BPM, excludes silent channels, retains edits and exports selection',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 let open,submit,opts,clicked=0,scans=0;
 const inputs=[];
 const list={replaceChildren(){inputs.length=0;},append(label){inputs.push(label.input);},querySelectorAll(){return inputs.filter(i=>i.checked);}};
 const bpm={value:'120',reportValidity:()=>true};const help={};const anchor={click(){clicked++;}};
 const context=vm.createContext({
  currentBuffer:new Uint8Array(1),midiExportAvailable:true,lastLoadedFileName:'music.vgz',
  exportLilyPondButton:{addEventListener(_t,fn){open=fn;}},
  lilyPondExportDialog:{close(){},showModal(){},querySelector(){return {addEventListener(_t,fn){submit=fn;}};}},
  lilyPondBpmInput:bpm,
  analyzeLilyPondSource(){scans++;return {tempo:{bpm:137,estimated:true,candidates:[137]},channels:[{name:'CH1',notes:[note(0,4,60)]},{name:'CH2',notes:[]}]};},
  exportLilyPondAnalysis(_a,o){opts=o;return {text:'score',noteCount:1,skippedNotes:0};},
  document:{getElementById:id=>id==='lilyPondChannels'?list:help,createTextNode:s=>s,createElement(tag){return tag==='a'?anchor:tag==='label'?{style:{},append(input){this.input=input;}}:{};}},
  URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Blob:class{},setTimeout(){},setStatus(){},
 });
 vm.runInContext(source.slice(source.indexOf('let lilyPondPrepared =')),context);
 open();assert.equal(bpm.value,137);assert.deepEqual(inputs.map(i=>i.checked),[true,false]);
 bpm.value='90';open();assert.equal(bpm.value,'90');assert.equal(scans,1);
 submit({submitter:{value:'cancel'}});assert.equal(clicked,0);
 submit({submitter:{value:'export'}});assert.equal(opts.bpm,90);assert.deepEqual(Array.from(opts.channelIndices),[0]);assert.equal(anchor.download,'music.ly');
 submit({submitter:{value:'preview'}});assert.equal(clicked,1); // Preview is no longer an action.
 inputs[0].checked=false;let prevented=false;submit({submitter:{value:'export'},preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(clicked,1);
 context.currentBuffer=new Uint8Array(2);open();assert.equal(scans,2);assert.equal(bpm.value,137);
});
