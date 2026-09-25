import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('page import, routing and all eight panels deliver controls to the worklet',async()=>{
  const elements=new Map();
  class Element {
    constructor(){this.children=[];this.value='';this.checked=false;this.hidden=false;this.classList={add(){},remove(){}};}
    set id(id){this._id=id;elements.set(id,this);}get id(){return this._id;}
    append(...children){this.children.push(...children);}
  }
  const html=await readFile(new URL('../docs/native_audio_effect/index.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const el=new Element();el.id=match[1];
    el.value=/\bvalue="([^"]*)"/.exec(match[0])?.[1]??'';
    el.checked=/\bchecked\b/.test(match[0]);el.hidden=/\bhidden\b/.test(match[0]);
  }
  elements.get('routing').value='serial';
  const document={getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id);},createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
  const messages=[];let source,started=0,stopped=0;
  class Context {
    sampleRate=48000;destination={};audioWorklet={addModule:async()=>{}};
    async decodeAudioData(){return {duration:1,numberOfChannels:2,sampleRate:48000};}
    async resume(){}async close(){}
    createBufferSource(){source={connect(){},disconnect(){},start(){started++;},stop(){stopped++;}};return source;}
  }
  class Node {port={postMessage:m=>messages.push(m)};connect(){}}
  const bytes=await readFile(new URL('../docs/native_audio_effect/gain.wasm',import.meta.url));
  const scope=vm.createContext({document,window:{addEventListener(){}},AudioContext:Context,AudioWorkletNode:Node,WebAssembly,URL,
    fetch:async()=>({ok:true,arrayBuffer:async()=>bytes}),console});
  const controls=await readFile(new URL('../docs/native_audio_effect/fx_controls.js',import.meta.url),'utf8');
  vm.runInContext(controls.replaceAll('export ',''),scope);
  const main=await readFile(new URL('../docs/native_audio_effect/main.js',import.meta.url),'utf8');
  vm.runInContext(main.replace(/^import .*\n/,'').replaceAll('import.meta.url',JSON.stringify(new URL('../docs/native_audio_effect/main.js',import.meta.url).href)),scope);
  elements.get('file').files=[{name:'test.wav',arrayBuffer:async()=>new ArrayBuffer(1)}];
  await elements.get('file').onchange();
  assert.equal(elements.get('play').disabled,false);
  assert.equal(messages.filter(m=>m.type==='extra'&&m.parameter===7).length,8);
  await elements.get('play').onclick();assert.equal(started,1);
  elements.get('routing').value='extended';elements.get('routing').onchange();
  assert.equal(stopped,1);assert.equal(elements.get('extraControls').hidden,false);
  assert.equal(messages.filter(m=>m.type==='routing').at(-1).mode,'extended');
  for(const kind of [7,8,9,10,11,12,13,14]) {
    const name={7:'filter',8:'delay',9:'distortion',10:'bitcrusher',11:'wobble',12:'flanger',13:'slicer',14:'chorus'}[kind];
    const slider=elements.get(`extra-${name}-0`);slider.oninput();
    assert.equal(messages.at(-1).kind,kind);assert.equal(messages.at(-1).parameter,0);
  }
  await elements.get('play').onclick();assert.equal(started,2);
  elements.get('stop').onclick();assert.equal(stopped,2);
});
