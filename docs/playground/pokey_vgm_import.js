import {Ym2612VGM,rawCommandLength} from '../js/ym2612vgm.js?v=pokey-vgm-1';

export const POKEY_VGM_IMPORT_LIMITS=Object.freeze({sourceBytes:16*1024*1024,bankBytes:16*1024*1024,
  bankCopyBytes:64*1024*1024,timelineBytes:8*1024*1024,entries:1000000,
  recursiveCommands:256,sourceCharacters:64*1024*1024,durationSamples:0xffffffff});
const hex=value=>`0x${value.toString(16).padStart(2,'0')}`;
const fail=message=>{throw new Error(`POKEY VGM import: ${message}`);};

function checkHeader(parser){
  const clocks=Object.entries(parser.header).filter(([key,value])=>key.endsWith('Clock')&&value);
  if(clocks.length!==1||clocks[0][0]!=='pokeyClock')fail('requires only POKEY; mixed-chip files are unsupported.');
  const raw=parser.header.pokeyClock>>>0,clock=raw&0x3fffffff,chipCount=raw&0x40000000?2:1;
  if(raw&0x80000000)fail('clock variant flags are unsupported.');
  if(clock<100000||clock>100000000)fail('clock must be 100000..100000000 Hz.');
  const clockOffsets=[0x0c,0x10,0x2c,0x30,0x38,0x40,0x44,0x48,0x4c,0x50,0x54,0x58,0x5c,0x60,0x64,0x68,0x6c,0x70,0x74,0x80,0x84,0x88,0x8c,0x90,0x98,0x9c,0xa0,0xa4,0xa8,0xac,0xb0,0xb4,0xb8,0xc0,0xc4,0xc8,0xcc,0xd0,0xd8,0xdc,0xe0,0xe4,0xe8,0xec,0xf0,0xf4,0xf8,0xfc];
  for(const offset of clockOffsets)if(offset!==0xb0&&offset+4<=parser.header.dataOffset&&offset+4<=parser.bytes.length&&parser.view.getUint32(offset,true))fail(`mixed-chip clock at header ${hex(offset)} is unsupported.`);
  if(parser.header.dataOffset>=0xc0&&parser.bytes.length>=0xc0&&parser.view.getUint32(0xbc,true))fail('extra-header clock/volume overrides are unsupported.');
  return {clock,chipCount};
}

