/** RF5C164 software note helpers. No device, clock or waveform inference. */
import {noteToHz} from './soundchip_pitch.js';

/** @typedef {0|1|2|3|4|5|6|7} RF5C164NoteChannel */
/** @param {number} channel */
const checkChannel=channel=>{
  if(!Number.isInteger(channel)||channel<0||channel>7)throw new RangeError('RF5C164 channel must be 0..7');
};
/** @param {number} step */
const checkStep=step=>{
  if(!Number.isInteger(step)||step<0||step>65535)throw new RangeError('RF5C164 raw step must be 0..65535');
};

/** Validate a note name or integer MIDI 0..127, returning MIDI. No Hz input.
 * @param {string|number} note @returns {number} */
export function rf5c164MidiNote(note) {
  return Math.round(69+12*Math.log2(noteToHz(note)/440));
}

/** Transpose a declared raw reference speed. This does not infer sample pitch.
 * @param {string|number} note
 * @param {{rootNote?:string|number,baseStep:number}} options
 * @returns {number} Rounded hardware step, clamped to 1..65535. */
export function rf5c164NoteStep(note,{rootNote=60,baseStep}) {
  const midi=rf5c164MidiNote(note),root=rf5c164MidiNote(rootNote);
  if(typeof baseStep!=='number'||!Number.isFinite(baseStep)||baseStep<=0)throw new RangeError('RF5C164 notes need a positive reference step');
  return Math.max(1,Math.min(65535,Math.round(baseStep*2**((midi-root)/12))));
}

/** Keep declared raw speeds separate from temporary musical transposition. */
export class RF5C164NoteTuning {
  constructor() {
    this.rootNote=60;
    this.selected=0;
    /** @type {(number|null)[]} */
    this.referenceSteps=new Array(8).fill(null);
    this.actualSteps=new Uint16Array(8);
  }
  /** Change future note conversions only; null returns to C4.
   * @param {string|number|null} note @returns {number} */
  setRootNote(note) {
    const next=note===null?60:rf5c164MidiNote(note);
    this.rootNote=next;return next;
  }
  /** Observe a successful raw channel operation. Omitting step keeps its basis.
   * @param {number} channel @param {{step?:number}} options
   * @param {boolean} [reference=true] Whether this is an authored raw write. */
  observeChannel(channel,options,reference=true) {
    checkChannel(channel);
    if(options.step!==undefined)checkStep(options.step);
    this.selected=channel;
    if(options.step===undefined)return;
    this.actualSteps[channel]=options.step;
    if(reference)this.referenceSteps[channel]=options.step;
  }
  /** Track actual physical register values, including partial step byte writes.
   * @param {number} register @param {number} value
   * @param {boolean} [reference=true] Musical writes must pass false. */
  observeRegister(register,value,reference=true) {
    if(!Number.isInteger(register)||register<0||register>8||!Number.isInteger(value)||value<0||value>255)throw new RangeError('Invalid RF5C164 register observation');
    if(register===7){if(value&64)this.selected=value&7;return;}
    if(register!==2&&register!==3)return;
    const old=this.actualSteps[this.selected];
    const step=register===2?(old&65280)|value:(old&255)|(value<<8);
    this.observeChannel(this.selected,{step},reference);
  }
  /** @param {RF5C164NoteChannel} channel @param {string|number} note @returns {number} */
  noteStep(channel,note) {
    checkChannel(channel);
    const midi=rf5c164MidiNote(note),baseStep=this.referenceSteps[channel];
    if(baseStep===null||baseStep<=0)throw new Error(`Set a positive raw playback step for RF5C164 CH${channel+1} before using note helpers`);
    return rf5c164NoteStep(midi,{rootNote:this.rootNote,baseStep});
  }
  /** @param {number} channel @param {number} step */
  observeNoteStep(channel,step) {this.observeChannel(channel,{step},false);}
  /** Raw reset clears register/reference speeds while retaining software Root. */
  reset() {this.selected=0;this.referenceSteps.fill(null);this.actualSteps.fill(0);}
  getState() {return {rootNote:this.rootNote,selected:this.selected,referenceSteps:this.referenceSteps.slice(),actualSteps:Array.from(this.actualSteps)};}
}

