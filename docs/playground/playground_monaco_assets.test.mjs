import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectSynthCodeDeclarations} from '../synth/synth_code_declarations.js';

function monacoHost(initial='') {
  const models=new Map(),libraries=[];
  function model(text,uri){const result={getValue:()=>text,setValue:value=>{text=value;}};models.set(uri.toString(),result);return result;}
  const monaco={Uri:{parse:value=>({toString:()=>value})},
    languages:{typescript:{javascriptDefaults:{addExtraLib:(text,uri)=>libraries.push({text,uri})}}},
    editor:{getModel:uri=>models.get(uri.toString()),createModel:(text,_language,uri)=>model(text,uri)}};
  if(initial)model(initial,monaco.Uri.parse('file:///tetorica-playground-globals.d.ts'));
  return {monaco,libraries,models};
}

test('lazy Monaco declarations use captured trusted fetch during Code guards and leave default Playground declarations unchanged',async()=>{
  const original=globalThis.fetch,calls=[];
  const globals=await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8');
  const ym=await readFile(new URL('./tetorica-playground-ym2612.d.ts',import.meta.url),'utf8');
  const shell=await readFile(new URL('./tetorica-shell.d.ts',import.meta.url),'utf8');
  try {
    globalThis.fetch=async input=>{const url=new URL(input);calls.push(url.pathname);return{ok:true,text:async()=>url.pathname.includes('globals')?globals:url.pathname.includes('shell')?shell:ym};};
    const {registerMonacoPlaygroundGlobals}=await import('./playground_monaco.js?trusted-assets-test');
    const guardedFetch=()=>{throw Error('User code network guard');};globalThis.fetch=guardedFetch;
    const code=monacoHost('old unfiltered model');
    const selected=await registerMonacoPlaygroundGlobals(code.monaco,'ym2612',{
      declarationFiles:['tetorica-playground-globals'],transformDeclarations:selectSynthCodeDeclarations,
    });
    assert.equal(calls.length,1);assert.equal(selected.size,1);
    assert.match(code.libraries[0].text,/type SynthCodeSoundChipMap/);
    assert.doesNotMatch(code.libraries[0].text,/declare function createSoundChip|declare const CH7:/);
    assert.equal(selected.get('file:///tetorica-playground-globals.d.ts').getValue(),code.libraries[0].text,'definition model receives the same filtered declarations');
    const playground=monacoHost();await registerMonacoPlaygroundGlobals(playground.monaco,'ym2612');
    assert.equal(calls.length,4);assert.equal(playground.libraries.length,3);
    const primary=playground.libraries.find(item=>item.uri.endsWith('tetorica-playground-globals.d.ts'));
    assert.match(primary.text,/declare function createSoundChip/);assert.match(primary.text,/declare const CH16:/);
    assert.equal(globalThis.fetch,guardedFetch,'the host does not restore or weaken the user-code guard');
  }finally{globalThis.fetch=original;}
});
