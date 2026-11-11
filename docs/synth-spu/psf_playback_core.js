// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Synchronous PSF1 machine rendering, independent of browser audio scheduling.
import createPsfPlayerModule from '../generated/psf-player/psf_player.js?v=psf-live-spu-1';
import {readPsfLiveSnapshot} from './psf_live_snapshot.js?v=psf-live-spu-1';

const RAM_BYTES=2*1024*1024;
const backend=Object.freeze({abi:3,engine:'play-hle+mame-ps1-spu',sampleRate:44100});
const wasmUrl=new URL('../generated/psf-player/psf_player.wasm?v=psf-live-spu-1',import.meta.url).href;
const abort=signal=>signal?.throwIfAborted();
function validateImage(image) {
  if(!image||!(image.ram instanceof Uint8Array)||image.ram.byteLength!==RAM_BYTES||
      !(image.coverage instanceof Uint8Array)||image.coverage.byteLength!==RAM_BYTES)
    throw new TypeError('PSF playback needs a 2 MiB RAM image and coverage mask.');
  for(const key of ['pc','gp','sp'])if(!Number.isSafeInteger(image[key])||image[key]<0||image[key]>0xffffffff)
    throw new TypeError(`PSF playback needs an unsigned 32-bit ${key}.`);
  const physical=image.pc&0x1fffffff,offset=physical&0x1fffff;
  const alias=image.pc<0x800000||(image.pc>=0x80000000&&image.pc<0x80800000)||(image.pc>=0xa0000000&&image.pc<0xa0800000);
  if(!alias||(image.pc&3)||physical>=0x800000||offset>RAM_BYTES-4||!image.coverage.subarray(offset,offset+4).every(value=>value===1))
    throw new RangeError('PSF entry point is outside the loaded RAM program.');
  if(image.refresh!==undefined&&image.refresh!==50&&image.refresh!==60)
    throw new RangeError('PSF refresh must be 50 or 60 Hz.');
}

/**
 * Create one independent PSF1 CPU/HLE/SPU machine without audio-device access.
 * @param {{image: {ram: Uint8Array, coverage: Uint8Array, pc: number, gp: number, sp: number, refresh?:number}, signal?: AbortSignal, wasmBinary?: Uint8Array, moduleOptions?: object}} options
 */
export async function createPsfPlaybackCore({image,signal,wasmBinary,moduleOptions={}}={}) {
  abort(signal);validateImage(image);
  const module=await createPsfPlayerModule({
    locateFile:path=>path.endsWith('.wasm')?wasmUrl:new URL(path,import.meta.url).href,
    ...moduleOptions,...(wasmBinary?{wasmBinary}:{}),print:()=>{},printErr:()=>{},
  });
  abort(signal);
  if(module._psf_abi_version?.()!==backend.abi||module._psf_spu_model?.()!==1)
    throw new Error('PSF playback components are out of date. Reload the page to load the matching MAME SPU player.');
  let source=0,mask=0,handle=0,output=0,observationBuffer=0,closed=false,position=0;
  const error=()=>new Error(`PSF playback: ${module.UTF8ToString(module._psf_last_error())||'machine failed'}`);
  try {
    source=module._malloc(RAM_BYTES);mask=module._malloc(RAM_BYTES);
    if(!source||!mask)throw new Error('PSF playback could not allocate RAM.');
    module.HEAPU8.set(image.ram,source);module.HEAPU8.set(image.coverage,mask);
    handle=module._psf_create(source,mask,image.pc,image.gp,image.sp,image.refresh??60);
    if(!handle)throw error();
    output=module._malloc(44100*2*4);
    if(!output)throw new Error('PSF playback could not allocate its output buffer.');
    observationBuffer=module._malloc(64);
    if(!observationBuffer)throw new Error('PSF playback could not allocate its bounded observation buffer.');
    abort(signal);
  } catch(e) {
    if(handle)module._psf_destroy(handle);
    if(output)module._free(output);
    if(observationBuffer)module._free(observationBuffer);
    throw e;
  } finally {if(source)module._free(source);if(mask)module._free(mask);}
  return {
    backend,
    sampleRate:44100,
    get position(){return position;},
    observe() {
      if(closed)throw new Error('PSF playback core is disposed.');
      abort(signal);
      return readPsfLiveSnapshot({
        nativeFrames:module._psf_spu_frames(handle),keyGateMask:module._psf_spu_key_gates(handle),activeMask:module._psf_spu_active_mask(handle),
        readRegister:offset=>module._psf_spu_read(handle,offset),
        readRam(address,length) {
          if(length>64||!module._psf_spu_read_ram(handle,address,observationBuffer,length))
            throw new Error('PSF Live bounded RAM observation failed.');
          return module.HEAPU8.slice(observationBuffer,observationBuffer+length);
        },
      });
    },
    render(frames) {
      if(closed)throw new Error('PSF playback core is disposed.');
      abort(signal);
      if(!Number.isSafeInteger(frames)||frames<1||frames>44100)
        throw new RangeError('PSF render size must be 1–44100 stereo frames.');
      const count=module._psf_render(handle,output,frames);
      if(count!==frames)throw error();
      const samples=module.HEAPF32.slice(output/4,output/4+frames*2);
      position+=frames/44100;
      return samples;
    },
    dispose() {
      if(closed)return;
      closed=true;
      module._psf_destroy(handle);module._free(output);module._free(observationBuffer);
      handle=0;output=0;observationBuffer=0;
    },
  };
}
