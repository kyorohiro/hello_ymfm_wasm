// SPDX-License-Identifier: BSD-3-Clause
// Original synthetic PSF data; no executable game code or game assets.
import {deflateSync} from 'node:zlib';
import {createVabFixture} from './spu_vab_fixture.mjs';

export function fixtureCrc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export function psfFromExe(exe,tags='',{reserved=new Uint8Array(),version=1}={}) {
  const compressed=deflateSync(exe),suffix=new TextEncoder().encode(tags?`[TAG]${tags}`:'');
  const result=new Uint8Array(16+reserved.length+compressed.length+suffix.length),view=new DataView(result.buffer);
  result.set([0x50,0x53,0x46,version]);view.setUint32(4,reserved.length,true);view.setUint32(8,compressed.length,true);view.setUint32(12,fixtureCrc32(compressed),true);
  result.set(reserved,16);result.set(compressed,16+reserved.length);result.set(suffix,16+reserved.length+compressed.length);return result;
}
export function makePsf(data,address=0x80010000,tags='',options) {
  const exe=new Uint8Array(0x800+data.length),view=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode('PS-X EXE'));view.setUint32(0x18,address,true);view.setUint32(0x1c,data.length,true);exe.set(data,0x800);
  return psfFromExe(exe,tags,options);
}
export const psfFile=(name,bytes,webkitRelativePath='')=>({name,webkitRelativePath,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
export function createPsfFixture() {
  const {vab}=createVabFixture(),image=new Uint8Array(0x10000+vab.length);
  image.set(vab);const second=vab.slice();new DataView(second.buffer).setUint32(8,24,true);image.set(second,0x10000);
  const standalone=makePsf(image,0x80010000,'title=Original synthetic PSF\n');
  const library=makePsf(image,0x80010000,'title=Shared banks\n');
  const mini=makePsf(Uint8Array.of(0),0x80010845,'_lib=lib\\Bank.psflib\n_lib2=patch.psflib\ntitle=MiniPSF fixture\n');
  const patch=makePsf(Uint8Array.of(64),0xa0010845);
  return {standalone,mini,library,patch,files:[psfFile('track.minipsf',mini,'Demo/track.minipsf'),psfFile('Bank.psflib',library,'Demo/lib/Bank.psflib'),psfFile('patch.psflib',patch,'Demo/patch.psflib')]};
}