/**
 * @typedef {Object} RF5C164AsyncNoteControls
 * @property {(note:string|number|null)=>number} setRootNote Software Root; null means C4, not detected pitch.
 * @property {(channel:RF5C164NoteChannel,note:string|number)=>Promise<number>} setNote Set the transposed raw step without retriggering.
 * @property {(channel:RF5C164NoteChannel,note:string|number)=>Promise<void>} noteOn Set pitch and retrigger the physical channel.
 * @property {(channel:RF5C164NoteChannel)=>Promise<void>} noteOff Hard hardware key off.
 */
const decorated=new WeakMap();
/** Add note controls to the same asynchronous raw facade without new RPCs.
 * Await successful raw step configuration before using a note helper. Clock
 * changes retain hardware semantics: the same raw reference step detunes too.
 * @template {{setChannel:(channel:number,options:{step?:number})=>unknown,setPitch:(channel:number,step:number)=>unknown,
 * keyOn:(channel:number)=>unknown,keyOff:(channel:number)=>unknown,writeRegister:(register:number,value:number)=>unknown,reset:()=>unknown}} T
 * @param {T} client @returns {T & RF5C164AsyncNoteControls}
 */
export function attachRf5c164NoteControls(client) {
  if(decorated.has(client))return decorated.get(client);
  const methods=['setChannel','setPitch','keyOn','keyOff','writeRegister','reset'];
  if(!client||methods.some(name=>typeof client[name]!=='function'))throw new TypeError('RF5C164 notes need a complete raw client');
  const original=Object.fromEntries(methods.map(name=>[name,client[name].bind(client)]));
  const tuning=new RF5C164NoteTuning();let musicalDepth=0;
  /** @type {{before?:(command:{method:string,args:number[]})=>boolean|void,observe?:(command:{method:string,args:number[]})=>void}} */
  let noteLifecycle={};
  // Runtime ownership follows emitted raw gates. A rejected musical note never
  // reaches this point and cannot claim a channel held by another liveLoop.
  const gate=(method,channel)=>{
    try {
      checkChannel(channel);
      const command={method,args:[channel]};
      if(noteLifecycle.before?.(command)===false)return Promise.resolve();
      const result=original[method](channel);
      noteLifecycle.observe?.(command);
      return Promise.resolve(result);
    }catch(error){return Promise.reject(error);}
  };
  const musical=fn=>{musicalDepth++;try{return fn();}finally{musicalDepth--;}};
  const wrap=(name,observe)=>{
    client[name]=(...args)=>{
      const reference=musicalDepth===0,result=original[name](...args);
      if(name==='reset')noteLifecycle.observe?.({method:'reset',args:[]});
      // MessagePort copied the options when the raw call was issued. Keep
      // that same declaration if the author edits their object before its ACK.
      const observed=name==='setChannel'?[args[0],{step:args[1]?.step}]:args.slice();
      return Promise.resolve(result).then(value=>{observe(observed,reference);return value;});
    };
  };
  wrap('setChannel',([channel,options],reference)=>tuning.observeChannel(channel,options,reference));
  wrap('setPitch',([channel,step],reference)=>tuning.observeChannel(channel,{step},reference));
  wrap('writeRegister',([register,value],reference)=>tuning.observeRegister(register,value,reference));
  wrap('reset',()=>tuning.reset());
  client.keyOn=channel=>gate('keyOn',channel);
  client.keyOff=channel=>gate('keyOff',channel);
  Object.defineProperty(client,'_setNoteLifecycle',{value:hooks=>{noteLifecycle=hooks;}});
  const controls={
    /** @param {string|number|null} note */
    setRootNote:note=>tuning.setRootNote(note),
    /** @param {RF5C164NoteChannel} channel @param {string|number} note @returns {Promise<number>} */
    async setNote(channel,note) {
      const step=tuning.noteStep(channel,note);
      await musical(()=>original.setPitch(channel,step));
      tuning.observeNoteStep(channel,step);return step;
    },
    /** @param {RF5C164NoteChannel} channel @param {string|number} note @returns {Promise<void>} */
    async noteOn(channel,note) {
      const step=tuning.noteStep(channel,note);
      // Keep both raw calls in one stack: Native ownership/performance scopes
      // are attached synchronously and their existing FIFO preserves ordering.
      const pending=musical(()=>[original.setPitch(channel,step),gate('keyOn',channel)]);
      await Promise.all(pending);tuning.observeNoteStep(channel,step);
    },
    /** @param {RF5C164NoteChannel} channel @returns {Promise<void>} */
    async noteOff(channel) {checkChannel(channel);await gate('keyOff',channel);},
  };
  const result=Object.assign(client,controls);
  decorated.set(client,result);return result;
}
