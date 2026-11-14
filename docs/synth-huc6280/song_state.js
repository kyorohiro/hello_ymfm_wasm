// SPDX-License-Identifier: BSD-3-Clause
// Passive sent-register/configured-RAM observation. No native phase is read.
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw RangeError(`${label} must be an integer 0..${max}`);return value;};
const freezeRows=rows=>Object.freeze(rows.map(row=>Object.freeze([...row])));

function model(clock,onChange=()=>{}) {
  let selected=null,revision=0,cache=null;
  const globals=Array(10).fill(null),registers=Array.from({length:8},()=>Array(8).fill(null));
  const waveforms=Array.from({length:8},()=>Array(32).fill(null)),indices=Array(8).fill(null);
  const ddaValues=Array(8).fill(null),ddaFrames=Array(8).fill(null),ddaWrites=Array(8).fill(0);
  function assign(kind,ch,index,value,frame,record=true) {
    const array=kind==='g'?globals:kind==='r'?registers[ch]:kind==='w'?waveforms[ch]:kind==='i'?indices:
      kind==='d'?ddaValues:kind==='f'?ddaFrames:kind==='n'?ddaWrites:null;
    const at=['g','r','w'].includes(kind)?index:ch;
    if(kind==='s'){if(selected===value)return;selected=value;}
    else{if(array[at]===value)return;array[at]=value;}
    revision++;cache=null;if(record)onChange({kind,ch,index,value},frame);
  }
  function unknownWave(ch,frame){for(let i=0;i<32;i++)assign('w',ch,i,null,frame);}
  function write(register,value,frame=0) {
    integer(register,9,'HuC6280 register');integer(value,255,'HuC6280 byte');
    if(register===0){assign('s',0,0,value&7,frame);assign('g',0,0,value&7,frame);return;}
    if([1,8,9].includes(register)){assign('g',0,register,value,frame);return;}
    const channels=selected===null?[0,1,2,3,4,5,6,7]:[selected];
    for(const ch of channels) {
      const previous=registers[ch][4];
      if(selected===null){
        // A write to an unrecorded selector cannot safely identify its voice.
        assign('r',ch,register,null,frame);
        if(register===4)assign('i',ch,0,null,frame);
        if(register===6){unknownWave(ch,frame);assign('d',ch,0,null,frame);assign('f',ch,0,null,frame);}
        continue;
      }
      assign('r',ch,register,register===3?value&15:value,frame);
      if(register===4&&previous!==null&&(previous&64)&&!(value&64))assign('i',ch,0,0,frame);
      if(register!==6)continue;
      if(previous===null){unknownWave(ch,frame);assign('d',ch,0,null,frame);assign('f',ch,0,null,frame);}
      else if(previous&64){assign('d',ch,0,value&31,frame);assign('f',ch,0,frame,frame);assign('n',ch,0,ddaWrites[ch]+1,frame);}
      else if(indices[ch]===null)unknownWave(ch,frame);
      else{
        assign('w',ch,indices[ch],value&31,frame);
        if(!(previous&128))assign('i',ch,0,(indices[ch]+1)&31,frame);
      }
    }
  }
  function advance(frames,frame) {
    if(!frames)return;
    for(let ch=0;ch<8;ch++) {
      const control=registers[ch][4];
      if(control!==null&&(control&128)&&!(control&64)&&!(ch>=4&&registers[ch][7]!==null&&(registers[ch][7]&128)))assign('i',ch,0,null,frame);
    }
    const lfo=globals[9],carrier=registers[0][4];
    if(lfo!==null&&(lfo&3)&&carrier!==null&&(carrier&128)&&!(carrier&64))assign('i',1,0,lfo&128?0:null,frame);
  }
  function reset() {
    selected=null;globals.fill(null);registers.forEach(row=>row.fill(null));waveforms.forEach(row=>row.fill(null));
    indices.fill(null);ddaValues.fill(null);ddaFrames.fill(null);ddaWrites.fill(0);revision++;cache=null;
  }
  function snapshot(frame=0) {
    if(!cache)cache=Object.freeze({clock,revision,selectedChannel:selected,globals:Object.freeze([...globals]),
      registers:freezeRows(registers),waveforms:freezeRows(waveforms),indices:Object.freeze([...indices]),
      ddaValues:Object.freeze([...ddaValues]),ddaFrames:Object.freeze([...ddaFrames]),ddaWrites:Object.freeze([...ddaWrites]),
      observation:Object.freeze({kind:'song',registers:'sent',waveforms:'known-configured',phase:false,hardwareEnvelope:false,
        dda:'last-recorded-code',rootNote:false,sample:false})});
    return Object.freeze({...cache,positionFrames:frame});
  }
  return {write,advance,reset,snapshot,get selectedChannel(){return selected;},apply:change=>assign(change.kind,change.ch,change.index,change.value,0,false)};
}

