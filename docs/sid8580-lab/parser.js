// SPDX-License-Identifier: BSD-3-Clause
// Research target selection only. Production PAL/6581 validation stays intact.
import {parsePsidStructure} from './psid_structure.js';
import {parseRsid} from '../js/sid_rsid.js';

export function validateResearchSid(input,{clock,model,subtune,environment='minimal'}={}){
  if(clock!==undefined&&clock!=='pal')throw new RangeError('The research machine supports PAL only');
  if(model!==undefined&&model!=='8580')throw new RangeError('The research machine supports the 8580 model only');
  if(!['minimal','rom'].includes(environment))throw new RangeError('Environment must be minimal or rom');
  const bytes=input instanceof ArrayBuffer?new Uint8Array(input):ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
  if(!bytes)throw new TypeError('SID input must be a byte buffer');
  const psid=bytes.length>=4&&bytes[0]===80&&bytes[1]===83&&bytes[2]===73&&bytes[3]===68;
  const parsed=psid?parsePsidStructure(bytes):parseRsid(bytes);
  if(parsed.version!==2)throw new Error('This research machine currently supports PSID/RSID v2 only');
  if(psid&&(parsed.loadAddress<0x0800||parsed.endAddress>0xd000))throw new Error('Research PSID payload must fit RAM $0800..$CFFF');
  if(parsed.clock==='ntsc')throw new Error('A declared NTSC tune is not supported by the PAL research machine');
  if(parsed.model==='6581')throw new Error('A declared 6581 tune uses the existing SID Player');
  if(parsed.clock!=='pal'&&clock!=='pal')throw new Error('Choose PAL explicitly for an unspecified/either clock');
  if(parsed.model!=='8580'&&model!=='8580')throw new Error('Choose 8580 explicitly for an unspecified/either SID model');
  const selected=subtune??parsed.startSong;
  if(!Number.isInteger(selected)||selected<1||selected>parsed.songs)throw new RangeError(`Subtune must be an integer 1..${parsed.songs}`);
  if(parsed.basic&&environment!=='rom')throw new Error('BASIC startup requires user-supplied C64 ROMs');
  const timing=psid?parsed.songSpeeds[selected-1]:'c64-irq';
  let driverPage=0;
  if(psid){
    const {startPage,pageLength}=parsed.relocation;
    if(startPage===255)throw new Error('The PSID declares no free RAM for the C64 interrupt driver');
    if(startPage){
      driverPage=null;
      for(let p=startPage;p<startPage+pageLength;p++)if(p>=4&&(p<0xa0||p>=0xc0&&p<0xd0)){driverPage=p;break;}
      if(driverPage===null)throw new Error('No always-visible RAM page is available for the C64 interrupt driver');
    }
  }
  return {...parsed,subtune:selected,timing,driverPage,environment,playbackBackend:'research-c64',
    selectedClock:'pal',selectedModel:'8580',clockHz:985248,
    selection:{clock:parsed.clock==='pal'?'header':'explicit',model:parsed.model==='8580'?'header':'explicit'}};
}
