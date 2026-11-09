import {setSynthSongVoiceFrequency} from './synth_song_voice.js?v=vgm-mix-copy-1';

const integer=(name,value,max)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${name} must be an integer in range 0..${max}`);
  return value;
};

/** Detached, validated OP gates and optional CH3 tuning for an editable voice. */
export function normalizeCapturedVoice(value) {
  if(value==null)return null;
  if(typeof value!=='object')throw new TypeError('Captured voice must be an object');
  const keyMask=integer('Captured keyMask',value.keyMask,15);
  if(typeof value.specialMode!=='boolean')throw new TypeError('Captured specialMode must be a boolean');
  const specialMode=value.specialMode;
  if(!Array.isArray(value.specialFrequencies)||value.specialFrequencies.length!==(specialMode?4:0))throw new Error('Invalid captured special frequencies');
  const specialFrequencies=value.specialFrequencies.map(pitch=>({
    block:integer('Captured block',pitch?.block,7),fnum:integer('Captured fnum',pitch?.fnum,2047),
  }));
  if(specialMode&&!specialFrequencies[3].fnum)throw new Error('Captured CH3 requires an OP4 base frequency above zero');
  return {keyMask,specialMode,specialFrequencies};
}

export function normalizeCapturedCommand(command) {
  if(!command||!['capturedNoteOn','capturedFrequency','capturedKeyMask'].includes(command.type))throw new Error('Unknown captured performance command');
  const voice=normalizeCapturedVoice(command.voice);
  if(!voice)throw new Error('A captured performance command requires voice settings');
  const channel=integer('Captured channel',command.channel,5);
  if(voice.specialMode&&channel!==2)throw new Error('Captured CH3 performance must use channel 3');
  if(command.type==='capturedKeyMask')return {type:command.type,channel,voice};
  return {type:command.type,channel,block:integer('Captured note block',command.block,7),
    fnum:integer('Captured note fnum',command.fnum,2047),voice};
}

/** Apply already-validated captured performance without changing its FM patch. */
export function applyCapturedCommand(synth,command) {
  const {channel,block,fnum,voice}=command;
  const operators=[0,1,2,3].filter(operator=>voice.keyMask&(1<<operator));
  if(command.type==='capturedKeyMask') {
    // A key register write leaves operators whose bits stay On running. Do
    // not retrigger the channel or touch pitch while editing a held note.
    return operators.length?synth.keyOn(channel,operators):synth.noteOff(channel);
  }
  // CH3 special is a property of CH3 alone. Other FM channels must not turn
  // off an independently playing CH3 unit when they receive a normal note.
  if(voice.specialMode||channel===2)synth.setChannel3SpecialMode(voice.specialMode);
  if(command.type==='capturedNoteOn')synth.noteOff(channel);
  setSynthSongVoiceFrequency(synth,channel,block,fnum,voice.specialMode?voice.specialFrequencies:null);
  if(command.type==='capturedNoteOn'&&operators.length)synth.keyOn(channel,operators);
}

/**
 * A keyboard/looper target with the edited voice's OP mask and CH3 tuning.
 * A voice override replaces getVoice(); null means normal FM with all OPs On.
 * The recorder may wrap perform() to keep one musical command rather than
 * recording internal key/frequency writes a second time.
 */
export function createSynthPerformanceTarget({getSynth,getVoice=()=>null,onCapturedCommand=(_command,perform)=>perform()}) {
  if(typeof getSynth!=='function'||typeof getVoice!=='function'||typeof onCapturedCommand!=='function')throw new TypeError('Performance target callbacks must be functions');
  const select=override=>normalizeCapturedVoice(override===undefined?getVoice():override);
  function perform(type,channel,block,fnum,override) {
    const synth=getSynth();
    if(!synth)return;
    const voice=select(override);
    if(!voice||voice.keyMask===15&&!voice.specialMode) {
      return type==='capturedNoteOn'?synth.noteOn(channel,block,fnum):synth.setFrequency(channel,block,fnum);
    }
    const command=normalizeCapturedCommand({type,channel:voice.specialMode?2:channel,block,fnum,voice});
    return onCapturedCommand(command,()=>applyCapturedCommand(synth,command));
  }
  return {
    noteOn:(channel,block,fnum,voice)=>perform('capturedNoteOn',channel,block,fnum,voice),
    setFrequency:(channel,block,fnum,voice)=>perform('capturedFrequency',channel,block,fnum,voice),
    setKeyMask(channel,override) {
      const synth=getSynth();
      if(!synth)return;
      const voice=select(override)??{keyMask:15,specialMode:false,specialFrequencies:[]};
      const command=normalizeCapturedCommand({type:'capturedKeyMask',channel:voice.specialMode?2:channel,voice});
      return onCapturedCommand(command,()=>applyCapturedCommand(synth,command));
    },
    noteOff(channel,override) {
      const voice=select(override);
      return getSynth()?.noteOff(voice?.specialMode?2:channel);
    },
  };
}