export function createHuc6280RegisterState(clock=HUC6280_CLOCK) {
  if(clock!==HUC6280_CLOCK)throw RangeError('HuC6280 observation requires the normal PC Engine clock');
  return model(clock);
}

/** Writes are timestamped at generated PCM boundaries and merged by path at
 * the same frame. Even a fast DAC stream keeps just its final code per frame
 * and channel; consumed deltas are discarded. Observation failures disable
 * only the view and cannot alter the native write/render path. */
export function createHuc6280SongTimeline(engine,clock=HUC6280_CLOCK,{maxPendingChanges=131072}={}) {
  for(const method of ['writeHuc6280','writeHuc6280Stream','processFrames','reset'])if(typeof engine?.[method]!=='function')throw TypeError('Expected a HuC6280 VGM audio engine');
  if(clock!==HUC6280_CLOCK)throw RangeError('HuC6280 observation requires the normal PC Engine clock');
  integer(maxPendingChanges,1_000_000,'Pending Live change limit');
  const original={write:engine.writeHuc6280,stream:engine.writeHuc6280Stream,process:engine.processFrames,reset:engine.reset};
  let generated=0,readFrame=0,events=[],head=0,changes=0,error='',disposed=false,nativeWrites=0;
  const committed=model(clock),ahead=model(clock,record);
  function record(change,frame) {
    let event=events.at(-1);
    if(!event||event.frame!==frame){event={frame,changes:new Map()};events.push(event);}
    const key=`${change.kind}:${change.ch}:${change.index}`;
    if(!event.changes.has(key))changes++;
    event.changes.set(key,change);
    if(changes>maxPendingChanges)throw Error('HuC6280 pending Live observation limit exceeded');
  }
  function observe(action){if(!disposed&&!error)try{action();}catch(cause){error=cause?.message??String(cause);events=[];head=changes=0;}}
  function write(register,value) {
    const result=original.write.call(this,register,value);nativeWrites++;
    observe(()=>ahead.write(register&15,value,generated));return result;
  }
  function stream(port,register,value) {
    const before=nativeWrites,previous=ahead.selectedChannel;
    const result=original.stream.call(this,port,register,value);
    // The normal adapter calls the wrapped direct method (including selector
    // restore). A compatible injected adapter may emit the write internally.
    if(before===nativeWrites)observe(()=>{
      if(port!==255)ahead.write(register>>>4,port,generated);
      ahead.write(register&15,value,generated);
      if(port!==255){if(previous===null)throw Error('HuC6280 stream adapter did not expose its restored selector');ahead.write(register>>>4,previous,generated);}
    });
    return result;
  }
  function process(frames) {
    const pcm=original.process.call(this,frames);
    observe(()=>ahead.advance(frames,generated+Math.min(1,frames)));generated+=frames;return pcm;
  }
  function reset(...args) {
    const result=original.reset.apply(this,args);generated=readFrame=0;events=[];head=changes=0;error='';ahead.reset();committed.reset();return result;
  }
  engine.writeHuc6280=write;engine.writeHuc6280Stream=stream;engine.processFrames=process;engine.reset=reset;
  return {
    read(frame) {
      if(disposed)throw Error('HuC6280 song timeline is disposed');
      const next=Math.max(0,Math.min(generated,Math.floor(frame)));
      if(!Number.isFinite(next)||next<readFrame)throw RangeError('HuC6280 song observation cannot move backwards without reset');
      readFrame=next;if(error)return null;
      while(head<events.length&&events[head].frame<=next){for(const change of events[head].changes.values())committed.apply(change);changes-=events[head].changes.size;head++;}
      if(head===events.length){events=[];head=0;}else if(head>256){events=events.slice(head);head=0;}
      return committed.snapshot(next);
    },
    get generatedFrames(){return generated;},get pendingEvents(){return events.length-head;},get pendingChanges(){return changes;},get error(){return error;},
    dispose(){if(disposed)return;disposed=true;events=[];head=changes=0;
      if(engine.writeHuc6280===write)engine.writeHuc6280=original.write;
      if(engine.writeHuc6280Stream===stream)engine.writeHuc6280Stream=original.stream;
      if(engine.processFrames===process)engine.processFrames=original.process;
      if(engine.reset===reset)engine.reset=original.reset;},
  };
}
