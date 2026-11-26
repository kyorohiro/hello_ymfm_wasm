// SPDX-License-Identifier: BSD-3-Clause
import {createScspSongCore,createScspSongRenderer} from '../synth-scsp/song_player.js';
import {prepareScspSongSource} from '../synth-scsp/song_source.js';
import {createScspSsfWasmRenderer} from '../synth-scsp/scsp_ssf_wasm.js';
import {createPsfPlaybackCore} from '../synth-spu/psf_playback_core.js';
import {preparePsfSongSource} from '../synth-spu/psf_song_source.js';
import {parseVsuVgm} from '../synth-vsu/vgm.js';
import {createVgmTransport} from '../synth-vsu/vgm-transport.js';
import {wavHeader,encodePcm16} from './vgm_wav.js';

const rate = 44100, block = 2048;

async function binary(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error('Audio engine could not load: HTTP '+response.status);
  return response.arrayBuffer();
}

async function vsuRenderer(bytes, mask) {
  const plan = parseVsuVgm(bytes);
  const wasm = await binary(new URL('../synth-vsu/vsu.wasm',import.meta.url));
  const {instance:{exports:core}} = await WebAssembly.instantiate(wasm);
  const state = core.__heap_base.value, left = state + Math.ceil(core.vsu_size()/4)*4, right = left+4*block;
  const extra = right+4*block-core.memory.buffer.byteLength;
  if (extra > 0) core.memory.grow(Math.ceil(extra/65536));
  const transport = createVgmTransport({sampleRate:rate,reset:()=>core.vsu_reset(state),
    write:(addr,value)=>core.vsu_write(state,addr,value),setMask:value=>core.vsu_set_mix_mask(state,value),
    readChannel:ch=>core.vsu_get_channel(state,ch),onState() {},
    renderFrames:(offset,count)=>core.vsu_render(state,left+offset*4,right+offset*4,count,rate)});
  transport.play({id:1,plan,loop:false,mask:63 & ~mask});
  return {frames:plan.durationTicks,render(l,r,n) {
    const count = transport.render(n);
    l.set(new Float32Array(core.memory.buffer,left,count));
    r.set(new Float32Array(core.memory.buffer,right,count));
    return count;
  }};
}

async function renderer({song,mask,length,fade,maxFrames}) {
  if (song.format === 'VSU') return vsuRenderer(song.bytes,mask);
  if (song.format === 'SCSP') {
    const source = await prepareScspSongSource(song.bytes), core = await createScspSongCore();
    const engine = createScspSongRenderer(core,source,()=>mask);
    return {frames:source.totalSamples,render:engine.process,dispose:()=>core.dispose()};
  }
  if (song.format === 'SSF') {
    const source = song.source;
    const wasm = await binary(new URL('../generated/scsp-ssf/scsp-ssf.wasm',import.meta.url));
    const engine = await createScspSsfWasmRenderer(wasm,{...source,totalSamples:source.totalSamples ?? maxFrames});
    return {frames:source.totalSamples,dispose:engine.dispose,render(l,r,n) {
      const pcm = engine.process(n,mask);
      l.set(pcm.left); r.set(pcm.right); return pcm.frames;
    }};
  }
  const image = await preparePsfSongSource(song.set,song.path);
  const core = await createPsfPlaybackCore({image});
  core.setMuteMask(mask);
  let pos = 0;
  return {frames:length === null ? null : Math.round((length+fade)*rate),dispose:core.dispose,render(l,r,n) {
    const pcm = core.render(n);
    for (let i=0;i<n;i++,pos++) {
      const gain = fade && length !== null ? Math.min(1,Math.max(0,(length+fade-pos/rate)/fade)) : 1;
      l[i]=pcm[2*i]*gain; r[i]=pcm[2*i+1]*gain;
    }
    return n;
  }};
}

self.onmessage = async ({data}) => {
  let engine;
  try {
    const maxFrames = Math.round(data.maxSeconds*rate);
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 600*rate) throw Error('Choose up to 600 seconds.');
    engine = await renderer({...data,maxFrames});
    const frames = Math.min(engine.frames ?? maxFrames,maxFrames);
    if (!frames) throw Error('Nothing to render for this track.');
    const bytes = new Uint8Array(44+frames*4);
    bytes.set(wavHeader(frames,rate));
    const left = new Float32Array(block), right = new Float32Array(block);
    let percent = -1;
    for (let at=0;at<frames;) {
      const n = Math.min(block,frames-at);
      if (engine.render(left,right,n) !== n) throw Error('Song ended before its declared duration.');
      for (let i=0;i<n;i++) {left[i]*=data.master; right[i]*=data.master;}
      bytes.set(encodePcm16(left,right,n),44+at*4);
      at+=n;
      const next = Math.floor(at*100/frames);
      if (percent !== next) {percent=next; self.postMessage({progress:at/frames});}
    }
    self.postMessage({bytes,seconds:frames/rate,sampleRate:rate,truncated:engine.frames===null || frames<engine.frames},[bytes.buffer]);
  } catch (error) {self.postMessage({error:error.message});}
  finally {engine?.dispose?.();}
};
