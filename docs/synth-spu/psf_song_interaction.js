// SPDX-License-Identifier: BSD-3-Clause
// Unclocked keyboard/control edits on the existing PSF SPU. Source ownership
// comes from native CPU-write revisions, never from diagnostic trace capacity.
import {patchPs1Envelope} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';

const integer=(value,min,max,name)=>{if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${name} must be ${min}..${max}`);return value;};
const channel=value=>integer(value,0,23,'PSF channel');
const finite=(value,min,max,name)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new RangeError(`${name} must be ${min}..${max}`);return value;};
const plain=(value,name)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`Invalid ${name}`);};
const identifier=id=>{if(typeof id!=='string'||!id.length||id.length>256)throw new TypeError('PSF note needs an id');return id;};
const volume=value=>Math.round(finite(value,-1,1,'Voice volume')*0x3fff)&0x7fff;
const keyRegister=(ch,on)=>(on?0x188:0x18c)+(ch>=16?2:0);
const keyBit=ch=>1<<(ch%16);
const transpose=(pitch,semitones)=>Math.max(1,Math.min(0x3fff,Math.round(pitch*2**(semitones/12))));

/** read/write use byte register offsets. revision/gateRevision/pitchRevision
 * report CPU writes only; sourceValue retains the last CPU-written word even
 * after a keyboard transposes it. Every method is synchronous and unclocked. */
export function createPsfSongInteraction({read,write,revision,sourceValue,gateRevision,pitchRevision,isOpen=()=>true}={}) {
  for(const fn of [read,write,revision,sourceValue,gateRevision,pitchRevision,isOpen])if(typeof fn!=='function')throw new TypeError('PSF interaction needs register/ownership callbacks');
  const notes=new Map(),slots=Array(24).fill(null),bases=Array(24).fill(null);
  let pitchBend=0,disposed=false;
  const open=()=>{if(disposed||!isOpen())throw new DOMException('PSF interaction is disposed','AbortError');};
  const word=offset=>{const value=read(offset);integer(value,0,0xffff,'SPU register');return value;};
  const sourceBase=ch=>{
    const at=ch*16+4,stamp=revision(at);
    if(!bases[ch]||bases[ch].revision!==stamp)bases[ch]={revision:stamp,pitch:sourceValue(at)&0x3fff};
    return bases[ch].pitch;
  };
  const gateOwned=note=>slots[note.channel]===note&&gateRevision(note.channel)===note.gateRevision;
  const pitchOwned=note=>gateOwned(note)&&note.pitchOwned&&pitchRevision(note.channel)===note.pitchRevision;
  function forget(note){notes.delete(note.id);if(slots[note.channel]===note)slots[note.channel]=null;}
  function describe(ch) {
    open();channel(ch);
    const control=word(0x1aa),maskAt=ch>=16?2:0,mask=keyBit(ch);
    const noise=Boolean(word(0x194+maskAt)&mask),hardwarePmon=ch>0&&Boolean(word(0x190+maskAt)&mask);
    const pitch=word(ch*16+4)&0x3fff,referencePitch=sourceBase(ch);
    const reason=(control&0xc000)!==0xc000?'The PSF SPU output is disabled.':
      !noise&&referencePitch===0?'The selected CH has no nonzero source PITCH.':'';
    return {playable:!reason,reason,channel:ch,pitch,referencePitch,noise,hardwarePmon};
  }
  function edit(ch,patch) {
    open();channel(ch);plain(patch,'PSF voice patch');
    const keys=Reflect.ownKeys(patch);
    if(keys.some(key=>typeof key!=='string'||!['volumeLeft','volumeRight','pitch','envelope'].includes(key)))throw new TypeError('Unsupported PSF voice parameter');
    const writes=[],base=ch*16;
    if(Object.hasOwn(patch,'volumeLeft'))writes.push([base,volume(patch.volumeLeft)]);
    if(Object.hasOwn(patch,'volumeRight'))writes.push([base+2,volume(patch.volumeRight)]);
    if(Object.hasOwn(patch,'pitch'))writes.push([base+4,integer(patch.pitch,0,0x3fff,'Pitch')]);
    if(Object.hasOwn(patch,'envelope')) {
      const current1=word(base+8),current2=word(base+10),next=patchPs1Envelope(current1,current2,patch.envelope);
      if(next.adsr1!==current1)writes.push([base+8,next.adsr1]);
      if(next.adsr2!==current2)writes.push([base+10,next.adsr2]);
    }
    // Validate the complete patch before making its first physical write.
    const accepted=structuredClone(patch);
    for(const [offset,value]of writes)if(word(offset)!==value)write(offset,value);
    if(Object.hasOwn(patch,'pitch')) {
      bases[ch]={revision:revision(base+4),pitch:patch.pitch};
      if(slots[ch])slots[ch].pitchOwned=false;
    }
    return {channel:ch,...accepted};
  }
  function noteOn(id,ch,midi,options={}) {
    open();identifier(id);channel(ch);integer(midi,0,127,'MIDI note');plain(options,'PSF note options');
    if(Reflect.ownKeys(options).some(key=>typeof key!=='string'||!['referenceMidi','referencePitch','bend'].includes(key)))throw new TypeError('Unsupported PSF note option');
    const referenceMidi=integer(options.referenceMidi??60,0,127,'Reference MIDI note'),bend=finite(options.bend??pitchBend,-24,24,'Pitch bend');
    const referencePitch=options.referencePitch===undefined?sourceBase(ch):integer(options.referencePitch,0,0x3fff,'Reference pitch');
    const state=describe(ch);
    if(!state.playable)throw new Error(state.reason);
    if(!state.noise&&!referencePitch)throw new RangeError('PSF keyboard needs a nonzero reference pitch');
    const old=slots[ch],previous=notes.get(id),basePitch=state.noise?0:transpose(referencePitch,midi-referenceMidi);
    const pitch=state.noise?state.pitch:transpose(basePitch,bend);
    // An identifier may be moved to another physical CH, releasing only its
    // still-owned gate. No source channel outside that old lease is stopped.
    if(previous&&previous!==old)noteOff(id);
    if(old)forget(old);
    if(!state.noise)write(ch*16+4,pitch);
    write(keyRegister(ch,true),keyBit(ch));
    const note={id,channel:ch,basePitch,pitchOwned:!state.noise,noise:state.noise,
      gateRevision:gateRevision(ch),pitchRevision:pitchRevision(ch)};
    notes.set(id,note);slots[ch]=note;
    return {id,channel:ch,stolenId:old&&old.id!==id?old.id:null,pitch,noise:state.noise};
  }
  function noteOff(id) {
    open();identifier(id);const note=notes.get(id);if(!note)return false;
    const owned=gateOwned(note);forget(note);
    if(owned)write(keyRegister(note.channel,false),keyBit(note.channel));
    return owned;
  }
  function setPitchBend(value) {
    open();finite(value,-24,24,'Pitch bend');pitchBend=value;let changed=false;
    for(const note of notes.values())if(pitchOwned(note)) {
      write(note.channel*16+4,transpose(note.basePitch,value));changed=true;
    }
    return changed;
  }
  function releaseAll() {
    open();let changed=false;
    for(const id of [...notes.keys()])changed=noteOff(id)||changed;
    pitchBend=0;return changed;
  }
  return {edit,noteOn,noteOff,setPitchBend,releaseAll,describe,
    dispose(){if(disposed)return;if(isOpen())releaseAll();disposed=true;notes.clear();slots.fill(null);bases.fill(null);}};
}
