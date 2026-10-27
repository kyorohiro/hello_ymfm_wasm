import test from 'node:test';
import assert from 'node:assert/strict';
import {appendWonderSwanWave} from './wonderswan_wave_view.js';

const sample={id:4,chip:'wonderswan',kind:'wave',usedInPlayback:true,data:Uint8Array.from({length:16},(_,i)=>i|((15-i)<<4)),waveform:Array.from({length:32},(_,i)=>i%16),available:16,size:16};
const observation=(index=0)=>({sampleId:4,startTime:index*44100,channel:index%4+1,clock:3072000,frequency:1830,frequencyKnown:true,enabled:true,audible:true,mode:'wave',bank:0,address:0,reason:'RAM write'});

function dom(){
  let lines=0,selected=false;
  const node=tag=>({tag,children:[],style:{},attributes:{},value:'',append(...children){this.children.push(...children);},
    setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,fn){this[name]=fn;},
    focus(){},select(){selected=true;},getContext(){return {beginPath(){},moveTo(){},lineTo(){lines++;},stroke(){}};}});
  return {node,document:{createElement:node},get lines(){return lines;},get selected(){return selected;}};
}

test('WonderSwan wave view draws low-first data, changes reusable code with occurrence, and bounds history/options',async()=>{
  const fixture=dom(),previous=globalThis.document;
  globalThis.document=fixture.document;
  try{
    let stops=0,played;
    const output=fixture.node('div'),uses=Array.from({length:510},(_,i)=>observation(i));
    const row=appendWonderSwanWave(output,sample,uses,uses,{onStop(){stops++;},onPreview:async(s,e)=>played=[s,e]});
    assert.equal(row.attributes['data-wonderswan-wave-id'],'4');
    assert.equal(row.attributes['data-wonderswan-wave-usage'],'used');
    assert.match(row.children[0].textContent,/used in playback/);
    row.open=true;row.toggle();row.toggle();assert.equal(fixture.lines,63,'canvas draws once');
    const selection=row.children.find(node=>node.tag==='select'),code=row.children.find(node=>node.tag==='textarea');
    assert.equal(selection.children.length,500);
    let copied;new Function('ws',code.value)({setWaveform:(...args)=>copied=args});
    assert.deepEqual(copied,[0,sample.waveform]);
    selection.value='3';selection.onchange();assert.equal(stops,1);
    new Function('ws',code.value)({setWaveform:(...args)=>copied=args});assert.equal(copied[0],3);
    const listen=row.children.find(node=>node.textContent==='Preview wave (1 s)');
    await listen.onclick();assert.deepEqual(played,[sample,uses[3]]);assert.equal(listen.disabled,false);
    await row.children.find(node=>node.textContent==='Copy setWaveform JavaScript').onclick();assert.equal(fixture.selected,true);
    assert.match(row.children.find(node=>node.tag==='pre').textContent,/Showing first 500 observations/);
    assert.ok(row.children.some(node=>node.textContent==='Save waveform JSON'));
  }finally{globalThis.document=previous;}
});

test('WonderSwan wave controls handle absent pitch and abort pending WAV export without downloading',async()=>{
  const fixture=dom(),previous=globalThis.document,create=URL.createObjectURL;
  globalThis.document=fixture.document;
  let downloads=0,resolve,previewCalls=0;
  URL.createObjectURL=()=>{downloads++;return 'blob:test';};
  try{
    const controller=new AbortController(),row=appendWonderSwanWave(fixture.node('div'),sample,[],[],{
      signal:controller.signal,onPreview:async()=>previewCalls++,onWav:()=>new Promise(done=>resolve=done),
    });
    assert.match(row.children.find(node=>node.tag==='select').children[0].textContent,/A4 test tone/);
    const wav=row.children.find(node=>node.textContent==='Save preview WAV (1 s)'),pending=wav.onclick();
    assert.equal(wav.disabled,true);controller.abort();resolve({bytes:new Uint8Array(44)});await pending;
    assert.equal(downloads,0);
    await row.children.find(node=>node.textContent==='Preview wave (1 s)').onclick();assert.equal(previewCalls,0);
  }finally{globalThis.document=previous;URL.createObjectURL=create;}
});

test('WonderSwan unused RAM is explicitly a candidate, and used waves prefer an audible observation',async()=>{
  const fixture=dom(),previous=globalThis.document;globalThis.document=fixture.document;
  try{
    const unused={...sample,usedInPlayback:false},events=[{...observation(),audible:false,frequencyKnown:false}];
    const candidate=appendWonderSwanWave(fixture.node('div'),unused,events,events,{onPreview:async()=>{}});
    assert.equal(candidate.attributes['data-wonderswan-wave-usage'],'unused');assert.match(candidate.children[0].textContent,/Unplayed RAM candidate/);
    assert.match(candidate.children.find(node=>node.tag==='select').children[0].textContent,/unplayed RAM observation/);
    assert(candidate.children.some(node=>node.tag==='p'&&/test tone deliberately makes this stored RAM audible/.test(node.textContent)));
    await candidate.children.find(node=>node.textContent==='Preview wave (1 s)').onclick();
    assert(candidate.children.some(node=>node.attributes?.role==='status'&&/not the sound of the song/.test(node.textContent)));
    const uses=[{...observation(),audible:false},observation(1)],used=appendWonderSwanWave(fixture.node('div'),sample,uses,uses);
    assert.equal(used.children.find(node=>node.tag==='select').value,'1');
    assert.match(used.children.find(node=>node.tag==='textarea').value,/setWaveform\(1,/);
  }finally{globalThis.document=previous;}
});
