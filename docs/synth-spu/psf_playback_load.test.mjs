// Host-only WASM loading while user Code's network guard stays installed.
// These resource tests never create audio or perform network requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=(await readFile(new URL('./psf_playback_core.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export async function createPsfPlaybackCore','async function createPsfPlaybackCore')
  .replaceAll('import.meta.url',JSON.stringify('https://example.test/synth-spu/psf_playback_core.js'));
const bytes=Uint8Array.of(0,97,115,109,1,0,0,0);
const image=()=>{const ram=new Uint8Array(0x200000),coverage=new Uint8Array(0x200000);coverage.fill(1,0x10000,0x10004);return {ram,coverage,pc:0x80010000,gp:0,sp:0x801fff00};};
function fixture({fetcher,process:nodeProcess}={}) {
  const calls=[],factories=[],sentinel=Error('Factory reached'),guard=()=>{throw Error('User Code network guard');};
  const context=vm.createContext({URL,Uint8Array,DOMException,window:{},...(nodeProcess?{process:nodeProcess}:{}),
    fetch:(target,options)=>{calls.push({target,options});return fetcher?fetcher(target,options):Promise.resolve({ok:true,status:200,arrayBuffer:async()=>bytes.buffer.slice(0)});},
    createPsfPlayerModule:async options=>{factories.push(options);throw sentinel;},
    createPsfSongInteraction(){throw Error('Native interaction should not be reached');},readPsfLiveSnapshot(){throw Error('Native observation should not be reached');},
  });
  vm.runInContext(source,context);
  // This mirrors the real order: page modules load first, then Run guards the
  // user-code realm, then the host starts a PSF preflight while Code continues.
  context.fetch=guard;
  return {context,calls,factories,guard,sentinel,create:options=>context.createPsfPlaybackCore({image:image(),...options})};
}

test('PSF browser preflight fetches internal WASM through the captured host function while Code fetch stays guarded',async()=>{
  const h=fixture(),controller=new AbortController();
  await assert.rejects(h.create({signal:controller.signal}),error=>error===h.sentinel);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].target,'https://example.test/generated/psf-player/psf_player.wasm?v=psf-manual-spu-1');
  assert.equal(h.calls[0].options.signal,controller.signal);assert.equal(h.calls[0].options.credentials,'same-origin');
  assert.equal(h.factories.length,1);assert.deepEqual(h.factories[0].wasmBinary,bytes);
  assert.equal(h.context.fetch,h.guard);assert.throws(()=>h.context.fetch('/anything'),/network guard/);
});

test('browser preload respects custom locateFile target and generated factory prefix',async()=>{
  const h=fixture(),locations=[];
  const locateFile=(name,prefix)=>{locations.push({name,prefix});return '/custom/player.wasm';};
  await assert.rejects(h.create({moduleOptions:{locateFile}}),error=>error===h.sentinel);
  assert.deepEqual(locations,[{name:'psf_player.wasm',prefix:'https://example.test/generated/psf-player/'}]);
  assert.equal(h.calls[0].target,'/custom/player.wasm');assert.equal(h.factories[0].locateFile,locateFile);
  assert.equal(h.context.fetch,h.guard);
});

test('explicit binary and custom instantiation preserve factory options without an additional fetch',async()=>{
  for(const options of [{wasmBinary:bytes},{moduleOptions:{wasmBinary:bytes}},{moduleOptions:{instantiateWasm(){}}}]){
    const h=fixture();await assert.rejects(h.create(options),error=>error===h.sentinel);assert.equal(h.calls.length,0);
    if(options.moduleOptions?.instantiateWasm)assert.equal(h.factories[0].instantiateWasm,options.moduleOptions.instantiateWasm);
    else assert.equal(h.factories[0].wasmBinary,bytes);
  }
  const h=fixture(),other=Uint8Array.of(1,2,3);
  await assert.rejects(h.create({wasmBinary:bytes,moduleOptions:{wasmBinary:other}}),error=>error===h.sentinel);
  assert.equal(h.calls.length,0);assert.equal(h.factories[0].wasmBinary,bytes,'top-level explicit binary retains precedence');
});

test('Node retains the factory filesystem loader even in a host with a window object',async()=>{
  const h=fixture({process:{versions:{node:'26.0.0'}}});
  await assert.rejects(h.create(),error=>error===h.sentinel);
  assert.equal(h.calls.length,0);assert.equal(h.factories[0].wasmBinary,undefined);assert.equal(h.context.fetch,h.guard);
});

test('invalid images and early aborted signals do not fetch or instantiate a candidate',async()=>{
  const h=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(h.create({signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(h.create({image:{}}),/2 MiB RAM/);
  assert.equal(h.calls.length,0);assert.equal(h.factories.length,0);
});

test('aborting the native host fetch or pending binary read never reaches the factory or changes Code guards',async()=>{
  const h=fixture({fetcher:(_target,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  const controller=new AbortController(),pending=h.create({signal:controller.signal});controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(h.factories.length,0);assert.equal(h.context.fetch,h.guard);
  let finish,reading;const bodyStarted=new Promise(resolve=>{reading=resolve;});
  const later=fixture({fetcher:async()=>({ok:true,status:200,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;reading();})})}),lateController=new AbortController();
  const late=later.create({signal:lateController.signal});await bodyStarted;lateController.abort();finish(bytes.buffer.slice(0));
  await assert.rejects(late,{name:'AbortError'});assert.equal(later.factories.length,0);assert.equal(later.context.fetch,later.guard);
});

test('a failed internal HTTP request leaves the running Code guard intact and never instantiates the PSF',async()=>{
  const h=fixture({fetcher:async()=>({ok:false,status:503,arrayBuffer(){throw Error('HTTP failure must not read the body');}})});
  await assert.rejects(h.create(),/PSF playback WASM HTTP 503/);
  assert.equal(h.factories.length,0);assert.equal(h.context.fetch,h.guard);
});