// Bound the parser's recursive metadata path and bank-copy work before walking
// it. The shared VGM parser remains the only decoder of DAC stream timing.
function validateCommands(parser,chipCount){
  const {bytes,view,header}=parser,declaredEnd=view.getUint32(4,true)+4,end=declaredEnd===4?bytes.length:declaredEnd;
  if(header.dataOffset<0xb4||header.dataOffset>=end||end>bytes.length)fail('invalid data/EOF offset.');
  const configured=new Map(),blocks=new Map(),bankLengths=new Map();let position=header.dataOffset,recursive=0,bankBytes=0,copyBytes=0;
  while(position<end){
    const command=bytes[position],enough=count=>{if(position+count>end)fail('truncated command stream.');};
    if(![0xbb,0x61,0x62,0x63,0x66,0x67,0x90,0x91,0x92,0x93,0x94,0x95].includes(command)&&!(command>=0x70&&command<=0x7f))fail(`unsupported command ${hex(command)}.`);
    enough(command===0x67?7:1);const length=rawCommandLength(bytes,view,position);enough(length);
    if(command===0x66)return;
    if(command===0xbb){
      const address=bytes[position+1];if((address>>>7)>=chipCount)fail('second-chip write requires the dual-chip header flag.');
      if((address&127)>15)fail('register must be 0x00..0x0f.');
    }else if(command===0x67){
      if(bytes[position+1]!==0x66)fail('invalid data-block marker.');
      if(view.getUint32(position+3,true)&0x80000000)fail('chip-indexed data banks are unsupported.');
      const bank=bytes[position+2],size=length-7;
      if(bank>=0x40)fail('only uncompressed DAC data banks are supported.');
      bankBytes+=size;if(bankBytes>POKEY_VGM_IMPORT_LIMITS.bankBytes)fail('data banks exceed 16 MiB.');
      const joined=(bankLengths.get(bank)??0)+size;copyBytes+=joined;
      if(copyBytes>POKEY_VGM_IMPORT_LIMITS.bankCopyBytes)fail('fragmented data banks exceed the bank-copy work limit.');
      bankLengths.set(bank,joined);const list=blocks.get(bank)??[];list.push(size);blocks.set(bank,list);
    }else if(command>=0x90&&command<=0x95){
      const id=bytes[position+1];
      if(command===0x90){
        const target=bytes[position+2];
        if(id===255||(target&127)!==0x1e||(target>>>7)>=chipCount)fail('DAC streams must target a declared POKEY (type 0x1e / 0x9e).');
        if(bytes[position+4]>15)fail('DAC register must be 0x00..0x0f.');
        configured.set(id,{}); // POKEY's stream port byte is unused by the format.
      }else if(!(command===0x94&&id===255)){
        if(id===255||!configured.has(id))fail('DAC stream must first select a POKEY target.');
        const stream=configured.get(id);
        if(command===0x91){if(bytes[position+2]>=0x40||!bytes[position+3])fail('invalid DAC bank or zero step.');stream.bank=bytes[position+2];}
        else if(command===0x92){stream.frequency=view.getUint32(position+2,true);if(!stream.frequency)fail('DAC frequency must be positive.');}
        else if(command===0x93||command===0x95){
          if(!stream.frequency||stream.bank===undefined||!blocks.has(stream.bank))fail('DAC start requires a frequency and existing data bank.');
          if(command===0x93){const mode=bytes[position+6];if((mode&~0x93)||(mode&15)>3)fail('unsupported DAC length/flag mode.');if((mode&15)===0&&!stream.started)fail('DAC resume requires an earlier stream length.');}
          else{if(bytes[position+4]&~0x11)fail('unsupported fast DAC flags.');if(view.getUint16(position+2,true)>=blocks.get(stream.bank).length)fail('DAC block does not exist.');}
          stream.started=true;
        }
      }
    }
    if(command===0x67||command>=0x90&&command<=0x95){if(++recursive>POKEY_VGM_IMPORT_LIMITS.recursiveCommands)fail('too many consecutive metadata commands.');}else recursive=0;
    position+=length;
  }
  fail('missing end command.');
}

