import {MIDI_SUPPORTED_CC} from './playground_midi.js?v=midi-channels-2';

/**
 * Read SMF format 0/1 with PPQN timing and apply its tempo map to event timestamps.
 * Channel numbers in this parsed representation are 1..16, unlike the 0..15 output API.
 * Parts are separated by track, port, device name and channel. Unsupported performance
 * messages are retained with warnings; parsing does not play or modify a sound chip.
 * @param {ArrayBuffer|Uint8Array} input Complete MIDI file (at most 32 MiB).
 * @returns {{format: number, division: number, events: Object[], parts: Object[], seconds: number, warnings: string[]}}
 *   Events sorted by tick/track/order, with seconds from the beginning of the file.
 * @throws {Error} For malformed data, unsupported timing/format or more than 500000 events.
 */
export function parseMidiFile(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length>32*1024*1024)throw new Error('MIDI file exceeds 32 MiB');
  let p=0,limit=bytes.length;
  const need=n=>{if(p+n>limit)throw new Error('Truncated MIDI file');};
  const u8=()=>{need(1);return bytes[p++];};
  const u16=()=>u8()*256+u8();
  const u32=()=>u16()*65536+u16();
  const tag=()=>String.fromCharCode(u8(),u8(),u8(),u8());
  const vlq=()=>{let n=0;for(let i=0;i<4;i++){const b=u8();n=n*128+(b&127);if(!(b&128))return n;}throw new Error('Invalid MIDI variable length value');};
  if(tag()!=='MThd')throw new Error('Not a Standard MIDI File');
  const headerLength=u32();if(headerLength<6)throw new Error('Invalid MIDI header');need(headerLength);
  const headerEnd=p+headerLength,format=u16(),trackCount=u16(),division=u16();p=headerEnd;
  if(format>1 || !trackCount || (format===0&&trackCount!==1))throw new Error('Only SMF format 0/1 is supported');
  if(!division || division&0x8000)throw new Error('Only PPQN MIDI timing is supported (SMPTE is not supported yet)');
  const events=[],parts=new Map(),warnings=new Set();let maxTick=0;
  for(let track=0;track<trackCount;track++) {
    limit=bytes.length;if(tag()!=='MTrk')throw new Error('Expected MIDI track');const size=u32();need(size);limit=p+size;
    let tick=0,running=0,port=0,device='',name='',ended=false,order=0;
    while(p<limit) {
      if(events.length>=500000)throw new Error('MIDI exceeds 500000 events');
      tick+=vlq();if(!Number.isSafeInteger(tick))throw new Error('MIDI time overflow');maxTick=Math.max(maxTick,tick);
      let status=u8();if(status<128){if(!running)throw new Error('Missing MIDI running status');p--;status=running;}
      const event={track,tick,order:order++,port,device};
      if(status===255) {
        running=0;const meta=u8(),n=vlq();need(n);const data=Array.from(bytes.subarray(p,p+n));p+=n;
        Object.assign(event,{type:'meta',meta,data});
        if(meta===0x51){if(n!==3)throw new Error('Invalid MIDI tempo');event.tempo=data[0]*65536+data[1]*256+data[2];if(!event.tempo)throw new Error('Invalid MIDI tempo');}
        if(meta===3)name=new TextDecoder().decode(Uint8Array.from(data));
        if(meta===0x21){if(n!==1)throw new Error('Invalid MIDI port');port=data[0];}
        if(meta===9)device=new TextDecoder().decode(Uint8Array.from(data));
        events.push(event);
        if(meta===0x2f){if(n!==0)throw new Error('Invalid end-of-track');ended=true;p=limit;break;}
      } else if(status===0xf0||status===0xf7) {
        running=0;const n=vlq();need(n);events.push({...event,type:'sysex',status,data:Array.from(bytes.subarray(p,p+n))});p+=n;warnings.add('SysEx retained but not applied');
      } else {
        if(status<0x80||status>=0xf0)throw new Error('Unsupported MIDI status');running=status;
        const kind=status>>4,channel=(status&15)+1,a=u8(),b=kind===12||kind===13?undefined:u8();
        if(a>127||(b!==undefined&&b>127))throw new Error('Invalid MIDI data byte');
        const key=JSON.stringify([track,port,device,channel]);
        const part=parts.get(key)??{key,track,port,device,channel,name,notes:0};
        if(kind===9&&b>0)part.notes++;parts.set(key,part);
        events.push({...event,type:'channel',kind,channel,a,b,part:key});
        if(kind===10||kind===13)warnings.add('Pressure retained but not applied');
        if(kind===11&&!MIDI_SUPPORTED_CC.includes(a))warnings.add(`CC ${a} retained but not applied`);
        if(kind===11&&a===10)warnings.add('Pan uses left/center/right on FM; PSG pan is not applied');
        if(kind===11&&[100,101,6,38].includes(a))warnings.add('RPN bend range is not applied; set the bend range manually');
        if(kind===12||kind===11&&(a===0||a===32))warnings.add('Bank / Program retained; playback uses manually selected voices');
      }
    }
    if(!ended)throw new Error('Missing MIDI end-of-track');
    for(const part of parts.values())if(part.track===track)part.name=name;
  }
  events.sort((a,b)=>a.tick-b.tick||a.track-b.track||a.order-b.order);
  let tick=0,seconds=0,tempo=500000;
  for(const e of events){seconds+=(e.tick-tick)*tempo/1e6/division;tick=e.tick;e.seconds=seconds;if(e.tempo)tempo=e.tempo;}
  return {format,division,events,parts:[...parts.values()],seconds,warnings:[...warnings]};
}
