import {MegaSynthRecordingManager} from '../js/megasynth_recording.js';
import {YM2612Synth} from '../js/ym2612synth.js';
import {applyCapturedCommand,normalizeCapturedCommand} from './synth_performance.js?v=op-gates-1';

export const SYNTH_RECORDING_FORMAT='tetorica-fm2612-synth-recording-v1';
const LEGACY_FORMAT='megasynth-recording-v1';
const CAPTURED_TYPES=new Set(['capturedNoteOn','capturedFrequency','capturedKeyMask']);
const LEGACY_TYPES=new Set(['reset','setOperator','setAlgo','setPan','setLfo','setDacEnabled','writeDac',
  'setChannel3SpecialMode','setChannel3SpecialFrequency','noteOn','noteOff']);
const MAX_TIMER_SECONDS=(0x7fffffff-1000)/1000;
const finiteTime=(value,label)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>MAX_TIMER_SECONDS)throw new RangeError(`${label} must be a finite nonnegative playback time`);
  return value;
};

/**
 * App recording extension for operator gates and copied CH3 tuning. Ordinary recordings
 * retain the shared v1 format. Captured commands use a distinct format so an
 * older player refuses them instead of silently replaying all operators.
 */
export class SynthRecordingManager extends MegaSynthRecordingManager {
  constructor(options={}) {
    super(options);
    this.onPlaybackStopped=options.onPlaybackStopped??(()=>{});
    this._performanceDepth=0;
  }

  _withoutRecording(perform) {
    this._performanceDepth++;
    try{return perform();}finally{this._performanceDepth--;}
  }

  recordCommand(command) {
    if(this._performanceDepth||this.playing)return;
    if(CAPTURED_TYPES.has(command?.type)) {
      const normalized=normalizeCapturedCommand(command);
      if(this.recording&&this.currentRecording)this.currentRecording.format=SYNTH_RECORDING_FORMAT;
      return super.recordCommand(normalized);
    }
    return super.recordCommand(command);
  }

  perform(command,perform) {
    const normalized=normalizeCapturedCommand(command);
    if(typeof perform!=='function')throw new TypeError('Captured performance needs an action');
    const result=this._withoutRecording(perform);
    this.recordCommand(normalized);
    return result;
  }

  play(recording=null,options={}) {
    // Validate everything before stopping playback, committing a take, or
    // touching the actual chip. Importing a bad file keeps the current sound.
    const selected=recording??this.exportRecording();
    if(!selected)return null;
    const normalized=this._normalizeRecording(selected);
    if(this.recording)this.stop();
    return this._withoutRecording(()=>super.play(normalized,options));
  }

  stopPlayback() {
    const wasPlaying=this.playing;
    this._withoutRecording(()=>super.stopPlayback());
    if(wasPlaying)this.onPlaybackStopped();
  }

  _applyCommand(command,options={}) {
    if(!this.synth||!this.playing)return;
    return this._withoutRecording(()=>CAPTURED_TYPES.has(command.type)
      ?applyCapturedCommand(this.synth,command):super._applyCommand(command,options));
  }

  _normalizeRecording(recording) {
    if(!recording||typeof recording!=='object'||![LEGACY_FORMAT,SYNTH_RECORDING_FORMAT].includes(recording.format))throw new Error(`Unsupported recording format: ${recording?.format}`);
    const captured=recording.format===SYNTH_RECORDING_FORMAT;
    if(recording.version!==undefined&&recording.version!==1)throw new Error('Unsupported recording version');
    if(captured&&recording.version!==1)throw new Error('Captured recordings require version 1');
    const normalized=structuredClone(recording);
    normalized.version??=1;
    finiteTime(normalized.durationSeconds,'Recording duration');
    if(!Array.isArray(normalized.commands))throw new TypeError('Recording commands must be an array');
    for(const command of normalized.commands) {
      if(!command||typeof command!=='object')throw new TypeError('Invalid recording command');
      finiteTime(command.time,'Command time');
      if(command.time>normalized.durationSeconds+1e-6)throw new Error('A command occurs after the recording ends');
      if(CAPTURED_TYPES.has(command.type)) {
        if(!captured)throw new Error('Captured performance requires the Synth recording format');
        Object.assign(command,normalizeCapturedCommand(command));
      } else if(captured&&!LEGACY_TYPES.has(command.type))throw new Error(`Unknown Synth recording command: ${command.type}`);
    }
    // Validate standard patch/command values using the public synth's range
    // checks on a no-output transport. This allocates no WASM/audio resources.
    const synth=new YM2612Synth({transport:{write(){},reset(){}}});
    const checker=new MegaSynthRecordingManager({synth});
    checker.playing=true;
    try {
      checker._applyInitialState(normalized.initialState,{});
      for(const command of normalized.commands) {
        if(CAPTURED_TYPES.has(command.type))applyCapturedCommand(synth,command);
        else checker._applyCommand(command,{});
      }
    } catch(error) {throw new Error(`Invalid recording data: ${error.message}`);}
    return normalized;
  }
}
