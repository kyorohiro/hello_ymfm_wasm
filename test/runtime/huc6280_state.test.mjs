import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Huc6280AudioEngine} from '../../tetorica_src/runtime/huc6280audioengine.js';

function fakeModule(stamp=42){
  const module={HEAPU8:new Uint8Array(65536),loads:0,allocations:0,frees:0,failAllocation:false};module.HEAPF32=new Float32Array(module.HEAPU8.buffer);
  const chip={clock:0,rate:0,selected:0,mask:0,phase:0};let next=1024;
  Object.assign(module,{
    _huc6280_create(clock,rate){chip.clock=clock;chip.rate=rate;return 1;},_huc6280_destroy(){},
    _huc6280_write(_handle,r,v){if((r&15)===0)chip.selected=v&7;},_huc6280_mute(_handle,ch,on){chip.mask=on?chip.mask|(1<<ch):chip.mask&~(1<<ch);},
    _huc6280_reset(){chip.phase=0;chip.selected=0;},
    _malloc(size){if(module.failAllocation)return 0;module.allocations++;const ptr=next;next+=Math.ceil(size/8)*8;return ptr;},_free(){module.frees++;},
    _huc6280_generate(_handle,left,right,frames){for(let i=0;i<frames;i++){module.HEAPF32[left/4+i]=Math.sin(chip.phase++/7);module.HEAPF32[right/4+i]=chip.mask?-0.2:0.2;}},
    _huc6280_state_size:()=>512,
    _huc6280_save_state(_handle,ptr,size){if(size!==512)return 0;const bytes=module.HEAPU8.subarray(ptr,ptr+size);bytes.fill(0);bytes.set(new TextEncoder().encode('HUCSAVE1'));const view=new DataView(bytes.buffer,bytes.byteOffset,512);
      view.setUint32(8,1,true);view.setUint32(12,512,true);view.setUint32(16,stamp,true);view.setUint32(24,chip.clock,true);view.setUint32(28,chip.rate,true);bytes[48]=chip.selected;bytes[53]=chip.mask;view.setUint32(64,chip.phase,true);return 1;},
    _huc6280_validate_state(_handle,ptr,size){const bytes=module.HEAPU8.subarray(ptr,ptr+size),view=new DataView(bytes.buffer,bytes.byteOffset,size);return Number(size===512&&String.fromCharCode(...bytes.subarray(0,8))==='HUCSAVE1'&&view.getUint32(16,true)===stamp&&view.getUint32(24,true)===chip.clock&&view.getUint32(28,true)===chip.rate&&bytes[48]<8&&bytes[53]<64);},
    _huc6280_load_state(handle,ptr,size){if(!module._huc6280_validate_state(handle,ptr,size))return 0;const view=new DataView(module.HEAPU8.buffer,ptr,size);module.loads++;chip.selected=module.HEAPU8[ptr+48];chip.mask=module.HEAPU8[ptr+53];chip.phase=view.getUint32(64,true);return 1;},
  });return module;
}
const engine=(module=fakeModule(),options={})=>new Huc6280AudioEngine(module,options.clock??3579545,options.rate??48000,options.volume??1);

test('HuC6280 opaque states transfer across matching instances without retaining WASM heap views',()=>{
  const a=engine(),b=engine();a.writeHuc6280(0,5);a.processFrames(37);const state=a.saveState();
  assert.deepEqual(Object.keys(state),['byteLength']);assert.equal(state.byteLength,512);assert(Object.isFrozen(state));
  a.module.HEAPU8.fill(0);assert.equal(b.validateState(state),true);b.loadState(state);assert.equal(b.selectedChannel,5);
  const expected=a.processFrames(111),actual=b.processFrames(111);assert.deepEqual(actual,expected);assert.equal(b.module.loads,1);
  assert.throws(()=>b.loadState({...state}),/Invalid or incompatible/);assert.throws(()=>b.loadState(structuredClone(state)),/Invalid or incompatible/);
  a.dispose();b.dispose();
});

test('clock/rate/volume/mask/build mismatch and allocation errors are rejected before native mutation',()=>{
  const a=engine();a.setChannelMuted(2,true);a.writeHuc6280(0,3);const state=a.saveState();
  const candidates=[engine(fakeModule(),{clock:3579544}),engine(fakeModule(),{rate:44100}),engine(fakeModule(),{volume:.5}),engine(),engine(fakeModule(43))];
  for(const [index,candidate]of candidates.entries()){if(index!==3)candidate.setChannelMuted(2,true);
    assert.throws(()=>candidate.loadState(state),/Invalid|Incompatible|incompatible/);assert.equal(candidate.module.loads,0);candidate.dispose();}
  const valid=engine();valid.setChannelMuted(2,true);valid.module.failAllocation=true;assert.throws(()=>valid.loadState(state),/allocation failed/);assert.equal(valid.module.loads,0);valid.module.failAllocation=false;
  valid.loadState(state);assert.equal(valid.selectedChannel,3);assert.equal(valid.channelMask,4);valid.reset();assert.equal(valid.channelMask,4);assert.equal(valid.saveState().byteLength,512);
  const stale=engine();stale.writeHuc6280(0,4);stale.selectedChannel=2;assert.throws(()=>stale.saveState(),/native state settings/);assert.equal(stale.module.allocations,stale.module.frees);
  stale.dispose();valid.dispose();a.dispose();
});

test('older WASM builds expose unavailable state support rather than a fake snapshot',()=>{
  const module=fakeModule();delete module._huc6280_state_size;const i=engine(module);assert.equal(i.supportsState(),false);assert.throws(()=>i.saveState(),/unavailable/);i.dispose();
});

test('actual native HuC6280 state produces identical continuation in a matching second instance',async t=>{
  const {default:factory}=await import('../../tetorica_src/runtime/generated/huc6280_wasm.js');
  const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/huc6280_wasm.wasm',import.meta.url));
  const moduleFactory=()=>factory({wasmBinary}),a=await Huc6280AudioEngine.create({moduleFactory,clock:3579545,outputSampleRate:48000});
  t.after(()=>a.dispose());if(!a.supportsState()){t.skip('Native state SDK rebuild is pending');return;}
  const b=await Huc6280AudioEngine.create({moduleFactory,clock:3579545,outputSampleRate:48000});t.after(()=>b.dispose());
  a.writeHuc6280(1,255);a.writeHuc6280(0,0);a.writeHuc6280(4,64);a.writeHuc6280(4,0);for(let n=0;n<32;n++)a.writeHuc6280(6,n);
  a.writeHuc6280(5,255);a.writeHuc6280(2,173);a.writeHuc6280(3,1);a.writeHuc6280(4,159);a.processFrames(337);const state=a.saveState();b.loadState(state);
  assert.deepEqual(b.processFrames(4093),a.processFrames(4093));
});
