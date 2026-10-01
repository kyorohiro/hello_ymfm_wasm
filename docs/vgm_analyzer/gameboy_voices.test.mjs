import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSamples,exportSamples,listSamples} from './sample_core.js';
import {gameboyVoiceCode} from './gameboy_voices.js';
import {GameboySynth} from '../../web/gameboysynth.js';
import {mountSampleExplorer} from './sample_explorer.js';
const w=(r,v)=>[0xb3,r,v], wait=[0x61,0x44,0xac];
function vgm(commands){const b=new Uint8Array(256+commands.length);b.set([86,103,109,32]);const v=new DataView(b.buffer);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x80,4194304,true);b.set(commands,256);return b;}
const pulse=[...w(22,128),...w(0,0x29),...w(1,0x83),...w(2,0xa2),...w(3,0x34),...w(4,0xc6)];
const noise=[...w(16,7),...w(17,0x59),...w(18,0x3a),...w(19,0xc0)];
test('trigger snapshots decode Pulse/Noise voices and copied code uses the actual synth API',async()=>{
 const r=await extractSamples(vgm([...pulse,...noise,...wait,0x66]));
 const p=r.samples.find(s=>s.kind==='pulse'),n=r.samples.find(s=>s.kind==='noise');
 assert.deepEqual(p.voice,{volume:10,envelope:{direction:'down',period:2},duty:.5});
 assert.deepEqual(p.sweep,{direction:'down',period:2,shift:1});
 assert.deepEqual(n.voice,{volume:5,envelope:{direction:'up',period:1},divisor:2,shift:3,width:7});
 assert.deepEqual(r.events[0].length,{enabled:true,lastWrittenLoad:3});
 assert.equal(r.events[0].frequencyRegister,0x634);
 const writes=[];const synth=new GameboySynth({transport:{reset(){},writeRegister(r,v){writes.push([r,v]);}}});synth.initialize();writes.length=0;
 new Function('gb',gameboyVoiceCode(p))(synth);
 assert.ok(writes.some(([r,v])=>r===2&&v===0xa2));assert.ok(writes.some(([r,v])=>r===0&&v===0x29));
 new Function('gb',gameboyVoiceCode(n))(synth);
 assert.ok(writes.some(([r,v])=>r===18&&v===0x3a));
 assert.ok(writes.every(([r])=>![4,9,19].includes(r)));
});
test('later writes are occurrence-specific; pitch/length do not split a voice; DAC-off closes the interval',async()=>{
 const bytes=vgm([...pulse,...wait,...w(3,0x55),...w(21,0xff),...w(4,0x86),...wait,...w(2,0),...w(3,0x66),0x66]);
 const r=await extractSamples(bytes);assert.equal(r.samples.length,1);assert.equal(r.events.length,2);
 assert.deepEqual(r.events[0].changes.map(x=>[x.offsetSamples,x.register]),[[44100,3],[44100,21]]);
 assert.equal(r.events[0].endReason,'next trigger write');
 assert.deepEqual(r.events[1].changes.map(x=>x.register),[2]);
 assert.equal(r.events[1].endReason,'DAC disabled write');
 const saved=JSON.parse(new TextDecoder().decode((await exportSamples(bytes,{id:1})).bytes));
 assert.equal(saved.occurrences[0].changes.length,2);assert.equal(saved.representation,'trigger-register-settings');
 assert.equal((await listSamples(bytes)).samples[0].representation,'trigger-register-settings');
});
test('incomplete settings and power reset do not create invented voices; CH2 uses index 1',async()=>{
 const r=await extractSamples(vgm([...w(4,128),...pulse,...w(22,0),...w(22,128),...w(4,128),...w(6,64),...w(7,0xf0),...w(9,128),0x66]));
 assert.equal(r.samples.length,2);assert.ok(r.warnings.some(x=>x.includes('unknown voice')));
 const ch2=r.samples.find(s=>s.channel===2);assert.match(gameboyVoiceCode(ch2),/setVoice\(1,/);assert.equal(ch2.sweep,null);
 assert.equal(r.events[0].endReason,'APU power off write');
});
test('GB Info groups channels, separates initial settings from later writes, and resets cleanly',async()=>{
 const previous=globalThis.document;
 const node=tag=>({tag,children:[],style:{},value:'0',append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(){},addEventListener(t,fn){this[t]=fn;},focus(){},select(){}});
 globalThis.document={createElement:node};
 try{
  const panel=node('div'),ui=mountSampleExplorer(panel,()=>vgm([...pulse,...noise,...wait,...w(18,0x24),0x66]));
  ui.setChip('gameboy');assert.equal(panel.children[0].textContent,'Analyze Game Boy voices');await panel.children[0].onclick();
  const children=panel.children[1].children;
  assert.deepEqual(children.filter(x=>x.tag==='h3').map(x=>x.textContent),['Pulse CH1','Noise CH4']);
  const rows=children.filter(x=>x.tag==='details');assert.equal(rows.length,2);
  assert.ok(rows.every(r=>r.children.length===1));
  for(const row of rows){row.open=true;row.toggle();}
  assert.ok(rows[1].children.some(x=>x.textContent?.includes('gb.writeRegister(0x12, 0x24)')));
  assert.ok(rows[0].children.some(x=>x.textContent==='Copy initial voice JavaScript'));
  ui.reset();assert.equal(panel.children[1].children.length,0);
  ui.setChip('ym2612');assert.equal(panel.children[0].textContent,'Analyze samples');
 }finally{globalThis.document=previous;}
});

test('voice details are built once and all occurrences remain reachable in bounded pages',async()=>{
 const {appendGameboyVoice}=await import('./gameboy_voice_view.js');
 const r=await extractSamples(vgm([...pulse,0x66]));
 const events=Array.from({length:205},(_,i)=>({...r.events[0],startTime:i*44100,frequencyRegister:i}));
 const previous=globalThis.document;
 const node=tag=>({tag,children:[],style:{},value:'0',append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(){},addEventListener(t,fn){this[t]=fn;}});
 globalThis.document={createElement:node};
 try{
  const root=node('div');appendGameboyVoice(root,r.samples[0],events,events);const row=root.children[0];
  assert.equal(row.children.length,1);row.open=true;row.toggle();
  const count=row.children.length;row.open=false;row.toggle();row.open=true;row.toggle();assert.equal(row.children.length,count);
  const select=row.children.find(x=>x.tag==='select'),next=row.children.find(x=>x.textContent==='Next occurrences'),back=row.children.find(x=>x.textContent==='Previous occurrences');
  assert.equal(select.children.length,100);assert.equal(back.disabled,true);
  next.onclick();assert.equal(select.value,'100');assert.equal(select.children.length,100);
  next.onclick();assert.equal(select.value,'200');assert.equal(select.children.length,5);assert.equal(next.disabled,true);
  select.value='204';select.onchange();assert.ok(row.children.some(x=>x.textContent?.includes('"frequencyRegister": 204')));
  back.onclick();assert.equal(select.value,'100');assert.equal(next.disabled,false);
 }finally{globalThis.document=previous;}
});