function walk(buffer,{packStreams=true,retain=true}={}){
  if(!Number.isInteger(buffer?.byteLength)||buffer.byteLength>POKEY_VGM_IMPORT_LIMITS.sourceBytes)fail('source exceeds 16 MiB or is not binary data.');
  const parser=new Ym2612VGM(buffer,{logger:{warn:message=>fail(`cannot preserve this stream: ${message}`)}}),{clock,chipCount}=checkHeader(parser);
  validateCommands(parser,chipCount);
  const events=[],stores=Array.from({length:chipCount},()=>({chunks:[],offset:0,size:0,run:null,previous:0}));
  let time=0,writes=0,ordinaryWrites=0,streamWrites=0,entries=0,packedBytes=0,inDirect=false;
  const budget=()=>{if(entries>POKEY_VGM_IMPORT_LIMITS.entries||entries*32+packedBytes>POKEY_VGM_IMPORT_LIMITS.timelineBytes)fail('prepared data exceeds the 8 MiB conversion/work limit.');};
  const appendEvent=event=>{entries++;budget();if(retain)events.push(event);};
  const appendByte=(store,value)=>{store.size++;packedBytes++;budget();if(!retain)return;
    let chunk=store.chunks.at(-1);if(!chunk||store.offset===chunk.length){chunk=new Uint8Array(65536);store.chunks.push(chunk);store.offset=0;}chunk[store.offset++]=value;
  };
  const capture=(chipIndex,register,value)=>{
    if(chipIndex>=chipCount||!Number.isInteger(register)||register<0||register>15)fail('write targets an undeclared chip or invalid register.');
    writes++;const store=stores[chipIndex];
    if(packStreams&&!inDirect){
      if(!store.run){store.run={type:'packed',chipIndex,time,offset:store.size,length:0,count:0,endTime:time};store.previous=time;appendEvent(store.run);}
      let delta=time-store.previous;do{const byte=delta%128;delta=Math.floor(delta/128);appendByte(store,byte|(delta?128:0));}while(delta);
      appendByte(store,register);appendByte(store,value);streamWrites++;store.run.count++;store.run.length=store.size-store.run.offset;store.run.endTime=time;store.previous=time;
    }else{store.run=null;ordinaryWrites++;appendEvent(retain?{type:'register',chipIndex,register,value,time}:null);}
  };
  const targets={resolveChip:(type,index)=>{if(type!=='pokey'||index>=chipCount)fail('unexpected playback target.');return {writeRegister:(r,v)=>capture(index,r,v)};}};
  for(;;){
    const position=parser.position,event=parser.step();
    if(parser.position<=position)fail('parser did not advance.');
    if(event.type==='end')break;
    if(event.type==='wait'){
      if(!Number.isInteger(event.samples)||event.samples<0||time+event.samples>POKEY_VGM_IMPORT_LIMITS.durationSamples)fail('invalid or excessive sample duration.');
      inDirect=false;parser.consumeWait(targets,event.samples,samples=>{time+=samples;});
    }else if(event.type==='pokey-write'){
      inDirect=true;capture(event.chipIndex,event.register,event.value);
    }else fail(`unexpected event ${event.type}.`);
  }
  if(!writes)fail('no POKEY writes were found.');
  const stats={clock,chipCount,time,durationSamples:time,writes,ordinaryWrites,streamWrites,packedBytes};
  if(!retain)return stats;
  const packedData=new Uint8Array(packedBytes);let offset=0;
  for(const [chipIndex,store] of stores.entries()){
    for(const event of events)if(event.type==='packed'&&event.chipIndex===chipIndex)event.offset+=offset;
    let cursor=offset;for(const [i,chunk] of store.chunks.entries()){const bytes=i===store.chunks.length-1?chunk.subarray(0,store.offset):chunk;packedData.set(bytes,cursor);cursor+=bytes.length;}offset+=store.size;
  }
  return {...stats,events,packedData};
}
export const readPokeyVgm=(buffer,options={})=>walk(buffer,options);
export const validatePokeyVgm=buffer=>walk(buffer,{retain:false});

function highOperation(event,next,state,clock){
  const {register:r,value:v,time}=event,ch=r>>1;
  if(r<8&&!(r&1)){
    const lower=ch&2,joined=!!(state[8]&(lower?8:16));
    if(joined){
      if(ch!==lower||next?.type!=='register'||next.register!==r+2||next.time!==time)return null;
      const high=!!(state[8]&(lower?32:64)),divider=high?1:state[8]&1?114:28,period=v|(next.value<<8),offset=high?7:1;
      return {code:`setFrequency(${ch+1}, ${clock/(2*divider*(period+offset))})`,count:2};
    }
    const high=!(ch&1)&&!!(state[8]&(lower?32:64)),divider=high?1:state[8]&1?114:28,offset=high?4:1;
    return {code:`setFrequency(${ch}, ${clock/(2*divider*(v+offset))})`,count:1};
  }
  if(r<8&&(r&1)){
    if((v&31)===(state[r]&31))return {code:`setDistortion(${ch}, ${v>>5})`,count:1};
    if((v&239)===(state[r]&239))return {code:`setVolumeOnly(${ch}, ${!!(v&16)})`,count:1};
    if((state[r]&15)&&(v&240)===(state[r]&240))return {code:`setVolume(${ch}, ${v&15})`,count:1};
  }
  if(r===8){
    if((v&254)===(state[r]&254))return {code:`setBaseClock('${v&1?'15khz':'64khz'}')`,count:1};
    if((v&127)===(state[r]&127))return {code:`setPoly9(${!!(v&128)})`,count:1};
  }
  return null;
}
function explain(event){const {register:r,value:v}=event;return r<8?`CH${(r>>1)+1} ${r&1?`AUDC distortion ${v>>5}, volume ${v&15}, volume-only ${!!(v&16)}`:`AUDF ${v}; shared AUDCTL controls the divider`}`:
  ({8:'AUDCTL: shared clocks, joined pairs, filters and polynomial selection',9:'STIMER: restart counters',15:'SKCTL: polynomial / serial control'})[r]??'original hardware register write';}

