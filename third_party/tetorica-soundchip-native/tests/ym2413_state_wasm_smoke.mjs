import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=resolve(process.argv[2]??'dist/wasm');
const {default:factory}=await import(pathToFileURL(resolve(dir,'ym2413_wasm.js')));
const m=await factory({wasmBinary:await readFile(resolve(dir,'ym2413_wasm.wasm'))});
const h=m._ym2413_create(),l=m._malloc(8192),r=m._malloc(8192);
const write=(reg,val)=>{m._ym2413_write(h,0,reg);m._ym2413_write(h,1,val);};
const render=n=>{m._ym2413_generate(h,l,r,n);return new Float32Array(m.HEAPF32.buffer,l,n).slice();};
let statePtr;
try {
 for(const [reg,val] of [[0,0xe1],[1,0xe1],[2,0x10],[3,0x05],[4,0xf4],[5,0xf3],[6,0x35],[7,0x48],[0x30,3],[0x10,0x80],[0x20,0x17],[0x36,0x24],[0x37,0x34],[0x38,0x23],[0x16,0x80],[0x26,7],[0x17,0x50],[0x27,7],[0x18,0xa0],[0x28,7],[14,63]])write(reg,val);
 render(1379);const size=m._ym2413_save_state(h,0);assert(size>0);statePtr=m._malloc(size);m._ym2413_save_state(h,statePtr);
 const expected=render(2048);assert(expected.some(v=>v!==0));
 write(14,0);m._ym2413_reset(h);render(37);
 assert.equal(m._ym2413_load_state(h,statePtr,size-1),0);
 assert.equal(m._ym2413_load_state(h,statePtr,size),1);
 assert.deepEqual(render(2048),expected);
 console.log(JSON.stringify({passed:true,stateBytes:size,exactContinuationFrames:2048}));
}finally{if(statePtr)m._free(statePtr);m._free(l);m._free(r);m._ym2413_destroy(h);}