/** Editable one-pass score; all playback styles preserve the exact bytes. */
export function exportPokeyVgm(buffer,{mode='raw',writeDataFile}={}){
  if(!['raw','readable','high'].includes(mode))throw new Error('Unknown POKEY conversion mode.');
  const {events,time,clock,chipCount,packedData}=readPokeyVgm(buffer),lines=[];let characters=0;
  const append=line=>{characters+=line.length+1;if(characters>POKEY_VGM_IMPORT_LIMITS.sourceCharacters)fail('generated JavaScript exceeds 64 MiB.');lines.push(line);};
  ['// POKEY VGM: one pass, original write order and 44100 Hz sample positions.',
    '// Prepare all data first; dual chips start on the same absolute audio frame.',
    '// Edit score.at(sample) and score operations. Dense stream bytes stay in the data file.'].forEach(append);
  if(packedData.length){const path=writeDataFile?.(packedData);
    append(path?`const pokeyData = new Uint8Array(await file(${JSON.stringify(path)}, {type: 'arrayBuffer'}));`:`const pokeyData = new Uint8Array([${packedData.join(',')}]);`);
    append(`if (pokeyData.length !== ${packedData.length}) throw new Error('POKEY data: invalid byte length.');`);
  }
  append('const pokeyChips = [];');append('try {');
  for(let index=0;index<chipCount;index++)append(`  pokeyChips.push(await createSoundChip('pokey', {clock: ${clock}}));`);
  for(let chipIndex=0;chipIndex<chipCount;chipIndex++){
    append(`  const score${chipIndex+1} = pokeyChips[${chipIndex}].createTimeline({clock: ${clock}${packedData.length?', packedData: pokeyData':''}});`);
    const score=`score${chipIndex+1}`,own=events.filter(event=>event.chipIndex===chipIndex),state=new Uint8Array(16);let previous=0,packed=false;
    if(mode==='high')append(`  ${score}.adoptRegisterState(); // Authoring only; no extra reset or setup writes.`);
    for(let i=0;i<own.length;i++){
      const event=own[i];if(event.time>previous)append(`  ${score}.at(${event.time});`);previous=event.time;
      if(event.type==='packed'){
        append(`  ${score}.packed(${event.offset}, ${event.length}, ${event.count}, ${event.endTime}); // ${event.count} original stream writes.`);
        previous=event.endTime;
        // Packed writes may edit any register. High substitutions after a run
        // cannot use a stale shadow; remaining ordinary writes stay raw.
        packed=true;continue;
      }
      const operation=mode==='high'&&!packed?highOperation(event,own[i+1],state,clock):null;
      const count=operation?.count??1;
      for(let j=0;j<count;j++)state[own[i+j].register]=own[i+j].value;
      append(`  ${score}.${operation?.code??`writeRegister(${hex(event.register)}, ${hex(event.value)})`};${mode==='raw'?'':` // sample ${event.time}: ${explain(event)}`}`);i+=count-1;
    }
    append(`  await pokeyChips[${chipIndex}].prepareTimeline(${score}.finish(${time}));`);
  }
  ['  const timing = await pokeyChips[0].getTimelineState();',
    '  const startFrame = timing.currentFrame + Math.ceil(timing.sampleRate * 0.25);',
    '  await Promise.all(pokeyChips.map(chip => chip.playTimeline({startFrame})));',
    '} finally {', '  for (const chip of pokeyChips) chip.dispose();', '}',''].forEach(append);
  return lines.join('\n');
}
